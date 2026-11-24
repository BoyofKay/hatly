/**
 * Media platform over real HTTP / PostgreSQL / the real sharp pipeline and the real local storage provider:
 * byte-based validation, limits, EXIF/GPS stripping, WebP variants, de-duplication, crop/aspect rules, purpose authorisation,
 * assignment (FK + legacy URL together), reference-aware deletion (B4), restore, purge that never touches referenced assets.
 */
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import sharp = require('sharp');
import { bootWorld, World } from './support/world';
import { Scenario, Actor, expectData } from './support/actors';
import { boundary } from './support/external-boundary';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — Media platform', () => {
  let world: World;
  let s: Scenario;
  let superAdmin: Actor;
  let area: { id: string };
  let seed = 0;

  /** A distinct solid-colour image (so de-duplication does not merge unrelated uploads). */
  const img = async (w: number, h: number, format: 'jpeg' | 'png' | 'webp' = 'jpeg', extra: { exif?: boolean } = {}) => {
    seed += 1;
    let p = sharp({ create: { width: w, height: h, channels: 3, background: { r: seed % 255, g: (seed * 7) % 255, b: (seed * 13) % 255 } } });
    if (extra.exif) p = p.withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'Secret Photographer', Artist: 'Someone' } } });
    return (format === 'jpeg' ? p.jpeg() : format === 'png' ? p.png() : p.webp()).toBuffer();
  };

  const upload = (a: Actor, buf: Buffer, fields: Record<string, string>, filename = 'photo.jpg') =>
    new Promise<{ status: number; body: any }>((resolve, reject) => {
      const boundaryStr = `----e2e${Math.random().toString(16).slice(2)}`;
      const parts: Buffer[] = [];
      for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundaryStr}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
      parts.push(Buffer.from(`--${boundaryStr}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`), buf, Buffer.from(`\r\n--${boundaryStr}--\r\n`));
      const body = Buffer.concat(parts);
      const url = new URL('/api/v1/admin/media/uploads', world.baseUrl);
      const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { authorization: `Bearer ${a.accessToken}`, 'content-type': `multipart/form-data; boundary=${boundaryStr}`, 'content-length': body.length } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }));
      });
      req.on('error', reject);
      req.end(body);
    });
  const get = (a: Actor, p: string, query?: Record<string, string | number>) => world.api('get', p, { token: a.accessToken, query });
  const post = (a: Actor, p: string, body: unknown = {}) => world.api('post', p, { token: a.accessToken, body });
  const fileOf = (url: string) => path.join(path.resolve(process.env.UPLOADS_LOCAL_DIR || './uploads-storage'), url.split('/').pop()!);

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    area = await s.serviceArea({ radiusMeters: 50000 });
    superAdmin = await s.superAdmin();
  });
  beforeEach(() => boundary.reset());
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('converts to WebP display + thumb variants (≤1600 / ≤320 px), strips EXIF/GPS metadata, applies orientation, stores no bytes in the database', async () => {
    const original = await img(2400, 1200, 'jpeg', { exif: true }); // EXIF orientation 6 (rotate 90°) → oriented image is 1200×2400
    expect((await sharp(original).metadata()).exif).toBeDefined(); // the source really carries metadata
    const res = await upload(superAdmin, original, { purpose: 'GENERAL', altEn: 'A test image' });
    expect(res.status).toBe(201);
    const a = res.body.data;
    expect(a.display.width).toBeLessThanOrEqual(1600);
    expect(a.display.height).toBeLessThanOrEqual(1600);
    expect(a.thumb.height).toBeLessThanOrEqual(320);
    expect(a.display.height).toBe(1600); // oriented: tall image, longest side scaled to 1600
    expect(a.mimeType).toBe('image/webp');
    expect(a.deduplicated).toBe(false);
    for (const v of [a.display, a.thumb]) {
      const stored = fs.readFileSync(fileOf(v.url));
      const meta = await sharp(stored).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.exif).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      expect(stored.length).toBe(v.bytes);
    }
    // metadata only in the database — no binary column exists on the media tables
    const cols = await world.ds.query(`SELECT data_type FROM information_schema.columns WHERE table_name IN ('media_assets','media_variants') AND data_type IN ('bytea','oid')`);
    expect(cols).toHaveLength(0);
    const audit = await world.ds.query(`SELECT 1 FROM admin_audit_logs WHERE action = 'media.uploaded' AND target_id = $1`, [a.id]);
    expect(audit).toHaveLength(1);
  });

  it('identical processed content is de-duplicated to the same asset', async () => {
    const buf = await img(600, 600, 'png');
    const first = (await upload(superAdmin, buf, { purpose: 'GENERAL' }, 'a.png')).body.data;
    const second = await upload(superAdmin, buf, { purpose: 'GENERAL' }, 'b.png');
    expect(second.body.data.id).toBe(first.id);
    expect(second.body.data.deduplicated).toBe(true);
  });

  it('rejects by BYTES, not by name or declared type: GIF, SVG, PDF, a renamed text file, corrupt and truncated images, oversize, too many pixels', async () => {
    const code = async (buf: Buffer, name = 'x.jpg', purpose = 'GENERAL') => {
      const r = await upload(superAdmin, buf, { purpose }, name);
      return [r.status, r.body.error?.details?.code];
    };
    expect(await code(Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;'), 'a.jpg')).toEqual([400, 'MEDIA_UNSUPPORTED_TYPE']);
    expect(await code(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'a.png')).toEqual([400, 'MEDIA_UNSUPPORTED_TYPE']);
    expect(await code(Buffer.from('%PDF-1.4 fake'), 'a.jpg')).toEqual([400, 'MEDIA_UNSUPPORTED_TYPE']);
    expect(await code(Buffer.from('just some text pretending to be a photo'), 'photo.jpg')).toEqual([400, 'MEDIA_UNSUPPORTED_TYPE']);
    const good = await img(800, 800, 'jpeg');
    expect(await code(good.subarray(0, Math.floor(good.length / 2)), 'trunc.jpg')).toEqual([400, 'MEDIA_CORRUPT']);
    expect(await code(Buffer.concat([good.subarray(0, 40), Buffer.alloc(300, 0xff)]), 'junk.jpg')).toEqual([400, 'MEDIA_CORRUPT']);
    expect((await code(Buffer.alloc(5 * 1024 * 1024 + 10, 1), 'big.jpg'))[0]).toBe(413); // refused while streaming (multipart limit), before any decoding
    expect((await code(await img(50, 50), 'tiny.jpg'))[1]).toBe('MEDIA_TOO_SMALL');
    expect((await code(await img(9000, 200), 'wide.jpg'))[1]).toBe('MEDIA_TOO_LARGE_DIMENSIONS');
    expect((await upload(superAdmin, good, { purpose: 'NOT_A_PURPOSE' })).body.error.details.code).toBe('MEDIA_PURPOSE_UNKNOWN');
    expect((await upload(superAdmin, good, { purpose: 'GENERAL', crop: '{"x":-1}' })).body.error.details.code).toBe('MEDIA_BAD_CROP');
  });

  it('a decompression bomb (> 40 megapixels) is refused before it is decoded', async () => {
    const huge = await sharp({ create: { width: 7000, height: 6000, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png({ compressionLevel: 9 }).toBuffer(); // 42 MP, tiny on the wire
    expect(huge.length).toBeLessThan(5 * 1024 * 1024);
    const res = await upload(superAdmin, huge, { purpose: 'GENERAL' }, 'bomb.png');
    expect(res.status).toBe(400);
    expect(['MEDIA_TOO_MANY_PIXELS', 'MEDIA_TOO_LARGE_DIMENSIONS']).toContain(res.body.error.details.code);
  });

  it('purpose rules: square and legacy banner artwork accepted, optional crop, logo centre-cropped square', async () => {
    const banner = await img(1600, 1200);
    expect((await upload(superAdmin, await img(1254, 1254), { purpose: 'HOME_BANNER' })).status).toBe(201);
    expect((await upload(superAdmin, banner, { purpose: 'HOME_BANNER' })).status).toBe(201);
    const cropped = await upload(superAdmin, banner, { purpose: 'HOME_BANNER', crop: JSON.stringify({ x: 100, y: 0, width: 1200, height: 1200 }) });
    expect(cropped.status).toBe(201);
    expect(cropped.body.data.width / cropped.body.data.height).toBeCloseTo(1, 1);
    expect((await upload(superAdmin, banner, { purpose: 'HOME_BANNER', crop: JSON.stringify({ x: 0, y: 900, width: 1600, height: 800 }) })).body.error.details.code).toBe('MEDIA_BAD_CROP');

    const logo = await upload(superAdmin, await img(900, 500), { purpose: 'VENDOR_LOGO' });
    expect(logo.status).toBe(201);
    expect(logo.body.data.width).toBe(logo.body.data.height); // centre-cropped square
  });

  it('purpose authorisation: a catalog admin uploads product images but not logos or banners; a user without any media permission is refused', async () => {
    const catalog = await s.admin([Permission.MANAGE_CATALOG]);
    const buf = await img(700, 700);
    expect((await upload(catalog, buf, { purpose: 'PRODUCT_PRIMARY' })).status).toBe(201);
    expect((await upload(catalog, await img(710, 710), { purpose: 'VENDOR_LOGO' })).status).toBe(403);
    expect((await upload(catalog, await img(1600, 700), { purpose: 'HOME_BANNER' })).status).toBe(403);
    const nobody = await s.admin([Permission.VIEW_ORDERS]);
    expect((await upload(nobody, await img(700, 700), { purpose: 'GENERAL' })).status).toBe(403);
    expect((await get(nobody, '/admin/media')).status).toBe(403);
    const customer = await s.customer();
    expect((await get(customer, '/admin/media')).status).toBe(403);
  });

  it('assignment writes the FK AND the legacy URL; usage lists the record; deletion is refused while referenced (API and database), allowed once unused; restore works', async () => {
    const v = await s.vendor({ name: 'Media Vendor', serviceAreaId: area.id, lat: 30.42, lng: 31.56 });
    const asset = (await upload(superAdmin, await img(800, 800), { purpose: 'VENDOR_LOGO' })).body.data;
    const set = expectData<any>(await post(superAdmin, '/admin/media/assign', { entity: 'vendor', entityId: v.vendorId, assetId: asset.id }), 201);
    expect(set.url).toBe(asset.display.url);
    const [row] = await world.ds.query(`SELECT logo_url, logo_media_asset_id FROM vendors WHERE id = $1`, [v.vendorId]);
    expect(row.logo_url).toBe(asset.display.url);
    expect(row.logo_media_asset_id).toBe(asset.id);

    const usage = expectData<any>(await get(superAdmin, `/admin/media/${asset.id}/usage`));
    expect(usage.references.map((r: any) => r.id)).toContain(v.vendorId);
    const del = await world.api('delete', `/admin/media/${asset.id}`, { token: superAdmin.accessToken });
    expect(del.status).toBe(409);
    expect(del.body.error.details.code).toBe('MEDIA_IN_USE');
    await expect(world.ds.query(`DELETE FROM media_assets WHERE id = $1`, [asset.id])).rejects.toThrow(/foreign key|violates/i); // the database itself refuses (ON DELETE RESTRICT)

    // wrong purpose is refused
    const sectorImg = (await upload(superAdmin, await img(500, 500), { purpose: 'SECTOR_IMAGE' })).body.data;
    expect((await post(superAdmin, '/admin/media/assign', { entity: 'vendor', entityId: v.vendorId, assetId: sectorImg.id })).status).toBe(400);
    // a different permission holder cannot change the vendor
    const catalog = await s.admin([Permission.MANAGE_CATALOG]);
    expect((await post(catalog, '/admin/media/assign', { entity: 'vendor', entityId: v.vendorId, assetId: asset.id })).status).toBe(403);

    // unassign, then the asset can be soft-deleted, restored, and appears in the library filters
    expectData(await post(superAdmin, '/admin/media/assign', { entity: 'vendor', entityId: v.vendorId, assetId: null }), 201);
    expect(expectData<any>(await world.api('delete', `/admin/media/${asset.id}`, { token: superAdmin.accessToken })).status).toBe('DELETED');
    const deleted = (await get(superAdmin, '/admin/media', { status: 'DELETED' })).body.data as any[];
    expect(deleted.map((x) => x.id)).toContain(asset.id);
    expect((await post(superAdmin, '/admin/media/assign', { entity: 'vendor', entityId: v.vendorId, assetId: asset.id })).status).toBe(409); // deleted asset cannot be assigned
    expect(expectData<any>(await post(superAdmin, `/admin/media/${asset.id}/restore`), 201).status).toBe('ACTIVE');
  });

  it('a product keeps ordered images (first = primary, mirrored to image_url); limits and states are validated; the library filters by purpose / usage / text', async () => {
    const v = await s.vendor({ name: 'Gallery Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    const p = await s.product(v, { priceMinor: 5000, inventoryMode: 'OPEN' });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await upload(superAdmin, await img(600 + i, 600), { purpose: 'PRODUCT_ADDITIONAL', altEn: `Gallery shot ${i}` })).body.data.id);
    const put = (assetIds: string[]) => world.api('put', `/admin/products/${p.id}/media`, { token: superAdmin.accessToken, body: { assetIds } });
    expect((await put(ids)).status).toBe(200);
    const rows = await world.ds.query(`SELECT media_asset_id, sort_order, is_primary FROM product_media WHERE product_id = $1 ORDER BY sort_order`, [p.id]);
    expect(rows.map((r: any) => r.media_asset_id)).toEqual(ids);
    expect(rows.map((r: any) => r.is_primary)).toEqual([true, false, false]);
    const [prod] = await world.ds.query(`SELECT image_url, media_asset_id FROM products WHERE id = $1`, [p.id]);
    expect(prod.media_asset_id).toBe(ids[0]);
    expect(prod.image_url).toContain('/uploads/files/');
    expect((await put([ids[0], ids[0]])).status).toBe(400); // duplicates
    expect((await put(Array.from({ length: 9 }, () => ids[0]))).status).toBe(400);
    expect((await put([ids[1], ids[0]])).status).toBe(200); // reorder: primary changes
    expect((await world.ds.query(`SELECT media_asset_id FROM products WHERE id = $1`, [p.id]))[0].media_asset_id).toBe(ids[1]);
    expect((await world.api('delete', `/admin/media/${ids[1]}`, { token: superAdmin.accessToken })).status).toBe(409); // a product's primary image is referenced

    const used = (await get(superAdmin, '/admin/media', { used: 'true', purpose: 'PRODUCT_ADDITIONAL' })).body.data as any[];
    expect(used.map((x) => x.id)).toEqual(expect.arrayContaining([ids[1], ids[0]]));
    const search = (await get(superAdmin, '/admin/media', { q: 'Gallery shot 2' })).body.data as any[];
    expect(search.map((x) => x.id)).toContain(ids[2]);
    const stats = expectData<any>(await get(superAdmin, '/admin/media/stats'));
    expect(stats.active).toBeGreaterThan(5);
  });

  it('purge never removes a referenced or historical image; it removes an unreferenced soft-deleted one after retention', async () => {
    const asset = (await upload(superAdmin, await img(640, 640), { purpose: 'GENERAL' })).body.data;
    const files = [fileOf(asset.display.url), fileOf(asset.thumb.url)];
    expect(files.every((f) => fs.existsSync(f))).toBe(true);
    expectData(await world.api('delete', `/admin/media/${asset.id}`, { token: superAdmin.accessToken }));
    // still within retention → not due
    expect(expectData<any>(await post(superAdmin, '/admin/media-purge', { dryRun: false }), 201).purged).not.toContain(asset.id);
    // due, but a historical order snapshot still points at the image → skipped
    await world.ds.query(`UPDATE media_assets SET purge_after = now() - interval '1 day' WHERE id = $1`, [asset.id]);
    const { v, product } = await (async () => {
      const vv = await s.vendor({ name: 'Snap Vendor', serviceAreaId: area.id, lat: 30.423, lng: 31.563 });
      return { v: vv, product: await s.product(vv, { priceMinor: 5000, inventoryMode: 'OPEN' }) };
    })();
    const c = await s.customer();
    const order = await s.simpleOrder(c, v, product.id, { lat: 30.425, lng: 31.565 });
    await world.ds.query(`UPDATE order_items SET product_image_url_snapshot = $2 WHERE order_vendor_segment_id IN (SELECT id FROM order_vendor_segments WHERE order_id = $1)`, [order.id, asset.display.url]);
    const blocked = expectData<any>(await post(superAdmin, '/admin/media-purge', { dryRun: false }), 201);
    expect(blocked.purged).not.toContain(asset.id);
    expect(blocked.skipped).toEqual(expect.arrayContaining([{ id: asset.id, reason: 'HISTORICAL_SNAPSHOT' }]));
    expect(files.every((f) => fs.existsSync(f))).toBe(true);
    // snapshot gone → dry run lists it, real run removes the files and marks PURGED
    await world.ds.query(`UPDATE order_items SET product_image_url_snapshot = NULL WHERE order_vendor_segment_id IN (SELECT id FROM order_vendor_segments WHERE order_id = $1)`, [order.id]);
    expect(expectData<any>(await post(superAdmin, '/admin/media-purge', { dryRun: true }), 201).purged).toContain(asset.id);
    expect(files.every((f) => fs.existsSync(f))).toBe(true);
    expect(expectData<any>(await post(superAdmin, '/admin/media-purge', { dryRun: false }), 201).purged).toContain(asset.id);
    expect(files.some((f) => fs.existsSync(f))).toBe(false);
    expect((await world.ds.query(`SELECT status FROM media_assets WHERE id = $1`, [asset.id]))[0].status).toBe('PURGED');
  });

  it('backfill registers a pre-existing local image WITHOUT touching its URL or file, and is idempotent', async () => {
    const dir = path.resolve(process.env.UPLOADS_LOCAL_DIR || './uploads-storage');
    fs.mkdirSync(dir, { recursive: true });
    const name = `${require('crypto').randomUUID()}.jpg`;
    const legacyBuf = await img(1200, 900, 'jpeg', { exif: true });
    fs.writeFileSync(path.join(dir, name), legacyBuf);
    const legacyUrl = `/uploads/files/${name}`;
    const v = await s.vendor({ name: 'Legacy Vendor', serviceAreaId: area.id, lat: 30.424, lng: 31.564 });
    await world.ds.query(`UPDATE vendors SET logo_url = $2 WHERE id = $1`, [v.vendorId, legacyUrl]);
    const run = expectData<any>(await post(superAdmin, '/admin/media-backfill', { limit: 50 }), 201);
    expect(run.processed).toBeGreaterThanOrEqual(1);
    const [a] = await world.ds.query(`SELECT id FROM media_assets WHERE legacy_source_url = $1`, [legacyUrl]);
    expect(a).toBeDefined();
    expect((await world.ds.query(`SELECT logo_url FROM vendors WHERE id = $1`, [v.vendorId]))[0].logo_url).toBe(legacyUrl); // URL unchanged
    expect(fs.readFileSync(path.join(dir, name)).equals(legacyBuf)).toBe(true); // original bytes untouched
    const view = expectData<any>(await get(superAdmin, `/admin/media/${a.id}`));
    expect(view.legacy).toBe(true);
    expect(view.thumb.url).not.toBe(legacyUrl);
    expect(expectData<any>(await get(superAdmin, `/admin/media/${a.id}/usage`)).references.map((r: any) => r.id)).toContain(v.vendorId); // found by URL
    const again = expectData<any>(await post(superAdmin, '/admin/media-backfill', { limit: 50 }), 201);
    expect((await world.ds.query(`SELECT count(*)::int AS n FROM media_assets WHERE legacy_source_url = $1`, [legacyUrl]))[0].n).toBe(1);
    expect(again.processed).toBe(0);
    // a legacy-referenced asset cannot be deleted either
    expect((await world.api('delete', `/admin/media/${a.id}`, { token: superAdmin.accessToken })).status).toBe(409);
  });
});

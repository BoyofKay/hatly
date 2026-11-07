/**
 * Multipart (multer) endpoints over real HTTP — the vendor Excel import and product-image upload. They had no end-to-end coverage
 * and are the only routes that parse `multipart/form-data` (multer, which carried several denial-of-service advisories fixed in
 * multer 2.3+; see docs/security/dependency-audit.md). Proves the upgraded parser still serves the real flows, enforces the size
 * limits, and bounds hostile multipart input without a 5xx.
 */
import * as http from 'http';
import * as XLSX from 'xlsx';
import * as request from 'supertest';
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, PNG_1X1_BASE64, expectData } from './support/actors';

const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('E2E — multipart uploads (Excel import, product image)', () => {
  let world: World;
  let s: Scenario;
  let vendor: VendorFixture;
  let product: { id: string; priceMinor: number };
  let customer: Actor;
  let otherArea: { id: string };

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    const area = await s.serviceArea({ radiusMeters: 50000 });
    vendor = await s.vendor({ name: 'Multipart Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    otherArea = area;
    product = await s.product(vendor, { name: 'Multipart Product', priceMinor: 10000, inventoryMode: 'OPEN' });
    customer = await s.customer('Multipart Customer');
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  const token = () => vendor.manager.accessToken;
  const post = (path: string) => request(world.baseUrl).post(`/api/v1${path}`).set('Authorization', `Bearer ${token()}`);

  const template = async (): Promise<Buffer> => {
    const res = await request(world.baseUrl)
      .get('/api/v1/vendor/products/import-template')
      .query({ vendorBranchId: vendor.branchId })
      .set('Authorization', `Bearer ${token()}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    return res.body as Buffer;
  };

  /** The downloaded template with the first product's price cell replaced. */
  const templateWithPrice = async (price: string): Promise<Buffer> => {
    const wb = XLSX.read(await template(), { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null });
    rows[1][3] = price;
    wb.Sheets[wb.SheetNames[0]] = XLSX.utils.aoa_to_sheet(rows);
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  };

  describe('Excel import', () => {
    it('the downloaded template is a real .xlsx and validates as READY with nothing changed', async () => {
      const file = await template();
      expect(file.subarray(0, 2).toString()).toBe('PK');
      const res = await post('/vendor/products/import/validate').attach('file', file, { filename: 'products.xlsx', contentType: xlsxMime });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ status: 'READY', changedRows: 0 });
    });

    it('validate never writes; apply re-validates the original file and updates the product exactly once', async () => {
      const changed = await templateWithPrice('125.50');
      const validate = await post('/vendor/products/import/validate').attach('file', changed, { filename: 'p.xlsx', contentType: xlsxMime });
      expect(validate.status).toBe(201);
      expect(validate.body.data).toMatchObject({ status: 'READY', changedRows: 1 });
      expect((await world.ds.query('SELECT price_minor FROM products WHERE id = $1', [product.id]))[0].price_minor).toBe(10000);

      const apply = await post('/vendor/products/import/apply').attach('file', changed, { filename: 'p.xlsx', contentType: xlsxMime });
      expect(apply.status).toBe(201);
      // R7: a vendor's price INCREASE from Excel goes to Hatly (the approved price stays live), exactly like on the screens
      expect(apply.body.data).toMatchObject({ updatedRows: 1, sentForApproval: 1 });
      expect((await world.ds.query('SELECT price_minor FROM products WHERE id = $1', [product.id]))[0].price_minor).toBe(10000);
      const [req] = await world.ds.query(`SELECT id, source, payload FROM product_change_requests WHERE product_id = $1 AND status = 'PENDING' AND kind = 'UPDATE'`, [product.id]);
      expect(req).toMatchObject({ source: 'EXCEL', payload: { priceMinor: 12550 } });
      const admin = await s.superAdmin();
      expect((await world.api('post', `/admin/product-change-requests/${req.id}/approve`, { token: admin.accessToken, body: {} })).status).toBe(201);
      expect((await world.ds.query('SELECT price_minor FROM products WHERE id = $1', [product.id]))[0].price_minor).toBe(12550);
    });

    it('a file over the 2 MB limit is refused with 413 and nothing is read', async () => {
      const res = await post('/vendor/products/import/validate').attach('file', Buffer.alloc(2 * 1024 * 1024 + 1024, 1), { filename: 'big.xlsx', contentType: xlsxMime });
      expect(res.status).toBe(413);
    });

    it('garbage that is not a spreadsheet is a clean 4xx, never a 5xx', async () => {
      const res = await post('/vendor/products/import/validate').attach('file', Buffer.from('definitely not a workbook'), { filename: 'x.xlsx', contentType: xlsxMime });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });

    it('a request with no file is a 400, not a 500', async () => {
      const res = await post('/vendor/products/import/validate').field('note', 'no file here');
      expect(res.status).toBe(400);
    });

    it('only vendor staff may use it', async () => {
      const res = await request(world.baseUrl).post('/api/v1/vendor/products/import/validate').set('Authorization', `Bearer ${customer.accessToken}`).attach('file', await template(), { filename: 'p.xlsx', contentType: xlsxMime });
      expect(res.status).toBe(403);
      expect((await request(world.baseUrl).post('/api/v1/vendor/products/import/validate').attach('file', await template(), 'p.xlsx')).status).toBe(401);
    });
  });

  describe('product image upload', () => {
    const png = Buffer.from(PNG_1X1_BASE64, 'base64');

    it('a real PNG is stored through the upload pipeline and referenced by a stable /uploads/files path', async () => {
      const res = await post(`/vendor/products/${product.id}/image`).attach('image', png, { filename: 'photo.png', contentType: 'image/png' });
      expect(res.status).toBe(201);
      // R7: a new image of a live product is a detail change Hatly approves first
      expect(res.body.data.pendingChange.payload.imageUrl).toMatch(/^\/uploads\/files\/[0-9a-f-]{36}\.png$/);
    });

    it('a file that merely CLAIMS to be an image (spoofed Content-Type) is rejected by byte inspection', async () => {
      const res = await post(`/vendor/products/${product.id}/image`).attach('image', Buffer.from('<html><script>alert(1)</script></html> padding padding'), { filename: 'evil.png', contentType: 'image/png' });
      expect(res.status).toBe(400);
    });

    it('an image over 5 MB is refused with 413', async () => {
      const res = await post(`/vendor/products/${product.id}/image`).attach('image', Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)]), { filename: 'big.png', contentType: 'image/png' });
      expect(res.status).toBe(413);
    });

    it('a missing file is a 400, and another vendor cannot upload to this product', async () => {
      expect((await post(`/vendor/products/${product.id}/image`).field('x', 'y')).status).toBe(400);
      const other = await s.vendor({ name: 'Other Vendor', serviceAreaId: otherArea.id, lat: 30.422, lng: 31.562 });
      const res = await request(world.baseUrl).post(`/api/v1/vendor/products/${product.id}/image`).set('Authorization', `Bearer ${other.manager.accessToken}`).attach('image', png, { filename: 'p.png', contentType: 'image/png' });
      expect([403, 404]).toContain(res.status);
    });
  });

  describe('hostile multipart input is bounded (multer DoS advisories)', () => {
    const raw = (path: string, boundary: string, body: string) =>
      new Promise<number>((resolve, reject) => {
        const u = new URL(world.baseUrl);
        const req = http.request(
          { host: u.hostname, port: u.port, method: 'POST', path: `/api/v1${path}`, agent: false, headers: { Authorization: `Bearer ${token()}`, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': Buffer.byteLength(body) } },
          (res) => { res.resume(); res.on('end', () => resolve(res.statusCode!)); },
        );
        req.setTimeout(10_000, () => req.destroy(new Error('request hung')));
        req.on('error', reject);
        req.end(body);
      });
    const part = (b: string, name: string, value: string) => `--${b}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;

    it.each([
      ['an enormous array index in a field name', 'x[999999999999]'],
      ['deeply nested field names', 'a' + '[b]'.repeat(5000)],
      ['an extremely long field name', 'f'.repeat(200_000)],
    ])('%s is answered promptly with a non-5xx status', async (_label, name) => {
      const b = '----hatlyboundary';
      const status = await raw(`/vendor/products/${product.id}/image`, b, part(b, name, 'v') + `--${b}--\r\n`);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
    });

    it('thousands of parts do not hang or crash the server, and it keeps serving afterwards', async () => {
      const b = '----hatlyboundary2';
      let body = '';
      for (let i = 0; i < 5000; i++) body += part(b, `field${i}`, 'v');
      const status = await raw('/vendor/products/import/validate', b, body + `--${b}--\r\n`);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
      expect((await world.api('get', '/health')).status).toBe(200);
    });
  });
});

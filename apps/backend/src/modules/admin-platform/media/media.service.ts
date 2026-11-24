import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import * as crypto from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import sharp = require('sharp');
import { UPLOAD_PROVIDER, UploadProvider } from '../../uploads/upload-provider.interface';
import { detectImageType } from '../../uploads/image-validation';
import { Permission } from '../../permissions/permission.enum';
import { PermissionsService } from '../../permissions/permissions.service';
import { assertUuid, likeTerm, num, pageParams, returned } from '../common/platform-sql';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_PIXELS = 40_000_000;
const DISPLAY_EDGE = 1600;
const THUMB_EDGE = 320;
const retentionDays = () => Number(process.env.MEDIA_RETENTION_DAYS ?? 30);

export interface PurposePolicy {
  permission: Permission;
  minWidth: number;
  minHeight: number;
  maxEdge: number;
  /** Centre-crop to a square when no explicit crop is given. */
  square?: boolean;
  /** Accepted width/height range of the FINAL image (the existing banner rule: ~2:1). */
  aspect?: { min: number; max: number };
}

/** Purpose → who may upload and what the image must satisfy. Policy data, in one place; the upload errors quote these limits. */
export const PURPOSES: Record<string, PurposePolicy> = {
  VENDOR_LOGO: { permission: Permission.MANAGE_VENDORS, minWidth: 200, minHeight: 200, maxEdge: 4000, square: true },
  BRANCH_COVER: { permission: Permission.MANAGE_VENDORS, minWidth: 800, minHeight: 400, maxEdge: 6000 },
  SECTOR_IMAGE: { permission: Permission.MANAGE_MARKETPLACE_SECTORS, minWidth: 200, minHeight: 200, maxEdge: 4000 },
  SECTOR_BANNER: { permission: Permission.MANAGE_MARKETPLACE_SECTORS, minWidth: 320, minHeight: 320, maxEdge: 6000 },
  SUBCATEGORY_IMAGE: { permission: Permission.MANAGE_MARKETPLACE_SECTORS, minWidth: 200, minHeight: 200, maxEdge: 4000 },
  HOME_BANNER: { permission: Permission.MANAGE_HOME_BANNERS, minWidth: 320, minHeight: 320, maxEdge: 6000 },
  PRODUCT_PRIMARY: { permission: Permission.MANAGE_CATALOG, minWidth: 300, minHeight: 300, maxEdge: 6000 },
  PRODUCT_ADDITIONAL: { permission: Permission.MANAGE_CATALOG, minWidth: 300, minHeight: 300, maxEdge: 6000 },
  CATALOG_PRODUCT: { permission: Permission.MANAGE_CATALOG, minWidth: 300, minHeight: 300, maxEdge: 6000 },
  GENERAL: { permission: Permission.MANAGE_MEDIA, minWidth: 100, minHeight: 100, maxEdge: 8000 },
};

export interface AssignTarget {
  table: string;
  fk: string;
  urlColumn: string | null;
  purposes: string[];
  permission: Permission;
}
export const ASSIGN_TARGETS: Record<string, AssignTarget> = {
  vendor: { table: 'vendors', fk: 'logo_media_asset_id', urlColumn: 'logo_url', purposes: ['VENDOR_LOGO', 'GENERAL'], permission: Permission.MANAGE_VENDORS },
  branch_cover: { table: 'vendor_branches', fk: 'cover_media_asset_id', urlColumn: null, purposes: ['BRANCH_COVER', 'GENERAL'], permission: Permission.MANAGE_VENDORS },
  sector: { table: 'marketplace_sectors', fk: 'media_asset_id', urlColumn: 'image_url', purposes: ['SECTOR_IMAGE', 'GENERAL'], permission: Permission.MANAGE_MARKETPLACE_SECTORS },
  subcategory: { table: 'marketplace_subcategories', fk: 'media_asset_id', urlColumn: 'image_url', purposes: ['SUBCATEGORY_IMAGE', 'GENERAL'], permission: Permission.MANAGE_MARKETPLACE_SECTORS },
  banner: { table: 'home_banners', fk: 'media_asset_id', urlColumn: 'image_url', purposes: ['HOME_BANNER'], permission: Permission.MANAGE_HOME_BANNERS },
  product: { table: 'products', fk: 'media_asset_id', urlColumn: 'image_url', purposes: ['PRODUCT_PRIMARY', 'GENERAL'], permission: Permission.MANAGE_CATALOG },
  catalog_product: { table: 'catalog_products', fk: 'media_asset_id', urlColumn: 'image_url', purposes: ['CATALOG_PRODUCT', 'PRODUCT_PRIMARY', 'GENERAL'], permission: Permission.MANAGE_CATALOG },
};

const err = (status: 400 | 403 | 404 | 409, code: string, message: string, extra: Record<string, unknown> = {}) => {
  const body = { message, details: { code, ...extra } };
  if (status === 403) return new ForbiddenException(body);
  if (status === 404) return new NotFoundException(body);
  if (status === 409) return new ConflictException(body);
  return new BadRequestException(body);
};

@Injectable()
export class MediaService {
  constructor(
    private readonly ds: DataSource,
    private readonly permissions: PermissionsService,
    private readonly config: ConfigService,
    @Inject(UPLOAD_PROVIDER) private readonly provider: UploadProvider,
  ) {
    sharp.concurrency(Number(process.env.MEDIA_SHARP_THREADS ?? 2));
    sharp.cache(false);
  }

  // ----------------------------------------------------------------- upload pipeline

  async upload(
    file: { buffer: Buffer; originalname?: string },
    input: { purpose: string; crop?: string; altEn?: string; altAr?: string },
    actor: { id: string; role: string },
  ) {
    const policy = PURPOSES[input.purpose];
    if (!policy) throw err(400, 'MEDIA_PURPOSE_UNKNOWN', `Unknown purpose. Use one of: ${Object.keys(PURPOSES).join(', ')}.`);
    const allowed = (await this.permissions.actorHolds(actor, policy.permission)) || (await this.permissions.actorHolds(actor, Permission.MANAGE_MEDIA));
    if (!allowed) throw err(403, 'MEDIA_PURPOSE_FORBIDDEN', 'You are not allowed to upload images for this purpose.');
    if (!file?.buffer?.length) throw err(400, 'MEDIA_EMPTY', 'No file was received.');
    if (file.buffer.length > MAX_FILE_BYTES) throw err(400, 'MEDIA_FILE_TOO_LARGE', `The file is ${file.buffer.length} bytes; the limit is ${MAX_FILE_BYTES} bytes (5 MB).`);

    // Type from the BYTES (never the declared MIME type or the file name): JPEG, PNG or WebP only.
    const detected = detectImageType(file.buffer);
    if (!detected) throw err(400, 'MEDIA_UNSUPPORTED_TYPE', 'Only JPEG, PNG and WebP images are accepted (GIF, SVG, HEIC and PDF are rejected).');

    let crop: { x: number; y: number; width: number; height: number } | null = null;
    if (input.crop) {
      try {
        const c = JSON.parse(input.crop);
        if ([c.x, c.y, c.width, c.height].every((n) => Number.isInteger(n) && n >= 0) && c.width > 0 && c.height > 0) crop = c;
      } catch {
        /* handled below */
      }
      if (!crop) throw err(400, 'MEDIA_BAD_CROP', 'The crop must be {x, y, width, height} in whole source pixels.');
    }

    let processed: { display: Buffer; displayInfo: sharp.OutputInfo; thumb: Buffer; thumbInfo: sharp.OutputInfo };
    try {
      processed = await this.process(file.buffer, policy, crop);
    } catch (error: any) {
      if (error?.getStatus) throw error;
      const m = String(error?.message ?? '');
      if (/pixel limit/i.test(m)) throw err(400, 'MEDIA_TOO_MANY_PIXELS', `The image exceeds ${MAX_PIXELS / 1_000_000} megapixels.`);
      throw err(400, 'MEDIA_CORRUPT', 'The image is corrupt or truncated and could not be read.');
    }

    const sha256 = crypto.createHash('sha256').update(processed.display).digest('hex');
    const [existing] = await this.ds.query(`SELECT id FROM media_assets WHERE sha256 = $1 AND status = 'ACTIVE' AND legacy_source_url IS NULL`, [sha256]);
    if (existing) return { ...(await this.get(existing.id)), deduplicated: true };

    const stored: string[] = [];
    try {
      const displayUrl = (await this.provider.store({ base64Content: processed.display.toString('base64'), filename: 'image.webp' })).url;
      stored.push(displayUrl);
      const thumbUrl = (await this.provider.store({ base64Content: processed.thumb.toString('base64'), filename: 'thumb.webp' })).url;
      stored.push(thumbUrl);
      const id = await this.ds.transaction(async (m) => {
        const [asset] = await m.query(
          `INSERT INTO media_assets (purpose, original_name, mime_type, bytes, width, height, sha256, alt_en, alt_ar, uploaded_by_user_id)
           VALUES ($1,$2,'image/webp',$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [input.purpose, this.safeName(file.originalname), processed.display.length, processed.displayInfo.width, processed.displayInfo.height, sha256, input.altEn?.slice(0, 200) ?? null, input.altAr?.slice(0, 200) ?? null, actor.id],
        );
        await m.query(`INSERT INTO media_variants (asset_id, name, storage_key, url, width, height, bytes, mime_type) VALUES ($1,'DISPLAY',$2,$3,$4,$5,$6,'image/webp'), ($1,'THUMB',$7,$8,$9,$10,$11,'image/webp')`, [
          asset.id, this.keyOf(displayUrl), displayUrl, processed.displayInfo.width, processed.displayInfo.height, processed.display.length, this.keyOf(thumbUrl), thumbUrl, processed.thumbInfo.width, processed.thumbInfo.height, processed.thumb.length,
        ]);
        return asset.id as string;
      });
      return { ...(await this.get(id)), deduplicated: false };
    } catch (error) {
      // Compensation: nothing stored may outlive a failed upload.
      for (const url of stored) await this.provider.remove?.(url).catch(() => false);
      throw error;
    }
  }

  private safeName(name?: string): string | null {
    if (!name) return null;
    return path.basename(name).replace(/[^\w.\- ؀-ۿ]/g, '_').slice(0, 120);
  }

  private keyOf(url: string): string {
    return url.split('/').pop() ?? url;
  }

  /** decode strictly (pixel limit) → auto-orient → crop → WebP display (≤1600 px) + thumb (≤320 px). Output carries NO metadata (EXIF/GPS/ICC stripped). */
  private async process(buf: Buffer, policy: PurposePolicy, crop: { x: number; y: number; width: number; height: number } | null) {
    const base = () => sharp(buf, { limitInputPixels: MAX_PIXELS, failOn: 'error' });
    const meta = await base().metadata();
    if ((meta.pages ?? 1) > 1) throw err(400, 'MEDIA_ANIMATED_NOT_ALLOWED', 'Animated images are not accepted.');
    if (!meta.width || !meta.height) throw err(400, 'MEDIA_CORRUPT', 'The image dimensions could not be read.');
    const swap = (meta.orientation ?? 1) >= 5;
    const w = swap ? meta.height : meta.width;
    const h = swap ? meta.width : meta.height;
    if (Math.max(w, h) > policy.maxEdge) throw err(400, 'MEDIA_TOO_LARGE_DIMENSIONS', `The image is ${w}×${h}; the longest side may not exceed ${policy.maxEdge} px for this purpose.`);

    let pipeline: sharp.Sharp;
    let finalW = w;
    let finalH = h;
    if (crop || policy.square) {
      // Orient FIRST (raw pixels), then crop in the oriented coordinate system the editor showed.
      const { data, info } = await base().rotate().raw().toBuffer({ resolveWithObject: true });
      let region = crop ?? { x: Math.floor((info.width - Math.min(info.width, info.height)) / 2), y: Math.floor((info.height - Math.min(info.width, info.height)) / 2), width: Math.min(info.width, info.height), height: Math.min(info.width, info.height) };
      if (region.x + region.width > info.width || region.y + region.height > info.height) throw err(400, 'MEDIA_BAD_CROP', 'The crop lies outside the image.');
      pipeline = sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).extract({ left: region.x, top: region.y, width: region.width, height: region.height });
      finalW = region.width;
      finalH = region.height;
    } else {
      pipeline = base().rotate();
    }
    if (finalW < policy.minWidth || finalH < policy.minHeight) throw err(400, 'MEDIA_TOO_SMALL', `The image is ${finalW}×${finalH}; this purpose needs at least ${policy.minWidth}×${policy.minHeight} px.`);
    if (policy.aspect) {
      const ratio = finalW / finalH;
      if (ratio < policy.aspect.min || ratio > policy.aspect.max) throw err(400, 'MEDIA_BAD_ASPECT', `The image is ${finalW}×${finalH} (ratio ${ratio.toFixed(2)}); this purpose needs a ratio between ${policy.aspect.min} and ${policy.aspect.max}. Crop it first.`);
    }
    const display = await pipeline.clone().resize({ width: DISPLAY_EDGE, height: DISPLAY_EDGE, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    const thumb = await pipeline.clone().resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer({ resolveWithObject: true });
    return { display: display.data, displayInfo: display.info, thumb: thumb.data, thumbInfo: thumb.info };
  }

  // ----------------------------------------------------------------- library

  private view(a: any, variants: any[], usageCount?: number) {
    const byName = Object.fromEntries(variants.map((v) => [v.name, v]));
    const vv = (v: any) => (v ? { url: v.url, width: v.width, height: v.height, bytes: v.bytes } : null);
    return {
      id: a.id, purpose: a.purpose, status: a.status, originalName: a.original_name, mimeType: a.mime_type, bytes: a.bytes, width: a.width, height: a.height, altEn: a.alt_en, altAr: a.alt_ar, tags: a.tags,
      createdAt: new Date(a.created_at).toISOString(), uploadedBy: a.uploaded_by_user_id, legacy: Boolean(a.legacy_source_url), deletedAt: a.deleted_at, purgeAfter: a.purge_after,
      display: vv(byName.DISPLAY ?? byName.ORIGINAL), thumb: vv(byName.THUMB ?? byName.DISPLAY ?? byName.ORIGINAL), usageCount: usageCount ?? undefined,
    };
  }

  async get(id: string) {
    assertUuid(id, 'id');
    const [a] = await this.ds.query(`SELECT * FROM media_assets WHERE id = $1`, [id]);
    if (!a) throw err(404, 'MEDIA_NOT_FOUND', 'Media asset not found.');
    const variants = await this.ds.query(`SELECT * FROM media_variants WHERE asset_id = $1`, [id]);
    return this.view(a, variants, (await this.usage(id)).references.length);
  }

  async list(q: { purpose?: string; status?: string; used?: string; q?: string; page?: string | number; limit?: string | number }) {
    const { page, limit, offset } = pageParams(q, 24, 60);
    const params: unknown[] = [];
    const where: string[] = [];
    params.push(q.status === 'DELETED' ? 'DELETED' : 'ACTIVE');
    where.push(`a.status = $${params.length}`);
    if (q.purpose) { params.push(q.purpose); where.push(`a.purpose = $${params.length}`); }
    if (q.q) { params.push(likeTerm(q.q)); where.push(`(a.original_name ILIKE $${params.length} ESCAPE '\\' OR a.alt_en ILIKE $${params.length} ESCAPE '\\' OR a.alt_ar ILIKE $${params.length} ESCAPE '\\')`); }
    const usedSql = `(EXISTS (SELECT 1 FROM vendors x WHERE x.logo_media_asset_id = a.id) OR EXISTS (SELECT 1 FROM vendor_branches x WHERE x.cover_media_asset_id = a.id) OR EXISTS (SELECT 1 FROM marketplace_sectors x WHERE x.media_asset_id = a.id OR EXISTS (SELECT 1 FROM media_variants v WHERE v.asset_id = a.id AND v.url IN (x.banner_url, x.banner_url_ar)) OR a.legacy_source_url IN (x.banner_url, x.banner_url_ar))
      OR EXISTS (SELECT 1 FROM marketplace_subcategories x WHERE x.media_asset_id = a.id) OR EXISTS (SELECT 1 FROM home_banners x WHERE x.media_asset_id = a.id OR EXISTS (SELECT 1 FROM media_variants v WHERE v.asset_id = a.id AND v.url = x.image_url_ar) OR a.legacy_source_url = x.image_url_ar) OR EXISTS (SELECT 1 FROM products x WHERE x.media_asset_id = a.id)
      OR EXISTS (SELECT 1 FROM catalog_products x WHERE x.media_asset_id = a.id) OR EXISTS (SELECT 1 FROM product_media x WHERE x.media_asset_id = a.id))`;
    if (q.used === 'true') where.push(usedSql);
    if (q.used === 'false') where.push(`NOT ${usedSql}`);
    const w = `WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM media_assets a ${w}`, params);
    const rows = await this.ds.query(`SELECT a.*, ${usedSql} AS used FROM media_assets a ${w} ORDER BY a.created_at DESC, a.id LIMIT ${limit} OFFSET ${offset}`, params);
    const ids = rows.map((r: any) => r.id);
    const variants = ids.length ? await this.ds.query(`SELECT * FROM media_variants WHERE asset_id = ANY($1)`, [ids]) : [];
    return { items: rows.map((r: any) => ({ ...this.view(r, variants.filter((v: any) => v.asset_id === r.id)), used: r.used })), page, limit, total };
  }

  async stats() {
    const [s] = await this.ds.query(`SELECT count(*) FILTER (WHERE status = 'ACTIVE')::int AS active, count(*) FILTER (WHERE status = 'DELETED')::int AS deleted, count(*) FILTER (WHERE legacy_source_url IS NOT NULL)::int AS legacy, coalesce(sum(bytes) FILTER (WHERE status <> 'PURGED'), 0)::bigint AS bytes FROM media_assets`);
    const [v] = await this.ds.query(`SELECT coalesce(sum(v.bytes), 0)::bigint AS variant_bytes FROM media_variants v JOIN media_assets a ON a.id = v.asset_id WHERE a.status <> 'PURGED'`);
    const list = await this.list({ used: 'false', limit: 1 });
    return { active: s.active, softDeleted: s.deleted, legacyRegistered: s.legacy, displayBytes: num(s.bytes), storedBytes: num(v.variant_bytes), unreferenced: list.total, retentionDays: retentionDays() };
  }

  async update(id: string, input: { altEn?: string; altAr?: string; tags?: string[] }) {
    assertUuid(id, 'id');
    const tags = Array.isArray(input.tags) ? input.tags.map((t) => String(t).slice(0, 30)).slice(0, 12) : null;
    const rows = returned(await this.ds.query(`UPDATE media_assets SET alt_en = coalesce($2, alt_en), alt_ar = coalesce($3, alt_ar), tags = coalesce($4, tags), updated_at = now() WHERE id = $1 RETURNING id`, [id, input.altEn?.slice(0, 200) ?? null, input.altAr?.slice(0, 200) ?? null, tags]));
    if (!rows[0]) throw err(404, 'MEDIA_NOT_FOUND', 'Media asset not found.');
    return this.get(id);
  }

  // ----------------------------------------------------------------- usage / references (B4)

  /** Every record that references the asset: by FK (active records) and by the stored URL (legacy references and historical snapshots). */
  async usage(id: string) {
    const urls: string[] = (await this.ds.query(`SELECT url FROM media_variants WHERE asset_id = $1`, [id])).map((r: any) => r.url);
    const [legacy] = await this.ds.query(`SELECT legacy_source_url FROM media_assets WHERE id = $1`, [id]);
    if (legacy?.legacy_source_url) urls.push(legacy.legacy_source_url);
    const refs = await this.ds.query(
      `SELECT 'vendor' AS type, id, name AS label, 'logo' AS field FROM vendors WHERE (logo_media_asset_id = $1 OR logo_url = ANY($2)) AND deleted_at IS NULL
       UNION ALL SELECT 'branch_cover', id, name, 'cover' FROM vendor_branches WHERE cover_media_asset_id = $1 AND deleted_at IS NULL
       UNION ALL SELECT 'sector', id, name, 'image' FROM marketplace_sectors WHERE (media_asset_id = $1 OR image_url = ANY($2) OR image_url_ar = ANY($2)) AND deleted_at IS NULL
       UNION ALL SELECT 'sector', id, name, 'banner (EN)' FROM marketplace_sectors WHERE banner_url = ANY($2) AND deleted_at IS NULL
       UNION ALL SELECT 'sector', id, name, 'banner (AR)' FROM marketplace_sectors WHERE banner_url_ar = ANY($2) AND deleted_at IS NULL
       UNION ALL SELECT 'subcategory', id, name, 'image' FROM marketplace_subcategories WHERE (media_asset_id = $1 OR image_url = ANY($2) OR image_url_ar = ANY($2)) AND deleted_at IS NULL
       UNION ALL SELECT 'banner', id, title, 'image' FROM home_banners WHERE (media_asset_id = $1 OR image_url = ANY($2) OR image_url_ar = ANY($2)) AND deleted_at IS NULL
       UNION ALL SELECT 'product', id, name, 'primary image' FROM products WHERE (media_asset_id = $1 OR image_url = ANY($2) OR image_url_ar = ANY($2)) AND deleted_at IS NULL
       UNION ALL SELECT 'product', p.id, p.name, 'additional image' FROM product_media pm JOIN products p ON p.id = pm.product_id WHERE pm.media_asset_id = $1 AND pm.is_primary = false AND p.deleted_at IS NULL
       UNION ALL SELECT 'catalog_product', id, name, 'image' FROM catalog_products WHERE (media_asset_id = $1 OR image_url = ANY($2)) AND deleted_at IS NULL`,
      [id, urls],
    );
    const [snap] = await this.ds.query(`SELECT count(*)::int AS n FROM order_items WHERE product_image_url_snapshot = ANY($1)`, [urls]);
    return { references: refs.map((r: any) => ({ type: r.type, id: r.id, label: r.label, field: r.field })), historicalSnapshots: snap.n };
  }

  // ----------------------------------------------------------------- assignment (FK + legacy *_url written together)

  async assign(entity: string, entityId: string, assetId: string | null, actor: { id: string; role: string }) {
    const t = ASSIGN_TARGETS[entity];
    if (!t) throw err(400, 'VALIDATION_FAILED', `entity must be one of ${Object.keys(ASSIGN_TARGETS).join(', ')}.`);
    assertUuid(entityId, 'entityId');
    if (!(await this.permissions.actorHolds(actor, t.permission))) throw err(403, 'FORBIDDEN', 'You do not have permission to change this record.');
    return this.ds.transaction(async (m) => {
      const [row] = await m.query(`SELECT id FROM ${t.table} WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [entityId]);
      if (!row) throw err(404, 'NOT_FOUND', 'Record not found.');
      if (assetId === null) {
        // Unassign: drop the FK and, when the legacy URL column is nullable AND still holds this asset's image, clear it too —
        // otherwise the record would keep pointing at the image and the image could never be deleted (B4).
        const [cur] = await m.query(`SELECT ${t.fk} AS asset_id FROM ${t.table} WHERE id = $1`, [entityId]);
        await m.query(`UPDATE ${t.table} SET ${t.fk} = NULL, updated_at = now() WHERE id = $1`, [entityId]);
        if (t.urlColumn && cur?.asset_id) {
          const [nullable] = await m.query(`SELECT is_nullable FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`, [t.table, t.urlColumn]);
          if (nullable?.is_nullable === 'YES') {
            await m.query(`UPDATE ${t.table} SET ${t.urlColumn} = NULL WHERE id = $1 AND ${t.urlColumn} IN (SELECT url FROM media_variants WHERE asset_id = $2)`, [entityId, cur.asset_id]);
          }
        }
        if (entity === 'sector') await m.query(`UPDATE marketplace_sectors SET image_url = NULL WHERE id = $1`, [entityId]);
        if (entity === 'product') await m.query(`DELETE FROM product_media WHERE product_id = $1 AND is_primary`, [entityId]);
        return { entity, entityId, assetId: null };
      }
      assertUuid(assetId, 'assetId');
      const [a] = await m.query(`SELECT * FROM media_assets WHERE id = $1`, [assetId]);
      if (!a) throw err(404, 'MEDIA_NOT_FOUND', 'Media asset not found.');
      if (a.status !== 'ACTIVE') throw err(409, 'MEDIA_NOT_ACTIVE', 'This asset is deleted. Restore it first.');
      if (!t.purposes.includes(a.purpose)) throw err(400, 'MEDIA_PURPOSE_MISMATCH', `This image was uploaded for ${a.purpose}; ${entity} accepts ${t.purposes.join(' or ')}.`);
      const [display] = await m.query(`SELECT url FROM media_variants WHERE asset_id = $1 AND name IN ('DISPLAY','ORIGINAL') ORDER BY CASE name WHEN 'DISPLAY' THEN 0 ELSE 1 END LIMIT 1`, [assetId]);
      await m.query(`UPDATE ${t.table} SET ${t.fk} = $2${t.urlColumn ? `, ${t.urlColumn} = $3` : ''}, updated_at = now() WHERE id = $1`, t.urlColumn ? [entityId, assetId, display.url] : [entityId, assetId]);
      if (entity === 'product') {
        await m.query(`DELETE FROM product_media WHERE product_id = $1 AND is_primary`, [entityId]);
        await m.query(`UPDATE product_media SET sort_order = sort_order + 1 WHERE product_id = $1`, [entityId]);
        await m.query(`DELETE FROM product_media WHERE product_id = $1 AND media_asset_id = $2`, [entityId, assetId]);
        await m.query(`INSERT INTO product_media (product_id, media_asset_id, sort_order, is_primary) VALUES ($1,$2,0,true)`, [entityId, assetId]);
      }
      return { entity, entityId, assetId, url: display.url };
    });
  }

  /** A product's current ordered images (primary first), with their asset views. */
  async productImages(productId: string) {
    assertUuid(productId, 'productId');
    const rows = await this.ds.query(`SELECT a.*, pm.sort_order FROM product_media pm JOIN media_assets a ON a.id = pm.media_asset_id WHERE pm.product_id = $1 ORDER BY pm.sort_order, a.id`, [productId]);
    const ids = rows.map((r: any) => r.id);
    const variants = ids.length ? await this.ds.query(`SELECT * FROM media_variants WHERE asset_id = ANY($1)`, [ids]) : [];
    return rows.map((a: any) => this.view(a, variants.filter((v: any) => v.asset_id === a.id)));
  }

  /** A product's ordered images: the first is the primary (also written to products.image_url). At most PRODUCT_MAX_IMAGES. */
  async setProductImages(productId: string, assetIds: string[], actor: { id: string; role: string }) {
    assertUuid(productId, 'productId');
    const max = Number(process.env.PRODUCT_MAX_IMAGES ?? 8);
    if (!Array.isArray(assetIds) || assetIds.length > max || new Set(assetIds).size !== assetIds.length) throw err(400, 'VALIDATION_FAILED', `Provide between 0 and ${max} distinct image ids.`);
    if (!(await this.permissions.actorHolds(actor, Permission.MANAGE_CATALOG))) throw err(403, 'FORBIDDEN', 'You do not have permission to change products.');
    for (const id of assetIds) assertUuid(id, 'assetIds');
    return this.ds.transaction(async (m) => {
      const [p] = await m.query(`SELECT id FROM products WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [productId]);
      if (!p) throw err(404, 'NOT_FOUND', 'Product not found.');
      const assets = assetIds.length ? await m.query(`SELECT a.id, a.status, a.purpose, (SELECT url FROM media_variants v WHERE v.asset_id = a.id AND v.name IN ('DISPLAY','ORIGINAL') ORDER BY CASE v.name WHEN 'DISPLAY' THEN 0 ELSE 1 END LIMIT 1) AS url FROM media_assets a WHERE a.id = ANY($1)`, [assetIds]) : [];
      const byId = new Map<string, any>(assets.map((a: any) => [a.id, a]));
      for (const id of assetIds) {
        const a = byId.get(id);
        if (!a) throw err(404, 'MEDIA_NOT_FOUND', 'One of the images does not exist.');
        if (a.status !== 'ACTIVE') throw err(409, 'MEDIA_NOT_ACTIVE', 'One of the images is deleted.');
        if (!['PRODUCT_PRIMARY', 'PRODUCT_ADDITIONAL', 'GENERAL'].includes(a.purpose)) throw err(400, 'MEDIA_PURPOSE_MISMATCH', 'One of the images was not uploaded for products.');
      }
      await m.query(`DELETE FROM product_media WHERE product_id = $1`, [productId]);
      for (let i = 0; i < assetIds.length; i++) await m.query(`INSERT INTO product_media (product_id, media_asset_id, sort_order, is_primary) VALUES ($1,$2,$3,$4)`, [productId, assetIds[i], i, i === 0]);
      if (assetIds.length > 0) await m.query(`UPDATE products SET media_asset_id = $2, image_url = $3, updated_at = now() WHERE id = $1`, [productId, assetIds[0], byId.get(assetIds[0]).url]);
      else await m.query(`UPDATE products SET media_asset_id = NULL, updated_at = now() WHERE id = $1`, [productId]);
      return { productId, assetIds };
    });
  }

  // ----------------------------------------------------------------- lifecycle: soft delete, restore, purge (never a referenced asset)

  async remove(id: string, actorId: string) {
    assertUuid(id, 'id');
    const u = await this.usage(id);
    if (u.references.length > 0) throw err(409, 'MEDIA_IN_USE', `This image is used by ${u.references.length} record(s). Replace it there first.`, { references: u.references.slice(0, 20) });
    try {
      const rows = returned(await this.ds.query(`UPDATE media_assets SET status = 'DELETED', deleted_at = now(), deleted_by_user_id = $2, purge_after = now() + ($3 || ' days')::interval, updated_at = now() WHERE id = $1 AND status = 'ACTIVE' RETURNING id`, [id, actorId, String(retentionDays())]));
      if (!rows[0]) throw err(404, 'MEDIA_NOT_FOUND', 'Media asset not found or already deleted.');
    } catch (e: any) {
      if (e?.code === '23503') throw err(409, 'MEDIA_IN_USE', 'This image is still referenced.');
      throw e;
    }
    return { id, status: 'DELETED', purgeAfterDays: retentionDays() };
  }

  async restore(id: string) {
    assertUuid(id, 'id');
    const rows = returned(await this.ds.query(`UPDATE media_assets SET status = 'ACTIVE', deleted_at = NULL, deleted_by_user_id = NULL, purge_after = NULL, updated_at = now() WHERE id = $1 AND status = 'DELETED' RETURNING id`, [id]));
    if (!rows[0]) throw err(404, 'MEDIA_NOT_FOUND', 'Only a deleted (not yet purged) asset can be restored.');
    return this.get(id);
  }

  /**
   * Physically removes stored files of soft-deleted assets past retention — only when NOTHING references them: no active record, and no
   * historical snapshot (order items keep the image URL they were placed with). Legacy originals are never touched. `dryRun` lists only.
   */
  async purge(dryRun: boolean) {
    const due = await this.ds.query(`SELECT id FROM media_assets WHERE status = 'DELETED' AND purge_after < now() ORDER BY purge_after LIMIT 200`);
    const purged: string[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    for (const { id } of due) {
      const u = await this.usage(id);
      if (u.references.length > 0) { skipped.push({ id, reason: 'REFERENCED' }); continue; }
      if (u.historicalSnapshots > 0) { skipped.push({ id, reason: 'HISTORICAL_SNAPSHOT' }); continue; }
      if (dryRun) { purged.push(id); continue; }
      const variants = await this.ds.query(`SELECT url FROM media_variants WHERE asset_id = $1 AND name <> 'ORIGINAL'`, [id]);
      for (const v of variants) await this.provider.remove?.(v.url).catch(() => false);
      await this.ds.query(`UPDATE media_assets SET status = 'PURGED', purged_at = now(), updated_at = now() WHERE id = $1`, [id]);
      await this.ds.query(`DELETE FROM media_variants WHERE asset_id = $1 AND name <> 'ORIGINAL'`, [id]);
      purged.push(id);
    }
    return { dryRun, purged, skipped };
  }

  // ----------------------------------------------------------------- legacy backfill (resumable; never rewrites an existing URL)

  /** Registers pre-existing local images as assets and generates WebP variants beside them. The original file and every existing URL stay as they are. */
  async backfillLegacy(limit = 25) {
    const driver = this.config.get<string>('storage.driver') ?? 'local';
    if (driver !== 'local') return { processed: 0, remaining: 0, message: 'Backfill reads files from local storage; it is not available for the S3 driver.' };
    const prefix = (this.config.get<string>('uploads.publicUrlPrefix') ?? '/uploads/files').replace(/\/+$/, '') + '/';
    const dir = path.resolve(this.config.get<string>('uploads.localDir') || './uploads-storage');
    const candidates: Array<{ url: string }> = await this.ds.query(
      `SELECT url FROM (
         SELECT logo_url AS url FROM vendors WHERE logo_url IS NOT NULL AND deleted_at IS NULL UNION SELECT image_url FROM marketplace_sectors WHERE image_url IS NOT NULL AND deleted_at IS NULL
         UNION SELECT image_url FROM marketplace_subcategories WHERE image_url IS NOT NULL AND deleted_at IS NULL UNION SELECT image_url FROM home_banners WHERE image_url IS NOT NULL AND deleted_at IS NULL UNION SELECT image_url_ar FROM home_banners WHERE image_url_ar IS NOT NULL AND deleted_at IS NULL
         UNION SELECT image_url FROM products WHERE image_url IS NOT NULL AND deleted_at IS NULL UNION SELECT image_url FROM catalog_products WHERE image_url IS NOT NULL AND deleted_at IS NULL) u
       WHERE url LIKE $1 || '%' AND NOT EXISTS (SELECT 1 FROM media_assets a WHERE a.legacy_source_url = u.url) ORDER BY url LIMIT ${Math.min(200, Math.max(1, limit))}`,
      [prefix],
    );
    let processed = 0;
    const unreadable: string[] = [];
    for (const { url } of candidates) {
      const name = url.slice(prefix.length);
      if (!/^[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/.test(name)) { unreadable.push(url); continue; }
      try {
        const buf = await fs.readFile(path.join(dir, name));
        const meta = await sharp(buf, { limitInputPixels: MAX_PIXELS }).metadata();
        const out = await this.process(buf, { ...PURPOSES.GENERAL, minWidth: 1, minHeight: 1, maxEdge: 20000 }, null);
        const stored: string[] = [];
        try {
          const dUrl = (await this.provider.store({ base64Content: out.display.toString('base64'), filename: 'image.webp' })).url; stored.push(dUrl);
          const tUrl = (await this.provider.store({ base64Content: out.thumb.toString('base64'), filename: 'thumb.webp' })).url; stored.push(tUrl);
          await this.ds.transaction(async (m) => {
            const [asset] = await m.query(
              `INSERT INTO media_assets (purpose, mime_type, bytes, width, height, sha256, legacy_source_url) VALUES ('GENERAL',$1,$2,$3,$4,$5,$6) RETURNING id`,
              [`image/${meta.format === 'jpeg' ? 'jpeg' : meta.format}`, buf.length, meta.width ?? 0, meta.height ?? 0, crypto.createHash('sha256').update(buf).digest('hex'), url],
            );
            await m.query(`INSERT INTO media_variants (asset_id, name, storage_key, url, width, height, bytes, mime_type) VALUES ($1,'ORIGINAL',$2,$3,$4,$5,$6,$7), ($1,'DISPLAY',$8,$9,$10,$11,$12,'image/webp'), ($1,'THUMB',$13,$14,$15,$16,$17,'image/webp')`, [
              asset.id, name, url, meta.width ?? 0, meta.height ?? 0, buf.length, `image/${meta.format}`, this.keyOf(dUrl), dUrl, out.displayInfo.width, out.displayInfo.height, out.display.length, this.keyOf(tUrl), tUrl, out.thumbInfo.width, out.thumbInfo.height, out.thumb.length,
            ]);
          });
          processed += 1;
        } catch (e) {
          for (const s of stored) await this.provider.remove?.(s).catch(() => false);
          throw e;
        }
      } catch {
        unreadable.push(url);
      }
    }
    const [{ remaining }] = await this.ds.query(
      `SELECT count(*)::int AS remaining FROM (
         SELECT logo_url AS url FROM vendors WHERE logo_url IS NOT NULL AND deleted_at IS NULL UNION SELECT image_url FROM marketplace_sectors WHERE image_url IS NOT NULL AND deleted_at IS NULL
         UNION SELECT image_url FROM marketplace_subcategories WHERE image_url IS NOT NULL AND deleted_at IS NULL UNION SELECT image_url FROM home_banners WHERE image_url IS NOT NULL AND deleted_at IS NULL UNION SELECT image_url_ar FROM home_banners WHERE image_url_ar IS NOT NULL AND deleted_at IS NULL
         UNION SELECT image_url FROM products WHERE image_url IS NOT NULL AND deleted_at IS NULL UNION SELECT image_url FROM catalog_products WHERE image_url IS NOT NULL AND deleted_at IS NULL) u
       WHERE url LIKE $1 || '%' AND NOT EXISTS (SELECT 1 FROM media_assets a WHERE a.legacy_source_url = u.url)`,
      [prefix],
    );
    return { processed, remaining: Math.max(0, remaining - unreadable.length), unreadable };
  }
}

import { existsSync, promises as fs } from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../database/data-source';
import { collectMediaTargets, MediaKind, MediaTarget } from './marketplace-media-inventory';
import { DEFAULT_MEDIA_DIR, findMediaFile, MARKETPLACE_MEDIA_SUBDIR, MEDIA_EXTENSIONS, MEDIA_URL_PREFIX } from './seed-media';
import { buildBrief, STYLE_GUIDE } from './asset-brief';

/**
 * Read-only: derives the complete production asset manifest from the live `hatly_dev` rows (the same collector the seed's
 * media step uses, so the two cannot disagree), validates it against the database, and writes
 * `docs/assets/ASSET_MANIFEST.json`. One entry per UNIQUE asset key (a product sold by several branches of one vendor is one
 * file listing every entity that uses it). Run via `npm run assets:manifest`. Never writes to the database.
 */
async function assertDevDatabase(dataSource: DataSource): Promise<void> {
  const rows: Array<{ current_database: string }> = await dataSource.query('SELECT current_database()');
  if (rows[0]?.current_database !== 'hatly_dev') {
    throw new Error(`Refusing to run against "${rows[0]?.current_database}" — only hatly_dev.`);
  }
}

interface Spec {
  targetField: string;
  widthPx: number;
  heightPx: number;
  aspectRatio: string;
  displayedAs: string;
  usedBy: string;
  priority: number;
}

const SPEC: Record<MediaKind, Spec> = {
  sector: { targetField: 'marketplace_sectors.image_url', widthPx: 512, heightPx: 512, aspectRatio: '1:1', displayedAs: 'rounded square tile (radius 16)', usedBy: 'Home "Shop by category" tile; Explore featured-category row', priority: 1 },
  'vendor-logo': { targetField: 'vendors.logo_url', widthPx: 512, heightPx: 512, aspectRatio: '1:1', displayedAs: 'circle: 64 dp (lists), 84 dp (vendor page); keep subject centred with ~10% padding', usedBy: 'Vendor cards, vendor details header, favorites, product-details vendor row, promo fallback', priority: 1 },
  product: { targetField: 'products.image_url', widthPx: 1200, heightPx: 1090, aspectRatio: '1.1:1 card; 1.85:1 details hero and 1:1 thumbnails are cover-cropped from it (subject must sit in the central 1:1 area)', displayedAs: 'rounded rectangle (radius 16), BoxFit.cover', usedBy: 'Product card, product list tile (72 dp), product details hero, offers/promos, search results, order item snapshot', priority: 1 },
  'catalog-product': { targetField: 'catalog_products.image_url', widthPx: 1200, heightPx: 1090, aspectRatio: '1.85:1 hero (cover-cropped); subject in the central 1:1 area', displayedAs: 'rounded rectangle', usedBy: 'Catalog product details hero', priority: 2 },
  subcategory: { targetField: 'marketplace_subcategories.image_url', widthPx: 512, heightPx: 512, aspectRatio: '1:1', displayedAs: 'rounded square', usedBy: 'Not rendered by the Customer app today (chips are text) — column parsed and reserved', priority: 3 },
};

const KIND_ORDER: MediaKind[] = ['sector', 'subcategory', 'vendor-logo', 'product', 'catalog-product'];
const TABLE_BY_KIND: Record<MediaKind, string> = {
  sector: 'marketplace_sectors',
  subcategory: 'marketplace_subcategories',
  'vendor-logo': 'vendors',
  product: 'products',
  'catalog-product': 'catalog_products',
};

async function main(): Promise<void> {
  await AppDataSource.initialize();
  try {
    await assertDevDatabase(AppDataSource);
    const all = await collectMediaTargets(AppDataSource.manager);
    const active = all.filter((t) => t.meta.isActive);
    const excludedInactive = all.length - active.length;

    // --- group rows by asset key (one file per key) ---
    const byKey = new Map<string, MediaTarget[]>();
    for (const t of active) byKey.set(t.key, [...(byKey.get(t.key) ?? []), t]);

    // sample product names per sector / per vendor (real data, context for briefs only)
    const sectorSamples = new Map<string, string[]>();
    const vendorSamples = new Map<string, string[]>();
    for (const t of active.filter((x) => x.kind === 'product')) {
      const s = sectorSamples.get(t.meta.sectorSlug ?? '') ?? [];
      if (!s.includes(t.meta.entityName) && s.length < 5) s.push(t.meta.entityName);
      sectorSamples.set(t.meta.sectorSlug ?? '', s);
      const v = vendorSamples.get(t.meta.vendorId ?? '') ?? [];
      if (!v.includes(t.meta.entityName) && v.length < 4) v.push(t.meta.entityName);
      vendorSamples.set(t.meta.vendorId ?? '', v);
    }
    const catalogKeyByName = new Map<string, string>();
    for (const t of active.filter((x) => x.kind === 'product')) {
      if (!catalogKeyByName.has(t.meta.entityName.toLowerCase())) catalogKeyByName.set(t.meta.entityName.toLowerCase(), t.key);
    }

    // Same pack the seed applies: SEED_MEDIA_DIR, else the committed docs/assets/pack.
    const mediaDir = process.env.SEED_MEDIA_DIR || (existsSync(DEFAULT_MEDIA_DIR) ? DEFAULT_MEDIA_DIR : undefined);
    const entries = [];
    for (const kind of KIND_ORDER) {
      for (const [key, rows] of byKey) {
        const first = rows[0];
        if (first.kind !== kind) continue;
        const spec = SPEC[kind];
        const m = first.meta;
        const brief = buildBrief({
          kind,
          entityName: m.entityName,
          entityNameAr: m.entityNameAr,
          sectorName: m.sectorName,
          sectorNames: m.sectorName,
          vendorName: m.vendorName,
          categoryName: m.categoryName,
          pricingUnit: m.pricingUnit,
          sampleProducts: kind === 'sector' ? sectorSamples.get(m.sectorSlug ?? '') : kind === 'vendor-logo' ? vendorSamples.get(m.entityId) : undefined,
          sameSubjectAs: kind === 'catalog-product' ? catalogKeyByName.get(m.entityName.toLowerCase()) : undefined,
        });
        const baseName = key.split('/').pop()!;
        entries.push({
          assetKey: key,
          assetType: kind,
          entityIds: rows.map((r) => r.meta.entityId),
          sharedAcrossEntities: rows.length > 1,
          entities: rows.map((r) => ({
            entityId: r.meta.entityId,
            table: r.meta.table,
            name: r.meta.entityName,
            nameAr: r.meta.entityNameAr,
            sector: r.meta.sectorName ?? null,
            sectorSlug: r.meta.sectorSlug ?? null,
            vendor: r.meta.vendorName ?? null,
            vendorId: r.meta.vendorId ?? null,
            branch: r.meta.branchName ?? null,
            branchId: r.meta.branchId ?? null,
            category: r.meta.categoryName ?? null,
            categoryAr: r.meta.categoryNameAr ?? null,
            pricingUnit: r.meta.pricingUnit ?? null,
          })),
          expectedFilename: `${baseName}.webp`,
          mediaPackPath: `${key}.webp`,
          acceptedExtensions: [...MEDIA_EXTENSIONS],
          storedUrlPath: `${MEDIA_URL_PREFIX}/${MARKETPLACE_MEDIA_SUBDIR}/${key}.webp`,
          targetField: spec.targetField,
          dimensions: { widthPx: spec.widthPx, heightPx: spec.heightPx, aspectRatio: spec.aspectRatio, displayedAs: spec.displayedAs },
          usedBy: spec.usedBy,
          priority: spec.priority,
          generationBrief: brief,
          hasUrlInDb: rows.some((r) => !!r.currentUrl),
          deliveredInMediaDir: mediaDir ? (await findMediaFile(mediaDir, key)) !== null : false,
        });
      }
    }

    // --- validation against the live database ---
    const problems: string[] = [];
    const keys = entries.map((e) => e.assetKey);
    if (new Set(keys).size !== keys.length) problems.push('duplicate asset keys in manifest');
    const filenames = entries.map((e) => e.mediaPackPath);
    if (new Set(filenames).size !== filenames.length) problems.push('duplicate media pack paths in manifest');

    const rowCounts: Record<string, number> = {};
    for (const kind of KIND_ORDER) {
      const table = TABLE_BY_KIND[kind];
      const ids = entries.filter((e) => e.assetType === kind).flatMap((e) => e.entityIds);
      const found: Array<{ id: string }> = ids.length
        ? await AppDataSource.query(`SELECT id FROM ${table} WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`, [ids])
        : [];
      if (found.length !== ids.length) problems.push(`${kind}: ${ids.length - found.length} referenced entity id(s) not found in ${table}`);
      const [{ n }]: Array<{ n: string }> = await AppDataSource.query(`SELECT COUNT(*)::text AS n FROM ${table} WHERE deleted_at IS NULL`);
      const activeRows = active.filter((t) => t.kind === kind).length;
      rowCounts[kind] = ids.length;
      if (Number(n) !== all.filter((t) => t.kind === kind).length) problems.push(`${kind}: manifest source saw ${all.filter((t) => t.kind === kind).length} rows but table has ${n}`);
      if (activeRows !== ids.length) problems.push(`${kind}: active row count ${activeRows} != manifest entity refs ${ids.length}`);
    }
    // products sharing a key must be the same item from the same vendor (otherwise they would need different images)
    for (const e of entries.filter((x) => x.sharedAcrossEntities)) {
      const distinct = new Set(e.entities.map((x) => `${x.vendor}|${(x.name ?? '').toLowerCase()}|${x.category ?? ''}`));
      if (e.assetType === 'product' && distinct.size > 1) problems.push(`${e.assetKey}: shared across entities that differ in vendor/name/category`);
    }

    const countsByType: Record<string, number> = {};
    for (const e of entries) countsByType[e.assetType] = (countsByType[e.assetType] ?? 0) + 1;
    const out = {
      generatedFrom: 'hatly_dev (read-only)',
      fileConvention: '<assetKey>.webp (png/jpg also accepted) — see mediaPackPath',
      note: 'One entry per unique asset key. A product sold by several branches of the same vendor is one file that lists every entity using it.',
      styleGuide: STYLE_GUIDE,
      totals: {
        uniqueAssetFiles: entries.length,
        entityRowsCovered: Object.values(rowCounts).reduce((a, b) => a + b, 0),
        inactiveEntitiesExcluded: excludedInactive,
        countsByType,
        entityRowsByType: rowCounts,
      },
      validation: { passed: problems.length === 0, problems },
      entries,
    };

    const target = path.resolve(__dirname, '../../../../docs/assets/ASSET_MANIFEST.json');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify(out, null, 2) + '\n');
    console.log(JSON.stringify({ totals: out.totals, validation: out.validation, written: target }, null, 2));
    if (problems.length) process.exitCode = 1;
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((e) => {
  console.error('Asset manifest failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});

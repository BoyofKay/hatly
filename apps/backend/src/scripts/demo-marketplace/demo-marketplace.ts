import { DataSource, EntityManager } from 'typeorm';
import { MarketplaceSector } from '../../modules/sectors/entities/marketplace-sector.entity';
import { Vendor } from '../../modules/vendors/entities/vendor.entity';
import { VendorBranch } from '../../modules/vendors/entities/vendor-branch.entity';
import { ServiceArea } from '../../modules/service-areas/entities/service-area.entity';
import { ProductCategory } from '../../modules/products/entities/product-category.entity';
import { Product } from '../../modules/products/entities/product.entity';
import { ProductOption } from '../../modules/products/entities/product-option.entity';
import { ProductOptionValue } from '../../modules/products/entities/product-option-value.entity';
import { PricingUnit } from '../../modules/products/pricing-unit.enum';
import { InventoryMode } from '../../modules/products/inventory-mode.enum';
import { HomeBanner } from '../../modules/home-banners/entities/home-banner.entity';
import { HomeBannerActionType } from '../../modules/home-banners/home-banner-action.enum';
import { findMediaFile, mediaKeys, slugify, stageMediaFile } from '../seed-media';
import type { DemoBanner, DemoSector, DemoVendor } from './demo-types';

/**
 * The DEMONSTRATION marketplace importer.
 *
 * Creates, in a designated shared demo/testing environment, a small but complete marketplace — categories (sectors), vendors with a branch,
 * product categories, products (+ options) and discovery banners — so sales and testers can browse, add to cart and reach checkout without
 * anyone entering 30 vendors by hand. Everything it writes is a DEMONSTRATION listing:
 *
 *  - names are invented business names; prices are demonstration prices in EGP; there are NO real phone numbers, street addresses,
 *    coordinates or opening hours. A branch's address text says it is a demonstration listing, and its map point is a synthetic point
 *    around the centre of an EXISTING service area (never a real location); it has no opening hours.
 *  - it goes through the same entities/constraints the application uses (no raw catalogue SQL), so every business rule still applies.
 *
 * Safe by construction:
 *  - DRY-RUN by default: nothing is written until `mode: 'execute'`. The dry-run produces the same decisions and report.
 *  - IDEMPOTENT: every record has a stable `demo_key` in `demo_seed_records`. Re-running creates only what is missing and never changes
 *    anything that exists — including edits an admin made to a demo record.
 *  - it never overwrites or deletes: a vendor whose name already exists but was NOT created by this importer is reported as a CONFLICT and
 *    skipped with all its children; an existing sector with the same slug is reused as it is.
 *  - traceable: `demo_seed_records` lists exactly what was created, so the demo content can be found, replaced or (explicitly) deactivated
 *    at commercial launch without touching a real merchant. Nothing is deleted automatically, and nothing runs at application start.
 */

export const DEMO_BATCH = 'demo-marketplace-v1';

/** Dry-run only: the sector does not exist yet but WILL be created, so everything that belongs to it is planned as a CREATE. */
const PENDING_SECTOR = '__pending__';

export type DemoEntityType = 'SECTOR' | 'VENDOR' | 'BRANCH' | 'PRODUCT_CATEGORY' | 'PRODUCT' | 'PRODUCT_OPTION' | 'PRODUCT_OPTION_VALUE' | 'HOME_BANNER';
export type DemoAction = 'CREATE' | 'EXISTS' | 'REUSE_EXISTING' | 'CONFLICT' | 'DELETED_BY_ADMIN';
export type DemoImageStatus = 'APPLIED' | 'GENERIC_FALLBACK' | 'MISSING' | 'SKIPPED' | null;

export interface DemoCatalog {
  sectors: DemoSector[];
  vendors: DemoVendor[];
  banners: DemoBanner[];
}

export interface DemoPlanItem {
  demoKey: string;
  entityType: DemoEntityType;
  label: string;
  action: DemoAction;
  entityId?: string;
  reason?: string;
  image?: { key: string | null; status: DemoImageStatus };
}

export interface DemoImportOptions {
  mode: 'dry-run' | 'execute';
  database: string;
  /** Name or id of the service area the demo branches are placed in. Default: the only active service area. */
  serviceArea?: string;
  /** The asset pack (`<key>.webp|png|jpg`). */
  mediaDir: string;
  /** Where the application serves `/uploads/files/...` from. Images are copied under `marketplace/`. */
  uploadsDir: string;
  skipImages?: boolean;
}

export interface DemoImportReport {
  batch: string;
  mode: 'dry-run' | 'execute';
  database: string;
  startedAt: string;
  serviceArea: { id: string; name: string } | null;
  errors: string[];
  items: DemoPlanItem[];
  counts: Record<string, Record<string, number>>;
  /** Asset keys that were wanted but not found (the item shows the placeholder). Exact image needs for the owner. */
  missingImages: string[];
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Validation of the catalogue itself (pure)
// ---------------------------------------------------------------------------------------------------------------------------------

export const MIN_VENDORS_PER_SECTOR = 5;
export const MIN_PRODUCTS_PER_VENDOR = 6;
const MAX_PRICE_MINOR = 5_000_000; // 50,000 EGP — a typo guard for a demonstration price

export function validateDemoCatalog(catalog: DemoCatalog): string[] {
  const errors: string[] = [];
  const sectorSlugs = new Set<string>();
  for (const s of catalog.sectors) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.slug)) errors.push(`sector "${s.slug}": slug must be lowercase letters, digits and dashes`);
    if (sectorSlugs.has(s.slug)) errors.push(`sector "${s.slug}": duplicate slug`);
    sectorSlugs.add(s.slug);
    if (!s.name.trim() || !s.nameAr.trim() || s.name.length > 100 || s.nameAr.length > 100) errors.push(`sector "${s.slug}": Arabic and English names are required (max 100)`);
  }
  const vendorSlugs = new Set<string>();
  const vendorNames = new Set<string>();
  const perSector = new Map<string, number>();
  for (const v of catalog.vendors) {
    const where = `vendor "${v.slug}"`;
    if (v.slug !== slugify(v.name)) errors.push(`${where}: slug must be the slug of the English name ("${slugify(v.name)}")`);
    if (vendorSlugs.has(v.slug)) errors.push(`${where}: duplicate slug`);
    vendorSlugs.add(v.slug);
    if (vendorNames.has(v.name.toLowerCase())) errors.push(`${where}: duplicate English name`);
    vendorNames.add(v.name.toLowerCase());
    if (!v.name.trim() || !v.nameAr.trim() || v.name.length > 150 || v.nameAr.length > 150) errors.push(`${where}: Arabic and English names are required (max 150)`);
    if (!sectorSlugs.has(v.sector)) errors.push(`${where}: unknown sector "${v.sector}"`);
    perSector.set(v.sector, (perSector.get(v.sector) ?? 0) + 1);
    if (!Number.isInteger(v.preparationMinutes) || v.preparationMinutes <= 0) errors.push(`${where}: preparationMinutes must be a positive integer`);
    if (!Number.isInteger(v.commissionBasisPoints) || v.commissionBasisPoints < 0 || v.commissionBasisPoints > 10000) errors.push(`${where}: commissionBasisPoints must be 0-10000`);
    if (!v.deliveryEnabled && !v.pickupEnabled) errors.push(`${where}: delivery or pickup must be enabled`);
    const productSlugs = new Set<string>();
    let productCount = 0;
    const categoryNames = new Set<string>();
    for (const c of v.categories) {
      if (!c.name.trim() || !c.nameAr.trim() || c.name.length > 100 || c.nameAr.length > 100) errors.push(`${where}: category names are required (max 100)`);
      if (categoryNames.has(c.name)) errors.push(`${where}: duplicate category "${c.name}"`);
      categoryNames.add(c.name);
      for (const p of c.products) {
        productCount += 1;
        const pw = `${where} product "${p.name}"`;
        const ps = slugify(p.name);
        if (!ps) errors.push(`${pw}: English name must contain letters or digits`);
        if (productSlugs.has(ps)) errors.push(`${pw}: duplicate product within the vendor`);
        productSlugs.add(ps);
        if (!p.name.trim() || !p.nameAr.trim() || p.name.length > 150 || p.nameAr.length > 150) errors.push(`${pw}: Arabic and English names are required (max 150)`);
        if (!Number.isInteger(p.priceMinor) || p.priceMinor <= 0 || p.priceMinor > MAX_PRICE_MINOR) errors.push(`${pw}: price must be a positive whole number of piastres (max ${MAX_PRICE_MINOR})`);
        for (const o of p.options ?? []) {
          if (o.values.length === 0) errors.push(`${pw}: option "${o.name}" has no values`);
          for (const val of o.values) if (!Number.isInteger(val.priceDeltaMinor) || val.priceDeltaMinor < 0) errors.push(`${pw}: option value "${val.name}" has an invalid price change`);
        }
      }
    }
    if (productCount < MIN_PRODUCTS_PER_VENDOR) errors.push(`${where}: only ${productCount} products (a usable catalogue needs at least ${MIN_PRODUCTS_PER_VENDOR})`);
  }
  for (const s of catalog.sectors) {
    const n = perSector.get(s.slug) ?? 0;
    if (n < MIN_VENDORS_PER_SECTOR) errors.push(`sector "${s.slug}": only ${n} vendors (the demonstration needs at least ${MIN_VENDORS_PER_SECTOR} per category)`);
  }
  const bannerKeys = new Set<string>();
  for (const b of catalog.banners) {
    if (bannerKeys.has(b.key)) errors.push(`banner "${b.key}": duplicate key`);
    bannerKeys.add(b.key);
    if (!sectorSlugs.has(b.sector)) errors.push(`banner "${b.key}": unknown sector "${b.sector}"`);
    if (!b.title.trim() || b.title.length > 120 || !b.titleAr.trim() || b.titleAr.length > 120) errors.push(`banner "${b.key}": Arabic and English titles are required (max 120)`);
  }
  return errors;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Synthetic branch points (pure)
// ---------------------------------------------------------------------------------------------------------------------------------

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * A deterministic SYNTHETIC point inside the service area (between 15 % and 55 % of its radius from the centre), different for every
 * index. It is a placeholder that keeps a demo branch serviceable and its delivery fee measurable — it is NOT a real shop location.
 */
export function demoBranchPoint(area: { centerLatitude: number; centerLongitude: number; radiusMeters: number }, index: number, total: number): { latitude: number; longitude: number } {
  const fraction = 0.15 + 0.4 * Math.sqrt((index + 0.5) / Math.max(total, 1));
  const distance = area.radiusMeters * fraction;
  const angle = index * GOLDEN_ANGLE;
  const dLat = (distance * Math.cos(angle)) / 111_320;
  const dLng = (distance * Math.sin(angle)) / (111_320 * Math.cos((area.centerLatitude * Math.PI) / 180));
  return { latitude: Number((area.centerLatitude + dLat).toFixed(6)), longitude: Number((area.centerLongitude + dLng).toFixed(6)) };
}

export const DEMO_BRANCH_NAME = 'الفرع الرئيسي';
export const DEMO_BRANCH_ADDRESS = 'عنوان تجريبي — قائمة عرض تجريبية (Demonstration listing)';

// ---------------------------------------------------------------------------------------------------------------------------------
// The importer
// ---------------------------------------------------------------------------------------------------------------------------------

interface TrackedRow {
  entity_id: string;
}

async function tracked(manager: EntityManager, demoKey: string): Promise<string | null> {
  const rows: TrackedRow[] = await manager.query('SELECT entity_id FROM demo_seed_records WHERE demo_key = $1', [demoKey]);
  return rows[0]?.entity_id ?? null;
}

async function record(manager: EntityManager, demoKey: string, type: DemoEntityType, entityId: string): Promise<void> {
  await manager.query(
    'INSERT INTO demo_seed_records (demo_key, entity_type, entity_id, batch) VALUES ($1, $2, $3, $4) ON CONFLICT (demo_key) DO NOTHING',
    [demoKey, type, entityId, DEMO_BATCH],
  );
}

function summarize(items: DemoPlanItem[]): DemoImportReport['counts'] {
  const counts: DemoImportReport['counts'] = {};
  for (const i of items) {
    counts[i.entityType] ??= {};
    counts[i.entityType][i.action] = (counts[i.entityType][i.action] ?? 0) + 1;
  }
  return counts;
}

async function resolveServiceArea(manager: EntityManager, ref?: string): Promise<{ area: ServiceArea | null; error?: string }> {
  const repo = manager.getRepository(ServiceArea);
  if (ref) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
    const area = isUuid ? await repo.findOne({ where: { id: ref } }) : await repo.findOne({ where: { name: ref } });
    if (!area) return { area: null, error: `service area "${ref}" was not found` };
    if (!area.isActive) return { area: null, error: `service area "${area.name}" is not active` };
    return { area };
  }
  const active = await repo.find({ where: { isActive: true } });
  if (active.length === 0) {
    return { area: null, error: 'there is no active service area — create the real service area first (Admin Dashboard → Service Areas); the demo branches are placed inside it' };
  }
  if (active.length > 1) {
    return { area: null, error: `there are ${active.length} active service areas (${active.map((a) => a.name).join(', ')}) — pass one explicitly with --service-area` };
  }
  return { area: active[0] };
}

export async function runDemoImport(dataSource: DataSource, catalog: DemoCatalog, options: DemoImportOptions): Promise<DemoImportReport> {
  const write = options.mode === 'execute';
  const report: DemoImportReport = {
    batch: DEMO_BATCH,
    mode: options.mode,
    database: options.database,
    startedAt: new Date().toISOString(),
    serviceArea: null,
    errors: [],
    items: [],
    counts: {},
    missingImages: [],
  };
  const finish = (): DemoImportReport => {
    report.counts = summarize(report.items);
    report.missingImages = [...new Set(report.missingImages)].sort();
    return report;
  };

  report.errors.push(...validateDemoCatalog(catalog));
  const trackingTable: Array<{ t: string | null }> = await dataSource.query(`SELECT to_regclass('public.demo_seed_records') AS t`);
  if (!trackingTable[0]?.t) {
    report.errors.push('the table demo_seed_records does not exist — run the migration 1700006300000-DemoSeedRecords first');
  }
  const { area, error: areaError } = await resolveServiceArea(dataSource.manager, options.serviceArea);
  if (areaError) report.errors.push(areaError);
  if (area) report.serviceArea = { id: area.id, name: area.name };
  if (report.errors.length > 0 || !area) return finish();

  const imageFor = async (key: string | null, fallbackKey: string | null): Promise<{ url: string | null; key: string | null; status: DemoImageStatus }> => {
    if (options.skipImages) return { url: null, key, status: 'SKIPPED' };
    for (const [candidate, status] of [[key, 'APPLIED'], [fallbackKey, 'GENERIC_FALLBACK']] as const) {
      if (!candidate) continue;
      const found = await findMediaFile(options.mediaDir, candidate);
      if (!found) continue;
      if (!write) return { url: null, key: candidate, status };
      const url = await stageMediaFile({ mediaDir: options.mediaDir, uploadsDir: options.uploadsDir, key: candidate });
      return { url, key: candidate, status };
    }
    if (key) report.missingImages.push(key);
    return { url: null, key, status: 'MISSING' };
  };

  // ---- sectors ------------------------------------------------------------------------------------------------------
  const sectorIdBySlug = new Map<string, string | null>();
  for (const def of catalog.sectors) {
    const demoKey = `sector:${def.slug}`;
    const label = `${def.nameAr} (${def.slug})`;
    const trackedId = await tracked(dataSource.manager, demoKey);
    const existing = await dataSource.manager.getRepository(MarketplaceSector).findOne({ where: { slug: def.slug }, withDeleted: true });
    if (trackedId) {
      sectorIdBySlug.set(def.slug, trackedId);
      report.items.push({ demoKey, entityType: 'SECTOR', label, action: 'EXISTS', entityId: trackedId });
      continue;
    }
    if (existing) {
      sectorIdBySlug.set(def.slug, existing.deletedAt ? null : existing.id);
      report.items.push({
        demoKey,
        entityType: 'SECTOR',
        label,
        action: existing.deletedAt ? 'CONFLICT' : 'REUSE_EXISTING',
        entityId: existing.id,
        reason: existing.deletedAt ? 'a deleted sector with this slug exists — nothing is recreated or restored' : 'a sector with this slug already exists (not created by the importer) — used as it is, left untouched',
      });
      continue;
    }
    const image = await imageFor(mediaKeys.sector(def.slug), null);
    let id: string | undefined;
    if (write) {
      const saved = await dataSource.transaction(async (m) => {
        const row = await m.getRepository(MarketplaceSector).save(
          m.getRepository(MarketplaceSector).create({
            name: def.name,
            nameAr: def.nameAr,
            slug: def.slug,
            sortOrder: def.sortOrder,
            isActive: true,
            customRequestsEnabled: def.customRequests,
            imageUrl: image.url,
          }),
        );
        await record(m, demoKey, 'SECTOR', row.id);
        return row;
      });
      id = saved.id;
    }
    sectorIdBySlug.set(def.slug, id ?? PENDING_SECTOR);
    report.items.push({ demoKey, entityType: 'SECTOR', label, action: 'CREATE', entityId: id, image: { key: image.key, status: image.status } });
  }

  // ---- vendors ------------------------------------------------------------------------------------------------------
  const vendorsInOrder = catalog.vendors;
  for (let vi = 0; vi < vendorsInOrder.length; vi += 1) {
    const def = vendorsInOrder[vi];
    const sectorId = sectorIdBySlug.get(def.sector);
    const vendorKey = `vendor:${def.slug}`;
    const vendorLabel = `${def.nameAr} / ${def.name}`;
    if (sectorId === null || sectorId === undefined) {
      report.items.push({ demoKey: vendorKey, entityType: 'VENDOR', label: vendorLabel, action: 'CONFLICT', reason: `sector "${def.sector}" is unusable (deleted)` });
      continue;
    }

    const vendorRepo = dataSource.manager.getRepository(Vendor);
    const trackedVendor = await tracked(dataSource.manager, vendorKey);
    let vendorId: string | null = trackedVendor;
    let vendorCreated = false;
    if (trackedVendor) {
      const row = await vendorRepo.findOne({ where: { id: trackedVendor }, withDeleted: true });
      if (!row || row.deletedAt) {
        report.items.push({ demoKey: vendorKey, entityType: 'VENDOR', label: vendorLabel, action: 'DELETED_BY_ADMIN', entityId: trackedVendor, reason: 'deleted by an admin — left deleted, not recreated' });
        continue;
      }
      report.items.push({ demoKey: vendorKey, entityType: 'VENDOR', label: vendorLabel, action: 'EXISTS', entityId: trackedVendor });
    } else {
      const sameName = await vendorRepo.findOne({ where: { name: def.name }, withDeleted: true });
      if (sameName) {
        report.items.push({
          demoKey: vendorKey,
          entityType: 'VENDOR',
          label: vendorLabel,
          action: 'CONFLICT',
          entityId: sameName.id,
          reason: 'a vendor with this name already exists and was not created by the importer — nothing is changed; its catalogue is skipped',
        });
        continue;
      }
      vendorCreated = true;
    }

    const logo = vendorCreated ? await imageFor(mediaKeys.vendorLogo(def.name), mediaKeys.sector(def.sector)) : null;
    const point = demoBranchPoint(area, vi, vendorsInOrder.length);
    const items: DemoPlanItem[] = [];

    const body = async (m: EntityManager): Promise<void> => {
      // vendor
      if (vendorCreated) {
        const row = await m.getRepository(Vendor).save(m.getRepository(Vendor).create({ name: def.name, nameAr: def.nameAr, isActive: true, logoUrl: logo?.url ?? null }));
        vendorId = row.id;
        await record(m, vendorKey, 'VENDOR', row.id);
        items.push({ demoKey: vendorKey, entityType: 'VENDOR', label: vendorLabel, action: 'CREATE', entityId: row.id, image: logo ? { key: logo.key, status: logo.status } : undefined });
      }
      // branch
      const branchKey = `branch:${def.slug}`;
      let branchId = await tracked(m, branchKey);
      if (branchId) {
        items.push({ demoKey: branchKey, entityType: 'BRANCH', label: `${vendorLabel} — ${DEMO_BRANCH_NAME}`, action: 'EXISTS', entityId: branchId });
      } else {
        const branch = await m.getRepository(VendorBranch).save(
          m.getRepository(VendorBranch).create({
            vendorId: vendorId!,
            name: DEMO_BRANCH_NAME,
            address: DEMO_BRANCH_ADDRESS,
            latitude: point.latitude,
            longitude: point.longitude,
            serviceAreaId: area.id,
            marketplaceSectorId: sectorId!,
            openingHours: {},
            isOpen: true,
            isActive: true,
            deliveryEnabled: def.deliveryEnabled,
            pickupEnabled: def.pickupEnabled,
            commissionRateBasisPoints: def.commissionBasisPoints,
            preparationTimeMinutes: def.preparationMinutes,
          }),
        );
        branchId = branch.id;
        await record(m, branchKey, 'BRANCH', branch.id);
        items.push({ demoKey: branchKey, entityType: 'BRANCH', label: `${vendorLabel} — ${DEMO_BRANCH_NAME}`, action: 'CREATE', entityId: branch.id });
      }
      // product categories + products + options
      for (let ci = 0; ci < def.categories.length; ci += 1) {
        const cat = def.categories[ci];
        const catKey = `category:${def.slug}:${ci}`;
        let categoryId = await tracked(m, catKey);
        if (!categoryId) {
          const row = await m.getRepository(ProductCategory).save(
            m.getRepository(ProductCategory).create({ vendorBranchId: branchId!, name: cat.name, nameAr: cat.nameAr, sortOrder: ci, isActive: true }),
          );
          categoryId = row.id;
          await record(m, catKey, 'PRODUCT_CATEGORY', row.id);
          items.push({ demoKey: catKey, entityType: 'PRODUCT_CATEGORY', label: `${def.name} / ${cat.name}`, action: 'CREATE', entityId: row.id });
        } else {
          items.push({ demoKey: catKey, entityType: 'PRODUCT_CATEGORY', label: `${def.name} / ${cat.name}`, action: 'EXISTS', entityId: categoryId });
        }
        for (const p of cat.products) {
          const productKey = `product:${def.slug}:${slugify(p.name)}`;
          const existingId = await tracked(m, productKey);
          if (existingId) {
            items.push({ demoKey: productKey, entityType: 'PRODUCT', label: `${def.name} / ${p.name}`, action: 'EXISTS', entityId: existingId });
            continue;
          }
          const img = await imageFor(p.image ?? mediaKeys.product(def.name, p.name), null);
          const row = await m.getRepository(Product).save(
            m.getRepository(Product).create({
              vendorBranchId: branchId!,
              categoryId: categoryId!,
              name: p.name,
              nameAr: p.nameAr,
              priceMinor: p.priceMinor,
              pricingUnit: p.unit === 'WEIGHT' ? PricingUnit.WEIGHT : PricingUnit.PIECE,
              isAvailable: true,
              inventoryMode: InventoryMode.OPEN,
              quantity: null,
              imageUrl: img.url,
            }),
          );
          await record(m, productKey, 'PRODUCT', row.id);
          items.push({ demoKey: productKey, entityType: 'PRODUCT', label: `${def.name} / ${p.name}`, action: 'CREATE', entityId: row.id, image: { key: img.key, status: img.status } });
          for (const o of p.options ?? []) {
            const optRow = await m.getRepository(ProductOption).save(
              m.getRepository(ProductOption).create({ productId: row.id, name: o.name, nameAr: o.nameAr, isRequired: o.required, allowsMultiple: o.multiple }),
            );
            await record(m, `option:${def.slug}:${slugify(p.name)}:${slugify(o.name)}`, 'PRODUCT_OPTION', optRow.id);
            items.push({ demoKey: `option:${def.slug}:${slugify(p.name)}:${slugify(o.name)}`, entityType: 'PRODUCT_OPTION', label: `${def.name} / ${p.name} / ${o.name}`, action: 'CREATE', entityId: optRow.id });
            for (const val of o.values) {
              const valRow = await m.getRepository(ProductOptionValue).save(
                m.getRepository(ProductOptionValue).create({ optionId: optRow.id, name: val.name, nameAr: val.nameAr, priceDeltaMinor: val.priceDeltaMinor }),
              );
              const valKey = `optionvalue:${def.slug}:${slugify(p.name)}:${slugify(o.name)}:${slugify(val.name)}`;
              await record(m, valKey, 'PRODUCT_OPTION_VALUE', valRow.id);
              items.push({ demoKey: valKey, entityType: 'PRODUCT_OPTION_VALUE', label: `${def.name} / ${p.name} / ${o.name} / ${val.name}`, action: 'CREATE', entityId: valRow.id });
            }
          }
        }
      }
    };

    if (write) {
      await dataSource.transaction(body);
      report.items.push(...items);
    } else {
      // Dry-run: the same decisions without writing. An existing vendor is inspected for missing children; a new one is all CREATE.
      report.items.push(...(await planVendorChildren(dataSource.manager, def, vendorCreated, vendorKey, vendorLabel, logo)));
    }
  }

  // ---- banners ------------------------------------------------------------------------------------------------------
  const bannerTable: Array<{ t: string | null }> = await dataSource.query(`SELECT to_regclass('public.home_banners') AS t`);
  for (const def of catalog.banners) {
    const demoKey = `banner:${def.key}`;
    const label = `${def.titleAr} / ${def.title}`;
    if (!bannerTable[0]?.t) {
      report.items.push({ demoKey, entityType: 'HOME_BANNER', label, action: 'CONFLICT', reason: 'the home_banners table does not exist yet (migration 1700006000000-HomeBanners) — banners were skipped' });
      continue;
    }
    const trackedId = await tracked(dataSource.manager, demoKey);
    if (trackedId) {
      report.items.push({ demoKey, entityType: 'HOME_BANNER', label, action: 'EXISTS', entityId: trackedId });
      continue;
    }
    const targetSector = sectorIdBySlug.get(def.sector);
    const image = await imageFor(def.imageKey, null);
    if (image.status === 'MISSING' || image.status === 'SKIPPED') {
      report.items.push({ demoKey, entityType: 'HOME_BANNER', label, action: 'CONFLICT', reason: 'no banner image — a banner is never published without one', image: { key: image.key, status: image.status } });
      continue;
    }
    let id: string | undefined;
    if (write) {
      if (!targetSector) {
        report.items.push({ demoKey, entityType: 'HOME_BANNER', label, action: 'CONFLICT', reason: `sector "${def.sector}" is unusable` });
        continue;
      }
      id = await dataSource.transaction(async (m) => {
        const row = await m.getRepository(HomeBanner).save(
          m.getRepository(HomeBanner).create({
            title: def.title,
            titleAr: def.titleAr,
            imageUrl: image.url,
            actionType: HomeBannerActionType.SECTOR,
            actionTargetId: targetSector,
            sortOrder: def.sortOrder,
            isActive: true,
          }),
        );
        await record(m, demoKey, 'HOME_BANNER', row.id);
        return row.id;
      });
    }
    report.items.push({ demoKey, entityType: 'HOME_BANNER', label, action: 'CREATE', entityId: id, image: { key: image.key, status: image.status } });
  }

  if (!write && !options.skipImages) {
    // The dry-run does not copy files, but it can tell the owner exactly which product images the pack does not have.
    const audit = await auditProductImages(catalog, options.mediaDir);
    report.missingImages.push(...audit.missing);
  }
  return finish();
}

/** Dry-run decisions for one vendor's children (nothing is written). */
async function planVendorChildren(
  manager: EntityManager,
  def: DemoVendor,
  vendorCreated: boolean,
  vendorKey: string,
  vendorLabel: string,
  logo: { key: string | null; status: DemoImageStatus } | null,
): Promise<DemoPlanItem[]> {
  const items: DemoPlanItem[] = [];
  const has = async (key: string) => (await tracked(manager, key)) !== null;
  if (vendorCreated) items.push({ demoKey: vendorKey, entityType: 'VENDOR', label: vendorLabel, action: 'CREATE', image: logo ? { key: logo.key, status: logo.status } : undefined });
  const branchKey = `branch:${def.slug}`;
  items.push({ demoKey: branchKey, entityType: 'BRANCH', label: `${vendorLabel} — ${DEMO_BRANCH_NAME}`, action: (await has(branchKey)) ? 'EXISTS' : 'CREATE' });
  for (let ci = 0; ci < def.categories.length; ci += 1) {
    const cat = def.categories[ci];
    const catKey = `category:${def.slug}:${ci}`;
    items.push({ demoKey: catKey, entityType: 'PRODUCT_CATEGORY', label: `${def.name} / ${cat.name}`, action: (await has(catKey)) ? 'EXISTS' : 'CREATE' });
    for (const p of cat.products) {
      const productKey = `product:${def.slug}:${slugify(p.name)}`;
      const exists = await has(productKey);
      items.push({ demoKey: productKey, entityType: 'PRODUCT', label: `${def.name} / ${p.name}`, action: exists ? 'EXISTS' : 'CREATE' });
      if (!exists) {
        for (const o of p.options ?? []) {
          items.push({ demoKey: `option:${def.slug}:${slugify(p.name)}:${slugify(o.name)}`, entityType: 'PRODUCT_OPTION', label: `${def.name} / ${p.name} / ${o.name}`, action: 'CREATE' });
          for (const val of o.values) {
            items.push({ demoKey: `optionvalue:${def.slug}:${slugify(p.name)}:${slugify(o.name)}:${slugify(val.name)}`, entityType: 'PRODUCT_OPTION_VALUE', label: `${def.name} / ${p.name} / ${o.name} / ${val.name}`, action: 'CREATE' });
          }
        }
      }
    }
  }
  return items;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Product image status for the dry-run (so the report lists exact image needs without writing anything)
// ---------------------------------------------------------------------------------------------------------------------------------

export async function auditProductImages(catalog: DemoCatalog, mediaDir: string): Promise<{ wanted: number; found: number; missing: string[] }> {
  let wanted = 0;
  let found = 0;
  const missing: string[] = [];
  for (const v of catalog.vendors) {
    for (const c of v.categories) {
      for (const p of c.products) {
        wanted += 1;
        const key = p.image ?? mediaKeys.product(v.name, p.name);
        if (await findMediaFile(mediaDir, key)) found += 1;
        else missing.push(key);
      }
    }
  }
  return { wanted, found, missing };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Report / deactivate (explicit, never deletes)
// ---------------------------------------------------------------------------------------------------------------------------------

export interface DemoRecordStatus {
  demoKey: string;
  entityType: DemoEntityType;
  entityId: string;
  exists: boolean;
  active: boolean | null;
}

export async function listDemoRecords(dataSource: DataSource): Promise<DemoRecordStatus[]> {
  const rows: Array<{ demo_key: string; entity_type: DemoEntityType; entity_id: string }> = await dataSource.query(
    'SELECT demo_key, entity_type, entity_id FROM demo_seed_records ORDER BY entity_type, demo_key',
  );
  const table: Record<string, [string, string | null]> = {
    SECTOR: ['marketplace_sectors', 'is_active'],
    VENDOR: ['vendors', 'is_active'],
    BRANCH: ['vendor_branches', 'is_active'],
    PRODUCT_CATEGORY: ['product_categories', 'is_active'],
    PRODUCT: ['products', 'is_available'],
    PRODUCT_OPTION: ['product_options', null],
    PRODUCT_OPTION_VALUE: ['product_option_values', null],
    HOME_BANNER: ['home_banners', 'is_active'],
  };
  const out: DemoRecordStatus[] = [];
  for (const r of rows) {
    const [tbl, activeCol] = table[r.entity_type];
    const hit: Array<{ active: boolean | null }> = await dataSource.query(
      `SELECT ${activeCol ? `"${activeCol}"` : 'NULL::boolean'} AS active FROM "${tbl}" WHERE id = $1`,
      [r.entity_id],
    );
    out.push({ demoKey: r.demo_key, entityType: r.entity_type, entityId: r.entity_id, exists: hit.length > 0, active: hit[0]?.active ?? null });
  }
  return out;
}

/**
 * Takes the demonstration content OFF the customer app without deleting a single row: demo vendors, branches, products and banners are
 * deactivated; a demo sector is deactivated too. Only records listed in `demo_seed_records` are touched — a real merchant never is.
 * Order history that references a demo product stays intact. Reversible by re-activating in the Admin Dashboard.
 */
export async function deactivateDemoRecords(dataSource: DataSource): Promise<{ deactivated: Record<string, number> }> {
  const deactivated: Record<string, number> = {};
  const targets: Array<[DemoEntityType, string, string]> = [
    ['HOME_BANNER', 'home_banners', 'is_active'],
    ['PRODUCT', 'products', 'is_available'],
    ['BRANCH', 'vendor_branches', 'is_active'],
    ['VENDOR', 'vendors', 'is_active'],
    ['SECTOR', 'marketplace_sectors', 'is_active'],
  ];
  await dataSource.transaction(async (m) => {
    for (const [type, tbl, col] of targets) {
      if (type === 'HOME_BANNER') {
        const exists: Array<{ t: string | null }> = await m.query(`SELECT to_regclass('public.home_banners') AS t`);
        if (!exists[0]?.t) continue;
      }
      // A CTE, so the driver answers with a plain row set (an UPDATE … RETURNING comes back as a [rows, count] pair).
      const res: Array<{ n: number }> = await m.query(
        `WITH u AS (UPDATE "${tbl}" SET "${col}" = false WHERE "${col}" = true AND id IN (SELECT entity_id FROM demo_seed_records WHERE entity_type = $1) RETURNING id) SELECT COUNT(*)::int AS n FROM u`,
        [type],
      );
      deactivated[type] = res[0].n;
    }
  });
  return { deactivated };
}

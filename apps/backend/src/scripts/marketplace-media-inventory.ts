import { EntityManager } from 'typeorm';
import { MarketplaceSector } from '../modules/sectors/entities/marketplace-sector.entity';
import { MarketplaceSubcategory } from '../modules/sectors/entities/marketplace-subcategory.entity';
import { Vendor } from '../modules/vendors/entities/vendor.entity';
import { VendorBranch } from '../modules/vendors/entities/vendor-branch.entity';
import { Product } from '../modules/products/entities/product.entity';
import { ProductCategory } from '../modules/products/entities/product-category.entity';
import { CatalogProduct } from '../modules/catalog/entities/catalog-product.entity';
import { isValidMediaKey, mediaKeys } from './seed-media';

export type MediaKind = 'sector' | 'subcategory' | 'vendor-logo' | 'product' | 'catalog-product';

/** Real entity facts used by the manifest (IDs, names, context). Read straight from the rows, nothing invented. */
export interface MediaTargetMeta {
  table: string;
  entityId: string;
  entityName: string;
  entityNameAr: string | null;
  isActive: boolean;
  sectorSlug?: string;
  sectorName?: string;
  vendorId?: string;
  vendorName?: string;
  vendorNameAr?: string | null;
  branchId?: string;
  branchName?: string;
  categoryName?: string;
  categoryNameAr?: string | null;
  pricingUnit?: string;
}

export interface MediaTarget {
  kind: MediaKind;
  meta: MediaTargetMeta;
  /** Natural-key based asset key (see seed-media.ts) — the file the asset pack must deliver is `<key>.<ext>`. */
  key: string;
  label: string;
  /** The image column's current value (null = still no image). */
  currentUrl: string | null;
  /** `null` clears a stale seeded URL whose asset is no longer in the pack (never used for real uploads). */
  save(url: string | null): Promise<void>;
}

/**
 * Every row that has an image column, with its asset key. Single source for BOTH the seed's media step (applies
 * delivered files) and the manifest generator (lists expected files), so the two can never disagree. Reads only;
 * `save` is the only write and is called solely by the seed.
 */
export async function collectMediaTargets(manager: EntityManager): Promise<MediaTarget[]> {
  const targets: MediaTarget[] = [];

  const sectors = await manager.find(MarketplaceSector, { order: { sortOrder: 'ASC' } });
  const sectorSlugById = new Map(sectors.map((s) => [s.id, s.slug]));
  const sectorById = new Map(sectors.map((s) => [s.id, s]));
  for (const s of sectors) {
    targets.push({
      kind: 'sector',
      key: mediaKeys.sector(s.slug),
      meta: { table: 'marketplace_sectors', entityId: s.id, entityName: s.name, entityNameAr: s.nameAr ?? null, isActive: s.isActive, sectorSlug: s.slug, sectorName: s.name },
      label: `${s.name} (${s.slug})`,
      currentUrl: s.imageUrl ?? null,
      save: async (url) => void (await manager.update(MarketplaceSector, s.id, { imageUrl: url })),
    });
  }

  const subcategories = await manager.find(MarketplaceSubcategory, { order: { sortOrder: 'ASC' } });
  for (const sc of subcategories) {
    const sectorSlug = sectorSlugById.get(sc.sectorId);
    if (!sectorSlug) continue;
    targets.push({
      kind: 'subcategory',
      key: mediaKeys.subcategory(sectorSlug, sc.name),
      meta: { table: 'marketplace_subcategories', entityId: sc.id, entityName: sc.name, entityNameAr: sc.nameAr ?? null, isActive: sc.isActive, sectorSlug, sectorName: sectorById.get(sc.sectorId)?.name },
      label: `${sc.name} (${sectorSlug})`,
      currentUrl: sc.imageUrl ?? null,
      save: async (url) => void (await manager.update(MarketplaceSubcategory, sc.id, { imageUrl: url })),
    });
  }

  const vendors = await manager.find(Vendor);
  const allBranches = await manager.find(VendorBranch);
  const sectorsByVendorId = new Map<string, Set<string>>();
  for (const b of allBranches) {
    if (!b.marketplaceSectorId) continue;
    const set = sectorsByVendorId.get(b.vendorId) ?? new Set<string>();
    set.add(b.marketplaceSectorId);
    sectorsByVendorId.set(b.vendorId, set);
  }
  const vendorNameById = new Map(vendors.map((v) => [v.id, v.name]));
  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  for (const v of vendors) {
    targets.push({
      kind: 'vendor-logo',
      key: mediaKeys.vendorLogo(v.name),
      meta: {
        table: 'vendors',
        entityId: v.id,
        entityName: v.name,
        entityNameAr: v.nameAr ?? null,
        isActive: v.isActive,
        sectorSlug: [...(sectorsByVendorId.get(v.id) ?? [])].map((id) => sectorById.get(id)?.slug).filter(Boolean).join(','),
        sectorName: [...(sectorsByVendorId.get(v.id) ?? [])].map((id) => sectorById.get(id)?.name).filter(Boolean).join(', '),
      },
      label: v.name,
      currentUrl: v.logoUrl ?? null,
      save: async (url) => void (await manager.update(Vendor, v.id, { logoUrl: url })),
    });
  }

  const branches = allBranches;
  const categories = await manager.find(ProductCategory);
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const branchById = new Map(branches.map((b) => [b.id, b]));
  const products = await manager.find(Product);
  for (const p of products) {
    const branch = branchById.get(p.vendorBranchId);
    const vendorName = branch ? vendorNameById.get(branch.vendorId) : undefined;
    if (!branch || !vendorName) continue;
    targets.push({
      kind: 'product',
      key: mediaKeys.product(vendorName, p.name),
      meta: {
        table: 'products',
        entityId: p.id,
        entityName: p.name,
        entityNameAr: p.nameAr ?? null,
        isActive: p.isAvailable && branch.isActive && (vendorById.get(branch.vendorId)?.isActive ?? false),
        sectorSlug: branch.marketplaceSectorId ? sectorById.get(branch.marketplaceSectorId)?.slug : undefined,
        sectorName: branch.marketplaceSectorId ? sectorById.get(branch.marketplaceSectorId)?.name : undefined,
        vendorId: branch.vendorId,
        vendorName,
        vendorNameAr: vendorById.get(branch.vendorId)?.nameAr ?? null,
        branchId: branch.id,
        branchName: branch.name,
        categoryName: categoryById.get(p.categoryId)?.name,
        categoryNameAr: categoryById.get(p.categoryId)?.nameAr ?? null,
        pricingUnit: p.pricingUnit,
      },
      label: `${p.name} — ${vendorName} / ${branch.name}`,
      currentUrl: p.imageUrl ?? null,
      save: async (url) => void (await manager.update(Product, p.id, { imageUrl: url })),
    });
  }

  const catalogProducts = await manager.find(CatalogProduct);
  for (const c of catalogProducts) {
    targets.push({
      kind: 'catalog-product',
      key: mediaKeys.catalogProduct(c.name),
      meta: { table: 'catalog_products', entityId: c.id, entityName: c.name, entityNameAr: c.nameAr ?? null, isActive: c.isActive, pricingUnit: c.pricingUnit },
      label: c.name,
      currentUrl: c.imageUrl ?? null,
      save: async (url) => void (await manager.update(CatalogProduct, c.id, { imageUrl: url })),
    });
  }

  // Never hand out an asset key that cannot be a real filename (e.g. an Arabic-only name that slugifies to '').
  return targets.filter((t) => isValidMediaKey(t.key));
}

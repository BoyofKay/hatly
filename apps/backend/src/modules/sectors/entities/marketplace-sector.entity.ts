import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';

/**
 * CONFIRMED business decision (Marketplace Sector Taxonomy): Level 1
 * — "which type of vendor/branch this is, for marketplace
 * browsing/discovery" — completely separate from `ProductCategory`
 * (Level 2 — a branch's own menu sections). Never merged, never a
 * parent/child relationship between the two.
 *
 * Dynamic, Admin-managed configuration — the actual sector list is
 * NOT hardcoded anywhere; the Flutter `category_fixture.dart` list
 * this replaces was explicitly commented "NOT A BUSINESS DECISION."
 *
 * `slug` is the stable, unique, machine-readable identifier (matches
 * the shape the Flutter fixture already used — e.g. `'restaurants'`)
 * — separate from `name`, which is the display label and CAN change
 * without breaking anything that references a sector by slug.
 *
 * `sortOrder` controls marketplace display order — Admin-configurable,
 * never hardcoded client-side.
 *
 * Deliberately no icon/presentation field — CONFIRMED: kept out of
 * this implementation; the Flutter app may map a sector's `slug` to a
 * local presentation icon itself.
 */
@Entity({ name: 'marketplace_sectors' })
export class MarketplaceSector extends BaseEntity {
  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'name_ar', type: 'varchar', length: 100, nullable: true })
  nameAr?: string | null;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100 })
  slug: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /**
   * Consolidated customer-commerce milestone (Part F — Marketplace
   * image/asset readiness): a plain URL reference, same
   * reuse-the-existing-column pattern as `Vendor.logoUrl` /
   * `Product.imageUrl` / `MarketplaceSubcategory.imageUrl` — never a
   * second asset pipeline. Nullable: seed data intentionally leaves
   * this null rather than fabricate a URL for an asset that doesn't
   * exist yet (see the seed script's own comment for the exact list of
   * real image files this milestone still needs generated).
   */
  @Column({ name: 'image_url', type: 'varchar', length: 500, nullable: true })
  imageUrl?: string | null;

  /** Independent wide hero asset; category tile remains imageUrl. */
  @Column({ name: 'banner_url', type: 'varchar', length: 500, nullable: true })
  bannerUrl?: string | null;

  /**
   * Admin-managed: may a customer send a free-text / photo "custom request" ("لا تجد ما تبحث عنه؟") to a vendor of this sector,
   * to be priced by the vendor? OFF by default — it only makes sense where a vendor can source an item that is not on the menu
   * (pharmacy, grocery…) and not for a restaurant menu. Enforced by the server on `POST /cart/vendor-custom-items`; the app only
   * mirrors it (`allowsCustomRequests` on the branch details) and can never grant it.
   */
  @Column({ name: 'custom_requests_enabled', type: 'boolean', default: false })
  customRequestsEnabled: boolean;
}

/** Whether a branch's sector lets customers send custom requests. A branch with no (or an inactive) sector cannot establish it. */
export function sectorAllowsCustomRequests(sector: Pick<MarketplaceSector, 'customRequestsEnabled' | 'isActive'> | null | undefined): boolean {
  return !!sector && sector.isActive === true && sector.customRequestsEnabled === true;
}

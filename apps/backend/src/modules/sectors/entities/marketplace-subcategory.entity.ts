import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { MarketplaceSector } from './marketplace-sector.entity';

/**
 * Consolidated customer-commerce milestone (Sector Subcategories).
 * Level 1.5 of the marketplace taxonomy — a real refinement WITHIN an
 * existing `MarketplaceSector` (e.g. "Burgers" inside "Restaurants"),
 * never a replacement for it and never merged with `ProductCategory`
 * (a branch's own menu sections — a completely separate concept, same
 * discipline `MarketplaceSector`'s own doc comment already
 * establishes for the sector/category distinction).
 *
 * Dynamic, Admin-managed — same discipline as `MarketplaceSector`
 * itself: the actual subcategory list is NOT hardcoded in Flutter.
 *
 * CONFIRMED: selecting a subcategory filters the EXISTING vendor/
 * branch listing (`GET /vendors?sectorId=&subcategoryId=`) — it never
 * turns browsing into "subcategory -> products" directly. A branch
 * may belong to MULTIPLE subcategories (see
 * `VendorBranchSubcategory`, a genuine many-to-many join table) —
 * deliberately NOT the single-FK-per-branch shape
 * `VendorBranch.marketplaceSectorId` uses for its own (exactly-one)
 * sector assignment, since subcategories are explicitly required to
 * be multi-valued per branch.
 */
@Entity({ name: 'marketplace_subcategories' })
@Index(['sectorId'])
export class MarketplaceSubcategory extends BaseEntity {
  @ManyToOne(() => MarketplaceSector)
  @JoinColumn({ name: 'sector_id' })
  sector: MarketplaceSector;

  @Column({ type: 'uuid', name: 'sector_id' })
  sectorId: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'name_ar', type: 'varchar', length: 100, nullable: true })
  nameAr?: string | null;

  /**
   * A reference to an image/icon asset — same "reuse the existing
   * upload/URL model, never a second asset pipeline" discipline as
   * every other `*Url` field in this codebase (e.g. `Vendor.logoUrl`).
   * Nullable: an Admin may not have a real asset ready yet, and this
   * entity must never fabricate one.
   */
  @Column({ name: 'image_url', type: 'varchar', length: 500, nullable: true })
  imageUrl?: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;
}

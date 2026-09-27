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
}

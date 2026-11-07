import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { Vendor } from './vendor.entity';
import { MarketplaceSector } from '../../sectors/entities/marketplace-sector.entity';
import { ServiceArea } from '../../service-areas/entities/service-area.entity';

@Entity({ name: 'vendor_branches' })
export class VendorBranch extends BaseEntity {
  @ManyToOne(() => Vendor, (vendor) => vendor.branches, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'vendor_id' })
  vendor: Vendor;

  @Column({ name: 'vendor_id' })
  vendorId: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 255 })
  address: string;

  /**
   * PHASE I-B addition (Multi-City / Service Area). The column itself
   * already existed (Phase I-A, Chunk 1) — this adds the real relation
   * object now that a real `ServiceArea` table/FK exists. A branch
   * with no ServiceArea assigned is deliberately excluded from
   * Discovery's service-area-aware filtering (see
   * MarketplaceVendorsService) — never silently treated as globally
   * visible.
   */
  @ManyToOne(() => ServiceArea, { nullable: true })
  @JoinColumn({ name: 'service_area_id' })
  serviceArea?: ServiceArea | null;

  @Index()
  @Column({ type: 'uuid', name: 'service_area_id', nullable: true })
  serviceAreaId?: string | null;

  @Column({ type: 'double precision' })
  latitude: number;

  @Column({ type: 'double precision' })
  longitude: number;

  // Simple day->hours map for V1; a dedicated OperatingHours table can
  // replace this later if per-branch exceptions/holidays are needed.
  @Column({ name: 'opening_hours', type: 'jsonb', default: {} })
  openingHours: Record<string, { open: string; close: string }>;

  @Column({ name: 'is_open', type: 'boolean', default: false })
  isOpen: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  // PHASE 3 STEP 3 addition: independent booleans rather than one
  // enum, since the approved requirement describes four real
  // combinations (delivery only / pickup only / both / neither).
  // Both default true — preserves current behavior for every existing
  // branch (nothing was pickup-restricted before this column existed).
  @Column({ name: 'delivery_enabled', type: 'boolean', default: true })
  deliveryEnabled: boolean;

  @Column({ name: 'pickup_enabled', type: 'boolean', default: true })
  pickupEnabled: boolean;

  /**
   * PHASE F addition. CONFIRMED: vendor commission is NOT one global
   * fixed percentage — each vendor/branch has its own configurable
   * rate, set from the Admin Dashboard. Basis points (0–10000 =
   * 0%–100%) rather than a decimal — avoids floating-point rounding,
   * consistent with this project's "money is always an integer" rule
   * extended to rates. Nullable, deliberately unseeded: until an Admin
   * sets this for a given branch, no commission event can be
   * recognized for it (fails closed — see FinancialEventService
   * callers), never a fabricated default rate.
   */
  @Column({ name: 'commission_rate_basis_points', type: 'int', nullable: true })
  commissionRateBasisPoints?: number | null;

  /**
   * PHASE G fix. CONFIRMED: auto-accept must be independently
   * configurable per Vendor/Branch, never global — Vendor A's setting
   * must never affect Vendor B/C. This is now the ONE source of
   * truth. The old global `BusinessConfig.VENDOR_SEGMENT_AUTO_ACCEPT_ENABLED`
   * key is no longer read anywhere (see OrderCreationService) —
   * deliberately not deleted from the enum/migrations (past migrations
   * are never rewritten), just retired from use. Defaults to false —
   * preserves the exact prior global default (manual acceptance)
   * for every existing branch until an Admin explicitly turns it on.
   */
  @Column({ name: 'auto_accept_enabled', type: 'boolean', default: false })
  autoAcceptEnabled: boolean;

  /**
   * R12 (decision register 2026-11-06): who accepts this branch's new orders — AUTO (accepted on placement, after every checkout check:
   * hours, stock, product validity), VENDOR (the vendor; default) or HATLY (Hatly Operations, on the vendor's behalf). The single source
   * of truth; `autoAcceptEnabled` is kept equal to (mode === 'AUTO') for the previous release.
   */
  @Column({ name: 'acceptance_mode', type: 'varchar', length: 6, default: 'VENDOR' })
  acceptanceMode: 'AUTO' | 'VENDOR' | 'HATLY';

  /** Typical preparation time. The ONLY source of a preparation estimate: null means "no estimate", never a default. */
  @Column({ name: 'preparation_time_minutes', type: 'int', nullable: true })
  preparationTimeMinutes?: number | null;

  /**
   * PHASE G addition (Ratings). Derived/recomputable cache — never the
   * authoritative source (individual `VendorRating` rows are). Average
   * is always `ratingSumStars / ratingCount`, computed on read, never
   * stored pre-divided — avoids any floating-point rounding drift.
   * Both default 0 and only ever incremented (ratings are immutable,
   * so no decrement path exists or is needed).
   */
  @Column({ name: 'rating_count', type: 'int', default: 0 })
  ratingCount: number;

  @Column({ name: 'rating_sum_stars', type: 'int', default: 0 })
  ratingSumStars: number;

  /**
   * PHASE G addition (Marketplace Sector Taxonomy). CONFIRMED: exactly
   * one MarketplaceSector per VendorBranch — this is the sole
   * authoritative relationship (never `Vendor.category`, the inert
   * Phase-1 free-text column, deliberately left untouched). Different
   * branches of the same Vendor may belong to different sectors.
   * Nullable for now — see the migration's own comment: this
   * repository contains no existing Vendor/VendorBranch data to
   * safely backfill, so the NOT NULL constraint is deferred rather
   * than assigning an invented sector to a hypothetical production
   * row. Every NEW assignment through SectorsService.assignBranchSector
   * still validates a real, active, non-deleted sector — "nullable at
   * the DB level for historical safety" is not the same as "optional
   * at the point of assignment."
   */
  @ManyToOne(() => MarketplaceSector, { nullable: true })
  @JoinColumn({ name: 'marketplace_sector_id' })
  marketplaceSector?: MarketplaceSector | null;

  @Index()
  @Column({ type: 'uuid', name: 'marketplace_sector_id', nullable: true })
  marketplaceSectorId?: string | null;
}

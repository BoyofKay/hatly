import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { VendorBranch } from '../../vendors/entities/vendor-branch.entity';
import { DiscountType } from '../discount-type.enum';
import { OfferMechanism } from '../offer-mechanism.enum';

/**
 * CONFIRMED business decisions (Offers & Promotions, do not reopen):
 *
 * - `vendorBranchId` is required and non-null — every Offer belongs to
 *   exactly one VendorBranch, absolutely, never global (see
 *   `VendorRating.vendorBranchId`'s own comment for the same
 *   established "operational vendor identity" convention this reuses).
 * - Exactly one discount type per Offer. ONE `discountValue` column,
 *   not two nullable-XOR columns — its meaning (basis points vs. minor
 *   units) is entirely determined by `discountType`; DB CHECK
 *   constraints (see the migration) keep it always positive and, for
 *   PERCENTAGE, capped at 10000 (100.00%).
 * - `startAt`/`endAt` are both required — no indefinite Offers.
 *   Evaluated live at order-creation time (`startAt <= now < endAt`),
 *   never pre-disabled by a scheduler.
 * - `isActive` + soft-delete (`deletedAt`, from BaseEntity) are BOTH
 *   independent ways an Offer stops applying to new orders — a
 *   soft-deleted Offer is inactive by definition, but `isActive` can
 *   also be flipped false without deleting anything (Admin
 *   deactivation, per decision X).
 * - The four limits are independent nullable integers — null means
 *   unlimited for THAT dimension specifically, never a shared "max
 *   quantity" field. `budgetCapMinor` null means unlimited budget.
 *
 * `consumedUnitsCount`/`consumedDiscountMinor` are DERIVED CACHES —
 * see the migration's own comment. Never the authoritative source;
 * `OfferConsumption` rows are.
 *
 * Offers — Final System (mechanism split). `mechanism` discriminates
 * two calculation paths, both reusing this SAME entity/table —
 * CONFIRMED, not a second Promotions system:
 *
 * SUBTOTAL_DISCOUNT: `discountType`/`discountValue` — now scoped to
 * the ELIGIBLE SUBTOTAL of a matching VendorBranch segment (not a
 * single unit's price, unlike this entity's original per-unit design)
 * — plus `minimumEligibleSubtotalMinor`/`maximumDiscountMinor`. The
 * existing `perOrderLimit`/`perCustomerLifetimeLimit`/
 * `totalAllocationLimit` here represent a COUNT OF USES (each
 * consumption = 1), never a physical quantity, for this mechanism.
 *
 * FLASH_SALE: `specialPriceMinor` (a REPLACEMENT price, not a
 * discount amount) replaces `discountType`/`discountValue`, which stay
 * null for this mechanism. `perCustomerLifetimeLimit`/
 * `totalAllocationLimit`/`budgetCapMinor` keep their ORIGINAL physical-
 * quantity meaning, completely unchanged from before this split —
 * this is the "reuse existing limits where appropriate" instruction
 * applied literally: FLASH_SALE is the mechanism that already existed,
 * now named and finalized, with one behavior change (see
 * OfferConsumptionService's own comment: quantity-limit violations now
 * REJECT rather than silently clamp, for this mechanism only).
 *
 * Exactly one of the two field groups is populated per row — enforced
 * both by the DB CHECK constraint (`chk_offers_mechanism_fields`, see
 * the migration) and by `CreateOfferDto`'s own validation.
 */
@Entity({ name: 'offers' })
export class Offer extends BaseEntity {
  @ManyToOne(() => VendorBranch)
  @JoinColumn({ name: 'vendor_branch_id' })
  vendorBranch: VendorBranch;

  @Index()
  @Column({ name: 'vendor_branch_id' })
  vendorBranchId: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  /** Arabic name (bilingual app). */
  @Column({ name: 'name_ar', type: 'varchar', length: 150, nullable: true })
  nameAr?: string | null;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  mechanism: OfferMechanism;

  /** SUBTOTAL_DISCOUNT only — null for FLASH_SALE. Basis points (0–10000) for PERCENTAGE; integer minor currency units for FIXED. */
  @Column({ name: 'discount_type', type: 'varchar', length: 10, nullable: true })
  discountType?: DiscountType | null;

  /** SUBTOTAL_DISCOUNT only — null for FLASH_SALE. See this entity's own top comment. */
  @Column({ name: 'discount_value', type: 'int', nullable: true })
  discountValue?: number | null;

  /** SUBTOTAL_DISCOUNT only. Below this eligible subtotal, discount = 0 (not an ineligibility — the offer still "exists," it just computes to nothing). */
  @Column({ name: 'minimum_eligible_subtotal_minor', type: 'bigint', nullable: true })
  minimumEligibleSubtotalMinor?: number | null;

  /** SUBTOTAL_DISCOUNT only. A CAP, never an invalidation condition — see OfferConsumptionService's own calculation comment. */
  @Column({ name: 'maximum_discount_minor', type: 'bigint', nullable: true })
  maximumDiscountMinor?: number | null;

  /** FLASH_SALE only — null for SUBTOTAL_DISCOUNT. The fixed replacement selling price, never a percentage/discount amount. */
  @Column({ name: 'special_price_minor', type: 'bigint', nullable: true })
  specialPriceMinor?: number | null;

  @Column({ name: 'start_at', type: 'timestamptz' })
  startAt: Date;

  @Column({ name: 'end_at', type: 'timestamptz' })
  endAt: Date;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /**
   * COUPON. An offer with a code is applied ONLY when the customer enters that code at checkout — it is never
   * auto-applied. Unique (case-insensitive) among live offers.
   */
  @Column({ name: 'coupon_code', type: 'varchar', length: 50, nullable: true })
  couponCode?: string | null;

  /** Max units per single Order that may receive this Offer. Null = unlimited. */
  @Column({ name: 'per_order_limit', type: 'int', nullable: true })
  perOrderLimit?: number | null;

  /** Max units a single customer may ever redeem for this Offer, across ALL their historical Orders. Null = unlimited. */
  @Column({ name: 'per_customer_lifetime_limit', type: 'int', nullable: true })
  perCustomerLifetimeLimit?: number | null;

  /** Max units this Offer may grant across ALL customers/orders combined. Null = unlimited. */
  @Column({ name: 'total_allocation_limit', type: 'int', nullable: true })
  totalAllocationLimit?: number | null;

  /** Max total discount (minor units) this Offer may ever grant, across all customers. Null = unlimited. HARD STOP when reached (decision O). */
  @Column({ name: 'budget_cap_minor', type: 'bigint', nullable: true })
  budgetCapMinor?: number | null;

  /**
   * Derived/recomputable cache — see this entity's own top comment.
   * Updated only inside the same locked transaction that creates the
   * corresponding OfferConsumption row(s) (see
   * OfferConsumptionService), never independently.
   */
  @Column({ name: 'consumed_units_count', type: 'int', default: 0 })
  consumedUnitsCount: number;

  @Column({ name: 'consumed_discount_minor', type: 'bigint', default: 0 })
  consumedDiscountMinor: number;
}

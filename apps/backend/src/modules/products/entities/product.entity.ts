import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { VendorBranch } from '../../vendors/entities/vendor-branch.entity';
import { ProductCategory } from './product-category.entity';
import { ProductOption } from './product-option.entity';
import { PricingUnit } from '../pricing-unit.enum';
import { InventoryMode } from '../inventory-mode.enum';

@Entity({ name: 'products' })
export class Product extends BaseEntity {
  // Matches the migration (ON DELETE CASCADE) — entity metadata previously omitted it.
  @ManyToOne(() => VendorBranch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'vendor_branch_id' })
  vendorBranch: VendorBranch;

  @Index()
  @Column({ name: 'vendor_branch_id' })
  vendorBranchId: string;

  @ManyToOne(() => ProductCategory)
  @JoinColumn({ name: 'category_id' })
  category: ProductCategory;

  @Index()
  @Column({ name: 'category_id' })
  categoryId: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ name: 'name_ar', type: 'varchar', length: 150, nullable: true })
  nameAr?: string | null;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ name: 'description_ar', type: 'text', nullable: true })
  descriptionAr?: string | null;

  @Column({ name: 'image_url', type: 'varchar', nullable: true })
  imageUrl?: string | null;

  // Integer minor units (piasters) — see common/utils/money.ts. This is
  // the ONLY source of truth for a product's price; cart/order pricing
  // always reads it fresh here, never from anything client-submitted.
  // For a WEIGHT product, this is the price PER KILOGRAM (e.g. 200 EGP
  // in minor units = the price of 1000g) — see PricingUnit's own
  // comment. For PIECE, unchanged meaning: price per unit.
  @Column({ name: 'price_minor', type: 'bigint' })
  priceMinor: number;

  /**
   * PHASE G addition (Weighted Products). CONFIRMED: never overload
   * `quantity`/an existing integer field to sometimes mean grams —
   * this is the explicit switch. Defaults to PIECE, preserving every
   * existing product's exact current behavior.
   */
  @Column({ name: 'pricing_unit', type: 'varchar', length: 10, default: PricingUnit.PIECE })
  pricingUnit: PricingUnit;

  @Column({ name: 'is_available', type: 'boolean', default: true })
  isAvailable: boolean;

  /**
   * CHUNK 12A addition (Inventory Foundation — CONFIRMED business
   * decision, do not reopen). Explicit source of truth for finite
   * stock — never inferred from `quantity` alone. Defaults OPEN,
   * preserving every existing product's current behavior exactly (no
   * quantity tracking, availability governed solely by `isAvailable`,
   * unchanged).
   */
  @Column({ name: 'inventory_mode', type: 'varchar', length: 10, default: InventoryMode.OPEN })
  inventoryMode: InventoryMode;

  /**
   * Nullable at the database level — CONFIRMED: OPEN products keep
   * this null (unused, never authoritative); TRACKED products require
   * a non-negative integer (enforced in AdminProductsService, not by
   * a DB constraint, matching this codebase's existing convention of
   * service-layer cross-field validation). For a WEIGHT product, this
   * is GRAMS — matching `requestedWeightGrams`/`actualWeightGrams`'s
   * existing units exactly, never kilograms. For PIECE, this is a
   * plain integer piece count. Deliberately NOT used for stock
   * enforcement yet — order-time stock check/decrement is explicitly
   * out of scope for this chunk (see OrderCreationService, untouched).
   */
  @Column({ name: 'quantity', type: 'int', nullable: true })
  quantity?: number | null;

  /**
   * PHASE G addition (Ratings). Derived/recomputable cache — see
   * VendorBranch.ratingCount's own comment for the full reasoning;
   * applies identically here. Deliberately NOT reset/cleared when the
   * product is later soft-deleted (`deletedAt`) — historical ratings
   * remain valid and this cache should still reflect them.
   */
  /**
   * Optional link to the shared marketplace product identity (see CatalogProduct). NULL for every existing
   * product and for any listing nobody has linked — such a listing behaves exactly as before.
   *
   * `select: false` on purpose: every existing endpoint that returns this entity (vendor-scoped browsing,
   * admin lists, the vendor app) keeps its response shape byte-for-byte, and an INACTIVE or deleted
   * catalog product can never leak through one of them. The catalog module reads/writes it explicitly.
   */
  @Column({ name: 'catalog_product_id', type: 'uuid', nullable: true, select: false })
  catalogProductId?: string | null;

  @Column({ name: 'rating_count', type: 'int', default: 0 })
  ratingCount: number;

  @Column({ name: 'rating_sum_stars', type: 'int', default: 0 })
  ratingSumStars: number;

  /**
   * PHASE G addition (Discovery & Ranking — Best Selling). Derived/
   * recomputable cache — see the migration's own comment for the full
   * reasoning. Exactly one of these two is ever non-zero for a given
   * Product (a Product is always exactly one PricingUnit): this one
   * for PIECE (`SUM(OrderItem.quantity)` from DELIVERED orders,
   * non-cancelled segments only).
   */
  @Column({ name: 'delivered_quantity_count', type: 'bigint', default: 0 })
  deliveredQuantityCount: number;

  /** This one for WEIGHT (`SUM(OrderItem.actualWeightGrams)`, same DELIVERED/non-cancelled scope) — never "1 unit" regardless of actual weight. */
  @Column({ name: 'delivered_weight_grams_count', type: 'bigint', default: 0 })
  deliveredWeightGramsCount: number;

  @OneToMany(() => ProductOption, (option) => option.product)
  options: ProductOption[];
}

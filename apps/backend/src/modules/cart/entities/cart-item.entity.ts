import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { CartVendorGroup } from './cart-vendor-group.entity';
import { Product } from '../../products/entities/product.entity';
import { CartItemOptionValue } from './cart-item-option-value.entity';

/**
 * PHASE 3 STEP 3 CHANGE: `cartId` -> `cartVendorGroupId` (an item now
 * belongs to a vendor's slice of the cart, not the cart directly).
 * `productId` is now NULLABLE — an item in an AD_HOC_SERVICE group has
 * no catalog product at all; it's a free-text request instead
 * (`freeTextDescription`) with 0–2 optional image references
 * (`imageUrls`). Exactly one of {productId, freeTextDescription} is
 * populated per item, enforced in CartService, not by a DB
 * constraint (TypeORM/Postgres CHECK constraints spanning nullable
 * XOR logic add complexity this project's migrations haven't needed
 * elsewhere; application-level enforcement matches every other
 * cross-field business rule in this codebase, e.g. the branch/option
 * validation already in CartService).
 *
 * `imageUrls` must only ever contain URLs that came from this app's
 * own upload mechanism (see modules/uploads/) — CartService validates
 * every URL against a real `Upload` row before accepting it; this
 * column itself doesn't enforce that, same reasoning as above.
 *
 * Still stores NO price — unchanged from Phase 2D. A catalog item's
 * price is computed fresh from `Product`/`ProductOptionValue` on
 * every read; an ad-hoc item has no price computed here AT ALL (see
 * cart-view.interface.ts) — no formula is invented in this phase.
 */
@Entity({ name: 'cart_items' })
export class CartItem extends BaseEntity {
  @ManyToOne(() => CartVendorGroup, (group) => group.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cart_vendor_group_id' })
  cartVendorGroup: CartVendorGroup;

  @Index()
  @Column({ name: 'cart_vendor_group_id' })
  cartVendorGroupId: string;

  @ManyToOne(() => Product, { nullable: true })
  @JoinColumn({ name: 'product_id' })
  product?: Product | null;

  @Column({ type: 'uuid', name: 'product_id', nullable: true })
  productId?: string | null;

  // For a WEIGHT product, this is always 1 (one weight-line = one
  // weight request) — the customer's requested amount lives in
  // `requestedWeightGrams` instead, never here. For PIECE, unchanged
  // meaning: how many units. Enforced/validated in CartService.
  @Column({ type: 'int' })
  quantity: number;

  /**
   * PHASE G addition (Weighted Products). CONFIRMED: never overload
   * `quantity` to mean grams. Populated only for a CATALOG item whose
   * Product.pricingUnit is WEIGHT — null for every PIECE item and for
   * an AD_HOC_SERVICE item. Integer grams, never floating-point
   * kilograms.
   */
  @Column({ name: 'requested_weight_grams', type: 'int', nullable: true })
  requestedWeightGrams?: number | null;

  /** Per-item note — unchanged from Phase 2D, independent of the group's vendorNote and the cart's orderNote. */
  @Column({ type: 'varchar', nullable: true })
  notes?: string | null;

  /** AD_HOC_SERVICE items only — the customer's free-text request (e.g. "Panadol Extra"). */
  @Column({ name: 'free_text_description', type: 'varchar', nullable: true })
  freeTextDescription?: string | null;

  /** AD_HOC_SERVICE items only — 0–2 Hatly-upload-produced URLs, not inherently linked to freeTextDescription. */
  @Column({ name: 'image_urls', type: 'jsonb', nullable: true })
  imageUrls?: string[] | null;

  @OneToMany(() => CartItemOptionValue, (value) => value.cartItem, { cascade: true })
  selectedOptionValues: CartItemOptionValue[];
}

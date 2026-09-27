import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { Offer } from './offer.entity';
import { Product } from '../../products/entities/product.entity';

/**
 * Direct Product targeting for an Offer — one of two separate join
 * tables (see OfferCategory for the other), per the approved design:
 * never a generic polymorphic target table. Live FK to `products` is
 * appropriate here (unlike historical/snapshot tables elsewhere in
 * this codebase) — Offer targeting reflects CURRENT catalog state, and
 * Products are never hard-deleted (soft-delete only), so the FK always
 * resolves. Unique on (offerId, productId) — see the migration.
 */
@Entity({ name: 'offer_products' })
export class OfferProduct extends BaseEntity {
  @ManyToOne(() => Offer)
  @JoinColumn({ name: 'offer_id' })
  offer: Offer;

  @Index()
  @Column({ name: 'offer_id' })
  offerId: string;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Index()
  @Column({ name: 'product_id' })
  productId: string;
}

import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { Offer } from './offer.entity';
import { ProductCategory } from '../../products/entities/product-category.entity';

/**
 * Category targeting for an Offer — targets the Vendor's OWN
 * `ProductCategory` (a branch's menu section, e.g. "Starters"), never
 * a marketplace/sector taxonomy — confirmed no such taxonomy exists
 * anywhere in this codebase. Unique on (offerId, productCategoryId) —
 * see the migration. Live FK, same reasoning as OfferProduct.
 */
@Entity({ name: 'offer_categories' })
export class OfferCategory extends BaseEntity {
  @ManyToOne(() => Offer)
  @JoinColumn({ name: 'offer_id' })
  offer: Offer;

  @Index()
  @Column({ name: 'offer_id' })
  offerId: string;

  @ManyToOne(() => ProductCategory)
  @JoinColumn({ name: 'product_category_id' })
  productCategory: ProductCategory;

  @Index()
  @Column({ name: 'product_category_id' })
  productCategoryId: string;
}

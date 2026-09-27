import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { PricingUnit } from '../../products/pricing-unit.enum';

/**
 * A marketplace product identity — "Coca-Cola 1.25L" — shared by every vendor listing that sells it.
 *
 * This is ONLY the identity + shared display content. Everything vendor-specific stays on the vendor
 * listing, which is the existing `products` row and keeps its id: price, availability, inventory,
 * options (and their price deltas), offers, ratings and sales counts. Carts, orders, offers and ratings
 * keep referencing the listing id, so none of them are affected by this table.
 *
 * Links are created ONLY by an explicit admin action (`products.catalog_product_id`). Nothing here — and
 * nothing anywhere — infers that two listings are the same product from their names; a matching
 * `barcode` is information for the admin, never an automatic link.
 *
 * Partial unique indexes (see the migration; `deleted_at IS NULL` so a soft-deleted row never blocks a
 * future one): `barcode` when present.
 */
@Entity({ name: 'catalog_products' })
export class CatalogProduct extends BaseEntity {
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

  @Column({ type: 'varchar', length: 100, nullable: true })
  brand?: string | null;

  /** Must equal the `pricing_unit` of every linked listing — validated when linking; locked while listings are linked. */
  @Column({ name: 'pricing_unit', type: 'varchar', length: 10 })
  pricingUnit: PricingUnit;

  /** Barcode / GTIN. Optional; unique among live catalog products when present. */
  @Column({ type: 'varchar', length: 50, nullable: true })
  barcode?: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;
}

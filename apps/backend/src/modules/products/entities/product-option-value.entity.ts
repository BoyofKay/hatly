import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { ProductOption } from './product-option.entity';

/**
 * One choice within a ProductOption — e.g. "Large" within "Size".
 * `priceDeltaMinor` follows the same naming convention already used in
 * `OrderItemOption.optionsSnapshot` (order-item.entity.ts): a signed
 * integer minor-unit delta added to the product's base price when
 * this value is selected. Read fresh from here on every cart
 * mutation/read — never accepted from the client.
 */
@Entity({ name: 'product_option_values' })
export class ProductOptionValue extends BaseEntity {
  @ManyToOne(() => ProductOption, (option) => option.values, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'option_id' })
  option: ProductOption;

  @Index()
  @Column({ name: 'option_id' })
  optionId: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'name_ar', type: 'varchar', length: 100, nullable: true })
  nameAr?: string | null;

  @Column({ name: 'price_delta_minor', type: 'bigint', default: 0 })
  priceDeltaMinor: number;
}

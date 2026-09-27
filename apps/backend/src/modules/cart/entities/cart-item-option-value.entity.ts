import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { CartItem } from './cart-item.entity';
import { ProductOptionValue } from '../../products/entities/product-option-value.entity';

/**
 * One selected option value on one cart item — e.g. "Large" for the
 * "Size" option. A plain join row per selection naturally supports
 * both single-select and multi-select options (one row for a radio
 * choice, several rows for checkboxes) without a separate schema for
 * each. No price is stored here either — see cart-item.entity.ts.
 */
@Entity({ name: 'cart_item_option_values' })
export class CartItemOptionValue extends BaseEntity {
  @ManyToOne(() => CartItem, (item) => item.selectedOptionValues, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cart_item_id' })
  cartItem: CartItem;

  @Index()
  @Column({ name: 'cart_item_id' })
  cartItemId: string;

  @ManyToOne(() => ProductOptionValue)
  @JoinColumn({ name: 'product_option_value_id' })
  optionValue: ProductOptionValue;

  @Column({ name: 'product_option_value_id' })
  productOptionValueId: string;
}

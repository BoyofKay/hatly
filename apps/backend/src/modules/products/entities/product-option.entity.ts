import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { Product } from './product.entity';
import { ProductOptionValue } from './product-option-value.entity';

/**
 * A selectable group on a product — e.g. "Size" (isRequired,
 * allowsMultiple=false) or "Extra toppings" (optional,
 * allowsMultiple=true). Cart validation (see cart.service.ts) reads
 * isRequired/allowsMultiple directly off this table — never trusts a
 * client's claim about which options are required.
 */
@Entity({ name: 'product_options' })
export class ProductOption extends BaseEntity {
  @ManyToOne(() => Product, (product) => product.options, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Index()
  @Column({ name: 'product_id' })
  productId: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'name_ar', type: 'varchar', length: 100, nullable: true })
  nameAr?: string | null;

  @Column({ name: 'is_required', type: 'boolean', default: false })
  isRequired: boolean;

  @Column({ name: 'allows_multiple', type: 'boolean', default: false })
  allowsMultiple: boolean;

  @OneToMany(() => ProductOptionValue, (value) => value.option)
  values: ProductOptionValue[];
}

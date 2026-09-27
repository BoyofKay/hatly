import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { VendorBranch } from '../../vendors/entities/vendor-branch.entity';

/**
 * A branch's own menu section (e.g. "Starters", "Mains") — scoped to
 * one VendorBranch, not one Vendor, since two branches of the same
 * vendor could in principle run different menus. See the Phase 2D
 * assessment for why this wasn't built until now (customer app used a
 * client-side fixture through Phase 2C).
 */
@Entity({ name: 'product_categories' })
export class ProductCategory extends BaseEntity {
  // Matches the migration (ON DELETE CASCADE) — entity metadata previously omitted it.
  @ManyToOne(() => VendorBranch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'vendor_branch_id' })
  vendorBranch: VendorBranch;

  @Index()
  @Column({ name: 'vendor_branch_id' })
  vendorBranchId: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'name_ar', type: 'varchar', length: 100, nullable: true })
  nameAr?: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;
}

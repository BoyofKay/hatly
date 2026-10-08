import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { VendorBranch } from '../../vendors/entities/vendor-branch.entity';
import { MarketplaceSubcategory } from './marketplace-subcategory.entity';

/**
 * Consolidated customer-commerce milestone (Sector Subcategories).
 * The genuine many-to-many join `VendorBranch` <-> `MarketplaceSubcategory`
 * — deliberately a real join table, NOT a single FK column, because a
 * branch is explicitly required to belong to MULTIPLE subcategories
 * (unlike `VendorBranch.marketplaceSectorId`, which is exactly-one by
 * a separate, earlier, deliberate decision — see
 * `SectorsService.assignBranchSector`'s own doc comment — and is left
 * completely untouched by this table).
 *
 * A plain join entity (not `BaseEntity`, composite primary key on the
 * pair itself): no soft-delete/audit needs of its own — assigning/
 * unassigning a branch to a subcategory is a hard add/remove of a
 * membership row, not a historical record.
 */
@Entity({ name: 'vendor_branch_subcategories' })
@Index(['subcategoryId'])
export class VendorBranchSubcategory {
  @PrimaryColumn({ type: 'uuid', name: 'vendor_branch_id' })
  vendorBranchId: string;

  @PrimaryColumn({ type: 'uuid', name: 'subcategory_id' })
  subcategoryId: string;

  @ManyToOne(() => VendorBranch)
  @JoinColumn({ name: 'vendor_branch_id' })
  vendorBranch: VendorBranch;

  @ManyToOne(() => MarketplaceSubcategory)
  @JoinColumn({ name: 'subcategory_id' })
  subcategory: MarketplaceSubcategory;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;
}

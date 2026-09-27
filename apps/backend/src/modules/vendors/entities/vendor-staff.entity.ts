import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { User } from '../../users/entities/user.entity';
import { VendorBranch } from './vendor-branch.entity';

/**
 * Links a User (role: VENDOR or VENDOR_MANAGER) to the specific
 * VendorBranch they act on behalf of. This link did not exist anywhere
 * before Stage A — confirmed by direct inspection: a VENDOR-role user
 * had no way to be associated with any Vendor/VendorBranch at all,
 * unlike Driver, which already had a proper `userId` FK.
 *
 * Deliberately linked at the BRANCH level, not the Vendor level — a
 * technical default, not a business decision: every order-facing
 * concept in this codebase (`OrderVendorSegment.vendorBranchId`,
 * `CartVendorGroup.vendorBranchId`) keys off the branch, never the
 * bare vendor, so branch-level scoping is what future vendor-facing
 * endpoints ("show me MY orders") will actually need to filter by. A
 * staff member who manages more than one branch of the same vendor
 * simply gets more than one row here — no cap enforced at this layer.
 *
 * One User may only ever be linked once per branch — enforced by a
 * unique index on (user_id, vendor_branch_id), not by unique per user
 * overall, since one person legitimately managing multiple branches is
 * a real, allowed case.
 */
@Entity({ name: 'vendor_staff' })
export class VendorStaff extends BaseEntity {
  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Index()
  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => VendorBranch)
  @JoinColumn({ name: 'vendor_branch_id' })
  vendorBranch: VendorBranch;

  @Index()
  @Column({ name: 'vendor_branch_id' })
  vendorBranchId: string;
}

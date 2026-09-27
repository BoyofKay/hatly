import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VendorStaff } from './entities/vendor-staff.entity';

/**
 * The authorization layer every Phase B vendor-facing endpoint must
 * use. Role checks alone (VENDOR/VENDOR_MANAGER) were confirmed
 * insufficient in the Phase B design review — the existing generic
 * order-status endpoint has role gating but no ownership check at
 * all, letting any vendor act on any order. This service is the fix:
 * it answers "which branches does this user actually manage" and
 * "is this user allowed to touch this specific branch," using the
 * VendorStaff link built in Phase A.
 */
@Injectable()
export class VendorStaffAuthorizationService {
  constructor(
    @InjectRepository(VendorStaff)
    private readonly vendorStaffRepository: Repository<VendorStaff>,
  ) {}

  async getOwnedBranchIds(userId: string): Promise<string[]> {
    const rows = await this.vendorStaffRepository.find({ where: { userId } });
    return rows.map((r) => r.vendorBranchId);
  }

  /**
   * CHUNK 12B-3-A addition. Reuses the exact same `vendorStaffRepository`
   * already injected here — no new repository, no new authorization
   * mechanism. Returns only the minimal fields a branch-selector UI
   * needs. CONFIRMED by direct inspection: `VendorBranch` has no
   * `nameAr` field at all (only `name`) — not invented here.
   */
  async getOwnedBranches(userId: string): Promise<Array<{ id: string; name: string }>> {
    const rows = await this.vendorStaffRepository.find({ where: { userId }, relations: { vendorBranch: true } });
    return rows.map((r) => ({
      id: r.vendorBranch.id,
      name: r.vendorBranch.name,
    }));
  }

  /**
   * Throws if the user has no VendorStaff link to this exact branch.
   * Callers should treat this the same way NotFoundException is used
   * elsewhere in this codebase for ownership checks (e.g.
   * CartService.getOwnedCartForItem) — i.e. prefer NotFoundException
   * over this at the controller/service boundary where leaking "this
   * exists but isn't yours" is undesirable; this method is for the
   * lower-level check itself.
   */
  async assertOwnsBranch(userId: string, vendorBranchId: string): Promise<void> {
    const owned = await this.vendorStaffRepository.findOne({ where: { userId, vendorBranchId } });
    if (!owned) {
      throw new ForbiddenException('You are not authorized to act on this vendor branch.');
    }
  }
}

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../users/entities/user.entity';
import { VendorBranch } from './entities/vendor-branch.entity';
import { VendorStaff } from './entities/vendor-staff.entity';
import { Role } from '../../common/enums/role.enum';

/**
 * CHUNK 10 addition — read-only view for the Dashboard Vendor Staff
 * list. No such endpoint existed before this (confirmed by
 * inspection: `AdminVendorStaffController` had only `POST`).
 */
export interface AdminVendorStaffView {
  id: string;
  fullName: string;
  phone: string;
  role: Role;
  isActive: boolean;
  vendorId: string;
  vendorName: string;
  vendorBranchId: string;
  vendorBranchName: string;
  createdAt: Date;
}

@Injectable()
export class VendorStaffService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Creates a new VENDOR/VENDOR_MANAGER user account and links it to
   * the given branch, in one transaction. Rejects if the phone number
   * already belongs to an existing account — deliberately does NOT
   * silently "promote" an existing customer (or any other role) to
   * vendor staff, since no business rule addresses that case; the
   * admin must use a phone number with no existing account.
   *
   * PHASE I-B, CHUNK 9: `password` is now required and hashed with
   * `bcrypt` (same cost factor already used for Driver/SUPER_ADMIN) —
   * this account authenticates via the real phone+password endpoint
   * (`auth/password/login`), not OTP. The plain password is never
   * persisted or logged — only the hash.
   */
  async create(params: {
    phone: string;
    fullName: string;
    vendorBranchId: string;
    password: string;
    role?: Role;
  }): Promise<VendorStaff> {
    const passwordHash = await bcrypt.hash(params.password, 10);

    return this.dataSource.transaction(async (manager) => {
      const branch = await manager.findOne(VendorBranch, { where: { id: params.vendorBranchId } });
      if (!branch) {
        throw new NotFoundException('Vendor branch not found.');
      }

      const existingUser = await manager.findOne(User, { where: { phone: params.phone } });
      if (existingUser) {
        throw new ConflictException({
          message: 'An account with this phone number already exists.',
          details: { code: 'PHONE_ALREADY_REGISTERED' },
        });
      }

      const user = await manager.save(
        User,
        manager.create(User, {
          phone: params.phone,
          fullName: params.fullName,
          role: params.role ?? Role.VENDOR,
          passwordHash,
        }),
      );

      return manager.save(
        VendorStaff,
        manager.create(VendorStaff, { userId: user.id, vendorBranchId: branch.id }),
      );
    });
  }

  /**
   * Read-only, for the Dashboard Vendor Staff list — CONFIRMED
   * additive, no write path touched. `passwordHash` is never selected
   * here (the User relation's default query never opts into the
   * `select: false` column) — never rendered in the UI.
   */
  async listAll(): Promise<AdminVendorStaffView[]> {
    const rows = await this.dataSource.getRepository(VendorStaff).find({
      relations: { user: true, vendorBranch: { vendor: true } },
      order: { createdAt: 'DESC' },
    });

    return rows.map((row) => this.toView(row));
  }

  /**
   * CHUNK 11 addition. Takes a `VendorStaff` id (never a raw User id)
   * — this is the actual safety mechanism: a VendorStaff row only
   * ever exists for a user created via `create()` above, which always
   * sets role to VENDOR/VENDOR_MANAGER. A Customer/Driver/Admin has no
   * VendorStaff row and is therefore structurally unreachable through
   * this endpoint, regardless of what id is passed. The explicit role
   * check below is a second, defense-in-depth layer on top of that
   * structural guarantee — never load-bearing on its own.
   *
   * Toggles `User.isActive` directly — CONFIRMED: no new status field
   * introduced, reusing the existing column exactly as instructed.
   * Never touches vendor/branch assignment or role.
   */
  private async setActiveState(vendorStaffId: string, isActive: boolean): Promise<AdminVendorStaffView> {
    const staffRepository = this.dataSource.getRepository(VendorStaff);
    const usersRepository = this.dataSource.getRepository(User);

    const staff = await staffRepository.findOne({
      where: { id: vendorStaffId },
      relations: { user: true, vendorBranch: { vendor: true } },
    });
    if (!staff) {
      throw new NotFoundException('Vendor staff account not found.');
    }
    if (staff.user.role !== Role.VENDOR && staff.user.role !== Role.VENDOR_MANAGER) {
      // Should be structurally unreachable (see this method's own
      // comment) — fails closed rather than silently proceeding if it
      // ever somehow isn't.
      throw new NotFoundException('Vendor staff account not found.');
    }

    staff.user.isActive = isActive;
    await usersRepository.save(staff.user);

    return this.toView(staff);
  }

  async activate(vendorStaffId: string): Promise<AdminVendorStaffView> {
    return this.setActiveState(vendorStaffId, true);
  }

  async deactivate(vendorStaffId: string): Promise<AdminVendorStaffView> {
    return this.setActiveState(vendorStaffId, false);
  }

  private toView(row: VendorStaff): AdminVendorStaffView {
    return {
      id: row.id,
      fullName: row.user.fullName,
      phone: row.user.phone,
      role: row.user.role,
      isActive: row.user.isActive,
      vendorId: row.vendorBranch.vendor.id,
      vendorName: row.vendorBranch.vendor.name,
      vendorBranchId: row.vendorBranch.id,
      vendorBranchName: row.vendorBranch.name,
      createdAt: row.createdAt,
    };
  }
}

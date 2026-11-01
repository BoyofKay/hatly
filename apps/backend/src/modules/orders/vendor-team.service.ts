import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { AdminAuditAction, AdminAuditService } from '../audit/admin-audit.service';
import { VendorStaffAuthorizationService } from '../vendors/vendor-staff-authorization.service';
import { VendorStaffService } from '../vendors/vendor-staff.service';
import { Actor, UUID_RE, bad, notFound, ownedBranch } from './vendor-ops.shared';

const PHONE_RE = /^\+[1-9]\d{7,14}$/;

/**
 * A branch manager's staff management — deliberately narrower than the Admin's. A manager can, WITHIN THEIR OWN branches: create an OPERATOR account,
 * activate or deactivate an operator, and add/remove an operator on another of their branches. Everything else stays with the Admin: creating or
 * promoting a manager, changing anyone's role, touching a manager's account or one's own, and touching an account that also works at a branch the
 * caller does not own (the person is an identity shared with another branch, not this manager's to switch off). Accounts are created with the same
 * phone + password rules as the Admin path; no existing customer/driver/admin number is ever turned into staff. Every change is audited.
 */
@Injectable()
export class VendorTeamService {
  constructor(
    private readonly ds: DataSource,
    private readonly vendorAuth: VendorStaffAuthorizationService,
    private readonly staff: VendorStaffService,
    private readonly audit: AdminAuditService,
  ) {}

  private managerOnly(user: Actor) {
    if (user.role !== Role.VENDOR_MANAGER) throw new ForbiddenException({ message: 'Only a branch manager can manage the team.', details: { code: 'MANAGER_ONLY' } });
  }

  /** An operator the caller may manage: role VENDOR, not the caller, and EVERY branch they work at is one of the caller's own. */
  private async manageableOperator(user: Actor, targetUserId: string) {
    this.managerOnly(user);
    if (!UUID_RE.test(targetUserId ?? '')) throw notFound('Team member not found.');
    const owned = await this.vendorAuth.getOwnedBranchIds(user.id);
    const rows: Array<{ vendor_branch_id: string; role: string; is_active: boolean }> = await this.ds.query(
      `SELECT s.vendor_branch_id, u.role, u.is_active FROM vendor_staff s JOIN users u ON u.id = s.user_id WHERE s.user_id = $1 AND s.deleted_at IS NULL AND u.deleted_at IS NULL`,
      [targetUserId],
    );
    // Not a colleague of the caller → answers like a person that does not exist.
    if (rows.length === 0 || !rows.some((r) => owned.includes(r.vendor_branch_id))) throw notFound('Team member not found.');
    if (targetUserId === user.id) throw new ForbiddenException({ message: 'You cannot change your own account.', details: { code: 'SELF_CHANGE' } });
    if (rows[0].role !== Role.VENDOR) throw new ForbiddenException({ message: 'Only Hatly can change a manager’s account.', details: { code: 'ADMIN_ONLY' } });
    if (rows.some((r) => !owned.includes(r.vendor_branch_id))) throw new ForbiddenException({ message: 'This person also works at a branch you do not manage, so only Hatly can change their account.', details: { code: 'SHARED_ACCOUNT' } });
    return { owned, branchIds: rows.map((r) => r.vendor_branch_id), isActive: rows[0].is_active };
  }

  async createOperator(user: Actor, body: { fullName?: string; phone?: string; password?: string; branchId?: string }) {
    this.managerOnly(user);
    if (!body || typeof body !== 'object') throw bad('Nothing to save.');
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
    if (fullName.length < 2 || fullName.length > 120) throw bad('Enter the person’s full name.');
    const phone = typeof body.phone === 'string' ? body.phone.replace(/\s+/g, '') : '';
    if (!PHONE_RE.test(phone)) throw bad('Enter the phone number with the country code, for example +201001234567.');
    if (typeof body.password !== 'string' || body.password.length < 8 || Buffer.byteLength(body.password) > 72) throw bad('The password must be 8–72 characters.');
    const branchId = await ownedBranch(this.vendorAuth, user, String(body.branchId));
    // Always an OPERATOR — a manager is created by Hatly. A phone that already has any account is refused (never converted).
    const created = await this.staff.create({ phone, fullName, password: body.password, vendorBranchId: branchId, role: Role.VENDOR });
    await this.audit.record({ actorUserId: user.id, actorRole: user.role, action: AdminAuditAction.VENDOR_STAFF_CREATED, targetType: 'vendor_staff', targetId: String(created.id), metadata: { role: Role.VENDOR, branchId, via: 'vendor_manager' } });
    return { id: created.userId };
  }

  async setActive(user: Actor, targetUserId: string, isActive: unknown) {
    if (typeof isActive !== 'boolean') throw bad('isActive must be true or false.');
    const t = await this.manageableOperator(user, targetUserId);
    if (t.isActive === isActive) return { id: targetUserId, isActive };
    await this.ds.query(`UPDATE users SET is_active = $2, updated_at = now() WHERE id = $1 AND role = 'VENDOR'`, [targetUserId, isActive]);
    await this.audit.record({
      actorUserId: user.id, actorRole: user.role, action: isActive ? AdminAuditAction.VENDOR_STAFF_ACTIVATED : AdminAuditAction.VENDOR_STAFF_DEACTIVATED,
      targetType: 'user', targetId: targetUserId, metadata: { via: 'vendor_manager' },
    });
    return { id: targetUserId, isActive };
  }

  async assignBranch(user: Actor, targetUserId: string, branchId: string) {
    const t = await this.manageableOperator(user, targetUserId);
    await ownedBranch(this.vendorAuth, user, branchId);
    if (t.branchIds.includes(branchId)) return { id: targetUserId };
    // Same vendor only: a person never spans two vendors through this screen.
    const [same] = await this.ds.query(`SELECT 1 AS ok FROM vendor_branches a JOIN vendor_branches b ON b.vendor_id = a.vendor_id WHERE a.id = $1 AND b.id = $2`, [branchId, t.branchIds[0]]);
    if (!same) throw new ConflictException({ message: 'The branch belongs to a different vendor.', details: { code: 'DIFFERENT_VENDOR' } });
    await this.ds.query(`INSERT INTO vendor_staff (user_id, vendor_branch_id) VALUES ($1, $2)`, [targetUserId, branchId]);
    await this.audit.record({ actorUserId: user.id, actorRole: user.role, action: AdminAuditAction.VENDOR_STAFF_BRANCH_ASSIGNED, targetType: 'user', targetId: targetUserId, metadata: { branchId, via: 'vendor_manager' } });
    return { id: targetUserId };
  }

  async unassignBranch(user: Actor, targetUserId: string, branchId: string) {
    const t = await this.manageableOperator(user, targetUserId);
    await ownedBranch(this.vendorAuth, user, branchId);
    if (!t.branchIds.includes(branchId)) throw notFound('This person does not work at that branch.');
    if (t.branchIds.length === 1) throw new ConflictException({ message: 'This is their only branch. Deactivate the account instead.', details: { code: 'LAST_BRANCH' } });
    await this.ds.query(`UPDATE vendor_staff SET deleted_at = now(), updated_at = now() WHERE user_id = $1 AND vendor_branch_id = $2 AND deleted_at IS NULL`, [targetUserId, branchId]);
    await this.audit.record({ actorUserId: user.id, actorRole: user.role, action: AdminAuditAction.VENDOR_STAFF_BRANCH_UNASSIGNED, targetType: 'user', targetId: targetUserId, metadata: { branchId, via: 'vendor_manager' } });
    return { id: targetUserId };
  }
}

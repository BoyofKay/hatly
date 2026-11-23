import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { DataSource } from 'typeorm';
import { Role } from '../../../common/enums/role.enum';
import { RefreshTokenStore } from '../../auth/refresh-token.store';
import { Permission } from '../../permissions/permission.enum';
import { PermissionsService } from '../../permissions/permissions.service';
import { assertStrongStaffPassword } from '../staff/staff-password-policy';

export const TEMP_PASSWORD_VALID_MINUTES = 60;
export const TEMP_PASSWORD_MAX_ATTEMPTS = 5;

const RANK: Record<string, number> = { SUPER_ADMIN: 4, ADMIN: 3, OPS_SUPERVISOR: 2, OPS_TEAM: 1 };
const staffRank = (role: string, level: string | null) => (role === Role.SUPER_ADMIN ? 4 : role === Role.ADMIN ? RANK[level ?? 'ADMIN'] ?? 3 : 0);
const rows = <T>(r: unknown): T[] => (Array.isArray(r) && Array.isArray(r[0]) ? (r[0] as T[]) : (r as T[]));

export interface ResetRequestView {
  id: string;
  userId: string;
  role: string;
  staffLevel: string | null;
  kind: 'CUSTOMER' | 'DRIVER' | 'STORE_STAFF' | 'HATLY_STAFF';
  fullName: string | null;
  phone: string;
  requestedAt: string;
  tempIssuedAt: string | null;
  tempExpiresAt: string | null;
  failedAttempts: number;
  /** Whether the caller may issue a temporary password for this person (level + permission). */
  canIssue: boolean;
}

/**
 * Request-based "Forgot password?" for every user type (owner decision 2026-11-23). There is no SMS check, so the app never decides by
 * itself: the person asks, someone ABOVE them issues a temporary password (and tells them, e.g. by phone after checking who they are),
 * and the person types it with a new password on the same screen. Rules:
 *  - Hatly staff: only a higher staff level (super admin > admin > ops supervisor > ops team) holding "Manage staff accounts"; nobody
 *    issues one for the super admin. Same level or above: refused.
 *  - Customers: "Manage customers". Drivers: "Manage drivers" or "Change driver online status" (supervisors). Store staff: "Manage
 *    vendor staff".
 *  - The temporary password lives only on the request (hashed); the account password is untouched until the change succeeds — the old
 *    password keeps working ("Cancel" and sign in as usual). It expires after 60 minutes and allows 5 wrong tries (then the request
 *    closes and a new one is needed). Success signs the person out everywhere.
 * The admin-initiated "Reset password" on a person (temporary password + forced change at sign-in) is a separate, unchanged flow.
 */
@Injectable()
export class PasswordResetService {
  constructor(
    private readonly ds: DataSource,
    private readonly permissions: PermissionsService,
    private readonly sessions: RefreshTokenStore,
  ) {}

  /** Public: records a request for an active account (one open per account). Silent for unknown phones (never reveals accounts). */
  async request(phone: string): Promise<void> {
    const [u] = await this.ds.query(`SELECT id FROM users WHERE phone = $1 AND is_active AND deleted_at IS NULL`, [phone.trim()]);
    if (!u) return;
    await this.ds.query(`INSERT INTO password_reset_requests (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [u.id]);
  }

  /** Public: the requester types the temporary password and a new one. */
  async complete(phone: string, tempPassword: string, newPassword: string): Promise<void> {
    const invalid = (extra: Record<string, unknown> = {}) =>
      new BadRequestException({ message: 'The temporary password is not correct, or none has been issued yet.', details: { code: 'TEMP_PASSWORD_INVALID', ...extra } });
    const [r] = await this.ds.query(
      `SELECT r.*, u.role::text AS role FROM password_reset_requests r JOIN users u ON u.id = r.user_id
        WHERE u.phone = $1 AND u.is_active AND u.deleted_at IS NULL AND r.resolved_at IS NULL AND r.temp_password_hash IS NOT NULL`,
      [phone.trim()],
    );
    if (!r) throw invalid();
    if (new Date(r.temp_expires_at).getTime() <= Date.now()) {
      await this.ds.query(`UPDATE password_reset_requests SET resolved_at = now(), resolution = 'EXPIRED' WHERE id = $1 AND resolved_at IS NULL`, [r.id]);
      throw new BadRequestException({ message: 'The temporary password has expired. Send a new request.', details: { code: 'TEMP_PASSWORD_EXPIRED' } });
    }
    if (!(await bcrypt.compare(tempPassword ?? '', r.temp_password_hash))) {
      const [{ failed_attempts }] = rows<{ failed_attempts: number }>(
        await this.ds.query(`UPDATE password_reset_requests SET failed_attempts = failed_attempts + 1 WHERE id = $1 RETURNING failed_attempts`, [r.id]),
      );
      if (failed_attempts >= TEMP_PASSWORD_MAX_ATTEMPTS) {
        await this.ds.query(`UPDATE password_reset_requests SET resolved_at = now(), resolution = 'LOCKED' WHERE id = $1 AND resolved_at IS NULL`, [r.id]);
        throw new BadRequestException({ message: 'Too many wrong tries. Send a new request.', details: { code: 'TEMP_PASSWORD_LOCKED' } });
      }
      throw invalid({ attemptsLeft: TEMP_PASSWORD_MAX_ATTEMPTS - failed_attempts });
    }
    // the new password follows the account's own rule
    if ([Role.ADMIN, Role.SUPER_ADMIN, Role.VENDOR, Role.VENDOR_MANAGER].includes(r.role as Role)) assertStrongStaffPassword(newPassword);
    else if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
      throw new BadRequestException({ message: 'The new password must be 8–128 characters.', details: { code: 'WEAK_PASSWORD' } });
    }
    if (newPassword === tempPassword) {
      throw new BadRequestException({ message: 'Choose a password different from the temporary one.', details: { code: 'PASSWORD_UNCHANGED' } });
    }
    await this.ds.transaction(async (m) => {
      await m.query(`UPDATE users SET password_hash = $2, must_change_password = false, updated_at = now() WHERE id = $1`, [r.user_id, await bcrypt.hash(newPassword, 10)]);
      await m.query(`UPDATE password_reset_requests SET resolved_at = now(), resolution = 'COMPLETED', temp_password_hash = NULL WHERE id = $1`, [r.id]);
    });
    await this.sessions.revoke(r.user_id);
  }

  /** Admin: open requests, each marked with whether the caller may answer it. `onlyActionable` drops the rest (the yellow notice). */
  async list(actor: { id: string; role: string }, onlyActionable = false): Promise<ResetRequestView[]> {
    const raw = await this.ds.query(
      `SELECT r.id, r.user_id, u.role::text AS role, u.staff_level, u.full_name, u.phone, r.requested_at, r.temp_issued_at, r.temp_expires_at, r.failed_attempts
         FROM password_reset_requests r JOIN users u ON u.id = r.user_id
        WHERE r.resolved_at IS NULL AND u.deleted_at IS NULL ORDER BY r.requested_at`,
    );
    const actorRank = await this.actorRank(actor);
    const out: ResetRequestView[] = [];
    for (const x of raw) {
      const canIssue = await this.mayIssue(actor, actorRank, x.role, x.staff_level, x.user_id);
      // a staff request is only visible to people above that person (never reveals higher accounts)
      if (!canIssue && (onlyActionable || ((x.role === Role.ADMIN || x.role === Role.SUPER_ADMIN) && staffRank(x.role, x.staff_level) >= actorRank))) continue;
      out.push({
        id: x.id,
        userId: x.user_id,
        role: x.role,
        staffLevel: x.staff_level ?? null,
        kind: x.role === Role.CUSTOMER ? 'CUSTOMER' : x.role === Role.DRIVER ? 'DRIVER' : x.role === Role.VENDOR || x.role === Role.VENDOR_MANAGER ? 'STORE_STAFF' : 'HATLY_STAFF',
        fullName: x.full_name ?? null,
        phone: x.phone,
        requestedAt: new Date(x.requested_at).toISOString(),
        tempIssuedAt: x.temp_issued_at ? new Date(x.temp_issued_at).toISOString() : null,
        tempExpiresAt: x.temp_expires_at ? new Date(x.temp_expires_at).toISOString() : null,
        failedAttempts: Number(x.failed_attempts ?? 0),
        canIssue,
      });
    }
    return out;
  }

  /** Admin: issues (or re-issues) a temporary password on a request. Returned once; stored only as a hash on the request. */
  async issue(actor: { id: string; role: string }, requestId: string): Promise<{ tempPassword: string; expiresAt: string }> {
    const [x] = await this.ds.query(
      `SELECT r.id, r.user_id, u.role::text AS role, u.staff_level FROM password_reset_requests r JOIN users u ON u.id = r.user_id WHERE r.id = $1 AND r.resolved_at IS NULL`,
      [requestId],
    );
    if (!x) throw new NotFoundException('No open request with this id.');
    if (!(await this.mayIssue(actor, await this.actorRank(actor), x.role, x.staff_level, x.user_id))) {
      throw new ForbiddenException({ message: 'Only someone above this person can issue a temporary password for them.', details: { code: 'RESET_NOT_ALLOWED' } });
    }
    const tempPassword = PasswordResetService.generate();
    const expiresAt = new Date(Date.now() + TEMP_PASSWORD_VALID_MINUTES * 60_000);
    await this.ds.query(
      `UPDATE password_reset_requests SET temp_password_hash = $2, temp_issued_at = now(), temp_expires_at = $3, temp_issued_by_user_id = $4, failed_attempts = 0 WHERE id = $1`,
      [requestId, await bcrypt.hash(tempPassword, 10), expiresAt, actor.id],
    );
    return { tempPassword, expiresAt: expiresAt.toISOString() };
  }

  async dismiss(actor: { id: string; role: string }, requestId: string): Promise<void> {
    const [x] = await this.ds.query(
      `SELECT r.user_id, u.role::text AS role, u.staff_level FROM password_reset_requests r JOIN users u ON u.id = r.user_id WHERE r.id = $1 AND r.resolved_at IS NULL`,
      [requestId],
    );
    if (!x) throw new NotFoundException('No open request with this id.');
    if (!(await this.mayIssue(actor, await this.actorRank(actor), x.role, x.staff_level, x.user_id))) {
      throw new ForbiddenException({ message: 'Only someone above this person can close their request.', details: { code: 'RESET_NOT_ALLOWED' } });
    }
    await this.ds.query(`UPDATE password_reset_requests SET resolved_at = now(), resolution = 'DISMISSED', resolved_by_user_id = $2, temp_password_hash = NULL WHERE id = $1`, [requestId, actor.id]);
  }

  /** A readable temporary password: 4 letters, a dash, 4 digits, then 1 letter (11 chars; no look-alike characters). */
  static generate(): string {
    const letters = 'abcdefghjkmnpqrstuvwxyz';
    const digits = '23456789';
    const pick = (set: string, n: number) => Array.from({ length: n }, () => set[randomInt(set.length)]).join('');
    return `${pick(letters, 4)}-${pick(digits, 4)}${pick(letters, 1)}`;
  }

  private async actorRank(actor: { id: string; role: string }): Promise<number> {
    if (actor.role === Role.SUPER_ADMIN) return 4;
    if (actor.role !== Role.ADMIN) return 0;
    const [me] = await this.ds.query(`SELECT role::text AS role, staff_level FROM users WHERE id = $1`, [actor.id]);
    return me ? staffRank(me.role, me.staff_level) : 0;
  }

  private async mayIssue(actor: { id: string; role: string }, actorRank: number, role: string, level: string | null, userId: string): Promise<boolean> {
    if (actorRank === 0 || userId === actor.id) return false;
    const holds = (p: Permission) => this.permissions.actorHolds(actor, p);
    switch (role) {
      case Role.SUPER_ADMIN:
        return false;
      case Role.ADMIN:
        return staffRank(role, level) < actorRank && (await holds(Permission.MANAGE_STAFF_ACCOUNTS));
      case Role.CUSTOMER:
        return holds(Permission.MANAGE_CUSTOMERS);
      case Role.DRIVER:
        return (await holds(Permission.MANAGE_DRIVERS)) || (await holds(Permission.CHANGE_DRIVER_ONLINE_STATUS));
      case Role.VENDOR:
      case Role.VENDOR_MANAGER:
        return holds(Permission.MANAGE_VENDOR_STAFF);
      default:
        return false;
    }
  }
}

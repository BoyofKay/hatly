import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { AdminAuditAction, AdminAuditService } from '../audit/admin-audit.service';
import { VendorStaffAuthorizationService } from '../vendors/vendor-staff-authorization.service';
import { Actor, UUID_RE, bad, notFound, ownedBranch } from './vendor-ops.shared';

const KINDS = ['TEMPORARY', 'HOLIDAY'];
const MAX_DAYS = 366;

/**
 * Branch closures: a scheduled or temporary closure of ONE branch with a reason and an explicit end (a temporary closure or a holiday). It is an
 * overlay on the manual open/closed switch — customers see the branch as closed while a closure is active, and it reopens by itself exactly at the
 * end time without touching the switch. There is no holiday calendar and no open-ended closure: a person decides each one. Times are instants; the
 * dashboard shows them in Cairo time. Creating and cancelling is a manager's decision (or an Admin's); every change is audited.
 */
@Injectable()
export class BranchClosuresService {
  constructor(
    private readonly ds: DataSource,
    private readonly vendorAuth: VendorStaffAuthorizationService,
    private readonly audit: AdminAuditService,
  ) {}

  async list(branchId: string) {
    const rows = await this.ds.query(
      `SELECT c.id, c.kind, c.starts_at, c.ends_at, c.reason, c.created_at, c.cancelled_at, u.full_name AS created_by, cu.full_name AS cancelled_by,
              CASE WHEN c.cancelled_at IS NOT NULL THEN 'CANCELLED' WHEN c.ends_at <= now() THEN 'ENDED' WHEN c.starts_at <= now() THEN 'ACTIVE' ELSE 'SCHEDULED' END AS status
         FROM vendor_branch_closures c JOIN users u ON u.id = c.created_by_user_id LEFT JOIN users cu ON cu.id = c.cancelled_by_user_id
        WHERE c.vendor_branch_id = $1 AND c.ends_at > now() - interval '120 days' ORDER BY c.starts_at DESC LIMIT 100`,
      [branchId],
    );
    return rows.map((c: any) => ({ id: c.id, kind: c.kind, startsAt: c.starts_at, endsAt: c.ends_at, reason: c.reason, status: c.status, createdBy: c.created_by, createdAt: c.created_at, cancelledAt: c.cancelled_at, cancelledBy: c.cancelled_by }));
  }

  /** What the branch page needs at a glance: is it effectively open, and which closure (active or next) applies. */
  async current(branchId: string) {
    const [active] = await this.ds.query(`SELECT id, kind, starts_at, ends_at, reason FROM vendor_branch_closures WHERE vendor_branch_id = $1 AND cancelled_at IS NULL AND starts_at <= now() AND ends_at > now() ORDER BY ends_at DESC LIMIT 1`, [branchId]);
    const [next] = await this.ds.query(`SELECT id, kind, starts_at, ends_at, reason FROM vendor_branch_closures WHERE vendor_branch_id = $1 AND cancelled_at IS NULL AND starts_at > now() ORDER BY starts_at LIMIT 1`, [branchId]);
    const view = (c: any) => (c ? { id: c.id, kind: c.kind, startsAt: c.starts_at, endsAt: c.ends_at, reason: c.reason } : null);
    return { active: view(active), next: view(next) };
  }

  async create(actor: Actor, branchId: string, body: { kind?: string; startsAt?: string; endsAt?: string; reason?: string }) {
    if (!body || typeof body !== 'object') throw bad('Nothing to save.');
    if (!KINDS.includes(String(body.kind))) throw bad('The kind must be TEMPORARY or HOLIDAY.');
    const starts = new Date(String(body.startsAt));
    const ends = new Date(String(body.endsAt));
    if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) throw bad('Start and end must be valid date-times.');
    if (ends <= starts) throw bad('The end must be after the start.');
    if (ends <= new Date()) throw bad('The closure must end in the future.');
    if ((ends.getTime() - starts.getTime()) / 86_400_000 > MAX_DAYS) throw bad(`A closure can last at most ${MAX_DAYS} days.`);
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 3 || reason.length > 300) throw bad('Give a reason of 3–300 characters.');
    const [overlap] = await this.ds.query(
      `SELECT id FROM vendor_branch_closures WHERE vendor_branch_id = $1 AND cancelled_at IS NULL AND starts_at < $3 AND ends_at > $2 LIMIT 1`,
      [branchId, starts.toISOString(), ends.toISOString()],
    );
    if (overlap) throw new ConflictException({ message: 'Another closure already covers part of this period. Cancel it or choose other dates.', details: { code: 'CLOSURE_OVERLAPS' } });
    const [row] = await this.ds.query(
      `INSERT INTO vendor_branch_closures (vendor_branch_id, kind, starts_at, ends_at, reason, created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [branchId, body.kind, starts.toISOString(), ends.toISOString(), reason, actor.id],
    );
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.BRANCH_CLOSURE_CREATED, targetType: 'vendor_branch', targetId: branchId, metadata: { closureId: row.id, kind: String(body.kind), startsAt: starts.toISOString(), endsAt: ends.toISOString(), reason } });
    return { id: row.id };
  }

  async cancel(actor: Actor, branchId: string, closureId: string) {
    if (!UUID_RE.test(closureId ?? '')) throw notFound('Closure not found.');
    const [c] = await this.ds.query(`SELECT id, ends_at, cancelled_at FROM vendor_branch_closures WHERE id = $1 AND vendor_branch_id = $2`, [closureId, branchId]);
    if (!c) throw notFound('Closure not found.');
    if (c.cancelled_at) throw new ConflictException({ message: 'This closure is already cancelled.', details: { code: 'ALREADY_CANCELLED' } });
    if (new Date(c.ends_at) <= new Date()) throw new ConflictException({ message: 'This closure has already ended.', details: { code: 'ALREADY_ENDED' } });
    await this.ds.query(`UPDATE vendor_branch_closures SET cancelled_at = now(), cancelled_by_user_id = $2 WHERE id = $1 AND cancelled_at IS NULL`, [closureId, actor.id]);
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.BRANCH_CLOSURE_CANCELLED, targetType: 'vendor_branch', targetId: branchId, metadata: { closureId } });
    return { id: closureId };
  }

  // ----- vendor-facing wrappers: own branches only, managers only for writes
  async vendorList(user: Actor, branchId: string) {
    await ownedBranch(this.vendorAuth, user, branchId);
    return { closures: await this.list(branchId), current: await this.current(branchId), canManage: user.role === Role.VENDOR_MANAGER };
  }
  async vendorCreate(user: Actor, branchId: string, body: any) {
    await ownedBranch(this.vendorAuth, user, branchId);
    this.managerOnly(user);
    return this.create(user, branchId, body);
  }
  async vendorCancel(user: Actor, branchId: string, closureId: string) {
    await ownedBranch(this.vendorAuth, user, branchId);
    this.managerOnly(user);
    return this.cancel(user, branchId, closureId);
  }
  private managerOnly(user: Actor) {
    if (user.role !== Role.VENDOR_MANAGER) throw new ForbiddenException({ message: 'Only a branch manager can schedule or cancel a closure.', details: { code: 'MANAGER_ONLY' } });
  }

  async assertBranchExists(branchId: string) {
    if (!UUID_RE.test(branchId ?? '')) throw notFound('Branch not found.');
    const [b] = await this.ds.query(`SELECT id FROM vendor_branches WHERE id = $1 AND deleted_at IS NULL`, [branchId]);
    if (!b) throw notFound('Branch not found.');
  }
}

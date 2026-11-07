import { ConflictException, ForbiddenException, Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { VendorStaffAuthorizationService } from '../vendors/vendor-staff-authorization.service';
import { AdminAuditAction, AdminAuditService } from '../audit/admin-audit.service';
import { StaffAlertsService } from '../notifications/staff-alerts.service';
import { Permission } from '../permissions/permission.enum';
import { BranchClosuresService } from './branch-closures.service';
import { Actor, UUID_RE, bad, notFound, ownedBranch } from './vendor-ops.shared';

export const BRANCH_CHANGE_KINDS = ['PAUSE', 'REOPEN', 'HOURS', 'CLOSURE', 'CLOSURE_CANCEL'] as const;
export type BranchChangeKind = (typeof BRANCH_CHANGE_KINDS)[number];
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * R8 / R44 (decision register 2026-11-06). A vendor cannot pause or close order acceptance, change weekly hours / working days, or schedule
 * or cancel a temporary closure by itself: it REQUESTS the change here and Hatly Admin approves or rejects it. Admin can still change all of
 * this directly (existing Admin endpoints). An approved request is applied through those same Admin paths; every change affects NEW orders
 * only — confirmed and scheduled orders continue. Requests and decisions record who, when and why; Operations are told of each request and
 * the branch's staff of each decision.
 */
@Injectable()
export class BranchChangeRequestsService {
  constructor(
    private readonly ds: DataSource,
    private readonly vendorAuth: VendorStaffAuthorizationService,
    private readonly closures: BranchClosuresService,
    private readonly audit: AdminAuditService,
    @Optional() private readonly staffAlerts?: StaffAlertsService,
  ) {}

  // ----------------------------------------------------------------- vendor side
  async request(user: Actor, branchId: string, kind: BranchChangeKind, payload: Record<string, unknown>, reason?: string) {
    await ownedBranch(this.vendorAuth, user, branchId);
    if (kind !== 'PAUSE' && kind !== 'REOPEN' && user.role !== Role.VENDOR_MANAGER) {
      throw new ForbiddenException({ message: 'Only a branch manager can request a change of hours or a closure.', details: { code: 'MANAGER_ONLY' } });
    }
    const clean = await this.validate(branchId, kind, payload);
    const note = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 300) : null;
    let row: { id: string; created_at: Date };
    try {
      [row] = await this.ds.query(
        `INSERT INTO vendor_branch_change_requests (vendor_branch_id, kind, payload, reason, requested_by_user_id) VALUES ($1, $2, $3::jsonb, $4, $5) RETURNING id, created_at`,
        [branchId, kind, JSON.stringify(clean), note, user.id],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException({ message: 'A request of this kind is already waiting for Hatly. Withdraw it first to send a different one.', details: { code: 'REQUEST_ALREADY_PENDING', kind } });
      }
      throw error;
    }
    await this.audit.record({ actorUserId: user.id, actorRole: user.role, action: AdminAuditAction.VENDOR_BRANCH_UPDATED, targetType: 'vendor_branch', targetId: branchId, metadata: { request: row.id, kind, status: 'PENDING' } });
    if (this.staffAlerts) {
      const manager = this.ds.manager;
      await this.staffAlerts.alert(manager, {
        eventKey: `branch-change:${row.id}:requested`, category: 'OPS_BRANCH_CHANGE_REQUEST', requiredAction: 'REVIEW_BRANCH_REQUEST', note: kind,
        recipients: await this.staffAlerts.recipientsHolding(manager, [Permission.MANAGE_VENDORS]),
        vendorBranchId: branchId,
      } as Parameters<StaffAlertsService['alert']>[1]);
    }
    return this.view((await this.rows(`r.id = $1`, [row.id]))[0]);
  }

  async vendorList(user: Actor, branchId: string) {
    await ownedBranch(this.vendorAuth, user, branchId);
    return (await this.rows(`r.vendor_branch_id = $1`, [branchId], 50)).map((r) => this.view(r));
  }

  async withdraw(user: Actor, branchId: string, requestId: string) {
    await ownedBranch(this.vendorAuth, user, branchId);
    if (!UUID_RE.test(requestId ?? '')) throw notFound('Request not found.');
    const done = await this.ds.query(
      `UPDATE vendor_branch_change_requests SET status = 'WITHDRAWN' WHERE id = $1 AND vendor_branch_id = $2 AND status = 'PENDING' RETURNING id`,
      [requestId, branchId],
    );
    if (done.length === 0 || (Array.isArray(done[0]) && done[0].length === 0)) {
      const [r] = await this.ds.query(`SELECT status FROM vendor_branch_change_requests WHERE id = $1 AND vendor_branch_id = $2`, [requestId, branchId]);
      if (!r) throw notFound('Request not found.');
      throw new ConflictException({ message: `This request is already ${r.status}.`, details: { code: 'REQUEST_NOT_PENDING', status: r.status } });
    }
    return { id: requestId, status: 'WITHDRAWN' };
  }

  // ----------------------------------------------------------------- admin side
  async adminList(status?: string) {
    const s = status && ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'].includes(status) ? status : 'PENDING';
    return (await this.rows(`r.status = $1`, [s], 200)).map((r) => this.view(r));
  }

  async approve(admin: Actor, requestId: string, note?: string) {
    const r = await this.pending(requestId);
    const branchId: string = r.vendor_branch_id;
    const payload = r.payload ?? {};
    switch (r.kind as BranchChangeKind) {
      case 'PAUSE':
        await this.ds.query(`UPDATE vendor_branches SET is_open = false, updated_at = now() WHERE id = $1`, [branchId]);
        break;
      case 'REOPEN': {
        const [b] = await this.ds.query(`SELECT is_active FROM vendor_branches WHERE id = $1`, [branchId]);
        if (!b?.is_active) throw new ConflictException({ message: 'Hatly has deactivated this branch, so it cannot be reopened.', details: { code: 'BRANCH_DEACTIVATED' } });
        await this.ds.query(`UPDATE vendor_branches SET is_open = true, updated_at = now() WHERE id = $1`, [branchId]);
        break;
      }
      case 'HOURS':
        await this.ds.query(`UPDATE vendor_branches SET opening_hours = $2::jsonb, updated_at = now() WHERE id = $1`, [branchId, JSON.stringify(payload.openingHours ?? {})]);
        break;
      case 'CLOSURE':
        await this.closures.create(admin, branchId, payload as never);
        break;
      case 'CLOSURE_CANCEL':
        await this.closures.cancel(admin, branchId, String(payload.closureId));
        break;
    }
    await this.decide(admin, r, 'APPROVED', note);
    return this.view((await this.rows(`r.id = $1`, [requestId]))[0]);
  }

  async reject(admin: Actor, requestId: string, note?: string) {
    const r = await this.pending(requestId);
    await this.decide(admin, r, 'REJECTED', note);
    return this.view((await this.rows(`r.id = $1`, [requestId]))[0]);
  }

  // ----------------------------------------------------------------- internals
  private async pending(requestId: string) {
    if (!UUID_RE.test(requestId ?? '')) throw notFound('Request not found.');
    const [r] = await this.ds.query(`SELECT * FROM vendor_branch_change_requests WHERE id = $1`, [requestId]);
    if (!r) throw notFound('Request not found.');
    if (r.status !== 'PENDING') throw new ConflictException({ message: `This request is already ${r.status}.`, details: { code: 'REQUEST_NOT_PENDING', status: r.status } });
    return r;
  }

  private async decide(admin: Actor, r: any, status: 'APPROVED' | 'REJECTED', note?: string) {
    const clean = typeof note === 'string' && note.trim() ? note.trim().slice(0, 300) : null;
    const done = await this.ds.query(
      `UPDATE vendor_branch_change_requests SET status = $2, decided_by_user_id = $3, decided_at = now(), decision_note = $4 WHERE id = $1 AND status = 'PENDING' RETURNING id`,
      [r.id, status, admin.id, clean],
    );
    if (done.length === 0 || (Array.isArray(done[0]) && done[0].length === 0)) {
      throw new ConflictException({ message: 'This request was decided meanwhile.', details: { code: 'REQUEST_NOT_PENDING' } });
    }
    await this.audit.record({ actorUserId: admin.id, actorRole: admin.role, action: AdminAuditAction.VENDOR_BRANCH_UPDATED, targetType: 'vendor_branch', targetId: r.vendor_branch_id, metadata: { request: r.id, kind: r.kind, status } });
    if (this.staffAlerts) {
      const manager = this.ds.manager;
      await this.staffAlerts.alert(manager, {
        eventKey: `branch-change:${r.id}:${status.toLowerCase()}`, category: 'VENDOR_BRANCH_CHANGE_DECIDED', note: `${r.kind}:${status}`,
        recipients: await this.staffAlerts.vendorRecipients(manager, r.vendor_branch_id),
        vendorBranchId: r.vendor_branch_id,
      } as Parameters<StaffAlertsService['alert']>[1]);
    }
  }

  private async validate(branchId: string, kind: BranchChangeKind, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!BRANCH_CHANGE_KINDS.includes(kind)) throw bad('Unknown request kind.');
    const p = payload && typeof payload === 'object' ? payload : {};
    if (kind === 'PAUSE' || kind === 'REOPEN') {
      const [b] = await this.ds.query(`SELECT is_open, is_active FROM vendor_branches WHERE id = $1`, [branchId]);
      if (kind === 'REOPEN' && !b?.is_active) {
        throw new ConflictException({ message: 'Hatly has deactivated this branch, so it cannot be reopened.', details: { code: 'BRANCH_DEACTIVATED' } });
      }
      if (b && b.is_open === (kind === 'REOPEN')) {
        throw new ConflictException({ message: kind === 'PAUSE' ? 'The store is already paused.' : 'The store is already open.', details: { code: 'NO_CHANGE' } });
      }
      return {};
    }
    if (kind === 'HOURS') {
      const h = p.openingHours as Record<string, { open?: unknown; close?: unknown }>;
      if (!h || typeof h !== 'object' || Array.isArray(h)) throw bad('Weekly hours must be an object keyed by mon…sun.');
      for (const [day, v] of Object.entries(h)) {
        if (!DAYS.includes(day)) throw bad(`Unknown day "${day}".`);
        if (!v || typeof v.open !== 'string' || typeof v.close !== 'string' || !TIME_RE.test(v.open) || !TIME_RE.test(v.close)) throw bad(`Hours for ${day} must be HH:mm to HH:mm.`);
      }
      return { openingHours: h };
    }
    if (kind === 'CLOSURE') {
      const starts = new Date(String(p.startsAt));
      const ends = new Date(String(p.endsAt));
      if (!['TEMPORARY', 'HOLIDAY'].includes(String(p.kind))) throw bad('The kind must be TEMPORARY or HOLIDAY.');
      if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || ends <= starts) throw bad('Start and end must be valid, with the end after the start.');
      if (ends <= new Date()) throw bad('The closure must end in the future.');
      const reason = typeof p.reason === 'string' ? p.reason.trim() : '';
      if (reason.length < 3 || reason.length > 300) throw bad('Give a reason of 3–300 characters.');
      return { kind: p.kind, startsAt: starts.toISOString(), endsAt: ends.toISOString(), reason };
    }
    // CLOSURE_CANCEL
    const closureId = String(p.closureId ?? '');
    if (!UUID_RE.test(closureId)) throw notFound('Closure not found.');
    const [c] = await this.ds.query(`SELECT id FROM vendor_branch_closures WHERE id = $1 AND vendor_branch_id = $2 AND cancelled_at IS NULL AND ends_at > now()`, [closureId, branchId]);
    if (!c) throw notFound('Closure not found.');
    return { closureId };
  }

  private rows(where: string, params: unknown[], limit = 1): Promise<any[]> {
    return this.ds.query(
      `SELECT r.*, b.name AS branch_name, v.name AS vendor_name, ru.full_name AS requested_by, du.full_name AS decided_by
         FROM vendor_branch_change_requests r
         JOIN vendor_branches b ON b.id = r.vendor_branch_id JOIN vendors v ON v.id = b.vendor_id
         JOIN users ru ON ru.id = r.requested_by_user_id LEFT JOIN users du ON du.id = r.decided_by_user_id
        WHERE ${where} ORDER BY r.created_at DESC LIMIT ${Number(limit)}`,
      params,
    );
  }

  private view(r: any) {
    return {
      id: r.id, branchId: r.vendor_branch_id, branchName: r.branch_name, vendorName: r.vendor_name, kind: r.kind, payload: r.payload ?? {},
      reason: r.reason, status: r.status, requestedBy: r.requested_by, createdAt: r.created_at, decidedBy: r.decided_by ?? null,
      decidedAt: r.decided_at ?? null, decisionNote: r.decision_note ?? null,
    };
  }
}

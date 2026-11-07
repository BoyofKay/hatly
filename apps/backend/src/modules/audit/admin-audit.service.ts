import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { AdminAuditLog } from './entities/admin-audit-log.entity';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';

/** The vocabulary of audited actions — a small, stable list (never an inline string at a call site). */
export const AdminAuditAction = {
  DASHBOARD_LOGIN: 'auth.dashboard_login',
  DASHBOARD_LOGIN_FAILED: 'auth.dashboard_login_failed',
  DASHBOARD_LOGOUT: 'auth.dashboard_logout',
  MFA_SETUP_STARTED: 'mfa.setup_started',
  MFA_ENABLED: 'mfa.enabled',
  MFA_DISABLED: 'mfa.disabled',
  MFA_RECOVERY_CODE_USED: 'mfa.recovery_code_used',
  MFA_RESET_BY_ADMIN: 'mfa.reset_by_admin',
  MFA_VERIFY_FAILED: 'mfa.verify_failed',
  PERMISSION_GRANTED: 'permission.granted',
  PERMISSION_REVOKED: 'permission.revoked',
  VENDOR_STAFF_CREATED: 'vendor_staff.created',
  VENDOR_STAFF_ACTIVATED: 'vendor_staff.activated',
  VENDOR_STAFF_DEACTIVATED: 'vendor_staff.deactivated',
  BUSINESS_CONFIG_CHANGED: 'business_config.changed',
  SECTOR_CUSTOM_REQUESTS_CHANGED: 'sector.custom_requests_changed',
  /** A customer deleted their own account (store policy). Records the id only — never the name or phone that were erased. */
  CUSTOMER_ACCOUNT_DELETED: 'customer.account_deleted',
  ACCOUNT_DELETION_REQUEST_REJECTED: 'customer.account_deletion_request_rejected',
  // ---- Enterprise Admin Panel (2026-10-30): explicit, structured events for sensitive actions ----
  TEMPLATE_CREATED: 'permission_template.created',
  TEMPLATE_UPDATED: 'permission_template.updated',
  TEMPLATE_DELETED: 'permission_template.deleted',
  TEMPLATE_APPLIED: 'permission_template.applied',
  EXPORT_REQUESTED: 'export.requested',
  EXPORT_COMPLETED: 'export.completed',
  EXPORT_DOWNLOADED: 'export.downloaded',
  EXPORT_CANCELLED: 'export.cancelled',
  PII_REVEALED: 'customer.pii_revealed',
  CUSTOMER_BLOCKED: 'customer.blocked',
  CUSTOMER_UNBLOCKED: 'customer.unblocked',
  CUSTOMER_NOTE_ADDED: 'customer.note_added',
  WALLET_ADJUSTMENT_REQUESTED: 'wallet_adjustment.requested',
  WALLET_ADJUSTMENT_APPLIED: 'wallet_adjustment.applied',
  WALLET_ADJUSTMENT_REJECTED: 'wallet_adjustment.rejected',
  SETTLEMENT_PAYMENT_RECORDED: 'settlement_payment.recorded',
  SETTLEMENT_PAYMENT_VOIDED: 'settlement_payment.voided',
  ORDER_ADMIN_CANCELLED: 'order.admin_cancelled',
  ORDER_EXCEPTION_ITEMS_MARKED: 'order_exception.items_marked_unavailable',
  ORDER_EXCEPTION_DECISION_RECORDED: 'order_exception.decision_recorded',
  ORDER_EXCEPTION_ITEMS_REMOVED: 'order_exception.items_removed',
  ORDER_EXCEPTION_ISOLATED: 'order_exception.execution_isolated',
  ORDER_EXCEPTION_ESCALATED: 'order_exception.escalated',
  ORDER_EXCEPTION_NOTE_ADDED: 'order_exception.note_added',
  ORDER_EXCEPTION_ASSIGNED: 'order_exception.assigned',
  /** A vendor's staff changed their own branch's open/closed state, weekly hours or preparation time. */
  VENDOR_BRANCH_UPDATED: 'vendor_branch.updated',
  VENDOR_STAFF_BRANCH_ASSIGNED: 'vendor_staff.branch_assigned',
  VENDOR_STAFF_BRANCH_UNASSIGNED: 'vendor_staff.branch_unassigned',
  BRANCH_CLOSURE_CREATED: 'branch_closure.created',
  BRANCH_CLOSURE_CANCELLED: 'branch_closure.cancelled',
  STOCKTAKE_STARTED: 'stocktake.started',
  STOCKTAKE_APPLIED: 'stocktake.applied',
  STOCKTAKE_CANCELLED: 'stocktake.cancelled',
  VENDOR_SETTLEMENT_TERMS_SET: 'vendor_settlement_terms.set',
  ORDER_EXCEPTION_RESOLVED: 'order_exception.resolved',
  ORDER_NOTE_ADDED: 'order.note_added',
  RATING_HIDDEN: 'rating.hidden',
  RATING_UNHIDDEN: 'rating.unhidden',
  MEDIA_UPLOADED: 'media.uploaded',
  MEDIA_UPDATED: 'media.updated',
  MEDIA_DELETED: 'media.deleted',
  MEDIA_RESTORED: 'media.restored',
  MEDIA_REPLACED: 'media.replaced_everywhere',
  MEDIA_PURGED: 'media.purged',
  MEDIA_BACKFILL: 'media.backfill',
  CAMPAIGN_TRANSITION: 'campaign.transition',
  BROADCAST_TRANSITION: 'broadcast.transition',
  OFFER_UPDATED: 'offer.updated',
  OFFER_CLONED: 'offer.cloned',
  COUPON_GRANTED: 'coupon.granted',
  BULK_ACTION: 'bulk.action',
  INTEGRATION_CHECK_RUN: 'integration.check_run',
  PRODUCT_MEDIA_SET: 'product.media_set',
  PRODUCT_CHANGE_REQUESTED: 'product.change_requested',
  DRIVER_CAPACITY_OVERRIDDEN: 'driver.capacity_overridden',
  PRODUCT_CHANGE_DECIDED: 'product.change_decided',
  DISPATCH_AUTOMATION_CHANGED: 'dispatch.automation_changed',
  /** Generic record of any other privileged (ADMIN / SUPER_ADMIN) mutation — see AdminMutationAuditInterceptor. */
  ADMIN_MUTATION: 'admin.mutation',
} as const;
export type AdminAuditActionName = (typeof AdminAuditAction)[keyof typeof AdminAuditAction];

export interface AuditEntry {
  actorUserId?: string | null;
  actorRole?: string | null;
  action: AdminAuditActionName;
  targetType?: string | null;
  targetId?: string | null;
  outcome?: 'SUCCESS' | 'FAILURE';
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

/** Keys whose VALUE is never recorded, whatever the caller passes (a defence against someone logging a request body by accident). */
const SECRET_KEY = /pass(word|code)?|secret|token|otp|code|hash|authorization|cookie|key/i;
const MAX_VALUE_LENGTH = 200;

/**
 * Durable audit trail for privileged, security-sensitive mutations. `record` NEVER throws: an audit-write failure is logged loudly
 * but must not turn a completed admin action into an error response (the same principle as the structured business-event log).
 * Pass the caller's `manager` to write inside the action's own transaction so "it happened" and "it is on record" cannot disagree.
 */
@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(@InjectRepository(AdminAuditLog) private readonly repo: Repository<AdminAuditLog>) {}

  async record(entry: AuditEntry, manager?: EntityManager): Promise<void> {
    try {
      const repo = manager ? manager.getRepository(AdminAuditLog) : this.repo;
      await repo.insert({
        actorUserId: entry.actorUserId ?? null,
        actorRole: entry.actorRole ?? null,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetRef: entry.targetId ? String(entry.targetId).slice(0, 120) : null,
        outcome: entry.outcome ?? 'SUCCESS',
        metadata: AdminAuditService.sanitize(entry.metadata ?? {}),
        ipAddress: entry.ipAddress ? String(entry.ipAddress).slice(0, 64) : null,
      });
    } catch (error) {
      this.logger.error(`AUDIT WRITE FAILED for ${entry.action}: ${(error as Error).message}`);
    }
  }

  /** Flat, small, secret-free: scalars only, secret-looking keys dropped, long strings truncated. Exposed for tests. */
  static sanitize(input: Record<string, unknown>): Record<string, string | number | boolean | null> {
    const out: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(input)) {
      if (SECRET_KEY.test(key)) continue;
      if (value === null || typeof value === 'boolean' || typeof value === 'number') out[key] = value as never;
      else if (typeof value === 'string') out[key] = value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…` : value;
    }
    return out;
  }

  /**
   * Launch-readiness G-11 — the read side. Newest first, deterministic tie-break, `limit` silently clamped (same contract as the other
   * admin lists). Every filter is an exact match on an indexed or short column — no free-text search over `metadata`.
   * The actor's display name comes from a LEFT JOIN so a row whose actor is unknown (a failed sign-in for a phone with no account)
   * still lists; the actor's phone number is deliberately not returned.
   */
  async list(query: ListAuditLogsQueryDto): Promise<{ data: AuditLogView[]; page: number; limit: number; total: number }> {
    const page = query.page && query.page > 0 ? query.page : AUDIT_DEFAULT_PAGE;
    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, AUDIT_MAX_LIMIT) : AUDIT_DEFAULT_LIMIT;

    const qb = this.repo
      .createQueryBuilder('a')
      .leftJoin(User, 'u', 'u.id = a.actor_user_id')
      .select(['a.id', 'a.createdAt', 'a.actorUserId', 'a.actorRole', 'a.action', 'a.targetType', 'a.targetRef', 'a.outcome', 'a.metadata', 'a.ipAddress'])
      .addSelect('u.full_name', 'actor_name')
      .orderBy('a.createdAt', 'DESC')
      .addOrderBy('a.id', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit);

    if (query.action) qb.andWhere('a.action = :action', { action: query.action });
    if (query.outcome) qb.andWhere('a.outcome = :outcome', { outcome: query.outcome });
    if (query.actorUserId) qb.andWhere('a.actor_user_id = :actorUserId', { actorUserId: query.actorUserId });
    if (query.targetType) qb.andWhere('a.target_type = :targetType', { targetType: query.targetType });
    if (query.targetRef) qb.andWhere('a.target_id = :targetRef', { targetRef: query.targetRef });
    if (query.from) qb.andWhere('a.created_at >= :from', { from: query.from });
    if (query.to) qb.andWhere('a.created_at <= :to', { to: query.to });

    const [total, raw] = await Promise.all([qb.getCount(), qb.getRawAndEntities()]);
    const data = raw.entities.map((row, index) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      actorUserId: row.actorUserId,
      actorName: (raw.raw[index]?.actor_name as string | null | undefined) ?? null,
      actorRole: row.actorRole,
      action: row.action,
      targetType: row.targetType,
      targetRef: row.targetRef,
      outcome: row.outcome,
      metadata: row.metadata,
      ipAddress: row.ipAddress,
    }));
    return { data, page, limit, total };
  }
}

export const AUDIT_DEFAULT_PAGE = 1;
export const AUDIT_DEFAULT_LIMIT = 25;
export const AUDIT_MAX_LIMIT = 100;

/** What the admin API returns for one audit row (mirrored by apps/dashboard/lib/api/admin-audit-log.ts). */
export interface AuditLogView {
  id: string;
  createdAt: string;
  actorUserId: string | null;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  targetType: string | null;
  targetRef: string | null;
  outcome: string;
  metadata: Record<string, string | number | boolean | null>;
  ipAddress: string | null;
}

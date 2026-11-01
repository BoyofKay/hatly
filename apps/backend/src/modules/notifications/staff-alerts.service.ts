import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { Permission } from '../permissions/permission.enum';
import { PermissionsService } from '../permissions/permissions.service';
import { VendorStaffAuthorizationService } from '../vendors/vendor-staff-authorization.service';
import { NotificationOutboxService } from './outbox/notification-outbox.service';

export type StaffAudience = 'OPERATIONS' | 'VENDOR';

/**
 * Every staff alert category. `CRITICAL` alerts cannot be switched off in the in-app inbox (a critical exception must never vanish
 * silently); they are also the only ones pushed to a staff device. Wording is rendered by the dashboard from `category` + `requiredAction`;
 * the server only stores codes, the order number and the (optional) note of the person who raised it.
 */
export const STAFF_ALERT_META = {
  EXCEPTION_NEW: { audience: 'OPERATIONS', severity: 'INFO', title: 'New order exception', body: 'A product of an order is unavailable. The customer has been asked.' },
  EXCEPTION_ASSIGNED: { audience: 'OPERATIONS', severity: 'INFO', title: 'An exception was assigned to you', body: 'You are responsible for this exception.' },
  EXCEPTION_ESCALATED: { audience: 'OPERATIONS', severity: 'CRITICAL', title: 'Exception escalated', body: 'An exception was escalated and needs a decision.' },
  EXCEPTION_ACTION_REQUIRED: { audience: 'OPERATIONS', severity: 'CRITICAL', title: 'The customer asked to cancel the order', body: 'Contact the customer if needed and execute the cancellation.' },
  EXCEPTION_ISOLATED: { audience: 'OPERATIONS', severity: 'CRITICAL', title: 'A case needs a person: the order was not changed', body: 'The rules do not define the money for this case, so nothing was changed.' },
  VENDOR_ITEMS_REMOVED: { audience: 'VENDOR', severity: 'INFO', title: 'Items were taken off an order', body: 'The customer agreed to continue without the unavailable items. Prepare the rest.' },
  VENDOR_ORDER_CANCELLED: { audience: 'VENDOR', severity: 'CRITICAL', title: 'An order was cancelled', body: 'The order was cancelled after an item was unavailable. Stop preparing it.' },
  VENDOR_ACTION_REQUESTED: { audience: 'VENDOR', severity: 'CRITICAL', title: 'Hatly operations need your action', body: 'Open the order to see what is needed.' },
  // Operational events of the order lifecycle (2026-11-01). Each is written in the transaction that made the change (or right after it, for a
  // change committed by another service), to the staff whose permission or branch covers it.
  VENDOR_NEW_ORDER: { audience: 'VENDOR', severity: 'INFO', title: 'New order', body: 'A new order arrived for your branch.' },
  VENDOR_PART_CANCELLED: { audience: 'VENDOR', severity: 'CRITICAL', title: 'An order was cancelled', body: 'The customer or Hatly cancelled this order. Stop preparing it.' },
  OPS_DISPATCH_NEEDED: { audience: 'OPERATIONS', severity: 'INFO', title: 'An order needs a driver', body: 'Automatic assignment could not place this order; assign a driver.' },
  OPS_TRANSFER_TO_VERIFY: { audience: 'OPERATIONS', severity: 'INFO', title: 'A transfer is waiting for verification', body: 'The customer says the manual transfer was sent.' },
  OPS_FAILED_DELIVERY: { audience: 'OPERATIONS', severity: 'CRITICAL', title: 'A delivery failed', body: 'A failed delivery needs a resolution.' },
} as const;
export type StaffAlertCategory = keyof typeof STAFF_ALERT_META;
export const STAFF_ALERT_CATEGORIES = Object.keys(STAFF_ALERT_META) as StaffAlertCategory[];

export type RequiredAction = 'REVIEW_NEW_CASE' | 'EXECUTE_CANCELLATION' | 'REVIEW_ISOLATED_CASE' | 'DECIDE_ESCALATION' | 'PREPARE_WITHOUT_ITEMS' | 'STOP_PREPARING' | 'VENDOR_ACTION'
  | 'ACCEPT_ORDER' | 'ASSIGN_DRIVER' | 'VERIFY_TRANSFER' | 'RESOLVE_FAILED_DELIVERY';

export interface StaffAlert {
  eventKey: string;
  category: StaffAlertCategory;
  recipients: string[];
  /** The person who caused the event is never alerted about their own action. */
  excludeUserId?: string | null;
  orderId: string;
  orderNumber: string;
  exceptionId?: string | null;
  vendorBranchId?: string | null;
  requiredAction?: RequiredAction;
  note?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A notification with the vendor's own order part (so the vendor app can open it); null for Operations alerts. */
const SELECT_WITH_SEGMENT = `SELECT n.*, (SELECT g.id FROM order_vendor_segments g WHERE g.order_id = n.order_id AND g.vendor_branch_id = n.vendor_branch_id ORDER BY g.created_at LIMIT 1) AS segment_id FROM staff_notifications n`;
const notFound = () => new NotFoundException({ message: 'Notification not found.', details: { code: 'NOTIFICATION_NOT_FOUND' } });

/**
 * Staff alerts: who is told, and the staff member's own inbox.
 *
 * WHO — Operations: ADMIN users holding MANAGE_ORDER_FULFILMENT (the permission that works the queue); critical alerts also reach holders of
 * MANAGE_ORDER_ISSUES, SUPER_ADMINs and the case's assignee. Vendor staff: only the staff linked to the branch of the order part.
 * HOW — the inbox row is written in the caller's transaction (so it exists iff the business change committed) and never depends on a
 * provider; a CRITICAL alert additionally queues a push in the outbox for staff who actually have a registered device.
 * PREFERENCES — a member of staff may mute non-critical categories in the inbox and any category's push; a CRITICAL category can never be
 * muted in the inbox.
 */
@Injectable()
export class StaffAlertsService {
  private readonly logger = new Logger(StaffAlertsService.name);

  constructor(
    private readonly ds: DataSource,
    private readonly outbox: NotificationOutboxService,
    private readonly permissions: PermissionsService,
    private readonly vendorAuth: VendorStaffAuthorizationService,
  ) {}

  // ----------------------------------------------------------------------------------------------------------------------------- recipients

  async operationsRecipients(m: EntityManager, opts: { critical: boolean; assigneeUserId?: string | null }): Promise<string[]> {
    const perms = opts.critical ? [Permission.MANAGE_ORDER_FULFILMENT, Permission.MANAGE_ORDER_ISSUES] : [Permission.MANAGE_ORDER_FULFILMENT];
    const rows: Array<{ id: string }> = await m.query(
      `SELECT DISTINCT u.id FROM users u
         LEFT JOIN admin_permissions p ON p.user_id = u.id AND p.deleted_at IS NULL AND p.permission = ANY($1)
        WHERE u.is_active AND u.deleted_at IS NULL
          AND ((u.role = 'ADMIN' AND p.id IS NOT NULL) OR ($2 AND u.role = 'SUPER_ADMIN') OR (u.id = $3 AND u.role IN ('ADMIN','SUPER_ADMIN')))`,
      [perms, opts.critical, opts.assigneeUserId ?? null],
    );
    return rows.map((r) => r.id);
  }

  /**
   * Active admins who may both READ order alerts (VIEW_ORDERS — the inbox's own rule) and act on this kind of event (any of `perms`);
   * SUPER_ADMINs always qualify. An admin who could not open the inbox is never sent a row they cannot see.
   */
  async recipientsHolding(m: EntityManager, perms: Permission[]): Promise<string[]> {
    const rows: Array<{ id: string }> = await m.query(
      `SELECT u.id FROM users u
        WHERE u.is_active AND u.deleted_at IS NULL
          AND (u.role = 'SUPER_ADMIN'
            OR (u.role = 'ADMIN'
              AND EXISTS (SELECT 1 FROM admin_permissions p WHERE p.user_id = u.id AND p.deleted_at IS NULL AND p.permission = ANY($1))
              AND EXISTS (SELECT 1 FROM admin_permissions v WHERE v.user_id = u.id AND v.deleted_at IS NULL AND v.permission = $2)))`,
      [perms, Permission.VIEW_ORDERS],
    );
    return rows.map((r) => r.id);
  }

  async vendorRecipients(m: EntityManager, vendorBranchId: string | null | undefined): Promise<string[]> {
    if (!vendorBranchId) return [];
    const rows: Array<{ id: string }> = await m.query(
      `SELECT DISTINCT u.id FROM vendor_staff s JOIN users u ON u.id = s.user_id
        WHERE s.vendor_branch_id = $1 AND s.deleted_at IS NULL AND u.is_active AND u.deleted_at IS NULL AND u.role IN ('VENDOR','VENDOR_MANAGER')`,
      [vendorBranchId],
    );
    return rows.map((r) => r.id);
  }

  // ------------------------------------------------------------------------------------------------------------------------------- writing

  /** Writes the inbox rows (and queues the pushes) in the caller's transaction. Never throws. Returns how many recipients got a NEW inbox row. */
  async alert(m: EntityManager, a: StaffAlert): Promise<number> {
    const meta = STAFF_ALERT_META[a.category];
    const recipients = [...new Set(a.recipients)].filter((id) => id && id !== a.excludeUserId);
    if (recipients.length === 0) return 0;
    try {
      return await m.transaction(async (sp) => {
        const prefs: Array<{ user_id: string; channel: string; enabled: boolean }> = await sp.query(
          `SELECT user_id, channel, enabled FROM notification_preferences WHERE user_id = ANY($1) AND category = $2`,
          [recipients, a.category],
        );
        const off = (user: string, channel: string) => prefs.some((p) => p.user_id === user && p.channel === channel && !p.enabled);
        const devices = new Set<string>(
          meta.severity === 'CRITICAL'
            ? (await sp.query(`SELECT DISTINCT user_id FROM device_tokens WHERE user_id = ANY($1) AND is_active AND deleted_at IS NULL`, [recipients])).map((r: any) => r.user_id)
            : [],
        );
        let created = 0;
        for (const user of recipients) {
          if (meta.severity === 'CRITICAL' || !off(user, 'IN_APP')) {
            const rows = await sp.query(
              `INSERT INTO staff_notifications (user_id, event_key, category, severity, required_action, order_id, order_number, exception_id, vendor_branch_id, note)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT ON CONSTRAINT "UQ_staff_notifications_user_event" DO NOTHING RETURNING id`,
              [user, a.eventKey.slice(0, 160), a.category, meta.severity, a.requiredAction ?? null, a.orderId, a.orderNumber, a.exceptionId ?? null, a.vendorBranchId ?? null, a.note?.slice(0, 500) ?? null],
            );
            if (rows.length > 0) created++;
          }
          if (meta.severity === 'CRITICAL' && devices.has(user)) {
            await this.outbox.enqueue(sp, {
              eventKey: a.eventKey, recipientUserId: user, recipientKind: 'STAFF', channel: 'PUSH', category: a.category, severity: 'CRITICAL', title: meta.title, body: `${meta.body} (${a.orderNumber})`,
              data: { type: a.category, orderId: a.orderId, ...(a.exceptionId ? { exceptionId: a.exceptionId } : {}) }, skipReason: off(user, 'PUSH') ? 'PREFERENCE_DISABLED' : undefined,
            });
          }
        }
        return created;
      });
    } catch (error) {
      this.logger.error(`Could not write staff alert ${a.category} (${a.eventKey}): ${(error as Error).message}`);
      return 0;
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------------- reading

  /** The caller's audience, after the permission/role check. A vendor is also limited to the branches they are linked to. */
  private async audience(actor: { id: string; role: string }): Promise<{ audience: StaffAudience; branchIds: string[] | null }> {
    if (actor.role === Role.ADMIN || actor.role === Role.SUPER_ADMIN) {
      if (!(await this.permissions.actorHolds(actor, Permission.VIEW_ORDERS))) {
        throw new ForbiddenException({ message: 'Order alerts need the order-viewing permission.', details: { code: 'MISSING_PERMISSION' } });
      }
      return { audience: 'OPERATIONS', branchIds: null };
    }
    if (actor.role === Role.VENDOR || actor.role === Role.VENDOR_MANAGER) return { audience: 'VENDOR', branchIds: await this.vendorAuth.getOwnedBranchIds(actor.id) };
    throw new ForbiddenException();
  }

  private categoriesOf(audience: StaffAudience): StaffAlertCategory[] {
    return STAFF_ALERT_CATEGORIES.filter((c) => STAFF_ALERT_META[c].audience === audience);
  }

  private scope(aud: { audience: StaffAudience; branchIds: string[] | null }, userId: string, params: unknown[] = []) {
    params.push(userId, this.categoriesOf(aud.audience));
    let where = `user_id = $1 AND category = ANY($2)`;
    if (aud.branchIds) {
      params.push(aud.branchIds);
      where += ` AND vendor_branch_id = ANY($${params.length})`;
    }
    return { where, params };
  }

  private view(r: any) {
    const meta = STAFF_ALERT_META[r.category as StaffAlertCategory];
    return {
      id: r.id, category: r.category, severity: r.severity, requiredAction: r.required_action, orderId: r.order_id, orderNumber: r.order_number, exceptionId: r.exception_id, segmentId: r.segment_id ?? null,
      vendorBranchId: r.vendor_branch_id, note: r.note, title: meta?.title ?? 'Order alert', body: meta?.body ?? '', isRead: r.is_read, readAt: r.read_at, createdAt: r.created_at,
    };
  }

  async list(actor: { id: string; role: string }, q: { page?: string | number; limit?: string | number; unread?: string }) {
    const aud = await this.audience(actor);
    const page = Math.max(1, Math.min(Number(q.page) || 1, 200));
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 25));
    const { where, params } = this.scope(aud, actor.id);
    const filter = q.unread === 'true' ? `${where} AND is_read = false` : where;
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM staff_notifications WHERE ${filter}`, params);
    const rows = await this.ds.query(`${SELECT_WITH_SEGMENT} WHERE ${filter} ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, params);
    return { items: rows.map((r: any) => this.view(r)), page, limit, total, unreadCount: await this.unreadCount(actor, aud) };
  }

  async unreadCount(actor: { id: string; role: string }, known?: { audience: StaffAudience; branchIds: string[] | null }): Promise<number> {
    const aud = known ?? (await this.audience(actor));
    const { where, params } = this.scope(aud, actor.id);
    const [{ n }] = await this.ds.query(`SELECT count(*)::int AS n FROM staff_notifications WHERE ${where} AND is_read = false`, params);
    return n;
  }

  /** Idempotent; someone else's notification is indistinguishable from a missing one. */
  async markRead(actor: { id: string; role: string }, id: string) {
    const aud = await this.audience(actor);
    if (!UUID_RE.test(id)) throw notFound();
    const { where, params } = this.scope(aud, actor.id);
    params.push(id);
    const rows = await this.ds.query(`${SELECT_WITH_SEGMENT} WHERE ${where} AND id = $${params.length}`, params);
    if (rows.length === 0) throw notFound();
    await this.ds.query(`UPDATE staff_notifications SET is_read = true, read_at = now() WHERE id = $1 AND user_id = $2 AND is_read = false`, [id, actor.id]);
    const [row] = await this.ds.query(`${SELECT_WITH_SEGMENT} WHERE n.id = $1`, [id]);
    return this.view(row);
  }

  async markAllRead(actor: { id: string; role: string }): Promise<{ updated: number }> {
    const aud = await this.audience(actor);
    const { where, params } = this.scope(aud, actor.id);
    const [, updated] = await this.ds.query(`UPDATE staff_notifications SET is_read = true, read_at = now() WHERE ${where} AND is_read = false`, params);
    return { updated };
  }

  async preferences(actor: { id: string; role: string }) {
    const aud = await this.audience(actor);
    const saved: Array<{ category: string; channel: string; enabled: boolean }> = await this.ds.query(`SELECT category, channel, enabled FROM notification_preferences WHERE user_id = $1`, [actor.id]);
    const enabled = (category: string, channel: string) => saved.find((p) => p.category === category && p.channel === channel)?.enabled ?? true;
    return this.categoriesOf(aud.audience).map((category) => {
      const critical = STAFF_ALERT_META[category].severity === 'CRITICAL';
      return {
        category, severity: STAFF_ALERT_META[category].severity,
        inApp: { enabled: critical ? true : enabled(category, 'IN_APP'), locked: critical },
        // Push is only ever used for critical alerts, and only reaches staff who registered a device.
        push: { enabled: enabled(category, 'PUSH'), available: critical },
      };
    });
  }

  async setPreference(actor: { id: string; role: string }, input: { category: string; channel: string; enabled: boolean }) {
    const aud = await this.audience(actor);
    if (!this.categoriesOf(aud.audience).includes(input?.category as StaffAlertCategory)) throw new BadRequestException({ message: 'Unknown notification category.', details: { code: 'VALIDATION_FAILED' } });
    if (input.channel !== 'IN_APP' && input.channel !== 'PUSH') throw new BadRequestException({ message: 'Channel must be IN_APP or PUSH.', details: { code: 'VALIDATION_FAILED' } });
    if (typeof input.enabled !== 'boolean') throw new BadRequestException({ message: 'enabled must be true or false.', details: { code: 'VALIDATION_FAILED' } });
    if (input.channel === 'IN_APP' && !input.enabled && STAFF_ALERT_META[input.category as StaffAlertCategory].severity === 'CRITICAL') {
      throw new ConflictException({ message: 'Critical alerts always stay in your inbox.', details: { code: 'CRITICAL_ALERT_CANNOT_BE_MUTED' } });
    }
    await this.ds.query(
      `INSERT INTO notification_preferences (user_id, category, channel, enabled) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, category, channel) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`,
      [actor.id, input.category, input.channel, input.enabled],
    );
    return this.preferences(actor);
  }
}

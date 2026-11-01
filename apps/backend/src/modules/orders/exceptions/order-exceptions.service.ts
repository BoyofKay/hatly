import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { Order } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { OrderVendorSegment } from '../entities/order-vendor-segment.entity';
import { OrderVendorSegmentStatus } from '../order-vendor-segment-status.enum';
import { CartGroupType } from '../../cart/cart-group-type.enum';
import { VendorStaffAuthorizationService } from '../../vendors/vendor-staff-authorization.service';
import { AdminAuditAction, AdminAuditService } from '../../audit/admin-audit.service';
import { CUSTOMER_NOTIFICATION_FALLBACK_TEXT, CustomerNotificationType, recordOrderNotification } from '../../notifications/customer-notification-events';
import { NotificationOutboxService } from '../../notifications/outbox/notification-outbox.service';
import { StaffAlertsService } from '../../notifications/staff-alerts.service';
import { OrderItemRemovalService, orderItemGrossAmountMinor } from './order-item-removal.service';
import {
  CLOSED_EXCEPTION_STATUSES,
  CUSTOMER_DECISIONS,
  CustomerDecision,
  DecisionChannel,
  ExceptionEventView,
  ExceptionStatus,
  ExceptionType,
  ExceptionView,
  EXCEPTION_STATUSES,
  EXCEPTION_TYPES,
  ITEM_REMOVAL_ORDER_STATUSES,
  IsolationCode,
  OPERATIONS_DECISION_CHANNELS,
  requiredActionFor,
  REQUIRED_ACTION_TEXT,
} from './order-exceptions.types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (status: 400 | 404 | 409, code: string, message: string) => {
  const body = { message, details: { code } };
  if (status === 404) return new NotFoundException(body);
  if (status === 409) return new ConflictException(body);
  return new BadRequestException(body);
};
/** Items added to a case the customer has not answered are folded into the notification sent in this window (see notifyCustomerOfMarking). */
const CUSTOMER_RENOTIFY_AFTER_MINUTES = 10;
const CLOSED_ORDER_SQL = `('CANCELLED','DELIVERED','COLLECTED','FAILED_DELIVERY')`;
const num = (v: unknown): number | null => (v == null ? null : Number(v));
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());

export interface Actor {
  id: string;
  role: string;
}

/**
 * Order exceptions (PD-016). First use: a product turns out to be unavailable after the order was placed.
 *  vendor (or Operations for the vendor) marks items → customer is told → customer continues without them OR asks to cancel the whole
 *  order → no answer = nothing happens (silence is never consent; the case waits in the Operations queue) → Operations contacts the
 *  customer, records what the customer decided and executes only that.
 * No substitution of any kind exists. Cancelling goes through the existing authorized cancellation path (the admin controller calls it);
 * this service never cancels an order itself.
 */
@Injectable()
export class OrderExceptionsService {
  constructor(
    private readonly ds: DataSource,
    private readonly vendorAuth: VendorStaffAuthorizationService,
    private readonly removal: OrderItemRemovalService,
    private readonly audit: AdminAuditService,
    private readonly outbox: NotificationOutboxService,
    private readonly alerts: StaffAlertsService,
  ) {}

  // ------------------------------------------------------------------------------------------------------------ vendor / operations: mark

  async markItemsUnavailable(params: { segmentId: string; itemIds: string[]; note?: string; actor: Actor; vendorScoped: boolean }): Promise<ExceptionView> {
    const itemIds = [...new Set(params.itemIds ?? [])];
    if (!Array.isArray(params.itemIds) || itemIds.length === 0 || itemIds.length > 50 || itemIds.some((i) => typeof i !== 'string' || !UUID_RE.test(i))) {
      throw err(400, 'VALIDATION_FAILED', 'Choose between 1 and 50 items of this order.');
    }
    if (!UUID_RE.test(params.segmentId)) throw err(404, 'NOT_FOUND', 'Order part not found.');
    const note = params.note?.trim() || undefined;
    if (note && note.length > 500) throw err(400, 'VALIDATION_FAILED', 'The note is limited to 500 characters.');

    const exceptionId = await this.ds.transaction(async (m) => {
      const probe = await m.findOne(OrderVendorSegment, { where: { id: params.segmentId } });
      if (!probe) throw err(404, 'NOT_FOUND', 'Order part not found.');
      if (params.vendorScoped) {
        // Another branch's part is indistinguishable from a part that does not exist.
        const owned = probe.vendorBranchId ? await this.vendorAuth.getOwnedBranchIds(params.actor.id) : [];
        if (!probe.vendorBranchId || !owned.includes(probe.vendorBranchId)) throw err(404, 'NOT_FOUND', 'Order part not found.');
      }
      const order = await m.findOne(Order, { where: { id: probe.orderId }, lock: { mode: 'pessimistic_write' } });
      const segment = await m.findOne(OrderVendorSegment, { where: { id: params.segmentId }, lock: { mode: 'pessimistic_write' } });
      if (!order || !segment) throw err(404, 'NOT_FOUND', 'Order part not found.');
      if (segment.groupType !== CartGroupType.CATALOG) throw err(409, 'NOT_A_VENDOR_PART', 'Only a vendor part of an order has items that can be unavailable.');
      if (segment.status === OrderVendorSegmentStatus.CANCELLED || !ITEM_REMOVAL_ORDER_STATUSES.includes(order.status)) {
        throw err(409, 'ORDER_NOT_EDITABLE', 'This order can no longer be changed.');
      }

      const items = await m.find(OrderItem, { where: { id: In(itemIds), orderVendorSegmentId: segment.id } });
      if (items.length !== itemIds.length) throw err(400, 'ITEM_NOT_IN_PART', 'Every chosen item must belong to this order part.');
      if (items.some((i) => i.removedAt)) throw err(409, 'ITEM_ALREADY_REMOVED', 'One of the items was already taken off the order.');

      const [open] = await m.query(
        `SELECT * FROM order_exceptions WHERE order_id = $1 AND type = 'ITEM_UNAVAILABLE' AND status NOT IN ('RESOLVED','WITHDRAWN') FOR UPDATE`,
        [order.id],
      );
      let id: string;
      if (open) {
        if (open.customer_decision) throw err(409, 'EXCEPTION_ALREADY_DECIDED', 'The customer has already answered; more items cannot be added to this case.');
        id = open.id;
      } else {
        const [created] = await m.query(
          `INSERT INTO order_exceptions (order_id, order_vendor_segment_id, type, status, summary, opened_by_user_id, opened_by_role)
           VALUES ($1, $2, 'ITEM_UNAVAILABLE', 'AWAITING_CUSTOMER', $3, $4, $5) RETURNING id`,
          [order.id, segment.id, `${items.length} item(s) unavailable`.slice(0, 300), params.actor.id, params.actor.role],
        );
        id = created.id;
      }
      for (const item of items) {
        await m.query(`INSERT INTO order_exception_items (exception_id, order_item_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, item.id]);
      }
      await this.event(m, id, 'ITEMS_MARKED_UNAVAILABLE', params.actor, note, { itemIds: items.map((i) => i.id), onBehalfOfVendor: !params.vendorScoped });
      await m.query(`UPDATE order_exceptions SET updated_at = now() WHERE id = $1`, [id]);
      await this.notifyCustomerOfMarking(m, order, id, !!open);
      if (!open) {
        // A NEW case: Operations are told (the customer has been asked; the case waits in their queue if the customer does not answer).
        await this.alerts.alert(m, {
          eventKey: `exception:${id}:new`, category: 'EXCEPTION_NEW', recipients: await this.alerts.operationsRecipients(m, { critical: false }), excludeUserId: params.actor.id,
          orderId: order.id, orderNumber: order.orderNumber, exceptionId: id, vendorBranchId: segment.vendorBranchId, requiredAction: 'REVIEW_NEW_CASE',
        });
      }
      await this.audit.record(
        { actorUserId: params.actor.id, actorRole: params.actor.role, action: AdminAuditAction.ORDER_EXCEPTION_ITEMS_MARKED, targetType: 'order', targetId: order.id, metadata: { exceptionId: id, items: items.length, onBehalfOfVendor: !params.vendorScoped } },
        m,
      );
      return id;
    });
    return this.getView(exceptionId, true);
  }

  // ------------------------------------------------------------------------------------------------------------------ customer: respond

  /** What the customer sees for an order: the open question (if any). Exposes nothing about other customers or internal notes. */
  async customerView(orderId: string, customerId: string): Promise<ExceptionView | null> {
    const [order] = await this.ds.query(`SELECT id FROM orders WHERE id = $1 AND customer_id = $2`, [orderId, customerId]);
    if (!order) throw err(404, 'NOT_FOUND', 'Order not found.');
    const [row] = await this.ds.query(
      `SELECT id FROM order_exceptions WHERE order_id = $1 AND type = 'ITEM_UNAVAILABLE' ORDER BY created_at DESC LIMIT 1`,
      [orderId],
    );
    if (!row) return null;
    const view = await this.getView(row.id, false);
    return { ...view, events: undefined };
  }

  async customerRespond(params: { orderId: string; exceptionId: string; customerId: string; decision: CustomerDecision }): Promise<{ exception: ExceptionView; executed: boolean; isolated: IsolationCode | null }> {
    if (!CUSTOMER_DECISIONS.includes(params.decision)) throw err(400, 'VALIDATION_FAILED', 'Choose to continue without the items or to cancel the order.');
    if (!UUID_RE.test(params.orderId) || !UUID_RE.test(params.exceptionId)) throw err(404, 'NOT_FOUND', 'Not found.');
    const actor: Actor = { id: params.customerId, role: 'CUSTOMER' };

    const result = await this.ds.transaction(async (m) => {
      const order = await m.findOne(Order, { where: { id: params.orderId }, lock: { mode: 'pessimistic_write' } });
      if (!order || order.customerId !== params.customerId) throw err(404, 'NOT_FOUND', 'Order not found.');
      const [ex] = await m.query(`SELECT * FROM order_exceptions WHERE id = $1 AND order_id = $2 AND type = 'ITEM_UNAVAILABLE' FOR UPDATE`, [params.exceptionId, order.id]);
      if (!ex) throw err(404, 'NOT_FOUND', 'Not found.');
      if (ex.customer_decision) {
        if (ex.customer_decision === params.decision) return { executed: ex.status === 'RESOLVED', isolated: null as IsolationCode | null }; // repeat: nothing changes
        throw err(409, 'DECISION_ALREADY_RECORDED', 'An answer was already recorded for this case.');
      }
      if (CLOSED_EXCEPTION_STATUSES.includes(ex.status)) throw err(409, 'EXCEPTION_CLOSED', 'This case is closed.');

      await this.recordDecisionRow(m, ex.id, params.decision, 'APP', null, null);
      await this.event(m, ex.id, 'CUSTOMER_DECISION_RECORDED', actor, null, { decision: params.decision, channel: 'APP' });
      await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.ORDER_EXCEPTION_DECISION_RECORDED, targetType: 'order', targetId: order.id, metadata: { exceptionId: ex.id, decision: params.decision, channel: 'APP' } }, m);

      if (params.decision === 'CANCEL_ORDER') {
        // Customer cancellation permissions are unchanged (PD-005/PD-014): the request is queued for authorized Operations to execute.
        await m.query(`UPDATE order_exceptions SET status = 'AWAITING_OPERATIONS', priority = 'HIGH', updated_at = now() WHERE id = $1`, [ex.id]);
        await this.event(m, ex.id, 'CANCELLATION_REQUESTED', actor, null, {});
        await this.alertOperations(m, ex, order, 'EXCEPTION_ACTION_REQUIRED', `exception:${ex.id}:cancellation-requested`, 'EXECUTE_CANCELLATION', actor.id);
        return { executed: false, isolated: null };
      }
      const outcome = await this.continueWithout(m, ex.id, order, actor);
      return { executed: outcome.ok, isolated: outcome.ok ? null : outcome.code };
    });
    return { ...result, exception: await this.getView(params.exceptionId, false) };
  }

  // ------------------------------------------------------------------------------------------------------------------ operations

  /**
   * Operations records what the customer decided by phone/WhatsApp (or executes a decision the customer left in the app) and, for
   * "continue without", executes it. For "cancel the entire order" this only RECORDS the decision and returns `needsCancellation`: the
   * caller runs the existing authorized cancellation path and then calls {@link markCancelledByDecision}.
   */
  async recordOperationsDecision(params: { exceptionId: string; decision: CustomerDecision; channel?: DecisionChannel; note?: string; actor: Actor }): Promise<{ exception: ExceptionView; executed: boolean; isolated: IsolationCode | null; needsCancellation: boolean; orderId: string }> {
    if (!UUID_RE.test(params.exceptionId)) throw err(404, 'NOT_FOUND', 'Case not found.');
    if (!CUSTOMER_DECISIONS.includes(params.decision)) throw err(400, 'VALIDATION_FAILED', 'Record either "continue without the items" or "cancel the order".');
    const note = params.note?.trim() || null;
    const outcome = await this.ds.transaction(async (m) => {
      const [probe] = await m.query(`SELECT order_id FROM order_exceptions WHERE id = $1`, [params.exceptionId]);
      if (!probe) throw err(404, 'NOT_FOUND', 'Case not found.');
      const order = await m.findOne(Order, { where: { id: probe.order_id }, lock: { mode: 'pessimistic_write' } });
      const [ex] = await m.query(`SELECT * FROM order_exceptions WHERE id = $1 FOR UPDATE`, [params.exceptionId]);
      if (!order || !ex) throw err(404, 'NOT_FOUND', 'Case not found.');
      if (ex.type !== 'ITEM_UNAVAILABLE') throw err(409, 'NOT_A_DECISION_CASE', 'This kind of case has no customer decision to record.');
      if (CLOSED_EXCEPTION_STATUSES.includes(ex.status)) throw err(409, 'EXCEPTION_CLOSED', 'This case is closed.');

      if (ex.customer_decision) {
        // The customer already answered in the app: Operations may only execute THAT answer — never replace it.
        if (ex.customer_decision !== params.decision) throw err(409, 'DECISION_ALREADY_RECORDED', 'The customer already answered differently; the recorded answer stands.');
      } else {
        // A decision made outside the app must be documented: how the customer was reached and what they said.
        if (!params.channel || !OPERATIONS_DECISION_CHANNELS.includes(params.channel)) throw err(400, 'VALIDATION_FAILED', 'State how the customer was reached: PHONE or WHATSAPP.');
        if (!note || note.length < 5) throw err(400, 'VALIDATION_FAILED', 'Write a short note of the conversation (at least 5 characters).');
        await this.recordDecisionRow(m, ex.id, params.decision, params.channel, note, params.actor.id);
        await this.event(m, ex.id, 'OPERATIONS_RECORDED_DECISION', params.actor, note, { decision: params.decision, channel: params.channel });
        await this.audit.record({ actorUserId: params.actor.id, actorRole: params.actor.role, action: AdminAuditAction.ORDER_EXCEPTION_DECISION_RECORDED, targetType: 'order', targetId: order.id, metadata: { exceptionId: ex.id, decision: params.decision, channel: params.channel } }, m);
      }
      if (params.decision === 'CANCEL_ORDER') {
        // The path is now the existing cancellation, so an earlier "not executable" reason no longer describes what is being done.
        await m.query(`UPDATE order_exceptions SET status = 'AWAITING_OPERATIONS', isolation_code = NULL, isolation_message = NULL, isolated_at = NULL, updated_at = now() WHERE id = $1`, [ex.id]);
        return { executed: false, isolated: null as IsolationCode | null, needsCancellation: true, orderId: order.id };
      }
      const result = await this.continueWithout(m, ex.id, order, params.actor);
      return { executed: result.ok, isolated: result.ok ? null : result.code, needsCancellation: false, orderId: order.id };
    });
    return { ...outcome, exception: await this.getView(params.exceptionId, true) };
  }

  /** Called after the existing authorized cancellation path succeeded (or found the order already cancelled). */
  async markCancelledByDecision(exceptionId: string, actor: Actor): Promise<void> {
    await this.ds.transaction(async (m) => {
      const [ex] = await m.query(`SELECT * FROM order_exceptions WHERE id = $1 FOR UPDATE`, [exceptionId]);
      if (!ex || CLOSED_EXCEPTION_STATUSES.includes(ex.status)) return;
      await m.query(`UPDATE order_exceptions SET status = 'RESOLVED', resolution = 'ORDER_CANCELLED', resolved_at = now(), resolved_by_user_id = $2, isolation_code = NULL, isolation_message = NULL, isolated_at = NULL, updated_at = now() WHERE id = $1`, [exceptionId, actor.id]);
      await this.event(m, exceptionId, 'RESOLVED_ORDER_CANCELLED', actor, null, {});
      const [order] = await m.query(`SELECT id, order_number FROM orders WHERE id = $1`, [ex.order_id]);
      const segments = await m.query(`SELECT DISTINCT vendor_branch_id FROM order_vendor_segments WHERE order_id = $1 AND vendor_branch_id IS NOT NULL`, [ex.order_id]);
      for (const g of segments) {
        await this.alertVendor(m, { branchId: g.vendor_branch_id, category: 'VENDOR_ORDER_CANCELLED', eventKey: `exception:${exceptionId}:order-cancelled:${g.vendor_branch_id}`, order: { id: order.id, orderNumber: order.order_number }, exceptionId, requiredAction: 'STOP_PREPARING' });
      }
      await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.ORDER_EXCEPTION_RESOLVED, targetType: 'order', targetId: ex.order_id, metadata: { exceptionId, resolution: 'ORDER_CANCELLED' } }, m);
    });
  }

  async addNote(exceptionId: string, actor: Actor, note: string): Promise<ExceptionView> {
    const text = note?.trim();
    if (!text || text.length > 500) throw err(400, 'VALIDATION_FAILED', 'Write a note of 1–500 characters.');
    await this.ds.transaction(async (m) => {
      const ex = await this.lock(m, exceptionId);
      await this.event(m, ex.id, 'NOTE_ADDED', actor, text, {});
      await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.ORDER_EXCEPTION_NOTE_ADDED, targetType: 'order', targetId: ex.order_id, metadata: { exceptionId } }, m);
    });
    return this.getView(exceptionId, true);
  }

  async escalate(exceptionId: string, actor: Actor, note?: string): Promise<ExceptionView> {
    await this.ds.transaction(async (m) => {
      const ex = await this.lock(m, exceptionId);
      if (ex.status === 'ESCALATED') return;
      await m.query(`UPDATE order_exceptions SET status = 'ESCALATED', priority = 'HIGH', updated_at = now() WHERE id = $1`, [ex.id]);
      await this.event(m, ex.id, 'ESCALATED', actor, note?.trim() || null, { from: ex.status });
      const [order] = await m.query(`SELECT id, order_number FROM orders WHERE id = $1`, [ex.order_id]);
      await this.alertOperations(m, ex, { id: order.id, orderNumber: order.order_number }, 'EXCEPTION_ESCALATED', `exception:${ex.id}:escalated`, 'DECIDE_ESCALATION', actor.id);
      await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.ORDER_EXCEPTION_ESCALATED, targetType: 'order', targetId: ex.order_id, metadata: { exceptionId } }, m);
    });
    return this.getView(exceptionId, true);
  }

  async assign(exceptionId: string, actor: Actor, assigneeUserId: string | null): Promise<ExceptionView> {
    if (assigneeUserId !== null && !UUID_RE.test(assigneeUserId)) throw err(400, 'VALIDATION_FAILED', 'Invalid assignee.');
    await this.ds.transaction(async (m) => {
      const ex = await this.lock(m, exceptionId);
      if (assigneeUserId) {
        const [u] = await m.query(`SELECT id FROM users WHERE id = $1 AND role IN ('ADMIN','SUPER_ADMIN') AND is_active`, [assigneeUserId]);
        if (!u) throw err(400, 'VALIDATION_FAILED', 'The assignee must be an active admin user.');
      }
      await m.query(`UPDATE order_exceptions SET assigned_to_user_id = $2, updated_at = now() WHERE id = $1`, [ex.id, assigneeUserId]);
      const assignEventId = await this.event(m, ex.id, assigneeUserId ? 'ASSIGNED' : 'UNASSIGNED', actor, null, { assigneeUserId });
      if (assigneeUserId) {
        const [order] = await m.query(`SELECT id, order_number FROM orders WHERE id = $1`, [ex.order_id]);
        await this.alerts.alert(m, { eventKey: `exception:${ex.id}:assigned:${assignEventId}`, category: 'EXCEPTION_ASSIGNED', recipients: [assigneeUserId], excludeUserId: actor.id, orderId: order.id, orderNumber: order.order_number, exceptionId: ex.id, requiredAction: 'REVIEW_NEW_CASE' });
      }
      await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.ORDER_EXCEPTION_ASSIGNED, targetType: 'order', targetId: ex.order_id, metadata: { exceptionId, assigneeUserId } }, m);
    });
    return this.getView(exceptionId, true);
  }

  /** Operations closes a case whose order is already over (cancelled, delivered, collected, failed): nothing is executed, the closure is recorded. */
  async resolve(exceptionId: string, actor: Actor, note: string): Promise<ExceptionView> {
    const text = note?.trim();
    if (!text || text.length < 5 || text.length > 500) throw err(400, 'VALIDATION_FAILED', 'Write a short note of why the case is closed (5–500 characters).');
    await this.ds.transaction(async (m) => {
      const ex = await this.lock(m, exceptionId);
      const [order] = await m.query(`SELECT status FROM orders WHERE id = $1`, [ex.order_id]);
      if (!['CANCELLED', 'DELIVERED', 'COLLECTED', 'FAILED_DELIVERY'].includes(order.status)) throw err(409, 'ORDER_STILL_ACTIVE', 'The order is still active: record the customer\'s decision instead of closing the case.');
      await m.query(
        `UPDATE order_exceptions SET status = 'RESOLVED', resolution = 'CLOSED_BY_OPERATIONS', resolved_at = now(), resolved_by_user_id = $2, isolation_code = NULL, isolation_message = NULL, isolated_at = NULL, updated_at = now() WHERE id = $1`,
        [ex.id, actor.id],
      );
      await this.event(m, ex.id, 'CLOSED_BY_OPERATIONS', actor, text, { orderStatus: order.status });
      await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.ORDER_EXCEPTION_RESOLVED, targetType: 'order', targetId: ex.order_id, metadata: { exceptionId, resolution: 'CLOSED_BY_OPERATIONS' } }, m);
    });
    return this.getView(exceptionId, true);
  }

  /** Operations asks the vendor of the case's order part to do something (the note says what). The vendor's staff are alerted; nothing else changes. */
  async requestVendorAction(exceptionId: string, actor: Actor, note: string): Promise<ExceptionView> {
    const text = note?.trim();
    if (!text || text.length < 5 || text.length > 500) throw err(400, 'VALIDATION_FAILED', 'Say what the vendor needs to do (5–500 characters).');
    await this.ds.transaction(async (m) => {
      const ex = await this.lock(m, exceptionId);
      const [row] = await m.query(`SELECT g.vendor_branch_id, o.id AS order_id, o.order_number FROM order_exceptions e JOIN orders o ON o.id = e.order_id LEFT JOIN order_vendor_segments g ON g.id = e.order_vendor_segment_id WHERE e.id = $1`, [ex.id]);
      if (!row.vendor_branch_id) throw err(409, 'NO_VENDOR_PART', 'This case is not about a vendor part of the order.');
      const eventId = await this.event(m, ex.id, 'VENDOR_ACTION_REQUESTED', actor, text, { vendorBranchId: row.vendor_branch_id });
      await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.ORDER_EXCEPTION_NOTE_ADDED, targetType: 'order', targetId: ex.order_id, metadata: { exceptionId, vendorActionRequested: true } }, m);
      await this.alertVendor(m, { branchId: row.vendor_branch_id, category: 'VENDOR_ACTION_REQUESTED', eventKey: `exception:${ex.id}:vendor-action:${eventId}`, order: { id: row.order_id, orderNumber: row.order_number }, exceptionId: ex.id, requiredAction: 'VENDOR_ACTION', note: text });
    });
    return this.getView(exceptionId, true);
  }

  private requiredAction(e: { status: string; type: string; customer_decision: string | null; isolation_code: string | null }) {
    const code = requiredActionFor({ status: e.status as ExceptionStatus, type: e.type as ExceptionType, customerDecision: e.customer_decision, isolationCode: e.isolation_code });
    return { requiredAction: code, requiredActionText: code ? REQUIRED_ACTION_TEXT[code] : null };
  }

  // ------------------------------------------------------------------------------------------------------------------------------ reads

  async list(q: { status?: string; type?: string; priority?: string; assignedTo?: string; q?: string; page?: string | number; limit?: string | number; includeClosedOrders?: string; isolated?: string }) {
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 25));
    const where: string[] = [];
    const v: unknown[] = [];
    if (q.status) {
      const statuses = q.status.split(',').filter((s) => (EXCEPTION_STATUSES as readonly string[]).includes(s));
      if (statuses.length === 0) throw err(400, 'VALIDATION_FAILED', 'Unknown status.');
      v.push(statuses);
      where.push(`e.status = ANY($${v.length})`);
    } else {
      where.push(`e.status NOT IN ('RESOLVED','WITHDRAWN')`);
    }
    if (q.type) {
      if (!(EXCEPTION_TYPES as readonly string[]).includes(q.type)) throw err(400, 'VALIDATION_FAILED', 'Unknown type.');
      v.push(q.type);
      where.push(`e.type = $${v.length}`);
    }
    if (q.priority === 'HIGH' || q.priority === 'NORMAL') {
      v.push(q.priority);
      where.push(`e.priority = $${v.length}`);
    }
    if (q.assignedTo === 'me' || (q.assignedTo && UUID_RE.test(q.assignedTo))) {
      v.push(q.assignedTo);
      where.push(`e.assigned_to_user_id = $${v.length}`);
    } else if (q.assignedTo === 'none') where.push('e.assigned_to_user_id IS NULL');
    if (q.q) {
      v.push(`%${q.q.replace(/[%_\\]/g, '\\$&')}%`);
      where.push(`(o.order_number ILIKE $${v.length} ESCAPE '\\' OR cu.full_name ILIKE $${v.length} ESCAPE '\\')`);
    }
    if (q.isolated === 'true') where.push('e.isolation_code IS NOT NULL');
    // A routine case of an order that is already over is hidden by default; a critical one (high priority, escalated, financially isolated) is NEVER
    // hidden by the state of the order — it stays in the queue until a person resolves it.
    if (q.includeClosedOrders !== 'true') where.push(`(o.status NOT IN ${CLOSED_ORDER_SQL} OR e.priority = 'HIGH' OR e.status = 'ESCALATED' OR e.isolation_code IS NOT NULL)`);
    const from = `FROM order_exceptions e JOIN orders o ON o.id = e.order_id JOIN users cu ON cu.id = o.customer_id`;
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total ${from} ${w}`, v);
    const rows = await this.ds.query(
      `SELECT e.id, e.status, e.type, e.priority, e.summary, e.customer_decision, e.decision_channel, e.assigned_to_user_id, e.created_at, e.updated_at, e.isolation_code, e.isolation_message, e.isolated_at,
              (SELECT u.full_name FROM users u WHERE u.id = e.assigned_to_user_id) AS assignee_name, o.id AS order_id, o.order_number, o.status AS order_status, cu.id AS customer_id, cu.full_name AS customer_name,
              (SELECT coalesce(s.vendor_name_snapshot, s.branch_name_snapshot) FROM order_vendor_segments s WHERE s.id = e.order_vendor_segment_id) AS vendor,
              (SELECT count(*)::int FROM order_exception_items i WHERE i.exception_id = e.id) AS item_count,
              extract(epoch FROM now() - e.created_at)::int AS age_seconds
         ${from} ${w} ORDER BY (e.priority = 'HIGH') DESC, e.created_at ASC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      v,
    );
    return {
      items: rows.map((r: any) => ({
        id: r.id, status: r.status, type: r.type, priority: r.priority, summary: r.summary, customerDecision: r.customer_decision, decisionChannel: r.decision_channel,
        assignedToUserId: r.assigned_to_user_id, responsible: r.assigned_to_user_id ? { userId: r.assigned_to_user_id, name: r.assignee_name } : null,
        isolation: r.isolation_code ? { code: r.isolation_code, message: r.isolation_message, at: iso(r.isolated_at) } : null,
        ...this.requiredAction({ status: r.status, type: r.type, customer_decision: r.customer_decision, isolation_code: r.isolation_code }),
        createdAt: iso(r.created_at), ageSeconds: r.age_seconds, itemCount: r.item_count,
        order: { id: r.order_id, orderNumber: r.order_number, status: r.order_status }, customer: { id: r.customer_id, name: r.customer_name }, vendor: r.vendor ?? null,
      })),
      page, limit, total,
    };
  }

  /** Workload counts for the Operations queues. */
  async summary() {
    const [r] = await this.ds.query(
      `SELECT count(*) FILTER (WHERE e.status NOT IN ('RESOLVED','WITHDRAWN'))::int AS open,
              count(*) FILTER (WHERE e.status = 'AWAITING_CUSTOMER')::int AS awaiting_customer,
              count(*) FILTER (WHERE e.status = 'AWAITING_OPERATIONS')::int AS awaiting_operations,
              count(*) FILTER (WHERE e.status = 'ESCALATED')::int AS escalated,
              count(*) FILTER (WHERE e.status NOT IN ('RESOLVED','WITHDRAWN') AND e.priority = 'HIGH')::int AS high_priority,
              count(*) FILTER (WHERE e.status NOT IN ('RESOLVED','WITHDRAWN') AND e.assigned_to_user_id IS NULL)::int AS unassigned,
              count(*) FILTER (WHERE e.status NOT IN ('RESOLVED','WITHDRAWN') AND e.isolation_code IS NOT NULL)::int AS isolated,
              coalesce(max(extract(epoch FROM now() - e.created_at)) FILTER (WHERE e.status NOT IN ('RESOLVED','WITHDRAWN')), 0)::int AS oldest_open_seconds
         FROM order_exceptions e JOIN orders o ON o.id = e.order_id WHERE (o.status NOT IN ${CLOSED_ORDER_SQL} OR e.priority = 'HIGH' OR e.status = 'ESCALATED' OR e.isolation_code IS NOT NULL)`,
    );
    return { open: r.open, awaitingCustomer: r.awaiting_customer, awaitingOperations: r.awaiting_operations, escalated: r.escalated, highPriority: r.high_priority, unassigned: r.unassigned, isolated: r.isolated, oldestOpenSeconds: r.oldest_open_seconds };
  }

  async getView(exceptionId: string, withEvents: boolean): Promise<ExceptionView> {
    if (!UUID_RE.test(exceptionId)) throw err(404, 'NOT_FOUND', 'Case not found.');
    const [e] = await this.ds.query(`SELECT e.*, o.order_number, o.status AS order_status FROM order_exceptions e JOIN orders o ON o.id = e.order_id WHERE e.id = $1`, [exceptionId]);
    if (!e) throw err(404, 'NOT_FOUND', 'Case not found.');
    const items = await this.ds.query(
      `SELECT i.*, x.removed_amount_minor AS x_removed FROM order_exception_items x JOIN order_items i ON i.id = x.order_item_id WHERE x.exception_id = $1 ORDER BY i.id`,
      [exceptionId],
    );
    const view: ExceptionView = {
      id: e.id, orderId: e.order_id, orderNumber: e.order_number, orderStatus: e.order_status, segmentId: e.order_vendor_segment_id, type: e.type, status: e.status, priority: e.priority, summary: e.summary,
      openedByRole: e.opened_by_role, assignedToUserId: e.assigned_to_user_id, customerDecision: e.customer_decision, decisionChannel: e.decision_channel, decisionNote: e.decision_note,
      decidedAt: iso(e.decided_at), resolution: e.resolution, resolvedAt: iso(e.resolved_at), createdAt: iso(e.created_at)!,
      isolation: e.isolation_code ? { code: e.isolation_code, message: e.isolation_message, at: iso(e.isolated_at) } : null,
      responsible: e.assigned_to_user_id ? { userId: e.assigned_to_user_id, name: (await this.ds.query(`SELECT full_name FROM users WHERE id = $1`, [e.assigned_to_user_id]))[0]?.full_name ?? null } : null,
      ...this.requiredAction(e),
      items: items.map((i: any) => ({
        orderItemId: i.id,
        productName: i.product_name_snapshot,
        quantity: i.quantity,
        amountMinor: orderItemGrossAmountMinor({ productId: i.product_id, pricingUnitSnapshot: i.pricing_unit_snapshot, finalAmountMinor: i.final_amount_minor, estimatedAmountMinor: i.estimated_amount_minor, unitPriceMinor: i.unit_price_minor, quantity: i.quantity } as OrderItem),
        removedAmountMinor: num(i.x_removed),
      })),
    };
    if (withEvents) {
      const events = await this.ds.query(`SELECT * FROM order_exception_events WHERE exception_id = $1 ORDER BY created_at, id`, [exceptionId]);
      view.events = events.map((ev: any): ExceptionEventView => ({ id: ev.id, action: ev.action, actorUserId: ev.actor_user_id, actorRole: ev.actor_role, note: ev.note, metadata: ev.metadata ?? {}, createdAt: iso(ev.created_at)! }));
    }
    return view;
  }

  /** Events of every case of an order, for the merged order timeline. */
  async eventsForOrder(orderId: string): Promise<Array<ExceptionEventView & { exceptionId: string }>> {
    const rows = await this.ds.query(
      `SELECT ev.*, e.id AS exception_id FROM order_exception_events ev JOIN order_exceptions e ON e.id = ev.exception_id WHERE e.order_id = $1 ORDER BY ev.created_at, ev.id`,
      [orderId],
    );
    return rows.map((ev: any) => ({ exceptionId: ev.exception_id, id: ev.id, action: ev.action, actorUserId: ev.actor_user_id, actorRole: ev.actor_role, note: ev.note, metadata: ev.metadata ?? {}, createdAt: iso(ev.created_at)! }));
  }

  // ---------------------------------------------------------------------------------------------------------------------------- internals

  private async lock(m: EntityManager, exceptionId: string) {
    if (!UUID_RE.test(exceptionId)) throw err(404, 'NOT_FOUND', 'Case not found.');
    const [ex] = await m.query(`SELECT * FROM order_exceptions WHERE id = $1 FOR UPDATE`, [exceptionId]);
    if (!ex) throw err(404, 'NOT_FOUND', 'Case not found.');
    if (CLOSED_EXCEPTION_STATUSES.includes(ex.status as ExceptionStatus)) throw err(409, 'EXCEPTION_CLOSED', 'This case is closed.');
    return ex;
  }

  private async event(m: EntityManager, exceptionId: string, action: string, actor: Actor | null, note: string | null | undefined, metadata: Record<string, unknown>): Promise<string> {
    const [row] = await m.query(
      `INSERT INTO order_exception_events (exception_id, action, actor_user_id, actor_role, note, metadata) VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id`,
      [exceptionId, action, actor?.id ?? null, actor?.role ?? null, note ? note.slice(0, 500) : null, JSON.stringify(metadata)],
    );
    return row.id;
  }

  /**
   * Tells the customer that items were marked. The notification belongs to the CASE, not just to (order, type): a second case on the same
   * order tells the customer again, while a retry or a racing writer of the same case produces one row. Items added to a case the customer
   * has not answered yet are COALESCED into the notification already sent for it (the card always shows the current items) unless that
   * notification is older than {@link CUSTOMER_RENOTIFY_AFTER_MINUTES} or was already read — so a vendor marking items one by one does not
   * buzz the customer once per tap, but a later, separate addition is never swallowed.
   */
  private async notifyCustomerOfMarking(m: EntityManager, order: Order, exceptionId: string, joinedExistingCase: boolean) {
    let revision = 1;
    if (joinedExistingCase) {
      const [{ n }] = await m.query(`SELECT count(*)::int AS n FROM order_exception_events WHERE exception_id = $1 AND action = 'ITEMS_MARKED_UNAVAILABLE'`, [exceptionId]);
      revision = n;
      const recent = await m.query(
        `SELECT 1 FROM customer_notifications WHERE order_id = $1 AND type = $2 AND event_key LIKE $3 AND is_read = false AND created_at > now() - ($4 || ' minutes')::interval LIMIT 1`,
        [order.id, CustomerNotificationType.ORDER_ITEM_UNAVAILABLE, `exception:${exceptionId}:%`, String(CUSTOMER_RENOTIFY_AFTER_MINUTES)],
      );
      if (recent.length > 0) return;
    }
    const eventKey = `exception:${exceptionId}:items:${revision}`;
    const inserted = await recordOrderNotification(m, { id: order.id, customerId: order.customerId, orderNumber: order.orderNumber }, CustomerNotificationType.ORDER_ITEM_UNAVAILABLE, eventKey);
    if (!inserted) return;
    const text = CUSTOMER_NOTIFICATION_FALLBACK_TEXT[CustomerNotificationType.ORDER_ITEM_UNAVAILABLE];
    // The push is queued in the same transaction; if no provider is configured the inbox row above is still the customer's notification.
    await this.outbox.enqueue(m, {
      eventKey: `customer:${eventKey}`, recipientUserId: order.customerId, recipientKind: 'CUSTOMER', channel: 'PUSH', category: CustomerNotificationType.ORDER_ITEM_UNAVAILABLE, severity: 'INFO',
      title: text.title, body: text.body, data: { type: CustomerNotificationType.ORDER_ITEM_UNAVAILABLE, orderId: order.id },
    });
  }

  /** Operations alert about a case. Critical alerts also reach supervisors, SUPER_ADMINs and the assignee. */
  private async alertOperations(m: EntityManager, ex: { id: string; assigned_to_user_id: string | null; order_vendor_segment_id: string | null }, order: { id: string; orderNumber: string }, category: 'EXCEPTION_ESCALATED' | 'EXCEPTION_ACTION_REQUIRED' | 'EXCEPTION_ISOLATED', eventKey: string, requiredAction: 'DECIDE_ESCALATION' | 'EXECUTE_CANCELLATION' | 'REVIEW_ISOLATED_CASE', excludeUserId: string | null) {
    await this.alerts.alert(m, {
      eventKey, category, recipients: await this.alerts.operationsRecipients(m, { critical: true, assigneeUserId: ex.assigned_to_user_id }), excludeUserId,
      orderId: order.id, orderNumber: order.orderNumber, exceptionId: ex.id, requiredAction,
    });
  }

  private async branchesOfItems(m: EntityManager, segmentIds: string[]): Promise<string[]> {
    if (segmentIds.length === 0) return [];
    const rows = await m.query(`SELECT DISTINCT vendor_branch_id FROM order_vendor_segments WHERE id = ANY($1) AND vendor_branch_id IS NOT NULL`, [segmentIds]);
    return rows.map((r: any) => r.vendor_branch_id);
  }

  /** Vendor staff of the branch that owns the order part. */
  private async alertVendor(m: EntityManager, params: { branchId: string | null | undefined; category: 'VENDOR_ITEMS_REMOVED' | 'VENDOR_ORDER_CANCELLED' | 'VENDOR_ACTION_REQUESTED'; eventKey: string; order: { id: string; orderNumber: string }; exceptionId: string; requiredAction: 'PREPARE_WITHOUT_ITEMS' | 'STOP_PREPARING' | 'VENDOR_ACTION'; note?: string | null }) {
    await this.alerts.alert(m, {
      eventKey: params.eventKey, category: params.category, recipients: await this.alerts.vendorRecipients(m, params.branchId), orderId: params.order.id, orderNumber: params.order.orderNumber,
      exceptionId: params.exceptionId, vendorBranchId: params.branchId ?? null, requiredAction: params.requiredAction, note: params.note ?? null,
    });
  }

  private async recordDecisionRow(m: EntityManager, exceptionId: string, decision: CustomerDecision, channel: DecisionChannel, note: string | null, recordedBy: string | null) {
    await m.query(
      `UPDATE order_exceptions SET customer_decision = $2, decision_channel = $3, decision_note = $4, decided_at = now(), decision_recorded_by_user_id = $5, updated_at = now() WHERE id = $1`,
      [exceptionId, decision, channel, note, recordedBy],
    );
  }

  /** Executes "continue without the items" for a case whose decision is recorded. Success resolves the case; an isolated case goes to Operations. */
  private async continueWithout(m: EntityManager, exceptionId: string, order: Order, actor: Actor) {
    const links = await m.query(`SELECT order_item_id FROM order_exception_items WHERE exception_id = $1`, [exceptionId]);
    const items = await m.find(OrderItem, { where: { id: In(links.map((l: any) => l.order_item_id)) } });
    const segmentIds = [...new Set(items.map((i) => i.orderVendorSegmentId))];
    // Items of one case may span vendor parts; each part has its own totals and refund key. All-or-nothing: if any part is isolated, the
    // savepoint rolls back every change made for the others, so a case is never half-executed.
    class Isolated extends Error {
      constructor(readonly outcome: Extract<Awaited<ReturnType<OrderItemRemovalService['removeItems']>>, { ok: false }>) {
        super('isolated');
      }
    }
    type Outcome = Awaited<ReturnType<OrderItemRemovalService['removeItems']>>;
    const state: { last: Outcome | null; removedMinor: number } = { last: null, removedMinor: 0 };
    try {
      await m.transaction(async (sp) => {
        for (const segmentId of segmentIds) {
          const segment = await sp.findOne(OrderVendorSegment, { where: { id: segmentId }, lock: { mode: 'pessimistic_write' } });
          if (!segment) throw err(404, 'NOT_FOUND', 'Order part not found.');
          const outcome = await this.removal.removeItems(sp, { order, segment, items: items.filter((i) => i.orderVendorSegmentId === segmentId && !i.removedAt), exceptionId, actorUserId: actor.role === 'CUSTOMER' ? null : actor.id });
          if (!outcome.ok) throw new Isolated(outcome);
          state.last = outcome;
          state.removedMinor += outcome.removedMinor;
        }
      });
    } catch (e) {
      if (!(e instanceof Isolated)) throw e;
      state.last = e.outcome;
    }
    const last = state.last;
    const removedMinor = state.removedMinor;
    if (!last) throw err(409, 'NOTHING_TO_REMOVE', 'The case has no items.');
    if (!last.ok) {
      // The recorded answer could not be executed, so it is no longer the basis for any action: it is cleared (the event below keeps what was said),
      // and Operations must speak to the customer again and record a fresh, documented decision.
      await m.query(
        `UPDATE order_exceptions SET status = 'AWAITING_OPERATIONS', priority = 'HIGH', customer_decision = NULL, decision_channel = NULL, decision_note = NULL, decided_at = NULL, decision_recorded_by_user_id = NULL, updated_at = now() WHERE id = $1`,
        [exceptionId],
      );
      await m.query(`UPDATE order_exceptions SET isolation_code = $2, isolation_message = $3, isolated_at = now() WHERE id = $1`, [exceptionId, last.code, last.message.slice(0, 500)]);
      const isolatedEventId = await this.event(m, exceptionId, 'EXECUTION_ISOLATED', actor, last.message, { code: last.code });
      const [exRow] = await m.query(`SELECT assigned_to_user_id, order_vendor_segment_id FROM order_exceptions WHERE id = $1`, [exceptionId]);
      await this.alertOperations(m, { id: exceptionId, assigned_to_user_id: exRow.assigned_to_user_id, order_vendor_segment_id: exRow.order_vendor_segment_id }, { id: order.id, orderNumber: order.orderNumber }, 'EXCEPTION_ISOLATED', `exception:${exceptionId}:isolated:${isolatedEventId}`, 'REVIEW_ISOLATED_CASE', actor.role === 'CUSTOMER' ? null : actor.id);
      await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.ORDER_EXCEPTION_ISOLATED, targetType: 'order', targetId: order.id, metadata: { exceptionId, code: last.code } }, m);
      return last;
    }
    await m.query(`UPDATE order_exceptions SET status = 'RESOLVED', resolution = 'CONTINUED_WITHOUT_ITEMS', resolved_at = now(), resolved_by_user_id = $2, isolation_code = NULL, isolation_message = NULL, isolated_at = NULL, updated_at = now() WHERE id = $1`, [exceptionId, actor.role === 'CUSTOMER' ? null : actor.id]);
    for (const branchId of await this.branchesOfItems(m, segmentIds)) {
      await this.alertVendor(m, { branchId, category: 'VENDOR_ITEMS_REMOVED', eventKey: `exception:${exceptionId}:items-removed:${branchId}`, order: { id: order.id, orderNumber: order.orderNumber }, exceptionId, requiredAction: 'PREPARE_WITHOUT_ITEMS' });
    }
    await this.event(m, exceptionId, 'ITEMS_REMOVED_ORDER_CONTINUES', actor, null, { removedMinor, newTotalMinor: last.newTotalMinor, walletRefundedMinor: last.walletRefundedMinor, transferRefundedMinor: last.transferRefundedMinor, transferPendingRefundMinor: last.transferPendingRefundMinor });
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.ORDER_EXCEPTION_ITEMS_REMOVED, targetType: 'order', targetId: order.id, metadata: { exceptionId, removedMinor, newTotalMinor: last.newTotalMinor } }, m);
    return last;
  }
}

export type { ExceptionType };

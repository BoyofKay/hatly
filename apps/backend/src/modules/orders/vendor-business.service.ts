import { vendorVisibleOrderSql } from './vendor-order-visibility';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { VendorStaffAuthorizationService } from '../vendors/vendor-staff-authorization.service';
import { AdminAuditAction, AdminAuditService } from '../audit/admin-audit.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const CAIRO = 'Africa/Cairo';
const bad = (message: string, code = 'VALIDATION_FAILED') => new BadRequestException({ message, details: { code } });
const num = (v: unknown) => (v == null ? null : Number(v));
const TERMINAL_ORDER = `('CANCELLED','DELIVERED','COLLECTED','FAILED_DELIVERY')`;

export interface Actor {
  id: string;
  role: string;
}

/**
 * The Vendor Business Hub: what a vendor's staff see about THEIR OWN branches — nothing else, ever. Every query is scoped by the branches the
 * authenticated user is linked to (`vendor_staff`); a `branchId` filter may only narrow that set, and another vendor's branch answers exactly
 * like a branch that does not exist. Read-only except the branch profile (open/close, weekly hours, preparation time). Customer personal data is
 * never part of these answers (history/insights/earnings carry order numbers and amounts only; the order page remains the place a vendor reads
 * what it needs to fulfil an order). Money is whatever the platform has already recorded (segment subtotals, recognized commission events,
 * closed settlement periods) — nothing is computed here that the finance module has not already decided.
 */
@Injectable()
export class VendorBusinessService {
  constructor(
    private readonly ds: DataSource,
    private readonly vendorAuth: VendorStaffAuthorizationService,
    private readonly audit: AdminAuditService,
  ) {}

  private async branches(user: Actor, branchId?: string): Promise<string[]> {
    const owned = await this.vendorAuth.getOwnedBranchIds(user.id);
    if (branchId === undefined || branchId === '') return owned;
    if (!UUID_RE.test(branchId) || !owned.includes(branchId)) throw new NotFoundException({ message: 'Branch not found.', details: { code: 'NOT_FOUND' } });
    return [branchId];
  }

  private range(from?: string, to?: string, defaultDays = 30) {
    if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) throw bad('Dates must be YYYY-MM-DD.');
    const params = { from: from || null, to: to || null };
    const days = from && to ? (Date.parse(to) - Date.parse(from)) / 86_400_000 : 0;
    if (from && to && (days < 0 || days > 366)) throw bad('The range must be between 0 and 366 days.');
    return { ...params, defaultDays };
  }

  /** SQL fragments: the Cairo calendar day of `o.created_at` between the (inclusive) dates, defaulting to the last N days. */
  private rangeSql(col: string, r: { from: string | null; to: string | null; defaultDays: number }, values: unknown[]) {
    values.push(r.from, r.to, r.defaultDays);
    const a = values.length - 2, b = values.length - 1, c = values.length;
    return `(${col} AT TIME ZONE '${CAIRO}')::date >= COALESCE($${a}::date, ((now() AT TIME ZONE '${CAIRO}')::date - $${c}::int)) AND (${col} AT TIME ZONE '${CAIRO}')::date <= COALESCE($${b}::date, (now() AT TIME ZONE '${CAIRO}')::date)`;
  }

  // ------------------------------------------------------------------------------------------------------------------------ overview

  async overview(user: Actor) {
    const ids = await this.branches(user);
    const empty = { live: {}, today: { received: 0, cancelled: 0, goodsMinor: 0 }, yesterday: { received: 0, cancelled: 0, goodsMinor: 0 }, productCount: 0, vendorName: null, rating: null, branches: [], openExceptions: 0, awaitingAcceptance: 0 };
    if (ids.length === 0) return empty;
    const live = await this.ds.query(
      `SELECT g.status, count(*)::int AS n FROM order_vendor_segments g JOIN orders o ON o.id = g.order_id AND ${vendorVisibleOrderSql()}
        WHERE g.vendor_branch_id = ANY($1) AND g.group_type = 'CATALOG' AND g.status <> 'CANCELLED' AND o.status NOT IN ${TERMINAL_ORDER} GROUP BY g.status`,
      [ids],
    );
    // The same figures for today and for yesterday (Cairo dates) — yesterday is what the cards compare today against.
    const day = async (offsetDays: number) => (await this.ds.query(
      `SELECT count(*)::int AS received, count(*) FILTER (WHERE g.status = 'CANCELLED')::int AS cancelled,
              coalesce(sum(g.subtotal_minor) FILTER (WHERE g.status <> 'CANCELLED'), 0) AS goods
         FROM order_vendor_segments g JOIN orders o ON o.id = g.order_id AND ${vendorVisibleOrderSql()}
        WHERE g.vendor_branch_id = ANY($1) AND g.group_type = 'CATALOG' AND (o.created_at AT TIME ZONE '${CAIRO}')::date = (now() AT TIME ZONE '${CAIRO}')::date - $2::int`,
      [ids, offsetDays],
    ))[0];
    const today = await day(0);
    const yesterday = await day(1);
    const [catalogue] = await this.ds.query(`SELECT count(*)::int AS n FROM products WHERE vendor_branch_id = ANY($1) AND deleted_at IS NULL`, [ids]);
    // Ratings are kept as two integers per branch (never a stored average); the average over the vendor's branches is derived from them.
    const [store] = await this.ds.query(`SELECT v.name FROM vendor_branches b JOIN vendors v ON v.id = b.vendor_id WHERE b.id = ANY($1) ORDER BY v.name LIMIT 1`, [ids]);
    const [stars] = await this.ds.query(`SELECT coalesce(sum(rating_count), 0)::int AS n, coalesce(sum(rating_sum_stars), 0)::int AS total FROM vendor_branches WHERE id = ANY($1) AND deleted_at IS NULL`, [ids]);
    const branches = await this.ds.query(
      `SELECT id, name, is_open, is_active, preparation_time_minutes, auto_accept_enabled FROM vendor_branches WHERE id = ANY($1) AND deleted_at IS NULL ORDER BY name`,
      [ids],
    );
    const [ex] = await this.ds.query(
      `SELECT count(*)::int AS n FROM order_exceptions e JOIN order_vendor_segments g ON g.id = e.order_vendor_segment_id
        WHERE g.vendor_branch_id = ANY($1) AND e.status NOT IN ('RESOLVED','WITHDRAWN')`,
      [ids],
    );
    const liveMap: Record<string, number> = {};
    for (const r of live) liveMap[r.status] = r.n;
    return {
      live: liveMap,
      awaitingAcceptance: liveMap.PENDING ?? 0,
      today: { received: today.received, cancelled: today.cancelled, goodsMinor: num(today.goods) },
      yesterday: { received: yesterday.received, cancelled: yesterday.cancelled, goodsMinor: num(yesterday.goods) },
      productCount: catalogue.n,
      vendorName: store?.name ?? null,
      rating: stars.n > 0 ? { average: Math.round((stars.total / stars.n) * 10) / 10, count: stars.n } : null,
      branches: branches.map((b: any) => ({ id: b.id, name: b.name, isOpen: b.is_open, isActive: b.is_active, preparationTimeMinutes: b.preparation_time_minutes, autoAcceptEnabled: b.auto_accept_enabled })),
      openExceptions: ex.n,
    };
  }

  // ------------------------------------------------------------------------------------------------------------------------- history

  async history(user: Actor, q: { from?: string; to?: string; status?: string; q?: string; branchId?: string; page?: string; limit?: string }) {
    const ids = await this.branches(user, q.branchId);
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 25));
    if (ids.length === 0) return { items: [], page, limit, total: 0 };
    const values: unknown[] = [ids];
    const where = [`g.vendor_branch_id = ANY($1)`, `g.group_type = 'CATALOG'`];
    where.push(this.rangeSql('o.created_at', this.range(q.from, q.to, 30), values));
    if (q.status) {
      const statuses = q.status.split(',').filter((s) => ['PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'CANCELLED'].includes(s));
      if (statuses.length === 0) throw bad('Unknown status.');
      values.push(statuses);
      where.push(`g.status = ANY($${values.length})`);
    }
    if (q.q) {
      values.push(`%${q.q.replace(/[%_\\]/g, '\\$&').slice(0, 40)}%`);
      where.push(`o.order_number ILIKE $${values.length} ESCAPE '\\'`);
    }
    const from = `FROM order_vendor_segments g JOIN orders o ON o.id = g.order_id AND ${vendorVisibleOrderSql()} JOIN vendor_branches b ON b.id = g.vendor_branch_id WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total ${from}`, values);
    const rows = await this.ds.query(
      `SELECT o.id AS order_id, g.id AS segment_id, o.order_number, o.status AS order_status, g.status, g.subtotal_minor, o.payment_method, o.fulfillment_type, o.created_at, b.id AS branch_id, b.name AS branch_name,
              (SELECT count(*)::int FROM order_items i WHERE i.order_vendor_segment_id = g.id AND i.removed_at IS NULL) AS item_count
         ${from} ORDER BY o.created_at DESC, g.id LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      values,
    );
    return {
      items: rows.map((r: any) => ({
        orderId: r.order_id, segmentId: r.segment_id, orderNumber: r.order_number, orderStatus: r.order_status, status: r.status, subtotalMinor: num(r.subtotal_minor), paymentMethod: r.payment_method,
        fulfillmentType: r.fulfillment_type, createdAt: r.created_at, branch: { id: r.branch_id, name: r.branch_name }, itemCount: r.item_count,
      })),
      page, limit, total,
    };
  }

  // ------------------------------------------------------------------------------------------------------------------------ insights

  async insights(user: Actor, q: { from?: string; to?: string; branchId?: string }) {
    const ids = await this.branches(user, q.branchId);
    const r = this.range(q.from, q.to, 30);
    const base = (values: unknown[]) => `g.vendor_branch_id = ANY($1) AND g.group_type = 'CATALOG' AND ${this.rangeSql('o.created_at', r, values)}`;
    if (ids.length === 0) return { totals: { received: 0, cancelled: 0, goodsMinor: 0, averageMinor: null }, byStatus: {}, daily: [], byHour: [], topProducts: [], medianAcceptMinutes: null, medianPrepMinutes: null };
    let v: unknown[] = [ids];
    const where = base(v);
    const [t] = await this.ds.query(
      `SELECT count(*)::int AS received, count(*) FILTER (WHERE g.status = 'CANCELLED')::int AS cancelled,
              coalesce(sum(g.subtotal_minor) FILTER (WHERE g.status <> 'CANCELLED'), 0) AS goods, count(*) FILTER (WHERE g.status <> 'CANCELLED')::int AS kept
         FROM order_vendor_segments g JOIN orders o ON o.id = g.order_id AND ${vendorVisibleOrderSql()} WHERE ${where}`,
      v,
    );
    const byStatus = Object.fromEntries((await this.ds.query(`SELECT g.status, count(*)::int AS n FROM order_vendor_segments g JOIN orders o ON o.id = g.order_id AND ${vendorVisibleOrderSql()} WHERE ${where} GROUP BY g.status`, v)).map((x: any) => [x.status, x.n]));
    const daily = await this.ds.query(
      `SELECT (o.created_at AT TIME ZONE '${CAIRO}')::date::text AS day, count(*)::int AS orders, coalesce(sum(g.subtotal_minor) FILTER (WHERE g.status <> 'CANCELLED'), 0) AS goods
         FROM order_vendor_segments g JOIN orders o ON o.id = g.order_id AND ${vendorVisibleOrderSql()} WHERE ${where} GROUP BY 1 ORDER BY 1`,
      v,
    );
    const byHour = await this.ds.query(
      `SELECT extract(hour FROM o.created_at AT TIME ZONE '${CAIRO}')::int AS hour, count(*)::int AS orders FROM order_vendor_segments g JOIN orders o ON o.id = g.order_id AND ${vendorVisibleOrderSql()} WHERE ${where} GROUP BY 1 ORDER BY 1`,
      v,
    );
    const topProducts = await this.ds.query(
      `SELECT i.product_name_snapshot AS name, i.product_name_ar_snapshot AS name_ar, sum(i.quantity)::int AS quantity
         FROM order_items i JOIN order_vendor_segments g ON g.id = i.order_vendor_segment_id JOIN orders o ON o.id = g.order_id AND ${vendorVisibleOrderSql()}
        WHERE ${where} AND g.status <> 'CANCELLED' AND i.removed_at IS NULL GROUP BY 1, 2 ORDER BY 3 DESC, 1 LIMIT 8`,
      v,
    );
    const [acc] = await this.ds.query(
      `SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM e.created_at - g.created_at) / 60))::numeric, 1) AS m
         FROM order_vendor_segment_events e JOIN order_vendor_segments g ON g.id = e.segment_id JOIN orders o ON o.id = g.order_id AND ${vendorVisibleOrderSql()}
        WHERE ${where} AND e.from_status = 'PENDING' AND e.to_status = 'CONFIRMED' AND e.on_behalf_of_vendor = false`,
      v,
    );
    const [prep] = await this.ds.query(
      `SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM r.created_at - c.created_at) / 60))::numeric, 1) AS m
         FROM order_vendor_segments g JOIN orders o ON o.id = g.order_id AND ${vendorVisibleOrderSql()}
         JOIN LATERAL (SELECT min(created_at) AS created_at FROM order_vendor_segment_events WHERE segment_id = g.id AND to_status = 'CONFIRMED') c ON true
         JOIN LATERAL (SELECT min(created_at) AS created_at FROM order_vendor_segment_events WHERE segment_id = g.id AND to_status = 'READY_FOR_PICKUP') r ON true
        WHERE ${where} AND c.created_at IS NOT NULL AND r.created_at IS NOT NULL`,
      v,
    );
    return {
      totals: { received: t.received, cancelled: t.cancelled, goodsMinor: num(t.goods), averageMinor: t.kept > 0 ? Math.round(Number(t.goods) / t.kept) : null },
      byStatus,
      daily: daily.map((d: any) => ({ day: d.day, orders: d.orders, goodsMinor: num(d.goods) })),
      byHour,
      topProducts: topProducts.map((p: any) => ({ name: p.name, nameAr: p.name_ar, quantity: p.quantity })),
      medianAcceptMinutes: acc?.m == null ? null : Number(acc.m),
      medianPrepMinutes: prep?.m == null ? null : Number(prep.m),
    };
  }

  // ------------------------------------------------------------------------------------------------------------------------ earnings

  /**
   * A READ-ONLY statement of what the platform has already recorded for the vendor's own branches: completed orders (delivered / collected) with the
   * goods value of the vendor's part and the commission Hatly recognized for it, plus the settlement periods Hatly has closed. It makes no
   * payout, balance or "net" claim: how and when the vendor and Hatly settle is a business decision that lives in the finance module.
   */
  async earnings(user: Actor, q: { from?: string; to?: string; branchId?: string; page?: string; limit?: string }) {
    const ids = await this.branches(user, q.branchId);
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 25));
    if (ids.length === 0) return { totals: { orders: 0, goodsMinor: 0, commissionMinor: 0 }, items: [], page, limit, total: 0, settlements: [] };
    const r = this.range(q.from, q.to, 30);
    const values: unknown[] = [ids];
    const done = `LEFT JOIN LATERAL (SELECT min(created_at) AS at FROM order_status_events WHERE order_id = o.id AND to_status IN ('DELIVERED','COLLECTED')) d ON true`;
    const where = `g.vendor_branch_id = ANY($1) AND g.group_type = 'CATALOG' AND g.status <> 'CANCELLED' AND o.status IN ('DELIVERED','COLLECTED') AND ${this.rangeSql('coalesce(d.at, o.updated_at)', r, values)}`;
    const commission = `(SELECT sum(f.amount_minor) FROM financial_events f WHERE f.order_vendor_segment_id = g.id AND f.type = 'VENDOR_COMMISSION_RECOGNIZED' AND f.direction = 'RECEIVABLE')`;
    const [tot] = await this.ds.query(`SELECT count(*)::int AS n, coalesce(sum(g.subtotal_minor), 0) AS goods, coalesce(sum(${commission}), 0) AS commission FROM order_vendor_segments g JOIN orders o ON o.id = g.order_id AND ${vendorVisibleOrderSql()} ${done} WHERE ${where}`, values);
    const rows = await this.ds.query(
      `SELECT o.id AS order_id, o.order_number, coalesce(d.at, o.updated_at) AS completed_at, g.subtotal_minor, ${commission} AS commission_minor, b.name AS branch_name, o.payment_method
         FROM order_vendor_segments g JOIN orders o ON o.id = g.order_id AND ${vendorVisibleOrderSql()} JOIN vendor_branches b ON b.id = g.vendor_branch_id ${done}
        WHERE ${where} ORDER BY completed_at DESC, g.id LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      values,
    );
    const settlements = await this.ds.query(
      `SELECT s.id, b.name AS branch_name, s.frequency, s.period_start, s.period_end, s.status, s.gross_sales_minor, s.total_commission_owed_minor, s.closed_at
         FROM vendor_settlement_periods s JOIN vendor_branches b ON b.id = s.vendor_branch_id WHERE s.vendor_branch_id = ANY($1) AND s.deleted_at IS NULL ORDER BY s.period_end DESC LIMIT 24`,
      [ids],
    );
    return {
      totals: { orders: tot.n, goodsMinor: num(tot.goods), commissionMinor: num(tot.commission) },
      items: rows.map((x: any) => ({ orderId: x.order_id, orderNumber: x.order_number, completedAt: x.completed_at, goodsMinor: num(x.subtotal_minor), commissionMinor: num(x.commission_minor), branchName: x.branch_name, paymentMethod: x.payment_method })),
      page, limit, total: tot.n,
      settlements: settlements.map((s: any) => ({ id: s.id, branchName: s.branch_name, frequency: s.frequency, periodStart: s.period_start, periodEnd: s.period_end, status: s.status, grossSalesMinor: num(s.gross_sales_minor), commissionOwedMinor: num(s.total_commission_owed_minor), closedAt: s.closed_at })),
    };
  }

  // ---------------------------------------------------------------------------------------------------------------------------- team

  /**
   * The people linked to the caller's branches. Phone numbers are masked: a colleague's number is not this screen's business. A manager is told which
   * of them they may manage (an operator who works only at the manager's own branches, never the manager themself) and which of their branches exist
   * to assign people to; creating/promoting managers and changing roles stays an Admin action.
   */
  async team(user: Actor) {
    const ids = await this.branches(user);
    if (ids.length === 0) return { members: [], canManage: false, branches: [] };
    const isManager = user.role === Role.VENDOR_MANAGER;
    const rows = await this.ds.query(
      `SELECT u.id, u.full_name, u.role, u.is_active, u.phone, array_agg(b.name ORDER BY b.name) AS branches, array_agg(b.id ORDER BY b.name) AS branch_ids,
              NOT EXISTS (SELECT 1 FROM vendor_staff s2 WHERE s2.user_id = u.id AND s2.deleted_at IS NULL AND s2.vendor_branch_id <> ALL($1)) AS only_here
         FROM vendor_staff s JOIN users u ON u.id = s.user_id JOIN vendor_branches b ON b.id = s.vendor_branch_id
        WHERE s.vendor_branch_id = ANY($1) AND s.deleted_at IS NULL AND u.deleted_at IS NULL GROUP BY u.id ORDER BY u.full_name`,
      [ids],
    );
    const owned = await this.ds.query(`SELECT id, name FROM vendor_branches WHERE id = ANY($1) AND deleted_at IS NULL ORDER BY name`, [ids]);
    const mask = (p: string) => (p.length > 6 ? `${p.slice(0, 3)}••••${p.slice(-3)}` : '••••');
    return {
      members: rows.map((u: any) => ({
        id: u.id, fullName: u.full_name, role: u.role === Role.VENDOR_MANAGER ? 'MANAGER' : 'OPERATOR', isActive: u.is_active, phoneMasked: mask(u.phone), branches: u.branches, branchIds: u.branch_ids, isYou: u.id === user.id,
        manageable: isManager && u.role === Role.VENDOR && u.id !== user.id && u.only_here === true,
      })),
      canManage: isManager,
      branches: owned.map((b: any) => ({ id: b.id, name: b.name })),
    };
  }

  // --------------------------------------------------------------------------------------------------------------------------- branch

  async branch(user: Actor, branchId: string) {
    const [id] = await this.branches(user, branchId);
    const [b] = await this.ds.query(
      `SELECT id, name, address, is_open, is_active, opening_hours, preparation_time_minutes, delivery_enabled, pickup_enabled, auto_accept_enabled FROM vendor_branches WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (!b) throw new NotFoundException({ message: 'Branch not found.', details: { code: 'NOT_FOUND' } });
    const [c] = await this.ds.query(`SELECT id, kind, starts_at, ends_at, reason FROM vendor_branch_closures WHERE vendor_branch_id = $1 AND cancelled_at IS NULL AND starts_at <= now() AND ends_at > now() ORDER BY ends_at DESC LIMIT 1`, [id]);
    return { ...this.branchView(b, user), activeClosure: c ? { id: c.id, kind: c.kind, startsAt: c.starts_at, endsAt: c.ends_at, reason: c.reason } : null, effectiveOpen: b.is_open && !c };
  }

  private branchView(b: any, user: Actor) {
    return {
      id: b.id, name: b.name, address: b.address, isOpen: b.is_open, isActive: b.is_active, openingHours: b.opening_hours ?? {}, preparationTimeMinutes: b.preparation_time_minutes,
      deliveryEnabled: b.delivery_enabled, pickupEnabled: b.pickup_enabled, autoAcceptEnabled: b.auto_accept_enabled,
      // What this user may change here: anyone linked to the branch can open/close it; hours and preparation time are a manager's decision.
      canEditProfile: user.role === Role.VENDOR_MANAGER,
    };
  }

  async updateBranch(user: Actor, branchId: string, body: { isOpen?: boolean; openingHours?: Record<string, { open: string; close: string }>; preparationTimeMinutes?: number | null }) {
    const [id] = await this.branches(user, branchId);
    if (!body || typeof body !== 'object') throw bad('Nothing to change.');
    const allowed = ['isOpen', 'openingHours', 'preparationTimeMinutes'];
    if (Object.keys(body).some((k) => !allowed.includes(k))) throw bad('Only open/closed, weekly hours and preparation time can be changed here.');
    if (Object.keys(body).length === 0) throw bad('Nothing to change.');
    const sets: string[] = [];
    const values: unknown[] = [id];
    const changed: Record<string, unknown> = {};
    if (body.isOpen !== undefined) {
      if (typeof body.isOpen !== 'boolean') throw bad('isOpen must be true or false.');
      values.push(body.isOpen); sets.push(`is_open = $${values.length}`); changed.isOpen = body.isOpen;
    }
    if (body.openingHours !== undefined || body.preparationTimeMinutes !== undefined) {
      if (user.role !== Role.VENDOR_MANAGER) throw new ForbiddenException({ message: 'Only a branch manager can change the weekly hours or the preparation time.', details: { code: 'MANAGER_ONLY' } });
    }
    if (body.openingHours !== undefined) {
      const h = body.openingHours;
      if (!h || typeof h !== 'object' || Array.isArray(h)) throw bad('Weekly hours must be an object keyed by mon…sun.');
      for (const [day, v] of Object.entries(h)) {
        if (!DAYS.includes(day)) throw bad(`Unknown day "${day}".`);
        if (!v || typeof v.open !== 'string' || typeof v.close !== 'string' || !TIME_RE.test(v.open) || !TIME_RE.test(v.close)) throw bad(`Hours for ${day} must be HH:mm to HH:mm.`);
      }
      values.push(JSON.stringify(h)); sets.push(`opening_hours = $${values.length}::jsonb`); changed.openingHours = h;
    }
    if (body.preparationTimeMinutes !== undefined) {
      const p = body.preparationTimeMinutes;
      if (p !== null && (!Number.isInteger(p) || p < 1 || p > 600)) throw bad('Preparation time must be 1–600 minutes.');
      values.push(p); sets.push(`preparation_time_minutes = $${values.length}`); changed.preparationTimeMinutes = p;
    }
    const [current] = await this.ds.query(`SELECT is_active FROM vendor_branches WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (!current) throw new NotFoundException({ message: 'Branch not found.', details: { code: 'NOT_FOUND' } });
    if (body.isOpen === true && !current.is_active) throw new ConflictException({ message: 'Hatly has deactivated this branch, so it cannot be opened.', details: { code: 'BRANCH_DEACTIVATED' } });
    await this.ds.query(`UPDATE vendor_branches SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, values);
    await this.audit.record({ actorUserId: user.id, actorRole: user.role, action: AdminAuditAction.VENDOR_BRANCH_UPDATED, targetType: 'vendor_branch', targetId: id, metadata: { fields: Object.keys(changed).join(','), isOpen: (changed.isOpen as boolean | undefined) ?? null } });
    return this.branch(user, id);
  }
}

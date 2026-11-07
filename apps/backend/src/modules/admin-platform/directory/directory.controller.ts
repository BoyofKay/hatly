import { approveOnHatlyActivation } from '../../products/product-approval';
import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { RequiresAnyPermission, RequiresPermission } from '../../permissions/decorators/requires-permission.decorator';
import { Permission } from '../../permissions/permission.enum';
import { PermissionsService } from '../../permissions/permissions.service';
import { AuthenticatedUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AdminAuditAction, AdminAuditService } from '../../audit/admin-audit.service';
import { ExplicitlyAudited } from '../../audit/admin-mutation-audit.interceptor';
import { HomeSectionsCache } from '../../home-products/home-sections.cache';
import { addCairoRange, assertMaxRange, assertUuid, likeTerm, num, pageParams } from '../common/platform-sql';
import { ExecutiveService } from '../executive/executive.service';

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const VENDORS = [Permission.VENDORS_VIEW, Permission.MANAGE_VENDORS] as const;
const CATALOG = [Permission.CATALOG_VIEW, Permission.MANAGE_CATALOG] as const;
const FLEET = [Permission.FLEET_VIEW, Permission.MANAGE_DRIVERS, Permission.ASSIGN_REASSIGN_ORDERS] as const;
const STOCK_STATE = `CASE WHEN p.inventory_mode <> 'TRACKED' THEN 'UNLIMITED' WHEN p.quantity <= 0 THEN 'OUT' WHEN p.quantity <= coalesce(p.low_stock_threshold, 5) THEN 'LOW' ELSE 'OK' END`;

/** Read models for vendors/branches, the catalogue and the fleet, plus safe bulk product actions. Existing CRUD endpoints are reused as they are. */
@ApiTags('admin-directory')
@Controller('admin')
export class DirectoryController {
  constructor(
    private readonly ds: DataSource,
    private readonly permissions: PermissionsService,
    private readonly executive: ExecutiveService,
    private readonly audit: AdminAuditService,
    private readonly homeCache: HomeSectionsCache,
  ) {}

  // ------------------------------------------------------------------ vendors / branches

  @Get('branch-directory')
  @RequiresAnyPermission(...VENDORS)
  async branches(@Query() q: Record<string, string>) {
    const { page, limit, offset } = pageParams(q);
    const v: unknown[] = []; const w: string[] = ['b.deleted_at IS NULL'];
    if (q.q) { v.push(likeTerm(q.q)); w.push(`(b.name ILIKE $${v.length} ESCAPE '\\' OR ven.name ILIKE $${v.length} ESCAPE '\\')`); }
    if (assertUuid(q.vendorId, 'vendorId')) { v.push(q.vendorId); w.push(`b.vendor_id = $${v.length}`); }
    if (assertUuid(q.sectorId, 'sectorId')) { v.push(q.sectorId); w.push(`b.marketplace_sector_id = $${v.length}`); }
    if (q.active === 'true' || q.active === 'false') w.push(`b.is_active = ${q.active}`);
    if (q.open === 'true' || q.open === 'false') w.push(`b.is_open = ${q.open}`);
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM vendor_branches b JOIN vendors ven ON ven.id = b.vendor_id WHERE ${w.join(' AND ')}`, v);
    const rows = await this.ds.query(
      `SELECT b.id, b.name, b.address, b.is_open, b.is_active, b.auto_accept_enabled, b.acceptance_mode, b.commission_rate_basis_points, b.rating_count, b.rating_sum_stars, ven.id AS vendor_id, ven.name AS vendor_name, ven.is_active AS vendor_active, sec.name AS sector_name,
              (SELECT count(*) FROM products p WHERE p.vendor_branch_id = b.id AND p.deleted_at IS NULL)::int AS products,
              (SELECT count(*) FROM order_vendor_segments s WHERE s.vendor_branch_id = b.id AND s.status = 'PENDING')::int AS pending_parts
         FROM vendor_branches b JOIN vendors ven ON ven.id = b.vendor_id LEFT JOIN marketplace_sectors sec ON sec.id = b.marketplace_sector_id WHERE ${w.join(' AND ')} ORDER BY ven.name, b.name LIMIT ${limit} OFFSET ${offset}`,
      v,
    );
    return {
      data: rows.map((r: any) => ({ id: r.id, name: r.name, address: r.address, vendorId: r.vendor_id, vendorName: r.vendor_name, vendorActive: r.vendor_active, sector: r.sector_name, isOpen: r.is_open, isActive: r.is_active, autoAccept: r.auto_accept_enabled, acceptanceMode: r.acceptance_mode, commissionPercent: num(r.commission_rate_basis_points) / 100, rating: r.rating_count > 0 ? Math.round((num(r.rating_sum_stars) / r.rating_count) * 100) / 100 : null, ratingCount: r.rating_count, products: r.products, pendingParts: r.pending_parts })),
      meta: { page, limit, total },
    };
  }

  @Get(`branch-directory/:id(${UUID})/performance`)
  @RequiresAnyPermission(...VENDORS)
  async branchPerformance(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    assertMaxRange(from, to, 366);
    const v: unknown[] = [id]; const w: string[] = ['s.vendor_branch_id = $1'];
    addCairoRange(w, v, 's.created_at', from, to);
    const [seg] = await this.ds.query(
      `SELECT count(*)::int AS received, count(*) FILTER (WHERE s.status = 'CANCELLED')::int AS rejected, count(*) FILTER (WHERE s.status IN ('PICKED_UP'))::int AS completed,
              coalesce(sum(s.subtotal_minor) FILTER (WHERE s.status <> 'CANCELLED'), 0)::bigint AS gross
         FROM order_vendor_segments s WHERE ${w.join(' AND ')}`,
      v,
    );
    const [acc] = await this.ds.query(
      `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (e.created_at - s.created_at)) / 60) AS median_minutes
         FROM order_vendor_segments s JOIN LATERAL (SELECT created_at FROM order_vendor_segment_events ev WHERE ev.segment_id = s.id AND ev.to_status = 'CONFIRMED' ORDER BY created_at LIMIT 1) e ON true WHERE ${w.join(' AND ')}`,
      v,
    );
    const reasons = await this.ds.query(
      `SELECT coalesce(ev.reason, '—') AS reason, count(*)::int AS n FROM order_vendor_segment_events ev JOIN order_vendor_segments s ON s.id = ev.segment_id WHERE ev.to_status = 'CANCELLED' AND ${w.join(' AND ')} GROUP BY 1 ORDER BY n DESC LIMIT 5`,
      v,
    );
    const out: Record<string, unknown> = { received: seg.received, rejected: seg.rejected, rejectionRatePct: seg.received ? Math.round((seg.rejected / seg.received) * 1000) / 10 : null, completed: seg.completed, medianAcceptanceMinutes: acc.median_minutes === null ? null : Math.round(num(acc.median_minutes) * 10) / 10, topRejectionReasons: reasons };
    if (await this.permissions.actorHolds(actor, Permission.VIEW_VENDOR_FINANCIAL_REPORTS)) {
      const ev = await this.ds.query(`SELECT coalesce(sum(amount_minor), 0)::bigint AS c FROM financial_events e WHERE e.vendor_branch_id = $1 AND e.type = 'VENDOR_COMMISSION_RECOGNIZED' ${from || to ? '' : ''}`, [id]);
      out.grossSalesMinor = num(seg.gross);
      out.commissionRecognisedAllTimeMinor = num(ev[0].c);
    }
    return { data: out };
  }

  // ------------------------------------------------------------------ catalogue

  @Get('product-directory')
  @RequiresAnyPermission(...CATALOG)
  async products(@Query() q: Record<string, string>) {
    const { page, limit, offset } = pageParams(q, 25, 100);
    const v: unknown[] = []; const w: string[] = ['p.deleted_at IS NULL'];
    if (q.q) { v.push(likeTerm(q.q)); w.push(`(p.name ILIKE $${v.length} ESCAPE '\\' OR p.name_ar ILIKE $${v.length} ESCAPE '\\' OR ven.name ILIKE $${v.length} ESCAPE '\\')`); }
    if (assertUuid(q.vendorBranchId, 'vendorBranchId')) { v.push(q.vendorBranchId); w.push(`p.vendor_branch_id = $${v.length}`); }
    if (assertUuid(q.categoryId, 'categoryId')) { v.push(q.categoryId); w.push(`p.category_id = $${v.length}`); }
    if (q.active === 'true' || q.active === 'false') w.push(`p.is_available = ${q.active}`);
    if (q.state) { v.push(q.state); w.push(`${STOCK_STATE} = $${v.length}`); }
    if (q.hasImage === 'true') w.push(`p.image_url IS NOT NULL`);
    if (q.hasImage === 'false') w.push(`p.image_url IS NULL`);
    const sorts: Record<string, string> = { name: 'p.name', price: 'p.price_minor', stock: 'p.quantity', updated: 'p.updated_at' };
    const sortField = (q.sort ?? 'name:asc').split(':');
    if (!sorts[sortField[0]]) throw new BadRequestException({ message: 'Unknown sort field.', details: { code: 'UNKNOWN_SORT' } });
    const order = `${sorts[sortField[0]]} ${sortField[1] === 'desc' ? 'DESC' : 'ASC'} NULLS LAST, p.id`;
    const from = `products p JOIN vendor_branches b ON b.id = p.vendor_branch_id JOIN vendors ven ON ven.id = b.vendor_id WHERE ${w.join(' AND ')}`;
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM ${from}`, v);
    const rows = await this.ds.query(
      `SELECT p.id, p.name, p.name_ar, p.price_minor, p.is_available, p.inventory_mode, p.quantity, p.image_url, p.low_stock_threshold, ${STOCK_STATE} AS state, b.id AS branch_id, b.name AS branch_name, ven.name AS vendor_name,
              (SELECT count(*) FROM product_media pm WHERE pm.product_id = p.id)::int AS image_count
         FROM ${from} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`,
      v,
    );
    return { data: rows.map((r: any) => ({ id: r.id, name: r.name, nameAr: r.name_ar, priceMinor: num(r.price_minor), available: r.is_available, inventoryMode: r.inventory_mode, quantity: r.quantity, stockState: r.state, imageUrl: r.image_url, imageCount: r.image_count, lowStockThreshold: r.low_stock_threshold, branchId: r.branch_id, branchName: r.branch_name, vendorName: r.vendor_name })), meta: { page, limit, total } };
  }

  @Get('inventory-board')
  @RequiresAnyPermission(...CATALOG)
  async inventory() {
    const [s] = await this.ds.query(`SELECT count(*) FILTER (WHERE ${STOCK_STATE} = 'OUT')::int AS out, count(*) FILTER (WHERE ${STOCK_STATE} = 'LOW')::int AS low, count(*) FILTER (WHERE ${STOCK_STATE} = 'OK')::int AS ok, count(*) FILTER (WHERE ${STOCK_STATE} = 'UNLIMITED')::int AS unlimited FROM products p WHERE p.deleted_at IS NULL`);
    const items = await this.ds.query(
      `SELECT p.id, p.name, p.quantity, p.low_stock_threshold, p.is_available, ${STOCK_STATE} AS state, b.name AS branch_name, ven.name AS vendor_name FROM products p JOIN vendor_branches b ON b.id = p.vendor_branch_id JOIN vendors ven ON ven.id = b.vendor_id
        WHERE p.deleted_at IS NULL AND ${STOCK_STATE} IN ('OUT','LOW') ORDER BY p.quantity, p.name LIMIT 200`,
    );
    return { data: { counts: s, defaultThreshold: 5, items: items.map((r: any) => ({ id: r.id, name: r.name, quantity: r.quantity, threshold: r.low_stock_threshold ?? 5, available: r.is_available, state: r.state, branchName: r.branch_name, vendorName: r.vendor_name })) } };
  }

  /**
   * Bulk product actions: at most 50, the count must be confirmed, every item is validated and applied individually and reported
   * individually (a partial result is explicit), one audit event with the counts. `dryRun` returns the per-item before/after without changing anything.
   */
  @Post('products/bulk')
  @RequiresPermission(Permission.MANAGE_CATALOG)
  @ExplicitlyAudited()
  async bulk(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: { ids: string[]; action: string; params?: { percent?: number; quantity?: number }; confirmCount?: number; dryRun?: boolean },
  ) {
    const ids = body?.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 50) throw new BadRequestException({ message: 'Select between 1 and 50 products.', details: { code: 'BULK_LIMIT' } });
    ids.forEach((i) => assertUuid(i, 'ids'));
    if (!['ACTIVATE', 'DEACTIVATE', 'SET_STOCK', 'PRICE_PERCENT'].includes(body.action)) throw new BadRequestException({ message: 'Unknown bulk action.', details: { code: 'VALIDATION_FAILED' } });
    if (!body.dryRun && body.confirmCount !== ids.length) throw new BadRequestException({ message: `Confirm the number of products (${ids.length}).`, details: { code: 'CONFIRM_COUNT_MISMATCH' } });
    const percent = body.params?.percent; const qty = body.params?.quantity;
    if (body.action === 'PRICE_PERCENT' && !(typeof percent === 'number' && Number.isFinite(percent) && percent >= -90 && percent <= 90 && percent !== 0)) throw new BadRequestException({ message: 'percent must be between -90 and 90 (not 0).', details: { code: 'VALIDATION_FAILED' } });
    if (body.action === 'SET_STOCK' && !(Number.isInteger(qty) && (qty as number) >= 0 && (qty as number) <= 1_000_000)) throw new BadRequestException({ message: 'quantity must be a whole number from 0.', details: { code: 'VALIDATION_FAILED' } });
    const results: Array<{ id: string; ok: boolean; code?: string; before?: unknown; after?: unknown }> = [];
    for (const id of ids) {
      const [p] = await this.ds.query(`SELECT id, price_minor, is_available, inventory_mode, quantity FROM products WHERE id = $1 AND deleted_at IS NULL`, [id]);
      if (!p) { results.push({ id, ok: false, code: 'NOT_FOUND' }); continue; }
      if (body.action === 'ACTIVATE' || body.action === 'DEACTIVATE') {
        const to = body.action === 'ACTIVATE';
        if (!body.dryRun) {
          await this.ds.query(`UPDATE products SET is_available = $2, updated_at = now() WHERE id = $1`, [id, to]);
          if (to) await approveOnHatlyActivation(this.ds, id); // R7: Hatly making it available is the approval
        }
        results.push({ id, ok: true, before: p.is_available, after: to });
      } else if (body.action === 'SET_STOCK') {
        if (p.inventory_mode !== 'TRACKED') { results.push({ id, ok: false, code: 'NOT_TRACKED' }); continue; }
        if (!body.dryRun) await this.ds.query(`UPDATE products SET quantity = $2, updated_at = now() WHERE id = $1`, [id, qty]);
        results.push({ id, ok: true, before: p.quantity, after: qty });
      } else {
        const next = Math.round(num(p.price_minor) * (1 + (percent as number) / 100));
        if (next < 0) { results.push({ id, ok: false, code: 'NEGATIVE_PRICE' }); continue; }
        if (!body.dryRun) await this.ds.query(`UPDATE products SET price_minor = $2, updated_at = now() WHERE id = $1`, [id, next]);
        results.push({ id, ok: true, before: num(p.price_minor), after: next });
      }
    }
    if (!body.dryRun) {
      await this.homeCache.bumpEpoch();
      await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.BULK_ACTION, targetType: 'product', metadata: { action: body.action, requested: ids.length, applied: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length } });
    }
    return { data: { dryRun: Boolean(body.dryRun), results } };
  }

  // ------------------------------------------------------------------ fleet

  @Get('driver-directory')
  @RequiresAnyPermission(...FLEET)
  async drivers(@Query() q: Record<string, string>) {
    const { page, limit, offset } = pageParams(q);
    const v: unknown[] = []; const w: string[] = ['d.deleted_at IS NULL'];
    if (q.q) { v.push(likeTerm(q.q)); w.push(`(u.full_name ILIKE $${v.length} ESCAPE '\\' OR u.phone ILIKE $${v.length} ESCAPE '\\')`); }
    if (q.verified) { v.push(q.verified.toUpperCase()); w.push(`d.verification_status = $${v.length}`); }
    if (q.online === 'true' || q.online === 'false') w.push(`d.is_online = ${q.online}`);
    const base = `drivers d JOIN users u ON u.id = d.user_id LEFT JOIN vehicle_types vt ON vt.id = d.vehicle_type_id WHERE ${w.join(' AND ')}`;
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM ${base}`, v);
    const rows = await this.ds.query(
      `SELECT d.id, u.full_name, u.phone, u.is_active, d.verification_status, d.is_online, d.is_available, d.last_location_at, d.commission_rate_basis_points, d.rating_count, d.rating_sum_stars, vt.name AS vehicle,
              (SELECT count(*) FROM deliveries x WHERE x.driver_id = d.id AND x.delivered_at IS NOT NULL)::int AS delivered,
              (SELECT count(*) FROM deliveries x WHERE x.driver_id = d.id AND x.delivered_at IS NULL AND x.deleted_at IS NULL)::int AS active
         FROM ${base} ORDER BY d.is_online DESC, u.full_name LIMIT ${limit} OFFSET ${offset}`,
      v,
    );
    return { data: rows.map((r: any) => ({ id: r.id, name: r.full_name, phone: r.phone, accountActive: r.is_active, verification: r.verification_status, online: r.is_online, available: r.is_available, lastSeenAt: r.last_location_at, vehicle: r.vehicle, commissionPercent: r.commission_rate_basis_points === null ? null : num(r.commission_rate_basis_points) / 100, rating: r.rating_count > 0 ? Math.round((num(r.rating_sum_stars) / r.rating_count) * 100) / 100 : null, delivered: r.delivered, activeDeliveries: r.active })), meta: { page, limit, total } };
  }

  @Get(`driver-directory/:id(${UUID})`)
  @RequiresAnyPermission(...FLEET)
  async driver(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    const [d] = await this.ds.query(`SELECT d.*, u.full_name, u.phone, vt.name AS vehicle FROM drivers d JOIN users u ON u.id = d.user_id LEFT JOIN vehicle_types vt ON vt.id = d.vehicle_type_id WHERE d.id = $1`, [id]);
    if (!d) throw new BadRequestException({ message: 'Driver not found.', details: { code: 'NOT_FOUND' } });
    const recent = await this.ds.query(`SELECT x.id, o.order_number, x.assigned_at, x.picked_up_at, x.delivered_at, x.reassignment_count FROM deliveries x JOIN orders o ON o.id = x.order_id WHERE x.driver_id = $1 ORDER BY x.assigned_at DESC LIMIT 15`, [id]);
    const [stats] = await this.ds.query(`SELECT count(*) FILTER (WHERE delivered_at IS NOT NULL)::int AS delivered, percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (delivered_at - assigned_at)) / 60) FILTER (WHERE delivered_at IS NOT NULL) AS median FROM deliveries WHERE driver_id = $1`, [id]);
    const out: Record<string, unknown> = {
      id: d.id, name: d.full_name, phone: d.phone, vehicle: d.vehicle, verification: d.verification_status, online: d.is_online, available: d.is_available, lastSeenAt: d.last_location_at,
      commissionPercent: d.commission_rate_basis_points === null ? null : num(d.commission_rate_basis_points) / 100, rating: d.rating_count > 0 ? Math.round((num(d.rating_sum_stars) / d.rating_count) * 100) / 100 : null, ratingCount: d.rating_count,
      delivered: stats.delivered, medianDeliveryMinutes: stats.median === null ? null : Math.round(num(stats.median) * 10) / 10,
      recentDeliveries: recent.map((r: any) => ({ id: r.id, orderNumber: r.order_number, assignedAt: r.assigned_at, pickedUpAt: r.picked_up_at, deliveredAt: r.delivered_at, reassignments: r.reassignment_count })),
    };
    if (await this.permissions.actorHolds(actor, Permission.VIEW_DRIVER_SETTLEMENTS)) {
      const periods = await this.ds.query(`SELECT id, period_start, period_end, total_earnings_minor, total_commission_owed_minor, total_reimbursements_owed_minor, net_payable_minor FROM driver_settlement_periods WHERE driver_id = $1 AND status = 'CLOSED' AND deleted_at IS NULL ORDER BY period_end DESC LIMIT 6`, [id]);
      out.settlementPeriods = periods.map((p: any) => ({ id: p.id, periodStart: p.period_start, periodEnd: p.period_end, earningsMinor: num(p.total_earnings_minor), commissionMinor: num(p.total_commission_owed_minor), reimbursementsMinor: num(p.total_reimbursements_owed_minor), netPayableMinor: num(p.net_payable_minor) }));
    }
    return { data: out };
  }

  @Get('fleet/live')
  @RequiresAnyPermission(...FLEET)
  async live() {
    const rows = await this.ds.query(
      `SELECT d.id, u.full_name, d.is_online, d.is_available, d.last_location_at, extract(epoch FROM now() - d.last_location_at)::int AS age,
              (SELECT o.order_number FROM deliveries x JOIN orders o ON o.id = x.order_id WHERE x.driver_id = d.id AND x.delivered_at IS NULL AND x.deleted_at IS NULL ORDER BY x.assigned_at DESC LIMIT 1) AS active_order
         FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.is_online AND d.deleted_at IS NULL ORDER BY u.full_name`,
    );
    return { data: rows.map((r: any) => ({ id: r.id, name: r.full_name, available: r.is_available, lastSeenAt: r.last_location_at, lastSeenSeconds: r.age, stale: r.age === null || r.age > 120, activeOrder: r.active_order })), meta: { asOf: new Date().toISOString(), staleAfterSeconds: 120 } };
  }

  @Get('delivery-performance')
  @RequiresAnyPermission(...FLEET)
  async deliveryPerformance(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.executive.sla(from, to) };
  }
}

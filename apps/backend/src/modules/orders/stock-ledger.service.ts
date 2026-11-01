import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { AdminAuditAction, AdminAuditService } from '../audit/admin-audit.service';
import { VendorStaffAuthorizationService } from '../vendors/vendor-staff-authorization.service';
import { setStockContext } from './stock-context';
import { Actor, CAIRO, UUID_RE, bad, notFound, num, ownedBranch } from './vendor-ops.shared';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REASONS = ['INITIAL_STOCK', 'ORDER_PLACED', 'ORDER_CANCELLED', 'MANUAL_ADJUSTMENT', 'SET_TO_ZERO', 'STOCKTAKE', 'IMPORT', 'UNATTRIBUTED'];

/**
 * The stock-movement ledger and stocktakes of a vendor's own branches.
 *
 * The ledger is written by a database trigger on `products` (see the migration), so every change of a tracked product's quantity leaves a row —
 * with the reason, the order or stocktake it came from, and the responsible user whenever the writer supplied them. History from BEFORE the ledger
 * existed is not reconstructed and not invented: `startedAt` says from when it is complete. A change that arrived without context is shown as
 * "source not recorded", never guessed.
 *
 * A stocktake counts the physical stock of a branch's tracked products against the quantity EXPECTED when the count started. Applying it moves each
 * counted product by (counted − expected), so sales and cancellations recorded since the count started are kept, and writes one STOCKTAKE movement
 * per product. A count that would take a product below zero is refused as a whole. Only a manager applies it. No new automatic deduction exists.
 */
@Injectable()
export class StockLedgerService {
  constructor(
    private readonly ds: DataSource,
    private readonly vendorAuth: VendorStaffAuthorizationService,
    private readonly audit: AdminAuditService,
  ) {}

  private async branchIds(user: Actor, branchId?: string): Promise<string[]> {
    const owned = await this.vendorAuth.getOwnedBranchIds(user.id);
    if (!branchId) return owned;
    if (!UUID_RE.test(branchId) || !owned.includes(branchId)) throw notFound('Branch not found.');
    return [branchId];
  }

  async movements(user: Actor, q: { branchId?: string; productId?: string; reason?: string; search?: string; from?: string; to?: string; page?: string; limit?: string }) {
    const ids = await this.branchIds(user, q.branchId);
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 25));
    const [info] = await this.ds.query(`SELECT started_at FROM stock_ledger_info WHERE id = 1`);
    const empty = { items: [], page, limit, total: 0, startedAt: info?.started_at ?? null };
    if (ids.length === 0) return empty;
    if ((q.from && !DATE_RE.test(q.from)) || (q.to && !DATE_RE.test(q.to))) throw bad('Dates must be YYYY-MM-DD.');
    if (q.reason && !REASONS.includes(q.reason)) throw bad('Unknown reason.');
    if (q.productId && !UUID_RE.test(q.productId)) throw bad('Unknown product.');
    const v: unknown[] = [ids];
    const where: string[] = ['m.vendor_branch_id = ANY($1)'];
    const add = (sql: string, val: unknown) => { v.push(val); where.push(sql.replace('?', `$${v.length}`)); };
    if (q.productId) add('m.product_id = ?', q.productId);
    if (q.reason) add('m.reason = ?', q.reason);
    if (q.from) add(`(m.occurred_at AT TIME ZONE '${CAIRO}')::date >= ?::date`, q.from);
    if (q.to) add(`(m.occurred_at AT TIME ZONE '${CAIRO}')::date <= ?::date`, q.to);
    const search = (q.search ?? '').trim().slice(0, 80);
    if (search) {
      v.push(`%${search.replace(/[%_\\]/g, '\\$&')}%`);
      const n = v.length;
      where.push(`(p.name ILIKE $${n} OR coalesce(p.name_ar,'') ILIKE $${n} OR coalesce(o.order_number,'') ILIKE $${n})`);
    }
    const fixed = where.join(' AND ');
    const base = `FROM stock_movements m JOIN products p ON p.id = m.product_id JOIN vendor_branches b ON b.id = m.vendor_branch_id LEFT JOIN users u ON u.id = m.actor_user_id
                  LEFT JOIN orders o ON m.reference_type = 'ORDER' AND o.id = m.reference_id LEFT JOIN stocktakes st ON m.reference_type = 'STOCKTAKE' AND st.id = m.reference_id`;
    const [tot] = await this.ds.query(`SELECT count(*)::int AS n ${base} WHERE ${fixed}`, v);
    const rows = await this.ds.query(
      `SELECT m.id, m.occurred_at, m.product_id, p.name, p.name_ar, b.name AS branch_name, m.before_quantity, m.after_quantity, m.delta, m.reason, m.reference_type, m.reference_id, o.order_number,
              u.full_name AS actor_name, m.actor_role, m.note, m.source_captured
         ${base} WHERE ${fixed} ORDER BY m.occurred_at DESC, m.id LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      v,
    );
    return {
      items: rows.map((r: any) => ({
        id: r.id, occurredAt: r.occurred_at, productId: r.product_id, productName: r.name, productNameAr: r.name_ar, branchName: r.branch_name,
        beforeQuantity: num(r.before_quantity), afterQuantity: num(r.after_quantity), delta: num(r.delta), reason: r.reason,
        reference: r.reference_id ? { type: r.reference_type, id: r.reference_id, orderNumber: r.order_number ?? null } : null,
        actorName: r.actor_name ?? null, actorRole: r.actor_role ?? null, note: r.note, sourceCaptured: r.source_captured,
      })),
      page, limit, total: tot.n, startedAt: info?.started_at ?? null,
    };
  }

  // ------------------------------------------------------------------------------------------------------------------------ stocktakes

  async listStocktakes(user: Actor, branchId?: string) {
    const ids = await this.branchIds(user, branchId);
    if (ids.length === 0) return { items: [], canApply: user.role === Role.VENDOR_MANAGER };
    const rows = await this.ds.query(
      `SELECT s.id, s.status, s.note, s.created_at, s.applied_at, b.name AS branch_name, b.id AS branch_id, u.full_name AS created_by,
              (SELECT count(*)::int FROM stocktake_lines l WHERE l.stocktake_id = s.id) AS lines, (SELECT count(*)::int FROM stocktake_lines l WHERE l.stocktake_id = s.id AND l.counted_quantity IS NOT NULL) AS counted
         FROM stocktakes s JOIN vendor_branches b ON b.id = s.vendor_branch_id JOIN users u ON u.id = s.created_by_user_id WHERE s.vendor_branch_id = ANY($1) ORDER BY s.created_at DESC LIMIT 50`,
      [ids],
    );
    return { items: rows.map((s: any) => ({ id: s.id, status: s.status, note: s.note, createdAt: s.created_at, appliedAt: s.applied_at, branchId: s.branch_id, branchName: s.branch_name, createdBy: s.created_by, lines: s.lines, counted: s.counted })), canApply: user.role === Role.VENDOR_MANAGER };
  }

  private async loadStocktake(user: Actor, id: string) {
    if (!UUID_RE.test(id ?? '')) throw notFound('Stocktake not found.');
    const [s] = await this.ds.query(`SELECT s.*, b.name AS branch_name FROM stocktakes s JOIN vendor_branches b ON b.id = s.vendor_branch_id WHERE s.id = $1`, [id]);
    if (!s) throw notFound('Stocktake not found.');
    await ownedBranch(this.vendorAuth, user, s.vendor_branch_id);
    return s;
  }

  async getStocktake(user: Actor, id: string) {
    const s = await this.loadStocktake(user, id);
    const lines = await this.ds.query(
      `SELECT l.product_id, p.name, p.name_ar, p.pricing_unit, l.expected_quantity, l.counted_quantity, l.counted_at, cu.full_name AS counted_by, p.quantity AS current_quantity
         FROM stocktake_lines l JOIN products p ON p.id = l.product_id LEFT JOIN users cu ON cu.id = l.counted_by_user_id WHERE l.stocktake_id = $1 ORDER BY p.name`,
      [id],
    );
    const items = lines.map((l: any) => {
      const counted = num(l.counted_quantity);
      return {
        productId: l.product_id, name: l.name, nameAr: l.name_ar, pricingUnit: l.pricing_unit, expected: num(l.expected_quantity), counted,
        variance: counted === null ? null : counted - Number(l.expected_quantity), currentQuantity: num(l.current_quantity),
        // The product's quantity moved after the count started (a sale, a cancellation, an edit): the variance is still counted − expected.
        movedSinceStart: s.status === 'OPEN' && Number(l.current_quantity) !== Number(l.expected_quantity),
        countedBy: l.counted_by ?? null, countedAt: l.counted_at,
      };
    });
    const counted = items.filter((i: any) => i.counted !== null);
    return {
      id: s.id, status: s.status, note: s.note, branchId: s.vendor_branch_id, branchName: s.branch_name, createdAt: s.created_at, appliedAt: s.applied_at,
      items, canApply: user.role === Role.VENDOR_MANAGER && s.status === 'OPEN',
      summary: {
        lines: items.length, counted: counted.length, uncounted: items.length - counted.length,
        withVariance: counted.filter((i: any) => i.variance !== 0).length,
        netVariance: counted.reduce((a: number, i: any) => a + i.variance, 0),
      },
    };
  }

  async startStocktake(user: Actor, body: { branchId?: string; note?: string }) {
    const branchId = await ownedBranch(this.vendorAuth, user, String(body?.branchId));
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 300) || null : null;
    const id = await this.ds.transaction(async (m) => {
      const [open] = await m.query(`SELECT id FROM stocktakes WHERE vendor_branch_id = $1 AND status = 'OPEN'`, [branchId]);
      if (open) throw new ConflictException({ message: 'A stocktake is already open for this branch. Finish or cancel it first.', details: { code: 'STOCKTAKE_ALREADY_OPEN', stocktakeId: open.id } });
      const [{ n }] = await m.query(`SELECT count(*)::int AS n FROM products WHERE vendor_branch_id = $1 AND inventory_mode = 'TRACKED' AND deleted_at IS NULL`, [branchId]);
      if (n === 0) throw new ConflictException({ message: 'This branch has no products with tracked stock to count.', details: { code: 'NO_TRACKED_PRODUCTS' } });
      const [row] = await m.query(`INSERT INTO stocktakes (vendor_branch_id, note, created_by_user_id) VALUES ($1,$2,$3) RETURNING id`, [branchId, note, user.id]);
      await m.query(
        `INSERT INTO stocktake_lines (stocktake_id, product_id, expected_quantity) SELECT $1, id, coalesce(quantity, 0) FROM products WHERE vendor_branch_id = $2 AND inventory_mode = 'TRACKED' AND deleted_at IS NULL`,
        [row.id, branchId],
      );
      return row.id as string;
    });
    await this.audit.record({ actorUserId: user.id, actorRole: user.role, action: AdminAuditAction.STOCKTAKE_STARTED, targetType: 'stocktake', targetId: id, metadata: { branchId } });
    return { id };
  }

  async setCount(user: Actor, id: string, productId: string, counted: unknown) {
    const s = await this.loadStocktake(user, id);
    if (s.status !== 'OPEN') throw new ConflictException({ message: 'This stocktake is closed.', details: { code: 'STOCKTAKE_CLOSED' } });
    if (!UUID_RE.test(productId ?? '')) throw notFound('Product not found in this stocktake.');
    if (counted !== null && (typeof counted !== 'number' || !Number.isInteger(counted) || counted < 0 || counted > 100_000_000)) throw bad('The counted quantity must be a whole number, 0 or more (or empty to clear).');
    const res = await this.ds.query(
      `UPDATE stocktake_lines SET counted_quantity = $3, counted_by_user_id = $4, counted_at = CASE WHEN $3::int IS NULL THEN NULL ELSE now() END WHERE stocktake_id = $1 AND product_id = $2 RETURNING product_id`,
      [id, productId, counted, counted === null ? null : user.id],
    );
    if ((res[0] ?? []).length === 0) throw notFound('Product not found in this stocktake.');
    return { productId, counted };
  }

  async apply(user: Actor, id: string) {
    if (user.role !== Role.VENDOR_MANAGER) throw new ForbiddenException({ message: 'Only a branch manager can apply a stocktake.', details: { code: 'MANAGER_ONLY' } });
    const s = await this.loadStocktake(user, id);
    const result = await this.ds.transaction(async (m) => {
      const [locked] = await m.query(`SELECT status FROM stocktakes WHERE id = $1 FOR UPDATE`, [id]);
      if (locked.status !== 'OPEN') throw new ConflictException({ message: 'This stocktake is already closed.', details: { code: 'STOCKTAKE_CLOSED' } });
      const lines = await m.query(`SELECT product_id, expected_quantity, counted_quantity FROM stocktake_lines WHERE stocktake_id = $1 AND counted_quantity IS NOT NULL ORDER BY product_id`, [id]);
      let adjusted = 0;
      for (const l of lines) {
        const delta = Number(l.counted_quantity) - Number(l.expected_quantity);
        if (delta === 0) continue;
        await setStockContext(m, { reason: 'STOCKTAKE', referenceType: 'STOCKTAKE', referenceId: id, actorUserId: user.id, actorRole: user.role });
        const upd = await m.query(`UPDATE products SET quantity = quantity + $2 WHERE id = $1 AND inventory_mode = 'TRACKED' AND quantity + $2 >= 0 RETURNING id`, [l.product_id, delta]);
        if ((upd[0] ?? []).length === 0) throw new ConflictException({ message: 'Applying this count would take a product below zero (stock changed since the count started). Recount that product.', details: { code: 'WOULD_GO_NEGATIVE', productId: l.product_id } });
        adjusted += 1;
      }
      await m.query(`UPDATE stocktakes SET status = 'APPLIED', applied_at = now(), applied_by_user_id = $2 WHERE id = $1`, [id, user.id]);
      return { adjusted, counted: lines.length };
    });
    await this.audit.record({ actorUserId: user.id, actorRole: user.role, action: AdminAuditAction.STOCKTAKE_APPLIED, targetType: 'stocktake', targetId: id, metadata: { branchId: s.vendor_branch_id, adjusted: result.adjusted, counted: result.counted } });
    return result;
  }

  async cancel(user: Actor, id: string) {
    const s = await this.loadStocktake(user, id);
    const res = await this.ds.query(`UPDATE stocktakes SET status = 'CANCELLED', cancelled_at = now() WHERE id = $1 AND status = 'OPEN' RETURNING id`, [id]);
    if ((res[0] ?? []).length === 0) throw new ConflictException({ message: 'This stocktake is already closed.', details: { code: 'STOCKTAKE_CLOSED' } });
    await this.audit.record({ actorUserId: user.id, actorRole: user.role, action: AdminAuditAction.STOCKTAKE_CANCELLED, targetType: 'stocktake', targetId: id, metadata: { branchId: s.vendor_branch_id } });
    return { id };
  }
}

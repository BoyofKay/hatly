import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { WalletService } from '../../wallet/wallet.service';
import { WalletTransactionType } from '../../wallet/wallet-transaction-type.enum';
import { RefreshTokenStore } from '../../auth/refresh-token.store';
import { assertUuid, maskEmail, maskName, maskPhone, num, pageParams, returned } from '../common/platform-sql';

export const WALLET_ADJUSTMENT_REASONS = ['GOODWILL', 'SERVICE_FAILURE', 'PAYMENT_CORRECTION', 'PROMOTION_CORRECTION', 'OTHER'] as const;
const approvalThreshold = () => Number(process.env.WALLET_ADJUSTMENT_APPROVAL_THRESHOLD_MINOR ?? 5000);
const maxAdjustment = () => Number(process.env.WALLET_ADJUSTMENT_MAX_MINOR ?? 100000);

type RatingTarget = 'vendor' | 'driver' | 'product';
const RATING_TABLE: Record<RatingTarget, { table: string; owner: string; ownerTable: string; ownerCol: string }> = {
  vendor: { table: 'vendor_ratings', owner: 'vendor_branch_id', ownerTable: 'vendor_branches', ownerCol: 'id' },
  driver: { table: 'driver_ratings', owner: 'driver_id', ownerTable: 'drivers', ownerCol: 'id' },
  product: { table: 'product_ratings', owner: 'product_id', ownerTable: 'products', ownerCol: 'id' },
};

@Injectable()
export class AdminCustomersExtService {
  constructor(
    private readonly ds: DataSource,
    private readonly wallet: WalletService,
    private readonly refreshTokens: RefreshTokenStore,
  ) {}

  private async customer(id: string) {
    assertUuid(id, 'id');
    const [u] = await this.ds.query(`SELECT id, full_name, phone, email, is_active, is_phone_verified, created_at FROM users WHERE id = $1 AND role = 'CUSTOMER' AND deleted_at IS NULL`, [id]);
    if (!u) throw new NotFoundException('Customer not found.');
    return u;
  }

  async summary(id: string, financial: boolean) {
    const u = await this.customer(id);
    const [o] = await this.ds.query(
      `SELECT count(*)::int AS orders, count(*) FILTER (WHERE status IN ('DELIVERED','COLLECTED'))::int AS delivered, count(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
              min(created_at) AS first_order, max(created_at) AS last_order FROM orders WHERE customer_id = $1`,
      [id],
    );
    const [notes] = await this.ds.query(`SELECT count(*)::int AS n FROM customer_notes WHERE customer_user_id = $1`, [id]);
    const [loy] = await this.ds.query(`SELECT coalesce(sum(points_delta), 0)::int AS points FROM loyalty_points_transactions WHERE customer_id = $1`, [id]);
    const out: Record<string, unknown> = {
      id: u.id, isActive: u.is_active, isPhoneVerified: u.is_phone_verified, registeredAt: new Date(u.created_at).toISOString(),
      orders: o.orders, delivered: o.delivered, cancelled: o.cancelled, firstOrderAt: o.first_order, lastOrderAt: o.last_order, notes: notes.n, loyaltyPoints: loy.points,
    };
    if (financial) {
      const [v] = await this.ds.query(
        `SELECT coalesce(sum(s.subtotal_minor), 0)::bigint AS gmv FROM order_vendor_segments s JOIN orders o ON o.id = s.order_id WHERE o.customer_id = $1 AND s.status <> 'CANCELLED' AND o.status IN ('DELIVERED','COLLECTED')`,
        [id],
      );
      out.lifetimeValueMinor = num(v.gmv);
      out.walletBalanceMinor = await this.wallet.getBalance(id);
    }
    return out;
  }

  async walletLedger(id: string, q: { page?: string | number; limit?: string | number }) {
    await this.customer(id);
    const { page, limit, offset } = pageParams(q);
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM wallet_transactions WHERE customer_id = $1`, [id]);
    const rows = await this.ds.query(
      `SELECT t.id, t.created_at, t.type, t.amount_delta_minor, t.reason, t.order_id, o.order_number FROM wallet_transactions t LEFT JOIN orders o ON o.id = t.order_id
        WHERE t.customer_id = $1 ORDER BY t.created_at DESC, t.id DESC LIMIT ${limit} OFFSET ${offset}`,
      [id],
    );
    return { balanceMinor: await this.wallet.getBalance(id), items: rows.map((r: any) => ({ id: r.id, createdAt: new Date(r.created_at).toISOString(), type: r.type, amountMinor: num(r.amount_delta_minor), reason: r.reason, orderId: r.order_id, orderNumber: r.order_number })), page, limit, total };
  }

  async loyalty(id: string, q: { page?: string | number; limit?: string | number }) {
    await this.customer(id);
    const { page, limit, offset } = pageParams(q);
    const [{ total, points }] = await this.ds.query(`SELECT count(*)::int AS total, coalesce(sum(points_delta), 0)::int AS points FROM loyalty_points_transactions WHERE customer_id = $1`, [id]);
    const rows = await this.ds.query(`SELECT id, created_at, type, points_delta, order_id FROM loyalty_points_transactions WHERE customer_id = $1 ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`, [id]);
    return { points, items: rows.map((r: any) => ({ id: r.id, createdAt: new Date(r.created_at).toISOString(), type: r.type, points: r.points_delta, orderId: r.order_id })), page, limit, total };
  }

  async addresses(id: string, pii: boolean) {
    await this.customer(id);
    const rows = await this.ds.query(`SELECT id, label, line1, governorate, city, is_default FROM addresses WHERE customer_id = $1 AND deleted_at IS NULL ORDER BY is_default DESC, created_at`, [id]);
    return rows.map((r: any) => ({ id: r.id, label: r.label, line1: pii ? r.line1 : null, governorate: r.governorate, city: r.city, isDefault: r.is_default, masked: !pii }));
  }

  async ratingsOf(id: string) {
    await this.customer(id);
    const rows = await this.ds.query(
      `SELECT 'vendor' AS target, id, stars, comment, created_at, hidden_at FROM vendor_ratings WHERE customer_id = $1
       UNION ALL SELECT 'driver', id, stars, comment, created_at, hidden_at FROM driver_ratings WHERE customer_id = $1
       UNION ALL SELECT 'product', id, stars, comment, created_at, hidden_at FROM product_ratings WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [id],
    );
    return rows.map((r: any) => ({ target: r.target, id: r.id, stars: r.stars, comment: r.comment, createdAt: new Date(r.created_at).toISOString(), hidden: Boolean(r.hidden_at) }));
  }

  async couponsOf(id: string) {
    await this.customer(id);
    const rows = await this.ds.query(
      `SELECT c.id, c.created_at, c.discount_applied_minor, c.is_reversed, c.reversed_at, o.name AS offer_name, o.coupon_code, ord.order_number
         FROM offer_consumptions c JOIN offers o ON o.id = c.offer_id LEFT JOIN orders ord ON ord.id = c.order_id WHERE c.customer_id = $1 ORDER BY c.created_at DESC LIMIT 100`,
      [id],
    );
    return rows.map((r: any) => ({ id: r.id, createdAt: new Date(r.created_at).toISOString(), offerName: r.offer_name, couponCode: r.coupon_code, orderNumber: r.order_number, discountMinor: num(r.discount_applied_minor), reversed: r.is_reversed }));
  }

  // ---------------------------------------------------------------- notes / block / reveal

  async notes(id: string) {
    await this.customer(id);
    const rows = await this.ds.query(`SELECT n.id, n.body, n.created_at, u.full_name FROM customer_notes n JOIN users u ON u.id = n.author_user_id WHERE n.customer_user_id = $1 ORDER BY n.created_at DESC`, [id]);
    return rows.map((r: any) => ({ id: r.id, body: r.body, createdAt: new Date(r.created_at).toISOString(), authorName: r.full_name }));
  }

  async addNote(id: string, body: string, authorId: string) {
    await this.customer(id);
    const text = (body ?? '').trim();
    if (!text || text.length > 1000) throw new BadRequestException({ message: 'A note must be 1–1000 characters.', details: { code: 'VALIDATION_FAILED' } });
    const [row] = await this.ds.query(`INSERT INTO customer_notes (customer_user_id, author_user_id, body) VALUES ($1,$2,$3) RETURNING id, created_at`, [id, authorId, text]);
    return { id: row.id, createdAt: new Date(row.created_at).toISOString() };
  }

  /** Block = the existing `is_active` flag (already refused at login) + the customer's refresh session is revoked. */
  async setBlocked(id: string, blocked: boolean, reason: string): Promise<{ changed: boolean }> {
    const u = await this.customer(id);
    if (!reason || reason.trim().length < 5) throw new BadRequestException({ message: 'A reason is required (at least 5 characters).', details: { code: 'VALIDATION_FAILED' } });
    const wantActive = !blocked;
    if (u.is_active === wantActive) return { changed: false };
    await this.ds.query(`UPDATE users SET is_active = $2, updated_at = now() WHERE id = $1 AND role = 'CUSTOMER'`, [id, wantActive]);
    if (blocked) await this.refreshTokens.revoke(id);
    return { changed: true };
  }

  async reveal(id: string, field: string) {
    const u = await this.customer(id);
    if (field === 'PHONE') return { field, value: u.phone };
    if (field === 'EMAIL') return { field, value: u.email };
    if (field === 'ADDRESS') {
      const [a] = await this.ds.query(`SELECT line1, city, governorate FROM addresses WHERE customer_id = $1 AND deleted_at IS NULL ORDER BY is_default DESC, created_at LIMIT 1`, [id]);
      return { field, value: a ? [a.line1, a.city, a.governorate].filter(Boolean).join(', ') : null };
    }
    throw new BadRequestException({ message: 'field must be PHONE, EMAIL or ADDRESS.', details: { code: 'VALIDATION_FAILED' } });
  }

  // ---------------------------------------------------------------- wallet adjustments (two-person control)

  /**
   * An adjustment at or below the threshold is applied immediately by a user who holds MANAGE_CUSTOMER_WALLET; above it, it waits for a
   * DIFFERENT admin holding WALLET_ADJUST_APPROVE. Either way the money moves ONLY through the wallet ledger (an ADJUSTMENT row keyed by
   * the adjustment id, so a retry can never apply it twice) and a debit can never take the wallet below zero.
   */
  async requestAdjustment(customerId: string, input: { amountMinor: number; reasonCode: string; note?: string }, actor: { id: string }, idempotencyKey: string) {
    await this.customer(customerId);
    if (!Number.isInteger(input.amountMinor) || input.amountMinor === 0) throw new BadRequestException({ message: 'amountMinor must be a non-zero integer.', details: { code: 'VALIDATION_FAILED' } });
    if (Math.abs(input.amountMinor) > maxAdjustment()) throw new BadRequestException({ message: `An adjustment may not exceed ${maxAdjustment()} minor units.`, details: { code: 'ADJUSTMENT_TOO_LARGE' } });
    if (!(WALLET_ADJUSTMENT_REASONS as readonly string[]).includes(input.reasonCode)) throw new BadRequestException({ message: 'Choose a reason.', details: { code: 'VALIDATION_FAILED' } });
    if (input.note && input.note.length > 300) throw new BadRequestException({ message: 'The note is limited to 300 characters.', details: { code: 'VALIDATION_FAILED' } });

    const existing = (await this.ds.query(`SELECT * FROM wallet_adjustments WHERE idempotency_key = $1`, [idempotencyKey]))[0];
    const same = (r: any) => r.customer_user_id === customerId && num(r.amount_minor) === input.amountMinor && r.reason_code === input.reasonCode;
    if (existing) {
      if (!same(existing)) throw new ConflictException({ message: 'This Idempotency-Key was already used for a different adjustment.', details: { code: 'IDEMPOTENCY_CONFLICT' } });
      return { adjustment: this.adjView(existing), replayed: true };
    }
    let row: any;
    try {
      [row] = await this.ds.query(
        `INSERT INTO wallet_adjustments (customer_user_id, amount_minor, reason_code, note, requested_by_user_id, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [customerId, input.amountMinor, input.reasonCode, input.note ?? null, actor.id, idempotencyKey],
      );
    } catch (error: any) {
      if (error?.code === '23505') {
        const winner = (await this.ds.query(`SELECT * FROM wallet_adjustments WHERE idempotency_key = $1`, [idempotencyKey]))[0];
        if (winner && same(winner)) return { adjustment: this.adjView(winner), replayed: true };
      }
      throw error;
    }
    if (Math.abs(input.amountMinor) <= approvalThreshold()) {
      const applied = await this.apply(row.id, actor.id, 'Applied immediately (at or below the approval threshold).');
      return { adjustment: applied, replayed: false, requiresApproval: false };
    }
    return { adjustment: this.adjView(row), replayed: false, requiresApproval: true };
  }

  private adjView(r: any) {
    return { id: r.id, customerId: r.customer_user_id, amountMinor: num(r.amount_minor), reasonCode: r.reason_code, note: r.note, status: r.status, requestedBy: r.requested_by_user_id, decidedBy: r.decided_by_user_id, decidedAt: r.decided_at, decisionNote: r.decision_note, createdAt: new Date(r.created_at).toISOString(), approvalThresholdMinor: approvalThreshold() };
  }

  private async apply(adjustmentId: string, decidedBy: string, decisionNote: string) {
    return this.ds.transaction(async (m) => {
      const [adj] = await m.query(`SELECT * FROM wallet_adjustments WHERE id = $1 FOR UPDATE`, [adjustmentId]);
      if (!adj) throw new NotFoundException('Adjustment not found.');
      if (adj.status !== 'PENDING') throw new ConflictException({ message: `This adjustment is already ${adj.status}.`, details: { code: 'ALREADY_DECIDED' } });
      await this.wallet.lockCustomerWallet(adj.customer_user_id, m);
      if (num(adj.amount_minor) < 0) {
        const balance = await this.wallet.getBalance(adj.customer_user_id, m);
        if (balance + num(adj.amount_minor) < 0) throw new ConflictException({ message: 'This debit would take the customer wallet below zero.', details: { code: 'INSUFFICIENT_WALLET_BALANCE', balanceMinor: balance } });
      }
      const tx = await this.wallet.recordTransaction({ customerId: adj.customer_user_id, amountDeltaMinor: num(adj.amount_minor), type: WalletTransactionType.ADJUSTMENT, idempotencyKey: `wallet-adjustment:${adj.id}`, reason: `${adj.reason_code}${adj.note ? `: ${adj.note}` : ''}`.slice(0, 300), createdByUserId: decidedBy }, m);
      const [row] = returned(await m.query(`UPDATE wallet_adjustments SET status = 'APPLIED', decided_by_user_id = $2, decided_at = now(), decision_note = $3, wallet_transaction_id = $4, updated_at = now() WHERE id = $1 RETURNING *`, [adj.id, decidedBy, decisionNote.slice(0, 300), tx.id]));
      return this.adjView(row);
    });
  }

  async listAdjustments(q: { status?: string; page?: string | number; limit?: string | number }) {
    const { page, limit, offset } = pageParams(q);
    const params: unknown[] = [];
    let where = 'true';
    if (q.status) { params.push(q.status); where = `a.status = $1`; }
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM wallet_adjustments a WHERE ${where}`, params);
    const rows = await this.ds.query(
      `SELECT a.*, c.full_name AS customer_name, r.full_name AS requested_by_name, d.full_name AS decided_by_name FROM wallet_adjustments a
         JOIN users c ON c.id = a.customer_user_id JOIN users r ON r.id = a.requested_by_user_id LEFT JOIN users d ON d.id = a.decided_by_user_id
        WHERE ${where} ORDER BY a.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    return { items: rows.map((r: any) => ({ ...this.adjView(r), customerName: r.customer_name, requestedByName: r.requested_by_name, decidedByName: r.decided_by_name })), page, limit, total };
  }

  async decideAdjustment(id: string, decision: 'APPROVE' | 'REJECT', actor: { id: string }, note?: string) {
    assertUuid(id, 'id');
    const [adj] = await this.ds.query(`SELECT * FROM wallet_adjustments WHERE id = $1`, [id]);
    if (!adj) throw new NotFoundException('Adjustment not found.');
    if (adj.requested_by_user_id === actor.id) throw new ForbiddenException({ message: 'You cannot decide an adjustment you requested.', details: { code: 'FOUR_EYES' } });
    if (decision === 'APPROVE') return { adjustment: await this.apply(id, actor.id, note ?? 'Approved.') };
    if (!note || note.trim().length < 5) throw new BadRequestException({ message: 'A reason is required to reject (at least 5 characters).', details: { code: 'VALIDATION_FAILED' } });
    const [row] = returned(await this.ds.query(`UPDATE wallet_adjustments SET status = 'REJECTED', decided_by_user_id = $2, decided_at = now(), decision_note = $3, updated_at = now() WHERE id = $1 AND status = 'PENDING' RETURNING *`, [id, actor.id, note.slice(0, 300)]));
    if (!row) throw new ConflictException({ message: 'This adjustment is already decided.', details: { code: 'ALREADY_DECIDED' } });
    return { adjustment: this.adjView(row) };
  }

  // ---------------------------------------------------------------- ratings moderation (hide, never delete; counters recomputed)

  async listRatings(q: { target?: string; hidden?: string; stars?: string; page?: string | number; limit?: string | number }) {
    const { page, limit, offset } = pageParams(q);
    const targets: RatingTarget[] = q.target ? [q.target as RatingTarget] : ['vendor', 'driver', 'product'];
    for (const t of targets) if (!RATING_TABLE[t]) throw new BadRequestException({ message: 'target must be vendor, driver or product.', details: { code: 'VALIDATION_FAILED' } });
    const parts = targets.map((t) => {
      const c = RATING_TABLE[t];
      const label = t === 'vendor' ? `(SELECT b.name FROM vendor_branches b WHERE b.id = r.${c.owner})` : t === 'driver' ? `(SELECT u.full_name FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.id = r.${c.owner})` : `(SELECT p.name FROM products p WHERE p.id = r.${c.owner})`;
      return `SELECT '${t}' AS target, r.id, r.stars, r.comment, r.created_at, r.hidden_at, r.hidden_reason, r.customer_id, ${label} AS subject FROM ${c.table} r WHERE r.deleted_at IS NULL`;
    });
    let wrapped = `SELECT * FROM (${parts.join(' UNION ALL ')}) x WHERE true`;
    const params: unknown[] = [];
    if (q.hidden === 'true') wrapped += ' AND x.hidden_at IS NOT NULL';
    if (q.hidden === 'false') wrapped += ' AND x.hidden_at IS NULL';
    if (q.stars) { params.push(Number(q.stars)); wrapped += ` AND x.stars = $${params.length}`; }
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM (${wrapped}) c`, params);
    const rows = await this.ds.query(`${wrapped} ORDER BY x.created_at DESC, x.id LIMIT ${limit} OFFSET ${offset}`, params);
    return { items: rows.map((r: any) => ({ target: r.target, id: r.id, stars: r.stars, comment: r.comment, subject: r.subject, createdAt: new Date(r.created_at).toISOString(), hidden: Boolean(r.hidden_at), hiddenReason: r.hidden_reason, customerId: r.customer_id })), page, limit, total };
  }

  async setRatingHidden(target: string, id: string, hidden: boolean, reason: string | undefined, actorId: string) {
    const c = RATING_TABLE[target as RatingTarget];
    if (!c) throw new BadRequestException({ message: 'target must be vendor, driver or product.', details: { code: 'VALIDATION_FAILED' } });
    assertUuid(id, 'id');
    if (hidden && (!reason || reason.trim().length < 5)) throw new BadRequestException({ message: 'A reason is required to hide a rating (at least 5 characters).', details: { code: 'VALIDATION_FAILED' } });
    return this.ds.transaction(async (m) => {
      const [r] = await m.query(`SELECT * FROM ${c.table} WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
      if (!r) throw new NotFoundException('Rating not found.');
      if (Boolean(r.hidden_at) === hidden) return { changed: false };
      await m.query(
        hidden ? `UPDATE ${c.table} SET hidden_at = now(), hidden_by_user_id = $2, hidden_reason = $3 WHERE id = $1` : `UPDATE ${c.table} SET hidden_at = NULL, hidden_by_user_id = NULL, hidden_reason = NULL WHERE id = $1`,
        hidden ? [id, actorId, reason!.slice(0, 300)] : [id],
      );
      // The denormalised counters are recomputed from the VISIBLE ratings in the same transaction (never incremented/decremented).
      await m.query(
        `UPDATE ${c.ownerTable} o SET rating_count = s.n, rating_sum_stars = s.total FROM
           (SELECT count(*)::int AS n, coalesce(sum(stars), 0)::int AS total FROM ${c.table} WHERE ${c.owner} = $1 AND deleted_at IS NULL AND hidden_at IS NULL) s
         WHERE o.${c.ownerCol} = $1`,
        [r[c.owner]],
      );
      return { changed: true };
    });
  }

  masked(u: { full_name: string | null; phone: string; email: string | null }) {
    return { fullName: maskName(u.full_name), phone: maskPhone(u.phone), email: maskEmail(u.email) };
  }
}

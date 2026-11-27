import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import { DataSource, EntityManager } from 'typeorm';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';
import { decide, OrderContextGroup, PromotionDecision, PromotionRule } from './promotion-engine';

/** Wrong codes allowed per customer per hour before code entry is paused (guessing protection). */
export const PROMO_FAILED_ATTEMPTS_PER_HOUR = 10;

const num = (v: unknown) => (v == null ? 0 : Number(v));
const rows = <T>(r: unknown): T[] => (Array.isArray(r) && Array.isArray(r[0]) ? (r[0] as T[]) : (r as T[]));

function toRule(r: any): PromotionRule {
  return {
    id: r.id, name: r.name, nameAr: r.name_ar ?? null, kind: r.kind, code: r.code ?? null, target: r.target, discountType: r.discount_type,
    discountValue: num(r.discount_value), maxDiscountMinor: r.max_discount_minor == null ? null : num(r.max_discount_minor),
    minSubtotalMinor: r.min_subtotal_minor == null ? null : num(r.min_subtotal_minor), scopeType: r.scope_type, scopeIds: r.scope_ids ?? [],
    startsAt: new Date(r.starts_at), endsAt: new Date(r.ends_at), isActive: r.is_active, perCustomerLimit: r.per_customer_limit ?? null,
    totalUsesLimit: r.total_uses_limit ?? null, budgetCapMinor: r.budget_cap_minor == null ? null : num(r.budget_cap_minor),
    newCustomersOnly: r.new_customers_only, stackable: r.stackable, feeBearer: r.fee_bearer, usesCount: num(r.uses_count),
    discountGivenMinor: num(r.discount_given_minor),
  };
}

export interface PromotionInput {
  name: string;
  nameAr?: string | null;
  kind: 'CODE' | 'AUTOMATIC';
  code?: string | null;
  target: 'ITEMS' | 'DELIVERY_FEE';
  discountType: 'PERCENTAGE' | 'FIXED' | 'FIXED_FEE';
  discountValue: number;
  maxDiscountMinor?: number | null;
  minSubtotalMinor?: number | null;
  scopeType: 'ALL' | 'SECTORS' | 'BRANCHES';
  scopeIds?: string[];
  startsAt: string;
  endsAt: string;
  perCustomerLimit?: number | null;
  totalUsesLimit?: number | null;
  budgetCapMinor?: number | null;
  newCustomersOnly?: boolean;
  stackable?: boolean;
  feeBearer?: 'HATLY' | 'DRIVER';
}

/**
 * Hatly promotions (owner decision 2026-11-27): loads candidates and the customer's history for the pure engine, records uses in the
 * same transaction as the order (rows locked, so limits and budgets hold under concurrent orders), reverses them when an order is
 * cancelled, slows down code guessing, and serves the admin screens.
 */
@Injectable()
export class PromotionsService {
  constructor(
    private readonly ds: DataSource,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  /** Is this text a Hatly promotion code (any state)? Store coupons are handled by the offers module when it is not. */
  async isPromotionCode(manager: EntityManager, code: string): Promise<boolean> {
    const [r] = await manager.query(`SELECT 1 FROM promotions WHERE upper(code) = upper($1)`, [code.trim()]);
    return !!r;
  }

  async tooManyFailedCodes(customerId: string): Promise<boolean> {
    if (!this.redis) return false;
    const n = Number(await this.redis.get(`promo-fail:${customerId}`).catch(() => 0));
    return n >= PROMO_FAILED_ATTEMPTS_PER_HOUR;
  }

  async recordFailedCode(customerId: string): Promise<void> {
    if (!this.redis) return;
    const key = `promo-fail:${customerId}`;
    await this.redis.multi().incr(key).expire(key, 3600).exec().catch(() => undefined);
  }

  /** The promotions of one order. In ORDER mode the candidate rows are locked until the order's transaction ends. */
  async decideFor(
    manager: EntityManager,
    params: { customerId: string; groups: OrderContextGroup[]; deliveryFeeMinor: number | null; existingStoreDiscountMinor: number; code: string | null; lock: boolean },
  ): Promise<PromotionDecision> {
    const now = new Date();
    const list: any[] = await manager.query(
      `SELECT * FROM promotions
        WHERE (kind = 'AUTOMATIC' AND is_active AND starts_at <= $1 AND ends_at > $1) OR ($2::text IS NOT NULL AND upper(code) = upper($2))
        ORDER BY id ${params.lock ? 'FOR UPDATE' : ''}`,
      [now, params.code?.trim() || null],
    );
    if (list.length === 0) return { applied: [], itemsDiscountMinor: 0, deliveryFeeDiscountMinor: 0, deliveryFeeBearer: null, code: null };
    const [{ n }] = await manager.query(`SELECT count(*)::int AS n FROM orders WHERE customer_id = $1 AND status::text <> 'CANCELLED' AND deleted_at IS NULL`, [params.customerId]);
    const uses: Array<{ promotion_id: string; n: number }> = await manager.query(
      `SELECT promotion_id, count(*)::int AS n FROM promotion_redemptions WHERE customer_id = $1 AND reversed_at IS NULL AND promotion_id = ANY($2) GROUP BY promotion_id`,
      [params.customerId, list.map((r) => r.id)],
    );
    return decide(
      list.map(toRule),
      {
        now,
        groups: params.groups,
        deliveryFeeMinor: params.deliveryFeeMinor,
        existingStoreDiscountMinor: params.existingStoreDiscountMinor,
        isNewCustomer: Number(n) === 0,
        customerUses: Object.fromEntries(uses.map((u) => [u.promotion_id, Number(u.n)])),
      },
      params.code,
    );
  }

  /** Records the uses of an order (inside the order's transaction; rows were locked by decideFor). */
  async redeem(manager: EntityManager, orderId: string, customerId: string, decision: PromotionDecision): Promise<void> {
    for (const a of decision.applied) {
      await manager.query(
        `INSERT INTO promotion_redemptions (promotion_id, order_id, customer_id, target, discount_minor, fee_bearer) VALUES ($1, $2, $3, $4, $5, $6)`,
        [a.promotionId, orderId, customerId, a.target, a.discountMinor, a.feeBearer],
      );
      await manager.query(`UPDATE promotions SET uses_count = uses_count + 1, discount_given_minor = discount_given_minor + $2, updated_at = now() WHERE id = $1`, [a.promotionId, a.discountMinor]);
    }
  }

  /** Cancellation gives the uses back (once): the customer may use the code again, and limits / budget are restored. */
  async reverseForOrder(manager: EntityManager, orderId: string): Promise<void> {
    const reversed = rows<{ promotion_id: string; discount_minor: string }>(
      await manager.query(`UPDATE promotion_redemptions SET reversed_at = now() WHERE order_id = $1 AND reversed_at IS NULL RETURNING promotion_id, discount_minor`, [orderId]),
    );
    for (const r of reversed) {
      await manager.query(
        `UPDATE promotions SET uses_count = greatest(0, uses_count - 1), discount_given_minor = greatest(0, discount_given_minor - $2), updated_at = now() WHERE id = $1`,
        [r.promotion_id, num(r.discount_minor)],
      );
    }
  }

  // ---- admin ---------------------------------------------------------------------------------------------------------------------

  async list(): Promise<any[]> {
    const r = await this.ds.query(`SELECT * FROM promotions ORDER BY created_at DESC LIMIT 500`);
    const now = Date.now();
    return r.map((x: any) => ({
      ...this.view(x),
      state: !x.is_active ? 'PAUSED' : new Date(x.starts_at).getTime() > now ? 'SCHEDULED' : new Date(x.ends_at).getTime() <= now ? 'ENDED' : 'RUNNING',
    }));
  }

  async redemptions(id: string): Promise<any[]> {
    const r = await this.ds.query(
      `SELECT r.*, o.order_number, u.full_name FROM promotion_redemptions r JOIN orders o ON o.id = r.order_id JOIN users u ON u.id = r.customer_id
        WHERE r.promotion_id = $1 ORDER BY r.created_at DESC LIMIT 300`,
      [id],
    );
    return r.map((x: any) => ({ id: x.id, orderId: x.order_id, orderNumber: x.order_number, customerName: x.full_name, discountMinor: num(x.discount_minor), target: x.target, feeBearer: x.fee_bearer, reversedAt: x.reversed_at, createdAt: x.created_at }));
  }

  async create(input: PromotionInput, actorUserId: string): Promise<any> {
    const v = await this.validate(input);
    const [r] = await this.ds.query(
      `INSERT INTO promotions (name, name_ar, kind, code, target, discount_type, discount_value, max_discount_minor, min_subtotal_minor, scope_type, scope_ids,
         starts_at, ends_at, per_customer_limit, total_uses_limit, budget_cap_minor, new_customers_only, stackable, fee_bearer, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
      [v.name, v.nameAr, v.kind, v.code, v.target, v.discountType, v.discountValue, v.maxDiscountMinor, v.minSubtotalMinor, v.scopeType, v.scopeIds,
       v.startsAt, v.endsAt, v.perCustomerLimit, v.totalUsesLimit, v.budgetCapMinor, v.newCustomersOnly, v.stackable, v.feeBearer, actorUserId],
    );
    return this.view(r);
  }

  /** Editing keeps the uses so far; the code cannot change once used (customers may have it), nor can the kind. */
  async update(id: string, input: PromotionInput): Promise<any> {
    const [cur] = await this.ds.query(`SELECT * FROM promotions WHERE id = $1`, [id]);
    if (!cur) throw new NotFoundException('Promotion not found.');
    const v = await this.validate(input, id);
    if (num(cur.uses_count) > 0 && ((v.code ?? null) !== (cur.code ?? null) || v.kind !== cur.kind || v.target !== cur.target)) {
      throw new BadRequestException({ message: 'This promotion has been used: its code, kind and target cannot change. Pause it and create a new one.', details: { code: 'PROMO_LOCKED_AFTER_USE' } });
    }
    const [r] = await this.ds.query(
      `UPDATE promotions SET name=$2, name_ar=$3, kind=$4, code=$5, target=$6, discount_type=$7, discount_value=$8, max_discount_minor=$9, min_subtotal_minor=$10,
         scope_type=$11, scope_ids=$12, starts_at=$13, ends_at=$14, per_customer_limit=$15, total_uses_limit=$16, budget_cap_minor=$17, new_customers_only=$18,
         stackable=$19, fee_bearer=$20, updated_at=now() WHERE id=$1 RETURNING *`,
      [id, v.name, v.nameAr, v.kind, v.code, v.target, v.discountType, v.discountValue, v.maxDiscountMinor, v.minSubtotalMinor, v.scopeType, v.scopeIds,
       v.startsAt, v.endsAt, v.perCustomerLimit, v.totalUsesLimit, v.budgetCapMinor, v.newCustomersOnly, v.stackable, v.feeBearer],
    );
    return this.view(r);
  }

  async setActive(id: string, active: boolean): Promise<any> {
    const [r] = rows<any>(await this.ds.query(`UPDATE promotions SET is_active = $2, updated_at = now() WHERE id = $1 RETURNING *`, [id, active]));
    if (!r) throw new NotFoundException('Promotion not found.');
    return this.view(r);
  }

  private async validate(i: PromotionInput, selfId?: string) {
    const bad = (message: string, code = 'PROMO_INVALID') => new BadRequestException({ message, details: { code } });
    const name = (i.name ?? '').trim();
    if (!name) throw bad('Give the promotion a name.');
    if (!['CODE', 'AUTOMATIC'].includes(i.kind) || !['ITEMS', 'DELIVERY_FEE'].includes(i.target) || !['PERCENTAGE', 'FIXED', 'FIXED_FEE'].includes(i.discountType)) throw bad('Choose the kind, target and discount type.');
    if (i.discountType === 'FIXED_FEE' && i.target !== 'DELIVERY_FEE') throw bad('A set delivery fee only applies to the delivery fee.');
    const value = Number(i.discountValue);
    if (!Number.isInteger(value) || value < 0 || (i.discountType === 'PERCENTAGE' && (value < 1 || value > 100)) || (i.discountType === 'FIXED' && value < 1)) throw bad('Enter a valid discount (1–100 % or an amount).');
    const code = i.kind === 'CODE' ? (i.code ?? '').trim().toUpperCase() : null;
    if (i.kind === 'CODE' && !/^[A-Z0-9_-]{3,40}$/.test(code ?? '')) throw bad('The code must be 3–40 letters, digits, - or _ (no spaces).', 'PROMO_CODE_INVALID');
    if (code) {
      const [dup] = await this.ds.query(`SELECT 1 FROM promotions WHERE upper(code) = $1 AND ($2::uuid IS NULL OR id <> $2)`, [code, selfId ?? null]);
      const [store] = await this.ds.query(`SELECT 1 FROM offers WHERE upper(coupon_code) = $1 AND deleted_at IS NULL`, [code]).catch(() => [null]);
      if (dup || store) throw bad('This code is already used by another promotion or store coupon.', 'PROMO_CODE_TAKEN');
    }
    const startsAt = new Date(i.startsAt);
    const endsAt = new Date(i.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) throw bad('The end must be after the start.', 'PROMO_DATES_INVALID');
    const scopeIds = i.scopeType === 'ALL' ? [] : [...new Set(i.scopeIds ?? [])];
    if (i.scopeType !== 'ALL' && scopeIds.length === 0) throw bad('Choose at least one sector or branch.', 'PROMO_SCOPE_EMPTY');
    const pos = (v: unknown) => (v == null || v === '' ? null : Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : (() => { throw bad('Limits must be whole numbers above 0.'); })());
    return {
      name, nameAr: i.nameAr?.trim() || null, kind: i.kind, code, target: i.target, discountType: i.discountType, discountValue: value,
      maxDiscountMinor: pos(i.maxDiscountMinor), minSubtotalMinor: i.minSubtotalMinor == null || (i.minSubtotalMinor as unknown) === '' ? null : Math.max(0, Number(i.minSubtotalMinor)),
      scopeType: i.scopeType, scopeIds, startsAt, endsAt, perCustomerLimit: pos(i.perCustomerLimit), totalUsesLimit: pos(i.totalUsesLimit),
      budgetCapMinor: pos(i.budgetCapMinor), newCustomersOnly: !!i.newCustomersOnly, stackable: !!i.stackable,
      feeBearer: i.feeBearer === 'DRIVER' ? 'DRIVER' : 'HATLY',
    };
  }

  private view(r: any) {
    const rule = toRule(r);
    return { ...rule, budgetLeftMinor: rule.budgetCapMinor == null ? null : Math.max(0, rule.budgetCapMinor - rule.discountGivenMinor), createdAt: r.created_at, updatedAt: r.updated_at };
  }
}

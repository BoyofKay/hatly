/**
 * Hatly promotions (owner decision 2026-11-27) — the pure rules. No I/O: the service loads the candidates and the customer's history,
 * this decides what applies, how much, and why something does not.
 *
 *  - kind CODE (applied only when the customer enters the code) or AUTOMATIC (a campaign: applies by itself while it runs).
 *  - target ITEMS (the order's items) or DELIVERY_FEE.
 *  - discount PERCENTAGE (1–100 of the target), FIXED (an amount off) or FIXED_FEE (delivery fee becomes this amount; DELIVERY_FEE only).
 *  - scope ALL stores, chosen SECTORS or chosen BRANCHES (per-store promotions): the target base is only the part of the order in scope
 *    (items: the in-scope stores' subtotal; delivery fee: the whole fee when any store of the order is in scope).
 *  - minimum spend (on the in-scope items), maximum discount, per-customer uses, total uses, budget, new customers only, dates.
 *  - stackable: whether it may combine with other promotions / store offers / codes. A non-stackable promotion applies only alone; when
 *    several options exist the customer gets the one with the biggest saving (an entered code that loses is reported, not silently lost).
 *  - feeBearer (DELIVERY_FEE only): HATLY (driver earns on the full fee) or DRIVER (driver earns on the reduced fee).
 */
export type PromotionKind = 'CODE' | 'AUTOMATIC';
export type PromotionTarget = 'ITEMS' | 'DELIVERY_FEE';
export type PromotionDiscountType = 'PERCENTAGE' | 'FIXED' | 'FIXED_FEE';
export type PromotionScope = 'ALL' | 'SECTORS' | 'BRANCHES';
export type FeeBearer = 'HATLY' | 'DRIVER';

export interface PromotionRule {
  id: string;
  name: string;
  nameAr: string | null;
  kind: PromotionKind;
  code: string | null;
  target: PromotionTarget;
  discountType: PromotionDiscountType;
  discountValue: number;
  maxDiscountMinor: number | null;
  minSubtotalMinor: number | null;
  scopeType: PromotionScope;
  scopeIds: string[];
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
  perCustomerLimit: number | null;
  totalUsesLimit: number | null;
  budgetCapMinor: number | null;
  newCustomersOnly: boolean;
  stackable: boolean;
  feeBearer: FeeBearer;
  usesCount: number;
  discountGivenMinor: number;
}

export interface OrderContextGroup {
  vendorBranchId: string | null;
  sectorId: string | null;
  /** Items subtotal of this store part AFTER its own store offers / store coupon; null while the price is pending. */
  subtotalMinor: number | null;
}

export interface PromotionContext {
  now: Date;
  groups: OrderContextGroup[];
  /** Delivery fee before promotions (null: pickup, or not known yet). */
  deliveryFeeMinor: number | null;
  /** Discounts already on the order from store offers / store coupons. */
  existingStoreDiscountMinor: number;
  /** The customer has no earlier order that was not cancelled. */
  isNewCustomer: boolean;
  /** Non-reversed uses of each promotion by this customer. */
  customerUses: Record<string, number>;
}

export interface AppliedPromotion {
  promotionId: string;
  name: string;
  nameAr: string | null;
  code: string | null;
  target: PromotionTarget;
  discountMinor: number;
  feeBearer: FeeBearer | null;
  stackable: boolean;
}

export type PromotionRejection =
  | 'PROMO_NOT_FOUND'
  | 'PROMO_NOT_ACTIVE'
  | 'PROMO_EXPIRED'
  | 'PROMO_NOT_STARTED'
  | 'PROMO_NOT_IN_SCOPE'
  | 'PROMO_MIN_SUBTOTAL'
  | 'PROMO_CUSTOMER_LIMIT'
  | 'PROMO_USAGE_LIMIT'
  | 'PROMO_BUDGET_EXHAUSTED'
  | 'PROMO_NEW_CUSTOMERS_ONLY'
  | 'PROMO_NOTHING_TO_DISCOUNT'
  | 'PROMO_NOT_COMBINABLE'
  | 'PROMO_PRICE_PENDING';

export interface PromotionDecision {
  applied: AppliedPromotion[];
  itemsDiscountMinor: number;
  deliveryFeeDiscountMinor: number;
  /** The bearer of the delivery-fee discount (a mix is resolved to DRIVER only when every fee promotion says DRIVER). */
  deliveryFeeBearer: FeeBearer | null;
  /** The entered code's outcome (null when no code was entered or it is not a Hatly promotion). */
  code: { code: string; status: 'APPLIED' | 'REJECTED'; reason?: PromotionRejection; minSubtotalMinor?: number } | null;
}

const inScope = (p: PromotionRule, g: OrderContextGroup) =>
  p.scopeType === 'ALL' ||
  (p.scopeType === 'BRANCHES' && !!g.vendorBranchId && p.scopeIds.includes(g.vendorBranchId)) ||
  (p.scopeType === 'SECTORS' && !!g.sectorId && p.scopeIds.includes(g.sectorId));

/** Why this promotion cannot apply to this order (null = it can), and the discount it gives. */
export function evaluate(p: PromotionRule, ctx: PromotionContext): { reason: PromotionRejection } | { discountMinor: number } {
  if (!p.isActive) return { reason: 'PROMO_NOT_ACTIVE' };
  if (ctx.now < p.startsAt) return { reason: 'PROMO_NOT_STARTED' };
  if (ctx.now >= p.endsAt) return { reason: 'PROMO_EXPIRED' };
  if (p.totalUsesLimit != null && p.usesCount >= p.totalUsesLimit) return { reason: 'PROMO_USAGE_LIMIT' };
  const budgetLeft = p.budgetCapMinor == null ? Number.POSITIVE_INFINITY : p.budgetCapMinor - p.discountGivenMinor;
  if (budgetLeft <= 0) return { reason: 'PROMO_BUDGET_EXHAUSTED' };
  if (p.perCustomerLimit != null && (ctx.customerUses[p.id] ?? 0) >= p.perCustomerLimit) return { reason: 'PROMO_CUSTOMER_LIMIT' };
  if (p.newCustomersOnly && !ctx.isNewCustomer) return { reason: 'PROMO_NEW_CUSTOMERS_ONLY' };
  const groups = ctx.groups.filter((g) => inScope(p, g));
  if (groups.length === 0) return { reason: 'PROMO_NOT_IN_SCOPE' };
  if (groups.some((g) => g.subtotalMinor == null) && (p.target === 'ITEMS' || p.minSubtotalMinor != null)) return { reason: 'PROMO_PRICE_PENDING' };
  const scopedSubtotal = groups.reduce((s, g) => s + (g.subtotalMinor ?? 0), 0);
  if (p.minSubtotalMinor != null && scopedSubtotal < p.minSubtotalMinor) return { reason: 'PROMO_MIN_SUBTOTAL' };

  let base: number;
  if (p.target === 'ITEMS') base = scopedSubtotal;
  else {
    if (ctx.deliveryFeeMinor == null) return { reason: 'PROMO_NOTHING_TO_DISCOUNT' };
    base = ctx.deliveryFeeMinor;
  }
  let d: number;
  if (p.discountType === 'PERCENTAGE') d = Math.floor((base * Math.min(100, Math.max(0, p.discountValue))) / 100);
  else if (p.discountType === 'FIXED') d = p.discountValue;
  else d = p.target === 'DELIVERY_FEE' ? base - Math.max(0, p.discountValue) : 0; // FIXED_FEE: the fee becomes the set amount
  if (p.maxDiscountMinor != null) d = Math.min(d, p.maxDiscountMinor);
  d = Math.max(0, Math.min(d, base, budgetLeft));
  if (d <= 0) return { reason: 'PROMO_NOTHING_TO_DISCOUNT' };
  return { discountMinor: d };
}

/**
 * Decides the promotions of one order: every eligible AUTOMATIC campaign + the entered CODE (when it is a Hatly promotion).
 * Options: all stackable candidates together (only if there is no store discount on the order for a non-stackable… — stackable ones
 * combine with store discounts), or each non-stackable candidate alone (and only when the order has no store discount). The option with
 * the biggest total saving wins. Item discounts are capped at the order's items; fee discounts at the fee.
 */
export function decide(candidates: PromotionRule[], ctx: PromotionContext, enteredCode: string | null): PromotionDecision {
  const code = enteredCode?.trim().toUpperCase() || null;
  const codePromo = code ? candidates.find((p) => p.kind === 'CODE' && p.code?.toUpperCase() === code) ?? null : null;
  const pool = candidates.filter((p) => p.kind === 'AUTOMATIC' || (codePromo && p.id === codePromo.id));

  const eligible: Array<{ p: PromotionRule; d: number }> = [];
  let codeReason: PromotionRejection | undefined;
  for (const p of pool) {
    const r = evaluate(p, ctx);
    if ('reason' in r) {
      if (codePromo && p.id === codePromo.id) codeReason = r.reason;
      continue;
    }
    eligible.push({ p, d: r.discountMinor });
  }

  const totalItems = ctx.groups.reduce((s, g) => s + (g.subtotalMinor ?? 0), 0);
  const fee = ctx.deliveryFeeMinor ?? 0;
  const build = (set: Array<{ p: PromotionRule; d: number }>) => {
    let items = 0;
    let feeDisc = 0;
    const applied: AppliedPromotion[] = [];
    for (const { p, d } of [...set].sort((a, b) => b.d - a.d)) {
      const room = p.target === 'ITEMS' ? Math.max(0, totalItems - items) : Math.max(0, fee - feeDisc);
      const take = Math.min(d, room);
      if (take <= 0) continue;
      if (p.target === 'ITEMS') items += take;
      else feeDisc += take;
      applied.push({ promotionId: p.id, name: p.name, nameAr: p.nameAr, code: p.kind === 'CODE' ? p.code : null, target: p.target, discountMinor: take, feeBearer: p.target === 'DELIVERY_FEE' ? p.feeBearer : null, stackable: p.stackable });
    }
    return { applied, items, feeDisc };
  };

  const stackable = eligible.filter((e) => e.p.stackable);
  const options = [build(stackable)];
  if (ctx.existingStoreDiscountMinor === 0) for (const e of eligible.filter((x) => !x.p.stackable)) options.push(build([e]));
  const best = options.reduce((a, b) => (b.items + b.feeDisc > a.items + a.feeDisc ? b : a));

  let codeOutcome: PromotionDecision['code'] = null;
  if (code && codePromo) {
    if (best.applied.some((a) => a.promotionId === codePromo.id)) codeOutcome = { code, status: 'APPLIED' };
    else if (codeReason) codeOutcome = { code, status: 'REJECTED', reason: codeReason, ...(codeReason === 'PROMO_MIN_SUBTOTAL' ? { minSubtotalMinor: codePromo.minSubtotalMinor ?? undefined } : {}) };
    else codeOutcome = { code, status: 'REJECTED', reason: 'PROMO_NOT_COMBINABLE' };
  }
  const feeApplied = best.applied.filter((a) => a.target === 'DELIVERY_FEE');
  return {
    applied: best.applied,
    itemsDiscountMinor: best.items,
    deliveryFeeDiscountMinor: best.feeDisc,
    deliveryFeeBearer: feeApplied.length === 0 ? null : feeApplied.every((a) => a.feeBearer === 'DRIVER') ? 'DRIVER' : 'HATLY',
    code: codeOutcome,
  };
}

import { decide, evaluate, PromotionContext, PromotionRule } from './promotion-engine';

const now = new Date('2026-12-01T12:00:00Z');
const rule = (over: Partial<PromotionRule> = {}): PromotionRule => ({
  id: 'p1', name: 'P', nameAr: null, kind: 'CODE', code: 'SAVE10', target: 'ITEMS', discountType: 'PERCENTAGE', discountValue: 10,
  maxDiscountMinor: null, minSubtotalMinor: null, scopeType: 'ALL', scopeIds: [], startsAt: new Date('2026-11-01'), endsAt: new Date('2027-01-01'),
  isActive: true, perCustomerLimit: null, totalUsesLimit: null, budgetCapMinor: null, newCustomersOnly: false, stackable: true, feeBearer: 'HATLY',
  usesCount: 0, discountGivenMinor: 0, ...over,
});
const ctx = (over: Partial<PromotionContext> = {}): PromotionContext => ({
  now, groups: [{ vendorBranchId: 'b1', sectorId: 's1', subtotalMinor: 20000 }], deliveryFeeMinor: 1500, existingStoreDiscountMinor: 0,
  isNewCustomer: false, customerUses: {}, ...over,
});

describe('promotion engine', () => {
  it('percentage, fixed, cap, minimum spend', () => {
    expect(evaluate(rule(), ctx())).toEqual({ discountMinor: 2000 });
    expect(evaluate(rule({ maxDiscountMinor: 1500 }), ctx())).toEqual({ discountMinor: 1500 });
    expect(evaluate(rule({ discountType: 'FIXED', discountValue: 5000 }), ctx())).toEqual({ discountMinor: 5000 });
    expect(evaluate(rule({ minSubtotalMinor: 25000 }), ctx())).toEqual({ reason: 'PROMO_MIN_SUBTOTAL' });
  });

  it('dates, active flag, usage, budget, per-customer, new customers', () => {
    expect(evaluate(rule({ isActive: false }), ctx())).toEqual({ reason: 'PROMO_NOT_ACTIVE' });
    expect(evaluate(rule({ endsAt: new Date('2026-11-30') }), ctx())).toEqual({ reason: 'PROMO_EXPIRED' });
    expect(evaluate(rule({ startsAt: new Date('2026-12-02') }), ctx())).toEqual({ reason: 'PROMO_NOT_STARTED' });
    expect(evaluate(rule({ totalUsesLimit: 3, usesCount: 3 }), ctx())).toEqual({ reason: 'PROMO_USAGE_LIMIT' });
    expect(evaluate(rule({ budgetCapMinor: 10000, discountGivenMinor: 10000 }), ctx())).toEqual({ reason: 'PROMO_BUDGET_EXHAUSTED' });
    expect(evaluate(rule({ budgetCapMinor: 10000, discountGivenMinor: 9500 }), ctx())).toEqual({ discountMinor: 500 }); // never above the budget left
    expect(evaluate(rule({ perCustomerLimit: 1 }), ctx({ customerUses: { p1: 1 } }))).toEqual({ reason: 'PROMO_CUSTOMER_LIMIT' });
    expect(evaluate(rule({ newCustomersOnly: true }), ctx())).toEqual({ reason: 'PROMO_NEW_CUSTOMERS_ONLY' });
    expect(evaluate(rule({ newCustomersOnly: true }), ctx({ isNewCustomer: true }))).toEqual({ discountMinor: 2000 });
  });

  it('scope: branches / sectors; only the in-scope part is discounted', () => {
    const two = ctx({ groups: [{ vendorBranchId: 'b1', sectorId: 's1', subtotalMinor: 20000 }, { vendorBranchId: 'b2', sectorId: 's2', subtotalMinor: 10000 }] });
    expect(evaluate(rule({ scopeType: 'BRANCHES', scopeIds: ['b2'] }), two)).toEqual({ discountMinor: 1000 });
    expect(evaluate(rule({ scopeType: 'SECTORS', scopeIds: ['s9'] }), two)).toEqual({ reason: 'PROMO_NOT_IN_SCOPE' });
  });

  it('delivery fee: % off, fixed off, set fee; pending item prices block item promotions only', () => {
    const fee = (o: Partial<PromotionRule>) => rule({ target: 'DELIVERY_FEE', ...o });
    expect(evaluate(fee({ discountValue: 50 }), ctx())).toEqual({ discountMinor: 750 });
    expect(evaluate(fee({ discountType: 'FIXED', discountValue: 5000 }), ctx())).toEqual({ discountMinor: 1500 }); // never below 0
    expect(evaluate(fee({ discountType: 'FIXED_FEE', discountValue: 1000 }), ctx())).toEqual({ discountMinor: 500 });
    expect(evaluate(fee({ discountType: 'FIXED_FEE', discountValue: 2000 }), ctx())).toEqual({ reason: 'PROMO_NOTHING_TO_DISCOUNT' });
    const pending = ctx({ groups: [{ vendorBranchId: null, sectorId: null, subtotalMinor: null }] });
    expect(evaluate(fee({ discountValue: 100 }), pending)).toEqual({ discountMinor: 1500 });
    expect(evaluate(rule(), pending)).toEqual({ reason: 'PROMO_PRICE_PENDING' });
    expect(evaluate(fee({}), ctx({ deliveryFeeMinor: null }))).toEqual({ reason: 'PROMO_NOTHING_TO_DISCOUNT' });
  });

  it('stacking: stackable ones combine; a non-stackable applies alone and only if better; never with a store discount', () => {
    const campaign = rule({ id: 'c', kind: 'AUTOMATIC', code: null, target: 'DELIVERY_FEE', discountType: 'FIXED_FEE', discountValue: 0, stackable: true, feeBearer: 'DRIVER' });
    const code = rule({ id: 'k', stackable: true });
    let d = decide([campaign, code], ctx(), 'save10');
    expect(d.itemsDiscountMinor).toBe(2000);
    expect(d.deliveryFeeDiscountMinor).toBe(1500);
    expect(d.deliveryFeeBearer).toBe('DRIVER');
    expect(d.code).toEqual({ code: 'SAVE10', status: 'APPLIED' });

    const lonely = rule({ id: 'k', stackable: false, discountValue: 5 }); // 1000 alone < 1500 + 0 of the campaign
    d = decide([campaign, lonely], ctx(), 'SAVE10');
    expect(d.applied.map((a) => a.promotionId)).toEqual(['c']);
    expect(d.code).toEqual({ code: 'SAVE10', status: 'REJECTED', reason: 'PROMO_NOT_COMBINABLE' });

    const big = rule({ id: 'k', stackable: false, discountValue: 50 }); // 10000 alone beats the campaign
    d = decide([campaign, big], ctx(), 'SAVE10');
    expect(d.applied.map((a) => a.promotionId)).toEqual(['k']);
    expect(d.deliveryFeeDiscountMinor).toBe(0);

    d = decide([big], ctx({ existingStoreDiscountMinor: 500 }), 'SAVE10'); // a store offer is already on the order
    expect(d.code?.reason).toBe('PROMO_NOT_COMBINABLE');
    expect(d.itemsDiscountMinor).toBe(0);
  });

  it('a code that does not apply says why; items never go below zero with store discounts', () => {
    const d = decide([rule({ minSubtotalMinor: 50000 })], ctx(), 'save10');
    expect(d.code).toEqual({ code: 'SAVE10', status: 'REJECTED', reason: 'PROMO_MIN_SUBTOTAL', minSubtotalMinor: 50000 });
    const capped = decide([rule({ discountType: 'FIXED', discountValue: 19000 })], ctx({ existingStoreDiscountMinor: 5000, groups: [{ vendorBranchId: 'b1', sectorId: 's1', subtotalMinor: 15000 }] }), 'SAVE10');
    expect(capped.itemsDiscountMinor).toBe(15000);
    expect(decide([], ctx(), 'nope').code).toBeNull(); // not a Hatly promotion: the store-coupon path handles it
  });
});

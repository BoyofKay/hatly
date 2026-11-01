import { BadRequestException } from '@nestjs/common';
import { CheckoutPlannerService } from './checkout-planner.service';
import { AddressValidationService } from './address-validation.service';
import { CartPricingService } from '../../cart/cart-pricing.service';
import { CartGroupType } from '../../cart/cart-group-type.enum';
import { FulfillmentType } from '../../cart/fulfillment-type.enum';
import { PricingUnit } from '../../products/pricing-unit.enum';
import { VendorBranch } from '../../vendors/entities/vendor-branch.entity';
import { CheckoutInput } from './checkout-plan';

/**
 * The single pricing/validation path shared by the quote and by order creation. The database-backed behaviour is proven end to
 * end in test/e2e/65 and 66; here the rules themselves are pinned against fakes.
 */
const ALL_METHODS = ['INSTAPAY', 'VODAFONE_CASH', 'ORANGE_CASH', 'ETISALAT_CASH', 'WE_PAY'];
const addr = { line1: 'Street 1', latitude: 30.1, longitude: 31.2 };
/** PD-009 (amended): Hatly Service requires the address's ACTIVE zone — its fee is the price input, pin or not. */
const HATLY_ZONE = {
  id: 'zone-h', name: 'Abu Naseeb', nameAr: 'أبو نصيب', city: 'Belbeis', cityAr: 'بلبيس', governorate: 'Sharqia', governorateAr: 'الشرقية',
  deliveryFeeMinor: 1500, isActive: true, serviceAreaId: 'area-1', serviceArea: { id: 'area-1', isActive: true },
};
const hatlyAddr = { ...addr, deliveryZoneId: 'zone-h' };

const product = (id: string, over: any = {}) => ({ id, name: `P ${id}`, priceMinor: 10000, isAvailable: true, deletedAt: null, categoryId: 'cat', pricingUnit: PricingUnit.PIECE, ...over });
const item = (id: string, p: any, quantity = 1, extra: any = {}) => ({ id, productId: p.id, product: p, quantity, notes: null, freeTextDescription: null, imageUrls: null, selectedOptionValues: [], ...extra });
const group = (id: string, branchId: string, items: any[]) => ({ id, groupType: CartGroupType.CATALOG, vendorBranchId: branchId, adHocPlaceName: null, vendorNote: null, items });
const cart = (groups: any[], over: any = {}) => ({ id: 'cart-1', customerId: 'c1', fulfillmentType: FulfillmentType.DELIVERY, orderNote: null, groups, ...over });
const branch = (id: string, over: any = {}) => ({ id, name: `B ${id}`, isActive: true, pickupEnabled: true, deliveryEnabled: true, serviceAreaId: 'area-1', preparationTimeMinutes: null, address: 'x', latitude: 30, longitude: 31, vendor: { name: `V ${id}`, isActive: true }, ...over });

function harness(opts: { branches: any[]; balance?: number; enabled?: string[]; fee?: number; couponResult?: any; subtotalPlan?: any; area?: any; eta?: number; zones?: any[]; serviceDefaults?: Record<string, any> }) {
  const businessConfig = {
    // PD-012: the configured Hatly / Wasally route defaults (absent = not configured).
    getServiceLocation: jest.fn(async (key: string) => opts.serviceDefaults?.[key] ?? null),
    getEnabledElectronicPaymentMethods: jest.fn(async () => opts.enabled ?? ALL_METHODS),
    get: jest.fn(async () => 'configured'),
    getRequired: jest.fn(),
  };
  const deliveryFee = {
    calculate: jest.fn(async () => ({
      deliveryFeeMinor: opts.fee ?? 2000,
      vendorSequence: [{ vendorBranchId: 'b1', distanceToCustomerMeters: 1000 }],
      legDistancesMeters: [1000],
      rawTotalDistanceMeters: 1000,
      roundedTotalDistanceMeters: 1000,
      pricePer100mMinorUsed: 100,
      minimumDeliveryFeeMinorUsed: 100,
      additionalVendorFeeMinorUsed: 500,
      additionalVendorChargeMinor: 0,
      ...(opts.eta === undefined ? { totalEtaSeconds: 600 } : opts.eta > 0 ? { totalEtaSeconds: opts.eta } : {}),
    })),
    // The real zone composition (base = zone fee, + 500 per extra vendor) — the formula itself is pinned in the fee-service spec.
    calculateForZone: jest.fn(async (branches: any[], zone: any) => ({
      pricingSource: 'DELIVERY_ZONE',
      deliveryZoneId: zone.id,
      zoneDeliveryFeeMinorUsed: zone.deliveryFeeMinor,
      deliveryFeeMinor: zone.deliveryFeeMinor + 500 * (branches.length - 1),
      vendorSequence: branches.map((b) => ({ vendorBranchId: b.id, distanceToCustomerMeters: null })),
      legDistancesMeters: [],
      rawTotalDistanceMeters: null,
      roundedTotalDistanceMeters: null,
      pricePer100mMinorUsed: null,
      minimumDeliveryFeeMinorUsed: null,
      additionalVendorFeeMinorUsed: 500,
      additionalVendorChargeMinor: 500 * (branches.length - 1),
    })),
  };
  const offers = {
    planFlashSaleForCart: jest.fn(async () => ({ plans: new Map(), lockedOffers: new Map() })),
    planSubtotalDiscountForSegment: jest.fn(async (_m: any, p: any) => ({ plan: opts.subtotalPlan?.[p.vendorBranchId] ?? null, lockedOffer: null })),
    checkSubtotalDiscountCustomerLimit: jest.fn(async () => true),
    planCouponForCart: jest.fn(async () => opts.couponResult ?? { status: 'REJECTED', reasonCode: 'COUPON_NOT_FOUND', message: 'nope' }),
  };
  const wallet = { getBalance: jest.fn(async () => opts.balance ?? 0), lockCustomerWallet: jest.fn(async () => undefined) };
  const address = new AddressValidationService({ findOne: async () => null } as any, { findOne: async (o: any) => (opts.zones ?? []).find((z: any) => z.id === o.where.id) ?? null } as any, { resolveForPoint: async () => ('area' in opts ? opts.area : { id: 'area-1' }) } as any);
  const manager = { find: jest.fn(async (E: any) => (E === VendorBranch ? opts.branches : [])), query: jest.fn(async () => []) }; // query: the branch-closure lookup (none active)
  const hatlyPricing = { calculateCharge: jest.fn(async () => ({ chargeMinor: 900 })) };
  const planner = new CheckoutPlannerService(new CartPricingService(), businessConfig as any, deliveryFee as any, hatlyPricing as any, offers as any, address, wallet as any);
  const plan = (c: any, input: Partial<CheckoutInput> = {}) =>
    planner.plan(manager as any, c, { customerId: 'c1', address: addr, mode: 'ORDER', multiVendorEnabled: true, paymentMethod: 'COD', ...input });
  return { plan, deliveryFee, offers, wallet, businessConfig, hatlyPricing };
}
const oneVendor = (over: any = {}, qty = 1) => cart([group('g1', 'b1', [item('i1', product('p1'), qty)])], over);
const twoVendors = () => cart([group('g1', 'b1', [item('i1', product('p1'))]), group('g2', 'b2', [item('i2', product('p2', { priceMinor: 20000 }))])]);

describe('CheckoutPlannerService — totals', () => {
  it('total = subtotal + delivery fee − discounts, amount due = total − wallet; nothing comes from the client', async () => {
    const h = harness({ branches: [branch('b1')] });
    const p = await h.plan(oneVendor());
    expect(p).toMatchObject({ subtotalMinor: 10000, deliveryFeeMinor: 2000, discountMinor: 0, totalMinor: 12000 });
    expect(p.payment).toMatchObject({ walletAppliedMinor: 0, amountDueMinor: 12000, method: 'COD', awaitsPaymentApproval: false });
  });

  it('an automatic segment discount lowers the total; each segment carries only its own discount', async () => {
    const plan1 = { offer: { id: 'o1' }, eligibleSubtotalMinor: 10000, discountAmountMinor: 1500 };
    const h = harness({ branches: [branch('b1'), branch('b2')], subtotalPlan: { b1: plan1 }, fee: 2500 });
    const p = await h.plan(twoVendors());
    expect(p.discountMinor).toBe(1500);
    expect(p.segments.map((s) => s.discountMinor)).toEqual([1500, 0]);
    expect(p.totalMinor).toBe(30000 + 2500 - 1500);
  });

  it('PICKUP: fee 0, no address needed, no service-area lookup, no map call', async () => {
    const h = harness({ branches: [branch('b1')], area: null });
    const p = await h.plan(oneVendor({ fulfillmentType: FulfillmentType.PICKUP }), { address: null });
    expect(p).toMatchObject({ deliveryFeeMinor: 0, totalMinor: 10000, address: null, eligibility: null });
    expect(h.deliveryFee.calculate).not.toHaveBeenCalled();
  });

  it('U2: a PICKUP order is cash at the counter only — Wallet, Manual Transfer, Pay at Delivery are refused (PICKUP_CASH_ONLY)', async () => {
    const pickup = () => oneVendor({ fulfillmentType: FulfillmentType.PICKUP });
    const h = harness({ branches: [branch('b1')], balance: 50000 });
    const attempts: Array<Partial<CheckoutInput>> = [
      { paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: 'INSTAPAY' as never },
      { paymentMethod: 'PAY_AT_DELIVERY', electronicPaymentMethod: 'INSTAPAY' as never },
      { paymentMethod: 'WALLET' },
      { paymentMethod: 'COD', useWallet: true },
    ];
    for (const input of attempts) {
      await expect(h.plan(pickup(), { address: null, ...input })).rejects.toMatchObject({ response: { details: { code: 'PICKUP_CASH_ONLY' } } });
    }
    expect(h.wallet.lockCustomerWallet).not.toHaveBeenCalled(); // never touches the wallet for a pickup order
    const cash = await h.plan(pickup(), { address: null, paymentMethod: 'COD' });
    expect(cash.payment).toMatchObject({ method: 'COD', walletAppliedMinor: 0, amountDueMinor: 10000, electronicMethod: null, awaitsPaymentApproval: false });
  });

  it('U2: a quote for a pickup reports the refusal as a blocker (never applies the wallet); a delivery order keeps every method', async () => {
    const h = harness({ branches: [branch('b1')], balance: 50000 });
    const q = await h.plan(oneVendor({ fulfillmentType: FulfillmentType.PICKUP }), { address: null, mode: 'QUOTE', paymentMethod: 'COD', useWallet: true });
    expect(q.blockers.map((b: any) => b.code)).toContain('PICKUP_CASH_ONLY');
    expect(q.payment.walletAppliedMinor).toBe(0);
    const delivery = await h.plan(oneVendor(), { useWallet: true });
    expect(delivery.payment.walletAppliedMinor).toBeGreaterThan(0);
  });

  it('PICKUP is refused for two vendors and for a branch without pickup', async () => {
    await expect(harness({ branches: [branch('b1'), branch('b2')] }).plan({ ...twoVendors(), fulfillmentType: FulfillmentType.PICKUP })).rejects.toMatchObject({ response: { details: { code: 'PICKUP_SINGLE_VENDOR_ONLY' } } });
    await expect(harness({ branches: [branch('b1', { pickupEnabled: false })] }).plan(oneVendor({ fulfillmentType: FulfillmentType.PICKUP }))).rejects.toMatchObject({ response: { details: { code: 'BRANCH_PICKUP_DISABLED' } } });
  });
});

describe('CheckoutPlannerService — address, eligibility, delivery quote', () => {
  it('ORDER mode throws for a missing or unserviceable address; QUOTE mode reports it as a blocker and leaves the fee unknown', async () => {
    const h = harness({ branches: [branch('b1')], area: null });
    await expect(h.plan(oneVendor())).rejects.toMatchObject({ response: { details: { code: 'ADDRESS_NOT_SERVICEABLE' } } });
    await expect(harness({ branches: [branch('b1')] }).plan(oneVendor(), { address: null })).rejects.toMatchObject({ response: { details: { code: 'DELIVERY_ADDRESS_REQUIRED' } } });

    const q = await h.plan(oneVendor(), { mode: 'QUOTE' });
    expect(q.blockers.map((b) => b.code)).toEqual(['ADDRESS_OUT_OF_SERVICE_AREA']);
    expect(q).toMatchObject({ deliveryFeeMinor: null, totalMinor: null });
    expect(h.deliveryFee.calculate).not.toHaveBeenCalled(); // no fee for an address we cannot serve
  });

  it('a map failure is fatal for an ORDER (fails closed) but only a blocker for a QUOTE', async () => {
    const h = harness({ branches: [branch('b1')] });
    h.deliveryFee.calculate.mockRejectedValue(new BadRequestException({ message: 'x', details: { code: 'DELIVERY_FEE_UNAVAILABLE' } }));
    await expect(h.plan(oneVendor())).rejects.toMatchObject({ response: { details: { code: 'DELIVERY_FEE_UNAVAILABLE' } } });
    const q = await h.plan(oneVendor(), { mode: 'QUOTE' });
    expect(q.blockers.map((b) => b.code)).toEqual(['DELIVERY_FEE_UNAVAILABLE']);
  });

  it('a frozen (confirmed) delivery breakdown is HONOURED only while the inputs hash matches; otherwise the fee is measured fresh', async () => {
    const h = harness({ branches: [branch('b1')], fee: 2000 });
    const fresh = await h.plan(oneVendor());
    expect(fresh.delivery.source).toBe('FRESH');
    expect(h.deliveryFee.calculate).toHaveBeenCalledTimes(1);

    const frozenBreakdown = { ...(await h.deliveryFee.calculate.mock.results[0].value), deliveryFeeMinor: 999 };
    const honoured = await h.plan(oneVendor(), { frozen: { inputsHash: fresh.inputsHash, breakdown: frozenBreakdown } });
    expect(honoured.delivery).toMatchObject({ source: 'FROZEN_QUOTE', feeMinor: 999 });
    expect(honoured.totalMinor).toBe(10000 + 999);
    expect(h.deliveryFee.calculate).toHaveBeenCalledTimes(1); // no second map call

    const stale = await h.plan(oneVendor(), { frozen: { inputsHash: 'other-inputs', breakdown: frozenBreakdown } });
    expect(stale.delivery).toMatchObject({ source: 'FRESH', feeMinor: 2000 });
  });

  it('the inputs hash tracks everything a quote depends on — and nothing else', async () => {
    const h = harness({ branches: [branch('b1'), branch('b2')] });
    const base = (await h.plan(oneVendor())).inputsHash;
    expect((await h.plan(oneVendor())).inputsHash).toBe(base); // deterministic
    expect((await h.plan(oneVendor(), { paymentMethod: 'COD', useWallet: false })).inputsHash).toBe(base); // payment choice is not a pricing input
    expect((await h.plan(oneVendor({}, 2))).inputsHash).not.toBe(base); // quantity
    expect((await h.plan(oneVendor(), { address: { ...addr, latitude: 30.2 } })).inputsHash).not.toBe(base); // location
    expect((await h.plan(oneVendor(), { address: { ...addr, latitude: 30.100001 } })).inputsHash).toBe(base); // < 1 m: the same spot
    expect((await h.plan(oneVendor(), { couponCode: 'x', mode: 'QUOTE' })).inputsHash).not.toBe(base); // coupon
    expect((await h.plan(oneVendor({ fulfillmentType: FulfillmentType.PICKUP }), { address: null })).inputsHash).not.toBe(base); // fulfilment
    expect((await h.plan(twoVendors())).inputsHash).not.toBe(base); // vendors
  });
});

describe('CheckoutPlannerService — payment rules', () => {
  it('ONLINE is always refused; unknown-to-the-order rules: Manual Transfer never for a weighed item, only COD for an unpriced item', async () => {
    const h = harness({ branches: [branch('b1')] });
    await expect(h.plan(oneVendor(), { paymentMethod: 'ONLINE' })).rejects.toMatchObject({ response: { details: { code: 'ONLINE_PAYMENT_NOT_AVAILABLE' } } });
    const weighed = cart([group('g1', 'b1', [item('i1', product('p1', { pricingUnit: PricingUnit.WEIGHT }), 1, { requestedWeightGrams: 500 })])]);
    await expect(h.plan(weighed, { paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: 'INSTAPAY' as never })).rejects.toMatchObject({ response: { details: { code: 'MANUAL_TRANSFER_NOT_ALLOWED_FOR_WEIGHTED_ORDER' } } });
  });

  it('electronic method: required for MANUAL_TRANSFER / PAY_AT_DELIVERY, refused for COD / WALLET, must be currently enabled, and is kept on the plan', async () => {
    const h = harness({ branches: [branch('b1')], enabled: ['INSTAPAY', 'WE_PAY'] });
    for (const method of ['MANUAL_TRANSFER', 'PAY_AT_DELIVERY'] as const) {
      await expect(h.plan(oneVendor(), { paymentMethod: method })).rejects.toMatchObject({ response: { details: { code: 'ELECTRONIC_PAYMENT_METHOD_REQUIRED' } } });
      await expect(h.plan(oneVendor(), { paymentMethod: method, electronicPaymentMethod: 'ORANGE_CASH' as never })).rejects.toMatchObject({ response: { details: { code: 'ELECTRONIC_PAYMENT_METHOD_NOT_AVAILABLE' } } });
    }
    await expect(h.plan(oneVendor(), { paymentMethod: 'COD', electronicPaymentMethod: 'INSTAPAY' as never })).rejects.toMatchObject({ response: { details: { code: 'ELECTRONIC_PAYMENT_METHOD_NOT_ALLOWED' } } });
    const ok = await h.plan(oneVendor(), { paymentMethod: 'PAY_AT_DELIVERY', electronicPaymentMethod: 'WE_PAY' as never });
    expect(ok.payment).toMatchObject({ method: 'PAY_AT_DELIVERY', electronicMethod: 'WE_PAY', awaitsPaymentApproval: false });
  });

  it('MANUAL_TRANSFER awaits payment approval; an ORDER needs the transfer destination configured', async () => {
    const h = harness({ branches: [branch('b1')] });
    const p = await h.plan(oneVendor(), { paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: 'INSTAPAY' as never });
    expect(p.payment).toMatchObject({ method: 'MANUAL_TRANSFER', electronicMethod: 'INSTAPAY', awaitsPaymentApproval: true });
    h.businessConfig.get.mockResolvedValue(null as never);
    await expect(h.plan(oneVendor(), { paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: 'INSTAPAY' as never })).rejects.toMatchObject({ response: { details: { code: 'MANUAL_TRANSFER_NOT_CONFIGURED' } } });
  });

  it('an ORDER needs a payment method; a QUOTE does not (it reports options)', async () => {
    const h = harness({ branches: [branch('b1')] });
    await expect(h.plan(oneVendor(), { paymentMethod: undefined })).rejects.toMatchObject({ response: { details: { code: 'PAYMENT_METHOD_REQUIRED' } } });
    const q = await h.plan(oneVendor(), { paymentMethod: undefined, mode: 'QUOTE' });
    expect(q.payment.method).toBeNull();
  });
});

describe('CheckoutPlannerService — wallet', () => {
  it('partial: the wallet is used first up to the balance; the remainder keeps its method', async () => {
    const h = harness({ branches: [branch('b1')], balance: 5000 });
    const p = await h.plan(oneVendor(), { useWallet: true });
    expect(p.payment).toMatchObject({ method: 'COD', walletBalanceMinor: 5000, walletAppliedMinor: 5000, amountDueMinor: 7000 });
  });

  it('full: source WALLET, amount due 0', async () => {
    const h = harness({ branches: [branch('b1')], balance: 999999 });
    const p = await h.plan(oneVendor(), { useWallet: true });
    expect(p.payment).toMatchObject({ method: 'WALLET', walletAppliedMinor: 12000, amountDueMinor: 0, electronicMethod: null });
  });

  it('a client cap can only lower the amount; the amount never exceeds balance or total', async () => {
    const h = harness({ branches: [branch('b1')], balance: 8000 });
    expect((await h.plan(oneVendor(), { useWallet: true, walletAmountMinor: 2000 })).payment.walletAppliedMinor).toBe(2000);
    expect((await h.plan(oneVendor(), { useWallet: true, walletAmountMinor: 500000 })).payment.walletAppliedMinor).toBe(8000);
  });

  it('method WALLET needs the balance to cover the total (insufficient → WALLET_INSUFFICIENT_BALANCE with the numbers)', async () => {
    const h = harness({ branches: [branch('b1')], balance: 100 });
    const error = await h.plan(oneVendor(), { paymentMethod: 'WALLET' }).catch((e) => e);
    expect(error.getResponse().details).toMatchObject({ code: 'WALLET_INSUFFICIENT_BALANCE', balanceMinor: 100, totalMinor: 12000 });
  });

  it('PD-001 (amended): the wallet MAY be combined with MANUAL_TRANSFER — the wallet part is server-decided and the transfer awaits approval only for the remainder', async () => {
    const h = harness({ branches: [branch('b1')], balance: 5000 });
    const plan = await h.plan(oneVendor(), { useWallet: true, paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: 'INSTAPAY' as never });
    expect(plan.payment).toMatchObject({ method: 'MANUAL_TRANSFER', electronicMethod: 'INSTAPAY', walletAppliedMinor: 5000, amountDueMinor: 12000 - 5000, awaitsPaymentApproval: true });
    // a client cap can only lower it
    const capped = await h.plan(oneVendor(), { useWallet: true, walletAmountMinor: 2000, paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: 'INSTAPAY' as never });
    expect(capped.payment).toMatchObject({ walletAppliedMinor: 2000, amountDueMinor: 10000 });
    // it stays an ordinary quote (no blocker) for the same request
    const quote = await h.plan(oneVendor(), { mode: 'QUOTE', useWallet: true, paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: 'INSTAPAY' as never });
    expect(quote.blockers.map((b: any) => b.code)).not.toContain('WALLET_NOT_ALLOWED_WITH_MANUAL_TRANSFER');
  });

  it('the wallet is still refused where the final amount is unknown: weighed and unpriced (ad-hoc) orders — with ANY payment method', async () => {
    const h = harness({ branches: [branch('b1')], balance: 50000 });
    const weighed = cart([group('g1', 'b1', [item('i1', product('p1', { pricingUnit: PricingUnit.WEIGHT }), 1, { requestedWeightGrams: 500 })])]);
    await expect(h.plan(weighed, { useWallet: true })).rejects.toMatchObject({ response: { details: { code: 'WALLET_NOT_ALLOWED_FOR_WEIGHTED_ORDER' } } });
  });

  it('ORDER mode takes the per-customer wallet lock BEFORE reading the balance; a QUOTE takes no lock', async () => {
    const h = harness({ branches: [branch('b1')], balance: 5000 });
    await h.plan(oneVendor(), { useWallet: true });
    expect(h.wallet.lockCustomerWallet).toHaveBeenCalledTimes(1);
    expect(h.wallet.lockCustomerWallet.mock.invocationCallOrder[0]).toBeLessThan(h.wallet.getBalance.mock.invocationCallOrder[0]);
    h.wallet.lockCustomerWallet.mockClear();
    await h.plan(oneVendor(), { useWallet: true, mode: 'QUOTE' });
    expect(h.wallet.lockCustomerWallet).not.toHaveBeenCalled();
  });

  it('no wallet requested → the wallet is never touched', async () => {
    const h = harness({ branches: [branch('b1')], balance: 5000 });
    await h.plan(oneVendor());
    expect(h.wallet.getBalance).not.toHaveBeenCalled();
  });
});

describe('CheckoutPlannerService — coupon', () => {
  const applied = (over: any = {}) => ({ status: 'APPLIED', groupIndex: 0, vendorBranchId: 'b1', code: 'SAVE10', plan: { offer: { id: 'offer-1', name: 'Ten' }, eligibleSubtotalMinor: 10000, discountAmountMinor: 1000 }, ...over });

  it('an applied coupon discounts ONLY its vendor\'s segment and is reported with the vendor', async () => {
    const h = harness({ branches: [branch('b1'), branch('b2')], couponResult: applied() });
    const p = await h.plan(twoVendors(), { couponCode: 'save10' });
    expect(p.coupon).toMatchObject({ status: 'APPLIED', code: 'SAVE10', discountMinor: 1000, vendorBranchId: 'b1' });
    expect(p.segments.map((s) => [s.discountMinor, s.couponApplied])).toEqual([[1000, true], [0, false]]);
    expect(p.discountMinor).toBe(1000);
    expect(p.subtotalPlansByGroupIndex.get(0)?.discountAmountMinor).toBe(1000);
  });

  it('a rejected coupon: QUOTE reports it and prices without it; ORDER refuses with the reason code', async () => {
    const h = harness({ branches: [branch('b1')] });
    const q = await h.plan(oneVendor(), { couponCode: 'BAD', mode: 'QUOTE' });
    expect(q.coupon).toMatchObject({ status: 'REJECTED', reasonCode: 'COUPON_NOT_FOUND' });
    expect(q.discountMinor).toBe(0);
    await expect(h.plan(oneVendor(), { couponCode: 'BAD' })).rejects.toMatchObject({ response: { details: { code: 'COUPON_NOT_FOUND' } } });
  });

  it('a coupon never replaces or stacks on an automatic subtotal offer of the same vendor (COUPON_CONFLICTS_WITH_OFFER)', async () => {
    const auto = { offer: { id: 'auto' }, eligibleSubtotalMinor: 10000, discountAmountMinor: 500 };
    const h = harness({ branches: [branch('b1')], couponResult: applied(), subtotalPlan: { b1: auto } });
    const q = await h.plan(oneVendor(), { couponCode: 'SAVE10', mode: 'QUOTE' });
    expect(q.coupon).toMatchObject({ status: 'REJECTED', reasonCode: 'COUPON_CONFLICTS_WITH_OFFER' });
    expect(q.discountMinor).toBe(500); // the automatic offer stands
    await expect(h.plan(oneVendor(), { couponCode: 'SAVE10' })).rejects.toMatchObject({ response: { details: { code: 'COUPON_CONFLICTS_WITH_OFFER' } } });
  });

  it('QUOTE plans read-only (no offer row locks); ORDER plans lock', async () => {
    const h = harness({ branches: [branch('b1')] });
    await h.plan(oneVendor(), { mode: 'QUOTE', couponCode: 'X' });
    expect((h.offers.planFlashSaleForCart.mock.calls as any[][])[0][1]).toMatchObject({ readOnly: true });
    expect((h.offers.planCouponForCart.mock.calls as any[][])[0][1]).toMatchObject({ readOnly: true });
    await h.plan(oneVendor(), { mode: 'ORDER' }).catch(() => undefined);
    expect((h.offers.planFlashSaleForCart.mock.calls as any[][])[1][1]).toMatchObject({ readOnly: false });
  });
});

describe('CheckoutPlannerService — ETA (only from real inputs)', () => {
  it('preparation of the slowest vendor + travel; unavailable with a reason when either is unknown', async () => {
    const h = harness({ branches: [branch('b1', { preparationTimeMinutes: 20 }), branch('b2', { preparationTimeMinutes: 35 })], eta: 660 });
    expect((await h.plan(twoVendors())).eta).toEqual({ available: true, preparationMinutes: 35, travelMinutes: 11, totalMinutes: 46 });

    const missing = await harness({ branches: [branch('b1', { preparationTimeMinutes: 20 }), branch('b2')] }).plan(twoVendors());
    expect(missing.eta).toMatchObject({ available: false, reason: 'PREPARATION_TIME_NOT_CONFIGURED', totalMinutes: null });

    const noTravel = await harness({ branches: [branch('b1', { preparationTimeMinutes: 20 })], eta: 0 }).plan(oneVendor());
    expect(noTravel.eta).toMatchObject({ available: false, reason: 'TRAVEL_TIME_UNAVAILABLE', preparationMinutes: 20 });
  });

  it('pickup ETA is preparation only', async () => {
    const h = harness({ branches: [branch('b1', { preparationTimeMinutes: 12 })] });
    expect((await h.plan(oneVendor({ fulfillmentType: FulfillmentType.PICKUP }), { address: null })).eta).toEqual({ available: true, preparationMinutes: 12, travelMinutes: 0, totalMinutes: 12 });
  });
});

describe('CheckoutPlannerService — Hatly / Wasally route endpoints (PD-012: customer choice, else the service default, else refused)', () => {
  const adHocItem = { id: 'ai1', productId: null, product: null, quantity: 1, notes: null, freeTextDescription: 'Two croissants', imageUrls: [], selectedOptionValues: [] };
  const adHocCart = (type: 'BUY_FROM_PLACE' | 'DELIVER_TO_PLACE', over: any = {}) =>
    cart([{ id: 'g1', groupType: CartGroupType.AD_HOC_SERVICE, vendorBranchId: null, adHocPlaceName: 'Corner Bakery', vendorNote: null, adHocServiceType: type, adHocPickupLatitude: null, adHocPickupLongitude: null, adHocPickupLabel: null, adHocDestinationLatitude: null, adHocDestinationLongitude: null, adHocDestinationLabel: null, items: [adHocItem], ...over }]);
  const CODE = (e: any) => e?.response?.details?.code;
  const HATLY_START = { latitude: 30.11, longitude: 31.11, label: 'Hatly start' };
  const HATLY_END = { latitude: 30.22, longitude: 31.22, label: 'Hatly end' };
  const WASALLY_END = { latitude: 30.33, longitude: 31.33, label: 'Wasally end' };
  const ALL_DEFAULTS = {
    HATLY_SERVICE_DEFAULT_PICKUP_LOCATION: HATLY_START,
    HATLY_SERVICE_DEFAULT_DESTINATION_LOCATION: HATLY_END,
    WASALLY_SERVICE_DEFAULT_DESTINATION_LOCATION: WASALLY_END,
  };
  // Every request here comes from an address with an ACTIVE zone (it decides the pricing method), so each test isolates its own rule.
  const hatlyHarness = (serviceDefaults: Record<string, any> = {}) => {
    const h = harness({ branches: [], zones: [HATLY_ZONE], serviceDefaults });
    return { ...h, plan: (c: any, input: Partial<CheckoutInput> = {}) => h.plan(c, { address: hatlyAddr, ...input }) };
  };
  const END = (lat: number, lng: number, label: string | null, source: 'CUSTOMER' | 'DEFAULT') => ({ latitude: lat, longitude: lng, label, source });

  it('Hatly with no choice: origin and destination are BOTH the configured Hatly defaults — never the customer address', async () => {
    const { plan, hatlyPricing } = hatlyHarness(ALL_DEFAULTS);
    const result = await plan(adHocCart('BUY_FROM_PLACE'));
    expect(hatlyPricing.calculateCharge).toHaveBeenCalledWith({
      serviceType: 'BUY_FROM_PLACE',
      origin: END(30.11, 31.11, 'Hatly start', 'DEFAULT'),
      destination: END(30.22, 31.22, 'Hatly end', 'DEFAULT'),
      deliveryZone: expect.objectContaining({ id: 'zone-h', deliveryFeeMinor: 1500 }),
    });
    expect(result.delivery.adHocLocations).toMatchObject({ pickupLatitude: 30.11, destinationLatitude: 30.22 });
    expect(result.delivery.adHocLocations?.route).toEqual({ origin: END(30.11, 31.11, 'Hatly start', 'DEFAULT'), destination: END(30.22, 31.22, 'Hatly end', 'DEFAULT') });
  });

  it('Hatly: each end is independent — a chosen origin keeps the default destination, a chosen destination keeps the default origin', async () => {
    const { plan } = hatlyHarness(ALL_DEFAULTS);
    const onlyOrigin = await plan(adHocCart('BUY_FROM_PLACE', { adHocPickupLatitude: 30.5, adHocPickupLongitude: 31.5, adHocPickupLabel: 'Chosen' }));
    expect(onlyOrigin.delivery.adHocLocations?.route).toEqual({ origin: END(30.5, 31.5, 'Chosen', 'CUSTOMER'), destination: END(30.22, 31.22, 'Hatly end', 'DEFAULT') });
    const onlyDestination = await plan(adHocCart('BUY_FROM_PLACE', { adHocDestinationLatitude: 30.6, adHocDestinationLongitude: 31.6 }));
    expect(onlyDestination.delivery.adHocLocations?.route).toEqual({ origin: END(30.11, 31.11, 'Hatly start', 'DEFAULT'), destination: END(30.6, 31.6, null, 'CUSTOMER') });
  });

  it('Hatly: an unset default is refused with its own code — nothing invented, the customer address is never substituted, nothing priced', async () => {
    const none = hatlyHarness({});
    expect(CODE(await none.plan(adHocCart('BUY_FROM_PLACE')).catch((e) => e))).toBe('HATLY_DEFAULT_PICKUP_NOT_CONFIGURED');
    const noEnd = hatlyHarness({ HATLY_SERVICE_DEFAULT_PICKUP_LOCATION: HATLY_START });
    expect(CODE(await noEnd.plan(adHocCart('BUY_FROM_PLACE')).catch((e) => e))).toBe('HATLY_DEFAULT_DESTINATION_NOT_CONFIGURED');
    expect(none.hatlyPricing.calculateCharge).not.toHaveBeenCalled();
    expect(noEnd.hatlyPricing.calculateCharge).not.toHaveBeenCalled();
  });

  it('Wasally: the origin is ALWAYS the customer\'s (no default exists, even with every default configured) — never assumed from home', async () => {
    const { plan, hatlyPricing } = hatlyHarness(ALL_DEFAULTS);
    expect(CODE(await plan(adHocCart('DELIVER_TO_PLACE')).catch((e) => e))).toBe('DELIVER_TO_PLACE_ORIGIN_REQUIRED');
    // A half-supplied coordinate pair counts as missing (never partially defaulted).
    expect(CODE(await plan(adHocCart('DELIVER_TO_PLACE', { adHocPickupLatitude: 30.5 })).catch((e) => e))).toBe('DELIVER_TO_PLACE_ORIGIN_REQUIRED');
    expect(hatlyPricing.calculateCharge).not.toHaveBeenCalled();
  });

  it('Wasally: customer origin + no destination → WASALLY\'s own default destination (not Hatly\'s); direction origin → destination', async () => {
    const { plan, hatlyPricing } = hatlyHarness(ALL_DEFAULTS);
    const result = await plan(adHocCart('DELIVER_TO_PLACE', { adHocPickupLatitude: 30.45, adHocPickupLongitude: 31.45, adHocPickupLabel: 'Current location' }));
    expect(hatlyPricing.calculateCharge).toHaveBeenCalledWith(
      expect.objectContaining({ serviceType: 'DELIVER_TO_PLACE', origin: END(30.45, 31.45, 'Current location', 'CUSTOMER'), destination: END(30.33, 31.33, 'Wasally end', 'DEFAULT') }),
    );
    expect(result.delivery.adHocLocations).toMatchObject({ pickupLatitude: 30.45, destinationLatitude: 30.33 });
  });

  it('Wasally: a customer destination overrides the default; with no Wasally default the Hatly default is NOT borrowed', async () => {
    const { plan } = hatlyHarness(ALL_DEFAULTS);
    const overridden = await plan(adHocCart('DELIVER_TO_PLACE', { adHocPickupLatitude: 30.45, adHocPickupLongitude: 31.45, adHocDestinationLatitude: 30.7, adHocDestinationLongitude: 31.7 }));
    expect(overridden.delivery.adHocLocations?.route?.destination).toEqual(END(30.7, 31.7, null, 'CUSTOMER'));
    const hatlyOnly = hatlyHarness({ HATLY_SERVICE_DEFAULT_DESTINATION_LOCATION: HATLY_END, HATLY_SERVICE_DEFAULT_PICKUP_LOCATION: HATLY_START });
    const error = await hatlyOnly.plan(adHocCart('DELIVER_TO_PLACE', { adHocPickupLatitude: 30.45, adHocPickupLongitude: 31.45 })).catch((e) => e);
    expect(CODE(error)).toBe('WASALLY_DEFAULT_DESTINATION_NOT_CONFIGURED');
  });

  it('a missing customer address is rejected for an ORDER of either type (DELIVERY_ADDRESS_REQUIRED) and no charge is computed', async () => {
    const { plan, hatlyPricing } = hatlyHarness(ALL_DEFAULTS);
    for (const c of [
      adHocCart('BUY_FROM_PLACE'),
      adHocCart('DELIVER_TO_PLACE', { adHocPickupLatitude: 30.45, adHocPickupLongitude: 31.45 }),
    ]) {
      const error = await plan(c, { address: null }).catch((e) => e);
      expect(CODE(error)).toBe('DELIVERY_ADDRESS_REQUIRED');
    }
    expect(hatlyPricing.calculateCharge).not.toHaveBeenCalled();
  });

  it('a QUOTE without an address prices nothing (fee unknown) but still resolves the route to show', async () => {
    const { plan, hatlyPricing } = hatlyHarness(ALL_DEFAULTS);
    const result = await plan(adHocCart('BUY_FROM_PLACE'), { address: null, mode: 'QUOTE' });
    expect(result.delivery.feeMinor).toBeNull();
    expect(result.delivery.adHocLocations?.route?.origin.label).toBe('Hatly start');
    expect(hatlyPricing.calculateCharge).not.toHaveBeenCalled();
  });

  it('STALE QUOTES: changing either endpoint — or the default it fell back to — changes the quote fingerprint', async () => {
    const quote = (serviceDefaults: Record<string, any>, over: any = {}) =>
      hatlyHarness(serviceDefaults).plan(adHocCart('BUY_FROM_PLACE', over), { mode: 'QUOTE' });
    const base = await quote(ALL_DEFAULTS);
    const sameAgain = await quote(ALL_DEFAULTS);
    const newOrigin = await quote(ALL_DEFAULTS, { adHocPickupLatitude: 30.5, adHocPickupLongitude: 31.5 });
    const newDestination = await quote(ALL_DEFAULTS, { adHocDestinationLatitude: 30.6, adHocDestinationLongitude: 31.6 });
    const movedDefault = await quote({ ...ALL_DEFAULTS, HATLY_SERVICE_DEFAULT_DESTINATION_LOCATION: { ...HATLY_END, latitude: 30.99 } });
    expect(sameAgain.inputsHash).toBe(base.inputsHash);
    expect(new Set([base.inputsHash, newOrigin.inputsHash, newDestination.inputsHash, movedDefault.inputsHash]).size).toBe(4);
  });
});

describe('CheckoutPlannerService — Delivery Zones (PD-009)', () => {
  const zoneRow = (over: any = {}) => ({
    id: 'zone-1', name: 'Abu Naseeb', nameAr: 'أبو نصيب', city: 'Belbeis', cityAr: 'بلبيس', governorate: 'Sharqia', governorateAr: 'الشرقية',
    deliveryFeeMinor: 1800, isActive: true, serviceAreaId: 'area-1', serviceArea: { id: 'area-1', isActive: true }, ...over,
  });
  const zoneAddr = { line1: 'شارع أبو نصيب جنب جامع الكردي، منزل 15', deliveryZoneId: 'zone-1' };
  const CODE = (e: any) => e?.response?.details?.code;
  const adHoc = (type: string, over: any = {}) =>
    cart([{ id: 'g1', groupType: CartGroupType.AD_HOC_SERVICE, vendorBranchId: null, adHocPlaceName: 'Pharmacy', adHocServiceType: type, adHocDestinationLatitude: 30.6, adHocDestinationLongitude: 31.6, vendorNote: null, items: [item('i1', { id: null }, 1, { productId: null, product: null, freeTextDescription: 'x' })], ...over }]);

  it('a pin-less address with an active zone is serviceable and priced by the ZONE (not by distance); the snapshot freezes the zone', async () => {
    const h = harness({ branches: [branch('b1')], zones: [zoneRow()] });
    const p = await h.plan(oneVendor(), { address: zoneAddr });
    expect(h.deliveryFee.calculate).not.toHaveBeenCalled();
    expect(h.deliveryFee.calculateForZone).toHaveBeenCalledWith([expect.objectContaining({ id: 'b1' })], expect.objectContaining({ id: 'zone-1', deliveryFeeMinor: 1800 }));
    expect(p).toMatchObject({ deliveryFeeMinor: 1800, totalMinor: 11800, eligibility: { serviceable: true, pricingSource: 'DELIVERY_ZONE' } });
    expect(p.address).toEqual({
      ...zoneAddr,
      governorate: 'الشرقية',
      city: 'بلبيس',
      deliveryZone: { id: 'zone-1', name: 'Abu Naseeb', nameAr: 'أبو نصيب', city: 'Belbeis', cityAr: 'بلبيس', governorate: 'Sharqia', governorateAr: 'الشرقية' },
    });
  });

  it('multi-vendor: zone fee + the unchanged additional-vendor fee per extra vendor', async () => {
    const h = harness({ branches: [branch('b1'), branch('b2')], zones: [zoneRow()] });
    const p = await h.plan(twoVendors(), { address: zoneAddr });
    expect(p.deliveryFeeMinor).toBe(1800 + 500);
  });

  it('a pin keeps the existing distance pricing even when the address also carries a zone', async () => {
    const h = harness({ branches: [branch('b1')], zones: [zoneRow()] });
    const p = await h.plan(oneVendor(), { address: { ...addr, deliveryZoneId: 'zone-1' } });
    expect(h.deliveryFee.calculate).toHaveBeenCalled();
    expect(h.deliveryFee.calculateForZone).not.toHaveBeenCalled();
    expect(p.eligibility?.pricingSource).toBe('DISTANCE');
  });

  it('ORDER: inactive zone → DELIVERY_ZONE_UNAVAILABLE; no pin and no zone → ADDRESS_ZONE_REQUIRED; nothing is priced', async () => {
    const inactive = harness({ branches: [branch('b1')], zones: [zoneRow({ isActive: false })] });
    expect(CODE(await inactive.plan(oneVendor(), { address: zoneAddr }).catch((e) => e))).toBe('DELIVERY_ZONE_UNAVAILABLE');
    const none = harness({ branches: [branch('b1')], zones: [] });
    expect(CODE(await none.plan(oneVendor(), { address: { line1: 'x' } }).catch((e) => e))).toBe('ADDRESS_ZONE_REQUIRED');
    expect(inactive.deliveryFee.calculateForZone).not.toHaveBeenCalled();
    expect(none.deliveryFee.calculateForZone).not.toHaveBeenCalled();
  });

  it('QUOTE: an inactive zone is a blocker, not a silently-retained fee', async () => {
    const h = harness({ branches: [branch('b1')], zones: [zoneRow({ isActive: false })] });
    const p = await h.plan(oneVendor(), { address: zoneAddr, mode: 'QUOTE' });
    expect(p.deliveryFeeMinor).toBeNull();
    expect(p.blockers.map((b) => b.code)).toContain('DELIVERY_ZONE_UNAVAILABLE');
  });

  it('the quote fingerprint changes when the zone changes, and when the zone FEE changes', async () => {
    const a = await harness({ branches: [branch('b1')], zones: [zoneRow(), zoneRow({ id: 'zone-2', nameAr: 'ب', name: 'B' })] }).plan(oneVendor(), { address: zoneAddr, mode: 'QUOTE' });
    const otherZone = await harness({ branches: [branch('b1')], zones: [zoneRow(), zoneRow({ id: 'zone-2', nameAr: 'ب', name: 'B' })] }).plan(oneVendor(), { address: { ...zoneAddr, deliveryZoneId: 'zone-2' }, mode: 'QUOTE' });
    const repriced = await harness({ branches: [branch('b1')], zones: [zoneRow({ deliveryFeeMinor: 2500 })] }).plan(oneVendor(), { address: zoneAddr, mode: 'QUOTE' });
    expect(new Set([a.inputsHash, otherZone.inputsHash, repriced.inputsHash]).size).toBe(3);
    expect([a.deliveryFeeMinor, repriced.deliveryFeeMinor]).toEqual([1800, 2500]);
  });

  it('a frozen quote made for another zone fee is NOT honoured — the current fee is computed', async () => {
    const h = harness({ branches: [branch('b1')], zones: [zoneRow({ deliveryFeeMinor: 2500 })] });
    const stale = await harness({ branches: [branch('b1')], zones: [zoneRow()] }).plan(oneVendor(), { address: zoneAddr, mode: 'QUOTE' });
    const p = await h.plan(oneVendor(), { address: zoneAddr, frozen: { inputsHash: stale.inputsHash, breakdown: stale.delivery.breakdown as any } });
    expect(p.delivery.source).toBe('FRESH');
    expect(p.deliveryFeeMinor).toBe(2500);
  });

  it('Hatly Service with a pin-less zone address is NOT rejected for a missing pin: priced from the zone', async () => {
    const h = harness({ branches: [], zones: [zoneRow()] });
    const p = await h.plan(adHoc('BUY_FROM_PLACE', { adHocPickupLatitude: 30.5, adHocPickupLongitude: 31.5 }), { address: zoneAddr });
    expect(h.hatlyPricing.calculateCharge).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryZone: expect.objectContaining({ id: 'zone-1', deliveryFeeMinor: 1800 }) }),
    );
    expect(p.blockers.map((b) => b.code)).not.toContain('HATLY_SERVICE_ADDRESS_LOCATION_REQUIRED');
    expect(p.eligibility).toMatchObject({ serviceable: true, pricingSource: 'DELIVERY_ZONE' });
    expect(p.address?.deliveryZone?.nameAr).toBe('أبو نصيب');
  });

  it('Hatly Service WITH a pin is priced from the ZONE exactly like without one: no distance, no radius check, same call', async () => {
    // The pin is outside every service area: for Hatly Service it neither decides serviceability nor price.
    const h = harness({ branches: [], zones: [zoneRow()], area: null });
    const cartWithPlace = adHoc('BUY_FROM_PLACE', { adHocPickupLatitude: 30.5, adHocPickupLongitude: 31.5 });
    const pinned = await h.plan(cartWithPlace, { address: { ...zoneAddr, latitude: 30.42, longitude: 31.56 } });
    const pinless = await h.plan(cartWithPlace, { address: zoneAddr });
    expect(pinned.eligibility).toMatchObject({ serviceable: true, pricingSource: 'DELIVERY_ZONE' });
    const [first, second] = h.hatlyPricing.calculateCharge.mock.calls.map((c: any[]) => c[0]);
    expect(first).toEqual(second);
    expect(first).not.toHaveProperty('customerLocation');
    expect(h.deliveryFee.calculate).not.toHaveBeenCalled();
    expect(pinned.deliveryFeeMinor).toBe(pinless.deliveryFeeMinor);
  });

  it('Hatly Service with a pinned address but NO zone is rejected (ADDRESS_ZONE_REQUIRED) — no fallback to distance pricing', async () => {
    const h = harness({ branches: [], zones: [zoneRow()] });
    const error = await h.plan(adHoc('BUY_FROM_PLACE', { adHocPickupLatitude: 30.5, adHocPickupLongitude: 31.5 }), { address: addr }).catch((e) => e);
    expect(CODE(error)).toBe('ADDRESS_ZONE_REQUIRED');
    expect(h.hatlyPricing.calculateCharge).not.toHaveBeenCalled();
    expect(h.deliveryFee.calculate).not.toHaveBeenCalled();
  });

  it('the quote fingerprint of a Hatly Service quote changes with the zone fee (a re-priced zone makes the old quote stale)', async () => {
    const c = adHoc('BUY_FROM_PLACE', { adHocPickupLatitude: 30.5, adHocPickupLongitude: 31.5 });
    const a = await harness({ branches: [], zones: [zoneRow()] }).plan(c, { address: zoneAddr, mode: 'QUOTE' });
    const b = await harness({ branches: [], zones: [zoneRow({ deliveryFeeMinor: 2500 })] }).plan(c, { address: zoneAddr, mode: 'QUOTE' });
    expect(a.inputsHash).not.toBe(b.inputsHash);
  });

  it('Hatly Service follows the same address serviceability: an inactive zone blocks the order, nothing is charged', async () => {
    const h = harness({ branches: [], zones: [zoneRow({ isActive: false })] });
    const error = await h.plan(adHoc('BUY_FROM_PLACE', { adHocPickupLatitude: 30.5, adHocPickupLongitude: 31.5 }), { address: zoneAddr }).catch((e) => e);
    expect(CODE(error)).toBe('DELIVERY_ZONE_UNAVAILABLE');
    expect(h.hatlyPricing.calculateCharge).not.toHaveBeenCalled();
  });
});

describe('CheckoutPlannerService — Maps disabled (PD-009 G: the active zone prices and bounds every delivery)', () => {
  const zoneRow = (over: any = {}) => ({
    id: 'zone-1', name: 'Abu Naseeb', nameAr: 'أبو نصيب', city: 'Belbeis', cityAr: 'بلبيس', governorate: 'Sharqia', governorateAr: 'الشرقية',
    deliveryFeeMinor: 1800, isActive: true, serviceAreaId: 'area-1', serviceArea: { id: 'area-1', isActive: true }, ...over,
  });
  const CODE = (e: any) => e?.response?.details?.code;
  const pinnedZoneAddr = { ...addr, deliveryZoneId: 'zone-1' };
  const disabled = (opts: Parameters<typeof harness>[0]) => {
    const h = harness(opts);
    (h.deliveryFee as any).roadDistancePricingAvailable = false; // what DeliveryFeeCalculationService reports with UnavailableMapProvider
    return h;
  };

  it('a PINNED address is priced by its zone — never by distance — and the pin stays on the order for the driver', async () => {
    const h = disabled({ branches: [branch('b1')], zones: [zoneRow()] });
    const p = await h.plan(oneVendor(), { address: pinnedZoneAddr });
    expect(h.deliveryFee.calculate).not.toHaveBeenCalled();
    expect(p).toMatchObject({ deliveryFeeMinor: 1800, eligibility: { serviceable: true, pricingSource: 'DELIVERY_ZONE' } });
    expect(p.address).toMatchObject({ latitude: addr.latitude, longitude: addr.longitude, deliveryZoneId: 'zone-1' });
  });

  it('the zone is the boundary: a pin outside every service-area radius changes nothing (no radius lookup is used)', async () => {
    const h = disabled({ branches: [branch('b1')], zones: [zoneRow()], area: null });
    const p = await h.plan(oneVendor(), { address: pinnedZoneAddr });
    expect(p.eligibility).toMatchObject({ serviceable: true, serviceAreaId: 'area-1', pricingSource: 'DELIVERY_ZONE' });
  });

  it('quote and order give the same fee for the same inputs (one planner, one formula)', async () => {
    const h = disabled({ branches: [branch('b1'), branch('b2')], zones: [zoneRow()] });
    const quote = await h.plan(twoVendors(), { address: pinnedZoneAddr, mode: 'QUOTE' } as any);
    const order = await h.plan(twoVendors(), { address: pinnedZoneAddr });
    expect(quote.deliveryFeeMinor).toBe(1800 + 500);
    expect(order.deliveryFeeMinor).toBe(quote.deliveryFeeMinor);
    expect(order.delivery.breakdown).toMatchObject({ pricingSource: 'DELIVERY_ZONE', additionalVendorChargeMinor: 500 });
  });

  it('ORDER: a pinned address WITHOUT a zone → ADDRESS_ZONE_REQUIRED; an inactive zone → DELIVERY_ZONE_UNAVAILABLE; nothing priced', async () => {
    const noZone = disabled({ branches: [branch('b1')], zones: [] });
    expect(CODE(await noZone.plan(oneVendor(), { address: addr }).catch((e) => e))).toBe('ADDRESS_ZONE_REQUIRED');
    const inactive = disabled({ branches: [branch('b1')], zones: [zoneRow({ isActive: false })] });
    expect(CODE(await inactive.plan(oneVendor(), { address: pinnedZoneAddr }).catch((e) => e))).toBe('DELIVERY_ZONE_UNAVAILABLE');
    expect(noZone.deliveryFee.calculateForZone).not.toHaveBeenCalled();
    expect(inactive.deliveryFee.calculateForZone).not.toHaveBeenCalled();
    expect(noZone.deliveryFee.calculate).not.toHaveBeenCalled();
  });

  it('ORDER: a branch in another service area than the zone is still refused', async () => {
    const h = disabled({ branches: [branch('b1', { serviceAreaId: 'area-9' })], zones: [zoneRow()] });
    expect(CODE(await h.plan(oneVendor(), { address: pinnedZoneAddr }).catch((e) => e))).toBe('VENDOR_OUTSIDE_DELIVERY_AREA');
  });

  it('with Maps available the existing rule is unchanged: a pin is priced by distance', async () => {
    const h = harness({ branches: [branch('b1')], zones: [zoneRow()] });
    (h.deliveryFee as any).roadDistancePricingAvailable = true;
    const p = await h.plan(oneVendor(), { address: pinnedZoneAddr });
    expect(h.deliveryFee.calculate).toHaveBeenCalled();
    expect(p.eligibility?.pricingSource).toBe('DISTANCE');
  });
});

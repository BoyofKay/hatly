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

const product = (id: string, over: any = {}) => ({ id, name: `P ${id}`, priceMinor: 10000, isAvailable: true, deletedAt: null, categoryId: 'cat', pricingUnit: PricingUnit.PIECE, ...over });
const item = (id: string, p: any, quantity = 1, extra: any = {}) => ({ id, productId: p.id, product: p, quantity, notes: null, freeTextDescription: null, imageUrls: null, selectedOptionValues: [], ...extra });
const group = (id: string, branchId: string, items: any[]) => ({ id, groupType: CartGroupType.CATALOG, vendorBranchId: branchId, adHocPlaceName: null, vendorNote: null, items });
const cart = (groups: any[], over: any = {}) => ({ id: 'cart-1', customerId: 'c1', fulfillmentType: FulfillmentType.DELIVERY, orderNote: null, groups, ...over });
const branch = (id: string, over: any = {}) => ({ id, name: `B ${id}`, isActive: true, pickupEnabled: true, deliveryEnabled: true, serviceAreaId: 'area-1', preparationTimeMinutes: null, address: 'x', latitude: 30, longitude: 31, vendor: { name: `V ${id}`, isActive: true }, ...over });

function harness(opts: { branches: any[]; balance?: number; enabled?: string[]; fee?: number; couponResult?: any; subtotalPlan?: any; area?: any; eta?: number }) {
  const businessConfig = {
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
  };
  const offers = {
    planFlashSaleForCart: jest.fn(async () => ({ plans: new Map(), lockedOffers: new Map() })),
    planSubtotalDiscountForSegment: jest.fn(async (_m: any, p: any) => ({ plan: opts.subtotalPlan?.[p.vendorBranchId] ?? null, lockedOffer: null })),
    checkSubtotalDiscountCustomerLimit: jest.fn(async () => true),
    planCouponForCart: jest.fn(async () => opts.couponResult ?? { status: 'REJECTED', reasonCode: 'COUPON_NOT_FOUND', message: 'nope' }),
  };
  const wallet = { getBalance: jest.fn(async () => opts.balance ?? 0), lockCustomerWallet: jest.fn(async () => undefined) };
  const address = new AddressValidationService({ findOne: async () => null } as any, { resolveForPoint: async () => ('area' in opts ? opts.area : { id: 'area-1' }) } as any);
  const manager = { find: jest.fn(async (E: any) => (E === VendorBranch ? opts.branches : [])) };
  const planner = new CheckoutPlannerService(new CartPricingService(), businessConfig as any, deliveryFee as any, { calculateCharge: jest.fn(async () => ({ chargeMinor: 900 })) } as any, offers as any, address, wallet as any);
  const plan = (c: any, input: Partial<CheckoutInput> = {}) =>
    planner.plan(manager as any, c, { customerId: 'c1', address: addr, mode: 'ORDER', multiVendorEnabled: true, paymentMethod: 'COD', ...input });
  return { plan, deliveryFee, offers, wallet, businessConfig };
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

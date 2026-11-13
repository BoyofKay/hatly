import { courierOrderLine, courierTotals, CourierOrderFacts } from './courier-settlement-math';
import { SettlementClosingService, cairoMidnight } from './settlement-closing.service';

const base: CourierOrderFacts = {
  paymentMethod: 'COD', totalMinor: 0, amountDueMinor: 0, goodsPaidToStoresMinor: 0, approvedChangeMinor: 0,
  feeEntitlementMinor: 0, commissionMinor: 0, changePendingReview: false,
};
const line = (f: Partial<CourierOrderFacts>) => {
  const r = courierOrderLine({ ...base, ...f });
  if (!('line' in r)) throw new Error(`unexpected unresolved ${(r as any).unresolved}`);
  return r.line;
};

/** Register R25–R31 and the owner's decisions of 2026-11-13. Amounts are EGP piasters (EGP 1 = 100). */
describe('courier settlement arithmetic — COD and electronic computed separately', () => {
  it('MANDATORY COD: goods 300, fee 40, commission 10, customer pays 340, courier pays store 300', () => {
    const l = line({ paymentMethod: 'COD', goodsPaidToStoresMinor: 30000, feeEntitlementMinor: 4000, commissionMinor: 1000, totalMinor: 34000, amountDueMinor: 34000 });
    expect(l).toEqual({
      paymentFlow: 'COD',
      feeEntitlementMinor: 4000, commissionMinor: 1000, courierCompensationMinor: 3000, // compensation 30, Hatly commission 10
      goodsPaidToStoresMinor: 30000, goodsPassThroughMinor: 30000, goodsReimbursementMinor: 0, // goods excluded: no reimbursement, no deduction
      cashCollectedMinor: 34000, cashHeldMinor: 4000, changeKeptMinor: 0, collectedByHatlyMinor: 0, // the courier already holds 40
      netToCourierMinor: -1000, // he remits only Hatly's 10 — no extra 30 payable for cash he already holds
    });
  });

  it('MANDATORY electronic: goods reimbursement 300, fee 40, commission 10, no cash → Hatly owes the courier 330', () => {
    const l = line({ paymentMethod: 'MANUAL_TRANSFER', goodsPaidToStoresMinor: 30000, feeEntitlementMinor: 4000, commissionMinor: 1000, totalMinor: 34000, amountDueMinor: 0 });
    expect(l).toMatchObject({ paymentFlow: 'ELECTRONIC', goodsReimbursementMinor: 30000, feeEntitlementMinor: 4000, commissionMinor: 1000, courierCompensationMinor: 3000, cashCollectedMinor: 0, cashHeldMinor: 0, goodsPassThroughMinor: 0, netToCourierMinor: 33000 });
  });

  it.each(['WALLET', 'MANUAL_TRANSFER', 'ELECTRONIC'])('%s follows the electronic path (decision 1)', (method) => {
    expect(line({ paymentMethod: method, goodsPaidToStoresMinor: 30000, feeEntitlementMinor: 4000, commissionMinor: 1000, totalMinor: 34000, amountDueMinor: 0 }).netToCourierMinor).toBe(33000);
  });

  it('wallet + COD: 50 from the wallet, 290 cash → the cash covers 290 of the goods; Hatly owes the other 10 of goods + 30 compensation', () => {
    const l = line({ paymentMethod: 'COD', goodsPaidToStoresMinor: 30000, feeEntitlementMinor: 4000, commissionMinor: 1000, totalMinor: 34000, amountDueMinor: 29000 });
    expect(l).toMatchObject({ goodsPassThroughMinor: 29000, goodsReimbursementMinor: 1000, cashHeldMinor: 0, collectedByHatlyMinor: 5000, netToCourierMinor: 4000 });
  });

  it('wallet covering only part of the fee: wallet 20, cash 320 → courier holds 20 of the fee; net = 30 − 20 = +10', () => {
    const l = line({ paymentMethod: 'COD', goodsPaidToStoresMinor: 30000, feeEntitlementMinor: 4000, commissionMinor: 1000, totalMinor: 34000, amountDueMinor: 32000 });
    expect(l).toMatchObject({ goodsPassThroughMinor: 30000, goodsReimbursementMinor: 0, cashHeldMinor: 2000, netToCourierMinor: 1000 });
  });

  it('approved change to wallet: the courier kept 20 more cash → owes it too (−30)', () => {
    const l = line({ paymentMethod: 'COD', goodsPaidToStoresMinor: 30000, feeEntitlementMinor: 4000, commissionMinor: 1000, totalMinor: 34000, amountDueMinor: 34000, approvedChangeMinor: 2000 });
    expect(l).toMatchObject({ changeKeptMinor: 2000, netToCourierMinor: -3000 });
  });

  it('multi-store COD: goods are the sum of the store parts; the fee and commission are counted once per order', () => {
    const l = line({ paymentMethod: 'COD', goodsPaidToStoresMinor: 12000 + 8000, feeEntitlementMinor: 4500, commissionMinor: 450, totalMinor: 24500, amountDueMinor: 24500 });
    expect(l).toMatchObject({ goodsPassThroughMinor: 20000, cashHeldMinor: 4500, courierCompensationMinor: 4050, netToCourierMinor: -450 });
  });

  it('a 0% commission rate is a real rate: COD net 0, electronic net = goods + fee', () => {
    expect(line({ paymentMethod: 'COD', goodsPaidToStoresMinor: 100, feeEntitlementMinor: 40, commissionMinor: 0, totalMinor: 140, amountDueMinor: 140 }).netToCourierMinor).toBe(0);
    expect(line({ paymentMethod: 'WALLET', goodsPaidToStoresMinor: 100, feeEntitlementMinor: 40, commissionMinor: 0, totalMinor: 140, amountDueMinor: 0 }).netToCourierMinor).toBe(140);
  });

  it('Hatly Service COD: compensation is the base fee only (R28); the premium the courier collected is remitted with the commission', () => {
    // goods 100 (purchase), base fee 25, premium 15, commission 2.50 → customer pays 140 cash
    const l = line({ paymentMethod: 'COD', goodsPaidToStoresMinor: 10000, feeEntitlementMinor: 2500, commissionMinor: 250, totalMinor: 14000, amountDueMinor: 14000 });
    expect(l).toMatchObject({ cashHeldMinor: 4000, courierCompensationMinor: 2250, netToCourierMinor: -1750 });
  });

  it('rounding: commission is taken as recorded on the event (already whole piasters); nothing is re-rounded here', () => {
    const l = line({ paymentMethod: 'COD', goodsPaidToStoresMinor: 999, feeEntitlementMinor: 333, commissionMinor: 33, totalMinor: 1332, amountDueMinor: 1332 });
    expect(l.netToCourierMinor).toBe(-33);
  });

  it.each([
    [{ paymentMethod: 'PAY_AT_DELIVERY' }, 'LEGACY_PAY_AT_DELIVERY'],
    [{ feeEntitlementMinor: null, commissionMinor: null }, 'RATE_UNDEFINED'],
    [{ changePendingReview: true }, 'CHANGE_PENDING_REVIEW'],
    [{ paymentMethod: 'COD', amountDueMinor: null }, 'AMOUNT_DUE_MISSING'],
  ] as Array<[Partial<CourierOrderFacts>, string]>)('cannot be computed → unresolved, never guessed: %o', (f, reason) => {
    expect(courierOrderLine({ ...base, ...f })).toEqual({ unresolved: reason });
  });

  it('refuses fractional money (minor units only; no silent rounding)', () => {
    expect(() => courierOrderLine({ ...base, goodsPaidToStoresMinor: 10.5 })).toThrow(/whole minor units/);
  });

  it('totals are exact sums of the lines (screen = export); net = compensation + reimbursement − cash held − change kept', () => {
    const a = line({ paymentMethod: 'COD', goodsPaidToStoresMinor: 30000, feeEntitlementMinor: 4000, commissionMinor: 1000, totalMinor: 34000, amountDueMinor: 34000 });
    const b = line({ paymentMethod: 'MANUAL_TRANSFER', goodsPaidToStoresMinor: 30000, feeEntitlementMinor: 4000, commissionMinor: 1000, totalMinor: 34000, amountDueMinor: 0 });
    const t = courierTotals([a, b]);
    expect(t).toMatchObject({ orders: 2, codOrders: 1, electronicOrders: 1, feeEntitlementMinor: 8000, commissionMinor: 2000, courierCompensationMinor: 6000, goodsReimbursementMinor: 30000, goodsPassThroughMinor: 30000, cashCollectedMinor: 34000, cashHeldMinor: 4000, netToCourierMinor: 32000 });
    expect(t.netToCourierMinor).toBe(t.courierCompensationMinor + t.goodsReimbursementMinor - t.cashHeldMinor - t.changeKeptMinor);
  });
});

describe('vendor period end (Cairo calendar)', () => {
  const now = new Date('2026-11-13T12:00:00Z');
  it('a Cairo date means up to the end of that day in Cairo (winter UTC+2)', () => {
    expect(SettlementClosingService.resolveEnd('2026-11-09', now).toISOString()).toBe('2026-11-09T22:00:00.000Z');
  });
  it('Egyptian summer time (UTC+3) is honoured', () => {
    expect(cairoMidnight('2026-07-01').toISOString()).toBe('2026-06-30T21:00:00.000Z');
  });
  it('never later than now; no end = now', () => {
    expect(SettlementClosingService.resolveEnd('2026-12-31', now)).toEqual(now);
    expect(SettlementClosingService.resolveEnd(undefined, now)).toEqual(now);
  });
  it('rejects garbage', () => {
    expect(() => SettlementClosingService.resolveEnd('soon', now)).toThrow();
  });
});

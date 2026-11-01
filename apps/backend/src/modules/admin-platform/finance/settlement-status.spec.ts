import { derivePaymentStatus, driverPeriodDue, remainingMinor, vendorPeriodDue } from './settlement-status';

describe('settlement direction and derived payment status (B1/B5)', () => {
  it('a vendor period is a receivable for Hatly: the due amount is the commission owed, collected from the vendor', () => {
    expect(vendorPeriodDue(12_500)).toEqual({ direction: 'COLLECTION', dueMinor: 12_500 });
    // gross sales never enter the amount due — only the commission does
    expect(vendorPeriodDue(0)).toEqual({ direction: 'COLLECTION', dueMinor: 0 });
  });

  it('a driver period follows the sign of the frozen net payable', () => {
    expect(driverPeriodDue(8_000)).toEqual({ direction: 'PAYOUT', dueMinor: 8_000 });
    expect(driverPeriodDue(-3_000)).toEqual({ direction: 'COLLECTION', dueMinor: 3_000 });
    expect(driverPeriodDue(0)).toEqual({ direction: 'PAYOUT', dueMinor: 0 });
  });

  it('derives every status; closed is not paid', () => {
    expect(derivePaymentStatus(0, 0)).toBe('NOTHING_DUE');
    expect(derivePaymentStatus(1_000, 0)).toBe('UNPAID');
    expect(derivePaymentStatus(1_000, 400)).toBe('PARTIAL');
    expect(derivePaymentStatus(1_000, 1_000)).toBe('PAID');
    expect(derivePaymentStatus(1_000, 1_001)).toBe('OVERPAID');
    expect(derivePaymentStatus(0, 50)).toBe('OVERPAID');
  });

  it('remaining never goes negative', () => {
    expect(remainingMinor(1_000, 400)).toBe(600);
    expect(remainingMinor(1_000, 1_500)).toBe(0);
  });
});

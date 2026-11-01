/**
 * Settlement amounts, direction and payment status (B1 + B5 — the approved financial model).
 *
 *  - A VENDOR period is a RECEIVABLE for Hatly: the amount due is the commission the vendor OWES Hatly
 *    (`total_commission_owed_minor`). Gross sales are the vendor's own sales value and are NEVER an amount Hatly owes the vendor.
 *    Payments are COLLECTIONS from the vendor.
 *  - A DRIVER period follows the existing frozen `net_payable_minor` (earnings − commission + reimbursements): positive → Hatly PAYS the
 *    driver (PAYOUT); negative → the driver owes Hatly (COLLECTION); zero → nothing is due.
 *  - "Closed" is not "paid": the payment status is DERIVED from the recorded (non-voided) payments against the frozen due amount.
 *    Partial payments are normal; an overpayment is possible only when explicitly authorised (and stays visible as OVERPAID).
 */
export type SettlementDirection = 'PAYOUT' | 'COLLECTION';
export type SettlementPaymentStatus = 'NOTHING_DUE' | 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERPAID';

export interface PeriodDue {
  direction: SettlementDirection;
  /** Always >= 0. */
  dueMinor: number;
}

export function vendorPeriodDue(totalCommissionOwedMinor: number): PeriodDue {
  return { direction: 'COLLECTION', dueMinor: Math.max(0, Number(totalCommissionOwedMinor) || 0) };
}

export function driverPeriodDue(netPayableMinor: number): PeriodDue {
  const net = Number(netPayableMinor) || 0;
  return { direction: net >= 0 ? 'PAYOUT' : 'COLLECTION', dueMinor: Math.abs(net) };
}

export function derivePaymentStatus(dueMinor: number, settledMinor: number): SettlementPaymentStatus {
  if (dueMinor <= 0) return settledMinor > 0 ? 'OVERPAID' : 'NOTHING_DUE';
  if (settledMinor <= 0) return 'UNPAID';
  if (settledMinor < dueMinor) return 'PARTIAL';
  if (settledMinor === dueMinor) return 'PAID';
  return 'OVERPAID';
}

/** What may still be recorded without an overpayment authorisation. */
export function remainingMinor(dueMinor: number, settledMinor: number): number {
  return Math.max(0, dueMinor - settledMinor);
}

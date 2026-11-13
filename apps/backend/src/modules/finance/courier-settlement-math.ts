/**
 * Courier settlement arithmetic for ONE delivered order (pure; no I/O). Sources: register R25–R31 and the owner's decisions of 2026-11-13.
 * This is the ONLY place the courier formula lives: the Admin preview, the confirmed closing, the courier statement, the S26 export and the
 * Driver App all show the numbers computed here (the Driver App receives them from the API; it never recomputes).
 *
 * Two payment flows, computed separately:
 *
 *  COD (cash at the door, R25; wallet part R27)
 *    The customer hands the courier the cash due; the courier paid the store(s) for the goods at pickup with that same money.
 *    - goods pass-through  = min(goods paid to stores, cash collected) — collected AND paid on, so EXCLUDED from the net: it is neither
 *                            owed to nor by the courier, and it is not Hatly revenue. Shown for reconciliation only.
 *    - goods reimbursement = goods the cash did not cover (only when part of the order was paid to Hatly, e.g. from the wallet).
 *    - cash held           = cash collected − goods pass-through: what the courier still holds after paying the stores (normally the
 *                            delivery fee). It is NOT paid to him again: it is set against his compensation.
 *
 *  ELECTRONIC (InstaPay / manual transfer / wallet / gateway, R26)
 *    The customer paid Hatly; the courier paid the store(s) with his own money.
 *    - goods reimbursement = goods paid to stores (Hatly owes it back); no cash was collected.
 *
 *  Both: delivery fee (= courier compensation basis, R28) − Hatly commission = courier compensation.
 *    net to courier = compensation + goods reimbursement − cash held − change kept
 *    > 0 → مستحق للمندوب (Hatly pays the courier) ; < 0 → مستحق على المندوب (the courier pays Hatly)
 *
 * Examples (EGP): COD goods 300, fee 40, commission 10, cash 340 → pass-through 300, cash held 40, compensation 30, net −10.
 *                 Electronic goods 300, fee 40, commission 10 → reimbursement 300, compensation 30, net +330.
 */
export type CourierPaymentMethod = 'COD' | 'MANUAL_TRANSFER' | 'WALLET' | 'ELECTRONIC' | 'PAY_AT_DELIVERY' | string;
export type CourierPaymentFlow = 'COD' | 'ELECTRONIC';

export interface CourierOrderFacts {
  paymentMethod: CourierPaymentMethod;
  totalMinor: number;
  /** orders.amount_due_minor — the cash the customer pays at the door (COD), after any wallet part. */
  amountDueMinor: number | null;
  goodsPaidToStoresMinor: number;
  /** Approved "change to wallet" amount: extra cash the courier kept and Hatly credited to the customer's wallet. */
  approvedChangeMinor: number;
  /** null when the order has no DRIVER_COMMISSION event (no commission rate — R43). */
  feeEntitlementMinor: number | null;
  commissionMinor: number | null;
  /** A change-to-wallet claim still waiting for review. */
  changePendingReview: boolean;
}

export type UnresolvedReason = 'RATE_UNDEFINED' | 'LEGACY_PAY_AT_DELIVERY' | 'AMOUNT_DUE_MISSING' | 'CHANGE_PENDING_REVIEW';

export interface CourierOrderLine {
  paymentFlow: CourierPaymentFlow;
  /** Delivery fee the courier is entitled to (R28 compensation basis). */
  feeEntitlementMinor: number;
  commissionMinor: number;
  /** fee − commission (تعويض المندوب). */
  courierCompensationMinor: number;
  /** Fact: what the courier paid the stores at pickup (all flows). */
  goodsPaidToStoresMinor: number;
  /** COD only: goods covered by the customer's cash — informational, excluded from the net. */
  goodsPassThroughMinor: number;
  /** Goods Hatly owes back to the courier (electronic; or the non-cash part of a COD order). */
  goodsReimbursementMinor: number;
  /** Cash the customer handed the courier (0 for electronic). */
  cashCollectedMinor: number;
  /** Cash still with the courier after paying the stores (set against his compensation, never paid again). */
  cashHeldMinor: number;
  /** Approved change-to-wallet the courier kept in cash. */
  changeKeptMinor: number;
  /** The part of the order total Hatly collected (wallet / transfer), not the courier. */
  collectedByHatlyMinor: number;
  netToCourierMinor: number;
}

const int = (n: unknown) => {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || !Number.isInteger(v)) throw new Error(`Amounts must be whole minor units, got ${String(n)}`);
  return v;
};

/** Returns the settled line, or the reason this delivered order cannot be settled yet (it is then carried to a later closing). */
export function courierOrderLine(f: CourierOrderFacts): { line: CourierOrderLine } | { unresolved: UnresolvedReason } {
  if (f.paymentMethod === 'PAY_AT_DELIVERY') return { unresolved: 'LEGACY_PAY_AT_DELIVERY' }; // R20: not approved; money flow undefined
  if (f.feeEntitlementMinor == null || f.commissionMinor == null) return { unresolved: 'RATE_UNDEFINED' }; // R43: no rate is assumed
  if (f.changePendingReview) return { unresolved: 'CHANGE_PENDING_REVIEW' };
  const cod = f.paymentMethod === 'COD';
  if (cod && f.amountDueMinor == null) return { unresolved: 'AMOUNT_DUE_MISSING' };

  const fee = int(f.feeEntitlementMinor);
  const commission = int(f.commissionMinor);
  const goods = int(f.goodsPaidToStoresMinor);
  const change = int(f.approvedChangeMinor);
  const total = int(f.totalMinor);
  const compensation = fee - commission;

  if (cod) {
    const cash = int(f.amountDueMinor);
    const passThrough = Math.min(goods, cash);
    const reimbursement = goods - passThrough;
    const held = cash - passThrough;
    return {
      line: {
        paymentFlow: 'COD', feeEntitlementMinor: fee, commissionMinor: commission, courierCompensationMinor: compensation,
        goodsPaidToStoresMinor: goods, goodsPassThroughMinor: passThrough, goodsReimbursementMinor: reimbursement,
        cashCollectedMinor: cash, cashHeldMinor: held, changeKeptMinor: change, collectedByHatlyMinor: Math.max(0, total - cash),
        netToCourierMinor: compensation + reimbursement - held - change,
      },
    };
  }
  return {
    line: {
      paymentFlow: 'ELECTRONIC', feeEntitlementMinor: fee, commissionMinor: commission, courierCompensationMinor: compensation,
      goodsPaidToStoresMinor: goods, goodsPassThroughMinor: 0, goodsReimbursementMinor: goods,
      cashCollectedMinor: 0, cashHeldMinor: 0, changeKeptMinor: change, collectedByHatlyMinor: total,
      netToCourierMinor: compensation + goods - change,
    },
  };
}

export type CourierTotals = Omit<CourierOrderLine, 'paymentFlow'> & { orders: number; codOrders: number; electronicOrders: number };

const SUM_KEYS = [
  'feeEntitlementMinor', 'commissionMinor', 'courierCompensationMinor', 'goodsPaidToStoresMinor', 'goodsPassThroughMinor', 'goodsReimbursementMinor',
  'cashCollectedMinor', 'cashHeldMinor', 'changeKeptMinor', 'collectedByHatlyMinor', 'netToCourierMinor',
] as const;

export function courierTotals(lines: CourierOrderLine[]): CourierTotals {
  const t = { orders: lines.length, codOrders: 0, electronicOrders: 0 } as CourierTotals;
  for (const k of SUM_KEYS) t[k] = 0;
  for (const l of lines) {
    for (const k of SUM_KEYS) t[k] += l[k];
    if (l.paymentFlow === 'COD') t.codOrders += 1;
    else t.electronicOrders += 1;
  }
  return t;
}

/**
 * Read-only summary of what has been given back on an order, assembled from the real ledgers — never recomputed from the order total and
 * never claiming money moved when it did not:
 *  - walletRefundedMinor: ORDER_REFUND credits in the customer's wallet ledger (instant, atomic with the cancellation).
 *  - transfer refund events: obligations recorded against an approved Manual Transfer; `sentAt` is set ONLY when operations marked the
 *    refund as really sent (refund_payouts).
 *  - pendingRefundMinor: what will be settled when a not-yet-verified transfer is approved or rejected (PD-004).
 */
export interface RefundEventView {
  id: string;
  amountMinor: number;
  recordedAt: string;
  sentAt: string | null;
}

export interface OrderRefundSummary {
  walletRefundedMinor: number;
  transferRefundRecordedMinor: number;
  transferRefundSentMinor: number;
  pendingRefundMinor: number;
  /** Total given back or owed back so far (wallet + recorded transfer refunds). */
  totalRefundMinor: number;
  /** NONE · PENDING_VERIFICATION · REFUNDED_TO_WALLET · TRANSFER_REFUND_PROCESSING · TRANSFER_REFUND_SENT · MIXED */
  status: string;
  transferRefunds: RefundEventView[];
}

type Query = (sql: string, params?: unknown[]) => Promise<any[]>;

export async function loadRefundSummary(query: Query, orderId: string): Promise<OrderRefundSummary> {
  const [wallet] = await query(
    `SELECT COALESCE(SUM(amount_delta_minor), 0)::bigint AS n FROM wallet_transactions WHERE order_id = $1 AND type = 'ORDER_REFUND'`,
    [orderId],
  );
  const events = await query(
    `SELECT e.id, e.amount_minor, e.created_at, p.sent_at
       FROM financial_events e LEFT JOIN refund_payouts p ON p.financial_event_id = e.id
      WHERE e.order_id = $1 AND e.type = 'MANUAL_TRANSFER_REFUND_RECORDED'
      ORDER BY e.created_at ASC`,
    [orderId],
  );
  const [payment] = await query(`SELECT pending_refund_minor FROM payments WHERE order_id = $1 LIMIT 1`, [orderId]);

  const transferRefunds: RefundEventView[] = events.map((e) => ({
    id: e.id,
    amountMinor: Number(e.amount_minor ?? 0),
    recordedAt: new Date(e.created_at).toISOString(),
    sentAt: e.sent_at ? new Date(e.sent_at).toISOString() : null,
  }));
  const walletRefundedMinor = Number(wallet?.n ?? 0);
  const transferRefundRecordedMinor = transferRefunds.reduce((s, e) => s + e.amountMinor, 0);
  const transferRefundSentMinor = transferRefunds.filter((e) => e.sentAt).reduce((s, e) => s + e.amountMinor, 0);
  const pendingRefundMinor = Number(payment?.pending_refund_minor ?? 0);

  const transferState = transferRefundRecordedMinor === 0 ? null : transferRefundSentMinor === transferRefundRecordedMinor ? 'TRANSFER_REFUND_SENT' : 'TRANSFER_REFUND_PROCESSING';
  let status = 'NONE';
  if (walletRefundedMinor > 0 && transferState) status = 'MIXED';
  else if (walletRefundedMinor > 0) status = 'REFUNDED_TO_WALLET';
  else if (transferState) status = transferState;
  else if (pendingRefundMinor > 0) status = 'PENDING_VERIFICATION';

  return {
    walletRefundedMinor,
    transferRefundRecordedMinor,
    transferRefundSentMinor,
    pendingRefundMinor,
    totalRefundMinor: walletRefundedMinor + transferRefundRecordedMinor,
    status,
    transferRefunds,
  };
}

/**
 * PD-015 — the Hatly-funded promotional cost of the order, NET of restorations: the original HATLY_FUNDED_OFFER_DISCOUNT_RECORDED event
 * (never modified) minus the compensating HATLY_FUNDED_OFFER_DISCOUNT_RESTORED events. For an order that recorded the original,
 * `netMinor` always equals the discount the order still carries. Informational: it is not a refund and never enters settlement.
 */
export interface HatlyFundedDiscountSummary {
  recordedMinor: number;
  restoredMinor: number;
  netMinor: number;
}

export async function loadHatlyFundedDiscountSummary(query: Query, orderId: string): Promise<HatlyFundedDiscountSummary> {
  const rows = await query(
    `SELECT type, COALESCE(SUM(amount_minor), 0)::bigint AS n FROM financial_events
      WHERE order_id = $1 AND type IN ('HATLY_FUNDED_OFFER_DISCOUNT_RECORDED', 'HATLY_FUNDED_OFFER_DISCOUNT_RESTORED') GROUP BY type`,
    [orderId],
  );
  const sum = (type: string) => Number(rows.find((r: { type: string; n: string }) => r.type === type)?.n ?? 0);
  const recordedMinor = sum('HATLY_FUNDED_OFFER_DISCOUNT_RECORDED');
  const restoredMinor = sum('HATLY_FUNDED_OFFER_DISCOUNT_RESTORED');
  return { recordedMinor, restoredMinor, netMinor: recordedMinor - restoredMinor };
}

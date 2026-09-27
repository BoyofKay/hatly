/**
 * State of the customer's PENDING REFUND ENTITLEMENT on a Manual Transfer payment (PD-004).
 *
 * A vendor-segment cancellation can reduce what the customer ultimately owes while their transfer is still unverified
 * (PENDING / CLAIMED / UNDER_REVIEW). The customer may well have sent the money already, so the difference is recorded
 * here as an entitlement — but it is NOT a payable: no refund event exists until Hatly confirms it received the money.
 *
 *   NONE       nothing is (or ever was) owed back
 *   PENDING    `pendingRefundMinor` is owed back IF the transfer is later verified PAID; re-derived (not accumulated)
 *              from the current amount owed on every cancellation
 *   CONVERTED  the transfer was verified PAID and the entitlement became one real refund event (terminal)
 *   VOIDED     the transfer was REJECTED — Hatly never confirmed receipt, so nothing is paid (terminal)
 */
export enum PendingRefundStatus {
  NONE = 'NONE',
  PENDING = 'PENDING',
  CONVERTED = 'CONVERTED',
  VOIDED = 'VOIDED',
}

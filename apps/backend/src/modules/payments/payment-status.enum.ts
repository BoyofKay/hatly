/**
 * CONFIRMED business decision (Manual Transfer payment). PAID and
 * REJECTED are terminal — no transition is ever defined out of
 * either. CUSTOMER_CLAIMED_TRANSFER -> UNDER_REVIEW happens
 * automatically as part of the same claim action (confirmed: "an
 * automatic state transition, not a separate Admin action") — see
 * PaymentStateMachineService's own doc comment for exactly how.
 */
export enum PaymentStatus {
  PENDING = 'PENDING',
  CUSTOMER_CLAIMED_TRANSFER = 'CUSTOMER_CLAIMED_TRANSFER',
  UNDER_REVIEW = 'UNDER_REVIEW',
  PAID = 'PAID',
  REJECTED = 'REJECTED',
}

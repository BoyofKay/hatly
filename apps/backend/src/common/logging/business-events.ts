/**
 * The full vocabulary of structured business/operational events emitted
 * across the critical order/payment/wallet/loyalty/delivery/dispatch
 * flows (Group 4 — Production-Grade Structured Logging). Every call to
 * `logBusinessEvent()` in this codebase uses one of these constants for
 * its `event` field — never an inline string — so the vocabulary stays
 * small and stable and two call sites can never accidentally diverge on
 * spelling for what is meant to be the same event.
 *
 * This is deliberately NOT an exhaustive log of every operation — see
 * each constant's own comment for what it means and, where relevant,
 * why a seemingly-related operation was deliberately left unlogged.
 * Financial ledgers (FinancialEvent/WalletTransaction/
 * LoyaltyPointsTransaction/Payment/DriverCashRemainder) remain the
 * source of truth; every event below is an operational diagnostic,
 * never a replacement record.
 */
export const BusinessEvent = {
  /** A new Order was created successfully (post-commit). */
  ORDER_CREATED: 'order.created',
  /** Order.status changed successfully (post-commit) — the ONLY place `Order.status` is written (OrderStateMachineService). */
  ORDER_STATE_TRANSITION: 'order.state_transition',

  /** Payment.status changed successfully (post-commit) — the ONLY place `Payment.status` is written (PaymentStateMachineService). Covers Manual Transfer claim/UNDER_REVIEW/PAID/REJECTED. */
  PAYMENT_STATE_TRANSITION: 'payment.state_transition',

  /** A new, previously-unseen FinancialEvent row was actually inserted. Only emitted when the write was its own committed unit of work — see financial-event.service.ts's own comment for why a write joining a caller's still-open transaction is never logged here. */
  FINANCIAL_EVENT_RECORDED: 'financial_event.recorded',
  /** record() found an existing row for this idempotencyKey (initial check or race-fallback) — a benign, expected replay, never an error. Safe to log regardless of transaction/manager state, since it reflects an already-durable prior fact, not new pending state. */
  FINANCIAL_EVENT_DUPLICATE: 'financial_event.duplicate',

  /** A WalletTransaction with a positive amountDeltaMinor committed. Emitted by the transaction-owning caller (never by WalletService.recordTransaction itself — see wallet.service.ts's own comment). */
  WALLET_CREDIT: 'wallet.credit',
  /** Reserved for a future wallet-debit flow. WalletService currently has no debit caller (checkout debit is explicitly out of scope — see wallet.service.ts's own class comment); kept in the taxonomy so a future debit path reuses this name instead of inventing a new one. */
  WALLET_DEBIT: 'wallet.debit',

  /** Points -> Wallet conversion committed successfully. */
  LOYALTY_REDEMPTION: 'loyalty.redemption',
  /** A retried/duplicate Points -> Wallet conversion was recognized via its idempotencyKey and the already-committed result was returned, rather than converting again. */
  LOYALTY_REDEMPTION_DUPLICATE: 'loyalty.redemption_duplicate',
  /** A retried/duplicate order-delivery loyalty-earning attempt was recognized (DB unique-constraint on order+EARNING) and skipped as a benign no-op. NOTE: this fires from inside the order DELIVERED transition's own transaction, before that transaction's own commit — a documented, low-risk exception to the "log after commit" rule; see loyalty.service.ts's own comment. */
  LOYALTY_EARNING_DUPLICATE: 'loyalty.earning_duplicate',

  /** A Driver submitted a new cash-remainder claim. */
  DRIVER_CASH_REMAINDER_SUBMITTED: 'driver_cash_remainder.submitted',
  /** A retried/duplicate cash-remainder submission for the same Order was recognized and the existing claim was returned. */
  DRIVER_CASH_REMAINDER_DUPLICATE_SUBMISSION: 'driver_cash_remainder.duplicate_submission',
  /** An Admin approved a cash-remainder claim (the WalletTransaction credit, if any, and the APPROVED status both committed together). */
  DRIVER_CASH_REMAINDER_APPROVED: 'driver_cash_remainder.approved',
  /** An Admin rejected a cash-remainder claim. */
  DRIVER_CASH_REMAINDER_REJECTED: 'driver_cash_remainder.rejected',

  /** M4 — a Driver submitted required Proof of Delivery (photo, and optional recipient name) before an ON_THE_WAY→DELIVERED transition. */
  PROOF_OF_DELIVERY_SUBMITTED: 'proof_of_delivery.submitted',
  /** A retried/duplicate Proof of Delivery submission for the same Delivery was recognized (DB unique constraint on delivery_id) and the existing record was returned instead of overwriting it. */
  PROOF_OF_DELIVERY_DUPLICATE_SUBMISSION: 'proof_of_delivery.duplicate_submission',

  /** An Admin recorded a decision (RESOLVED_NO_REFUND / REFUND_CUSTOMER) for a FAILED_DELIVERY order. */
  FAILED_DELIVERY_RESOLVED: 'failed_delivery.resolved',
  /** A previously-recorded REFUND_CUSTOMER decision was executed as a real Manual Transfer refund FinancialEvent. */
  FAILED_DELIVERY_REFUND_EXECUTED: 'failed_delivery.refund_executed',
  /** A retried refund-execution request was recognized as already recorded (same amount) and returned as a no-op success. */
  FAILED_DELIVERY_REFUND_ALREADY_RECORDED: 'failed_delivery.refund_already_recorded',

  /** A Driver was successfully locked and assigned to a Delivery (automatic or manual/Admin dispatch — both share DeliveryAssignmentService.assignDriver). */
  DISPATCH_DRIVER_ASSIGNED: 'dispatch.driver_assigned',
  /** Every ranked/named candidate driver was tried and none could be assigned (unavailable, or lost the lock race). */
  DISPATCH_ASSIGNMENT_FAILED: 'dispatch.assignment_failed',
  /** Automatic dispatch ran but driver ranking produced zero candidates for this order (before any assignment attempt was even made) — a DispatchAlert row is also created for Admin visibility. */
  DISPATCH_NO_ELIGIBLE_DRIVER: 'dispatch.no_eligible_driver',
  /** Timeout-driven reassignment milestone: an assigned driver did not act before `acceptDeadlineAt` — the delivery was released (ASSIGNED_TO_DRIVER → READY_FOR_PICKUP) so it could be re-ranked/reassigned. Distinguishes this trigger from a driver's own explicit rejection (same transition, no event) and from an Admin's manual reassignment (also the same transition, also unlogged as its own event — the Admin's own request is already auditable via the request log). */
  DISPATCH_DRIVER_TIMEOUT: 'dispatch.driver_timeout',
  /** Dispatch Hardening milestone: one full sweep invocation finished (whether it did any work or not) — processed/reassigned/alerted/skipped counts and duration, the primary operational signal for "is the timeout sweep healthy" absent a metrics stack (none exists in this codebase). Emitted once per sweep that actually acquired the lock; a sweep that lost the lock race to another instance/tick logs nothing here (nothing happened worth summarizing). */
  DISPATCH_TIMEOUT_SWEEP_COMPLETED: 'dispatch.timeout_sweep_completed',

  /** A call to an external dependency (Unifonic SMS, Firebase Cloud Messaging, Google Maps Distance Matrix) did not succeed. Never includes credentials, tokens, or raw request/response payloads — see each provider's own call site. */
  EXTERNAL_PROVIDER_FAILED: 'external_provider.failed',

  /**
   * Security monitoring (security milestone) — emitted by HttpExceptionFilter for every refused request of these kinds, at WARN, with
   * route TEMPLATE, status, error code, the caller's user id/role (when known) and IP. Never a body, a query string, a token or a phone.
   * Alerting: a burst of `security.access_denied` from one user (BOLA probing), `security.auth_failed` across many accounts from one
   * IP (credential stuffing), or `security.rate_limited` on auth routes.
   */
  SECURITY_AUTH_FAILED: 'security.auth_failed',
  SECURITY_ACCESS_DENIED: 'security.access_denied',
  SECURITY_RATE_LIMITED: 'security.rate_limited',
  /** A refused money-moving request (400/409 on payment / wallet / refund / loyalty / settlement / cash-remainder routes): over-refund, replayed key, double claim. */
  SECURITY_FINANCIAL_REJECTED: 'security.financial_rejected',
} as const;

export type BusinessEventName = (typeof BusinessEvent)[keyof typeof BusinessEvent];

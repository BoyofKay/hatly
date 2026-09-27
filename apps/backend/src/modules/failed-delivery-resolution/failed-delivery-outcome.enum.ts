/**
 * Failed Delivery Resolution (Chunk 2b). Exactly two values —
 * CONFIRMED per the approved design: DRIVER_REVIEW is deliberately
 * NOT a value here (it's the orthogonal `driverReviewNeeded`/
 * `driverReviewNotes` pair on the entity instead, since "needs
 * investigation" and "the customer-financial outcome" are two
 * independent facts, not mutually exclusive states).
 */
export enum FailedDeliveryOutcome {
  RESOLVED_NO_REFUND = 'RESOLVED_NO_REFUND',
  REFUND_CUSTOMER = 'REFUND_CUSTOMER',
}

/**
 * Every event type approved for Phase F. Each is a distinct, immutable
 * fact — never a step toward a mutable balance. See FinancialEvent's
 * own doc comment for the append-only architecture this enum serves.
 *
 * CONFIRMED (Phase F): three genuinely distinct event families that
 * must never be conflated:
 *   - VENDOR_COMMISSION_RECOGNIZED: Hatly's receivable from a vendor.
 *   - DRIVER_COMMISSION_RECOGNIZED: Hatly's payable-reduction against a
 *     driver's delivery-fee earnings (i.e. Hatly's cut of it).
 *   - DRIVER_REIMBURSEMENT_OWED: Hatly-to-driver obligation for money
 *     the driver spent out of pocket — explicitly NOT earnings, NOT
 *     vendor settlement (confirmed decision 6).
 */
export enum FinancialEventType {
  VENDOR_COMMISSION_RECOGNIZED = 'VENDOR_COMMISSION_RECOGNIZED',
  DRIVER_COMMISSION_RECOGNIZED = 'DRIVER_COMMISSION_RECOGNIZED',
  DRIVER_REIMBURSEMENT_OWED = 'DRIVER_REIMBURSEMENT_OWED',
  HATLY_SERVICE_CHARGE_RECOGNIZED = 'HATLY_SERVICE_CHARGE_RECOGNIZED',
  CANCELLATION_WITH_PRIOR_EXPENSE_RECORDED = 'CANCELLATION_WITH_PRIOR_EXPENSE_RECORDED',
  FAILED_DELIVERY_RECORDED = 'FAILED_DELIVERY_RECORDED',
  MANUAL_TRANSFER_REFUND_RECORDED = 'MANUAL_TRANSFER_REFUND_RECORDED',
  EMPLOYEE_LOAN_ISSUED = 'EMPLOYEE_LOAN_ISSUED',
  EMPLOYEE_LOAN_REPAYMENT_RECORDED = 'EMPLOYEE_LOAN_REPAYMENT_RECORDED',
  /**
   * Phase G addition (Offers & Promotions). CONFIRMED: Offers are
   * Hatly-funded — Vendor commission is calculated on the PRE-OFFER
   * amount (segment.subtotalMinor is genuinely unchanged by this
   * feature — see OrderFinancialEventsService, which required zero
   * modification). This event is the audit trail for the resulting
   * Hatly-funded promotional cost — informational only, never fed into
   * vendor/driver settlement math, mirroring
   * CANCELLATION_WITH_PRIOR_EXPENSE_RECORDED/FAILED_DELIVERY_RECORDED's
   * own "record the fact, invent no new money movement into
   * settlement" shape. Recorded once per OfferConsumption, at order
   * creation (the discount is known immediately — unlike weight, there
   * is no later-known-amount concern here).
   */
  HATLY_FUNDED_OFFER_DISCOUNT_RECORDED = 'HATLY_FUNDED_OFFER_DISCOUNT_RECORDED',
  /**
   * PD-015 — the COMPENSATING event for HATLY_FUNDED_OFFER_DISCOUNT_RECORDED. When a vendor part is rejected (or the order is
   * cancelled) its offer consumption is reversed (PD-014) and the discount Hatly would have funded is no longer a cost. The original
   * event is never touched; this one is appended, once per reversed OfferConsumption row (key `hatly-funded-offer-discount-restored:<consumptionId>`),
   * linked to the original (`relatedEventId`) and to the affected segment (`orderVendorSegmentId`). `amountMinor` is POSITIVE (the
   * amount restored); the net Hatly-funded cost of an order = recorded - restored (see FinancialEventService.hatlyFundedDiscountSummary).
   * Informational like the original: it never enters vendor/driver settlement and moves no money.
   */
  HATLY_FUNDED_OFFER_DISCOUNT_RESTORED = 'HATLY_FUNDED_OFFER_DISCOUNT_RESTORED',
}

/**
 * Direction of money relative to Hatly — a signed-amount convention,
 * not a mutable balance. RECEIVABLE = Hatly is owed money (e.g. vendor
 * commission). PAYABLE = Hatly owes money out (e.g. driver
 * reimbursement). INFORMATIONAL = no money movement, an audit record
 * only (e.g. a cancellation context note, a failed-delivery record
 * with no penalty attached).
 */
export enum FinancialEventDirection {
  RECEIVABLE = 'RECEIVABLE',
  PAYABLE = 'PAYABLE',
  INFORMATIONAL = 'INFORMATIONAL',
}

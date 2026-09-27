/**
 * Abstraction every payment method must implement. Business logic
 * (order creation, checkout) depends only on this interface — never on
 * a concrete provider — so an online gateway can be added later
 * without touching the order flow. See spec section 15.
 */
export interface PaymentChargeResult {
  success: boolean;
  providerReference?: string;
  failureReason?: string;
}

export interface PaymentProvider {
  readonly method: 'COD' | 'ONLINE';

  /**
   * For COD this is a no-op that always succeeds (payment happens
   * physically on delivery). For an online provider this would create
   * a charge/payment-intent and return its reference for later
   * verification via webhook — never trust a client-reported "payment
   * succeeded" without server-side verification.
   */
  charge(params: { orderId: string; amountMinor: number }): Promise<PaymentChargeResult>;
}

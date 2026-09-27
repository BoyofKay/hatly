import { Injectable } from '@nestjs/common';
import { PaymentChargeResult, PaymentProvider } from '../payment-provider.interface';

/**
 * Cash on Delivery — the only active payment method for V1 (spec
 * section 6). "Charging" here just means the order is allowed to
 * proceed; the actual cash exchange happens at delivery, reconciled
 * by the driver/vendor settlement process, not by this call.
 */
@Injectable()
export class CodPaymentProvider implements PaymentProvider {
  readonly method = 'COD' as const;

  async charge(_params: { orderId: string; amountMinor: number }): Promise<PaymentChargeResult> {
    return { success: true };
  }
}

/**
 * PLACEHOLDER for a future online provider (Paymob/Fawry/etc. — not
 * yet chosen, see Phase 0 "NEEDS CONFIRMATION"). Do not implement
 * against a specific gateway's SDK until one is selected; when it is,
 * add e.g. `paymob-payment.provider.ts` implementing this same
 * PaymentProvider interface and wire it up in payments.module.ts.
 */

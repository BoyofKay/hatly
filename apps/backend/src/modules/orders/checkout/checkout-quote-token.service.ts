import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { DeliveryFeeBreakdown } from '../../delivery-fee/delivery-fee-calculation.service';

/** The amounts a customer confirmed. The order is only created if the server still computes exactly these. */
export interface QuotedAmounts {
  subtotalMinor: number;
  discountMinor: number;
  deliveryFeeMinor: number | null;
  totalMinor: number | null;
  walletAppliedMinor: number;
  amountDueMinor: number | null;
}

export interface QuoteTokenPayload {
  v: 1;
  /** customer id — a token is useless to anyone else */
  cid: string;
  /** expiry, epoch seconds */
  exp: number;
  /** fingerprint of the inputs the quote was made for (see CheckoutPlannerService) */
  ih: string;
  /** the frozen registered-vendor delivery breakdown (null for pickup / ad-hoc) */
  breakdown: DeliveryFeeBreakdown | null;
  amounts: QuotedAmounts;
}

export type QuoteTokenVerification =
  | { status: 'VALID'; payload: QuoteTokenPayload }
  | { status: 'EXPIRED'; payload: QuoteTokenPayload }
  | { status: 'INVALID' };

/**
 * Signs and verifies the quote the customer confirmed. The token is opaque to the client and HMAC-signed by the server, so a
 * client can neither forge a cheaper delivery breakdown nor alter the amounts it confirmed — and it still decides nothing:
 * the order is priced by the server, the token only says "this is what you showed me, and this is the fee you froze for it".
 */
@Injectable()
export class CheckoutQuoteTokenService {
  constructor(private readonly configService: ConfigService) {}

  private key(): Buffer {
    const secret = this.configService.get<string>('auth.accessSecret') ?? '';
    return createHmac('sha256', secret).update('hatly-checkout-quote-v1').digest();
  }

  private mac(body: string): Buffer {
    return createHmac('sha256', this.key()).update(body).digest();
  }

  sign(payload: QuoteTokenPayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${this.mac(body).toString('base64url')}`;
  }

  verify(token: string, customerId: string, nowSeconds = Math.floor(Date.now() / 1000)): QuoteTokenVerification {
    const [body, signature, ...rest] = token.split('.');
    if (!body || !signature || rest.length > 0) return { status: 'INVALID' };

    const expected = this.mac(body);
    let given: Buffer;
    try {
      given = Buffer.from(signature, 'base64url');
    } catch {
      return { status: 'INVALID' };
    }
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { status: 'INVALID' };

    let payload: QuoteTokenPayload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return { status: 'INVALID' };
    }
    if (payload?.v !== 1 || payload.cid !== customerId) return { status: 'INVALID' };
    return payload.exp > nowSeconds ? { status: 'VALID', payload } : { status: 'EXPIRED', payload };
  }
}

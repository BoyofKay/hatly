import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsProvider, SmsSendResult } from '../sms-provider.interface';
import { normalizeEgyptianPhoneForUnifonic } from './normalize-egyptian-phone-for-unifonic';
import { RequestContextService } from '../../../common/request-context/request-context.service';
import { logBusinessEvent } from '../../../common/logging/log-business-event';
import { BusinessEvent } from '../../../common/logging/business-events';

/**
 * Real implementation of SmsProvider, using Unifonic's official REST
 * SMS API (POST https://el.cloud.unifonic.com/rest/SMS/messages).
 * Unifonic is ONLY the delivery layer here — OtpService remains fully
 * authoritative for generation/hashing/storage/verification/TTL/
 * attempts; nothing about that changes in this file, and this class
 * has no awareness of Redis, OTP codes as a concept, or
 * CUSTOMER_OTP_ENABLED at all — it only ever sees the already-composed
 * message body OtpService hands it.
 *
 * Uses Node's built-in global `fetch` (Node 18+) — no HTTP client
 * dependency exists anywhere in this backend today (confirmed by
 * inspection), and adding one (axios, node-fetch, etc.) for this one
 * call would be a new dependency this chunk doesn't need.
 *
 * Fail-closed by design: every failure path below returns
 * `{ success: false }` rather than throwing — OtpService (the caller)
 * is what decides how to fail closed for the Customer-facing request;
 * this class's job is only to accurately report whether Unifonic
 * accepted the message, never to decide what that means for
 * authentication.
 */
@Injectable()
export class UnifonicSmsProvider implements SmsProvider {
  private readonly logger = new Logger(UnifonicSmsProvider.name);
  private static readonly ENDPOINT = 'https://el.cloud.unifonic.com/rest/SMS/messages';
  private static readonly TIMEOUT_MS = 10_000;

  constructor(
    private readonly configService: ConfigService,
    private readonly requestContextService: RequestContextService,
  ) {}

  private logFailure(operation: string, reason: string): void {
    logBusinessEvent(this.logger, 'error', BusinessEvent.EXTERNAL_PROVIDER_FAILED, () => this.requestContextService.getCorrelationId(), {
      provider: 'unifonic',
      operation,
      reason,
    });
  }

  async sendSms(params: { to: string; body: string }): Promise<SmsSendResult> {
    const appSid = this.configService.get<string>('sms.unifonicAppSid');
    const senderId = this.configService.get<string>('sms.unifonicSenderId');

    // CONFIRMED (this chunk's explicit requirement): missing
    // configuration fails the SAME way a provider rejection does —
    // never a silent fallback to fake success or local-only logging.
    if (!appSid || !senderId) {
      this.logFailure('send_sms', 'not_configured');
      return { success: false };
    }

    const recipient = normalizeEgyptianPhoneForUnifonic(params.to);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UnifonicSmsProvider.TIMEOUT_MS);

    try {
      const response = await fetch(UnifonicSmsProvider.ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          AppSid: appSid,
          SenderID: senderId,
          Recipient: recipient,
          Body: params.body,
          responseType: 'JSON',
        }).toString(),
        signal: controller.signal,
      });

      if (!response.ok) {
        // Never log response internals that might echo back request
        // parameters (which would include AppSid) — status code only.
        this.logFailure('send_sms', `http_${response.status}`);
        return { success: false };
      }

      let data: any;
      try {
        data = await response.json();
      } catch {
        this.logFailure('send_sms', 'malformed_response');
        return { success: false };
      }

      // Unifonic's success envelope nests the message under `data`
      // with a `MessageID`; a missing MessageID on an otherwise-200
      // response is treated as a failure — CONFIRMED, per this
      // chunk's explicit "missing MessageID where the API contract
      // indicates one should exist" failure case.
      const messageId = data?.data?.MessageID as string | undefined;
      if (!messageId) {
        this.logFailure('send_sms', 'missing_message_id');
        return { success: false };
      }

      return { success: true, providerMessageId: messageId };
    } catch (error) {
      if ((error as any)?.name === 'AbortError') {
        this.logFailure('send_sms', 'timeout');
      } else {
        // Never log the raw error object — it could contain request
        // internals. Log only that a failure occurred.
        this.logFailure('send_sms', 'unexpected_error');
      }
      return { success: false };
    } finally {
      clearTimeout(timeout);
    }
  }
}

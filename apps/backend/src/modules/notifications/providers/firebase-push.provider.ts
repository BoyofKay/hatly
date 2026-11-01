import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { PushNotificationProvider, PushSendResult } from '../push-provider.interface';
import { RequestContextService } from '../../../common/request-context/request-context.service';
import { logBusinessEvent } from '../../../common/logging/log-business-event';
import { BusinessEvent } from '../../../common/logging/business-events';

/**
 * Real implementation of PushNotificationProvider using the Firebase
 * Admin SDK — CONFIRMED: `firebase-admin` was not previously a
 * dependency of this backend (checked package.json), added as the
 * minimum necessary dependency for this chunk, per the explicit
 * instruction not to hand-roll Firebase's HTTP protocol.
 *
 * `fcm.projectId`/`clientEmail`/`privateKey` were ALREADY reserved,
 * unused config keys (configuration.ts) — this is the first thing to
 * actually read them. Never hardcoded, never logged.
 *
 * Fail-closed by design, same discipline as UnifonicSmsProvider: every
 * failure path returns `{ success: false, invalidTokens: [] }` rather
 * than throwing — PushNotificationService (the caller) decides how to
 * handle that (log-and-continue, per this chunk's explicit "push
 * failure must never break the assignment" requirement), never this
 * class.
 *
 * Security milestone: uses the MODULAR Admin API (`firebase-admin/app`, `firebase-admin/messaging`). The namespaced API this used
 * before (`admin.apps`, `admin.credential.cert`, `admin.messaging(app)`) was removed in firebase-admin 14 — the release that drops the
 * vulnerable `node-forge` dependency — while the modular API exists unchanged from v11 through v14, so the same code runs on both.
 */
@Injectable()
export class FirebasePushNotificationProvider implements PushNotificationProvider, OnModuleInit {
  private readonly logger = new Logger(FirebasePushNotificationProvider.name);
  private app: App | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly requestContextService: RequestContextService,
  ) {}

  private logFailure(level: 'warn' | 'error', operation: string, reason: string): void {
    logBusinessEvent(this.logger, level, BusinessEvent.EXTERNAL_PROVIDER_FAILED, () => this.requestContextService.getCorrelationId(), {
      provider: 'fcm',
      operation,
      reason,
    });
  }

  onModuleInit(): void {
    const projectId = this.configService.get<string>('fcm.projectId');
    const clientEmail = this.configService.get<string>('fcm.clientEmail');
    const privateKey = this.configService.get<string>('fcm.privateKey');

    if (!projectId || !clientEmail || !privateKey) {
      // CONFIRMED (this chunk's explicit requirement): missing
      // configuration fails closed — no fake/no-op Firebase app is
      // constructed. `this.app` stays null; every send call below
      // reports failure without ever touching Firebase. Kept at WARN,
      // not ERROR — same level this already used before this group,
      // since a not-yet-configured environment (e.g. local dev) is not
      // itself a production anomaly.
      this.logFailure('warn', 'init', 'not_configured');
      return;
    }

    const existing = getApps();
    if (existing.length > 0) {
      // Reuse an already-initialized app rather than initializing a
      // second one — CONFIRMED "no duplicate Firebase initialization".
      this.app = existing[0];
      return;
    }

    this.app = initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        // Env vars commonly escape real newlines as literal "\n" —
        // Firebase's SDK requires the real character.
        privateKey: privateKey.replace(/\\n/g, '\n'),
      }),
    });
  }

  isConfigured(): boolean {
    return this.app !== null;
  }

  async sendToTokens(params: {
    tokens: string[];
    title: string;
    body: string;
    data: Record<string, string>;
  }): Promise<PushSendResult> {
    if (!this.app || params.tokens.length === 0) {
      return { success: false, invalidTokens: [] };
    }

    try {
      const response = await getMessaging(this.app).sendEachForMulticast({
        tokens: params.tokens,
        notification: { title: params.title, body: params.body },
        data: params.data,
      });

      const invalidTokens: string[] = [];
      response.responses.forEach((r, index) => {
        if (!r.success) {
          const code = r.error?.code;
          // Firebase's own documented error codes for a token that
          // will never succeed again — CONFIRMED: only these specific
          // codes mark a token invalid; any other failure (e.g. a
          // transient internal error) leaves the token untouched.
          if (
            code === 'messaging/invalid-registration-token' ||
            code === 'messaging/registration-token-not-registered'
          ) {
            invalidTokens.push(params.tokens[index]);
          }
        }
      });

      return { success: response.successCount > 0, invalidTokens };
    } catch (error) {
      this.logFailure('error', 'send_multicast', 'unexpected_error');
      return { success: false, invalidTokens: [] };
    }
  }
}

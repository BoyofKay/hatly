import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';

/**
 * The single network edge of Admin Web Push: standard Web Push (RFC 8030 + VAPID RFC 8292, payload encrypted per RFC 8291) sent straight to
 * the browser vendor's push service — no Firebase project, no paid service. Configuration comes only from the environment:
 *   WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY (generate once with `npx web-push generate-vapid-keys`), WEB_PUSH_SUBJECT
 *   (`mailto:` or `https:` contact the push services may use). When any is missing, Web Push is reported as NOT configured: nothing is sent
 *   and nothing pretends to be. The private key never leaves this class (never logged, never returned).
 */
export const WEB_PUSH_SENDER = Symbol('WEB_PUSH_SENDER');

export interface WebPushTarget { endpoint: string; p256dh: string; auth: string }
export interface WebPushSendResult { statusCode: number }
export interface WebPushSender {
  isConfigured(): boolean;
  publicKey(): string | null;
  /** Resolves with the push service's HTTP status for every HTTP answer (2xx or not); rejects only when no answer came (network/timeout). */
  send(target: WebPushTarget, payload: string, options: { ttlSeconds: number; urgency: 'high' | 'normal'; topic?: string }): Promise<WebPushSendResult>;
}

/** Push services Hatly may POST to. A subscription endpoint anywhere else is refused (it would let a caller make the API call arbitrary URLs). */
const ALLOWED_PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];
export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.port && ALLOWED_PUSH_HOSTS.some((re) => re.test(url.hostname));
  } catch {
    return false;
  }
}

@Injectable()
export class VapidWebPushSender implements WebPushSender {
  private readonly logger = new Logger(VapidWebPushSender.name);
  private readonly vapid: { publicKey: string; privateKey: string; subject: string } | null;

  constructor() {
    const publicKey = (process.env.WEB_PUSH_VAPID_PUBLIC_KEY ?? '').trim();
    const privateKey = (process.env.WEB_PUSH_VAPID_PRIVATE_KEY ?? '').trim();
    const subject = (process.env.WEB_PUSH_SUBJECT ?? '').trim();
    this.vapid = publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
    if (this.vapid) {
      try {
        webpush.getVapidHeaders('https://fcm.googleapis.com', subject, publicKey, privateKey, 'aes128gcm'); // validates the key pair and subject once at boot
      } catch (error) {
        this.logger.error(`Web Push is NOT configured: the VAPID settings were rejected (${(error as Error).message.replace(/[A-Za-z0-9_-]{40,}/g, '[key]')}).`);
        this.vapid = null;
      }
    }
  }

  isConfigured(): boolean {
    return this.vapid !== null;
  }

  publicKey(): string | null {
    return this.vapid?.publicKey ?? null;
  }

  async send(target: WebPushTarget, payload: string, options: { ttlSeconds: number; urgency: 'high' | 'normal'; topic?: string }): Promise<WebPushSendResult> {
    if (!this.vapid) throw new Error('WEB_PUSH_NOT_CONFIGURED');
    if (!isAllowedPushEndpoint(target.endpoint)) return { statusCode: 400 };
    try {
      const res = await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, payload, {
        vapidDetails: this.vapid,
        TTL: options.ttlSeconds,
        urgency: options.urgency,
        ...(options.topic ? { topic: options.topic } : {}),
        timeout: 10_000,
        contentEncoding: 'aes128gcm',
      });
      return { statusCode: res.statusCode };
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (typeof statusCode === 'number' && statusCode > 0) return { statusCode };
      throw error;
    }
  }
}

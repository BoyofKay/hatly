import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { isAllowedPushEndpoint, WEB_PUSH_SENDER, WebPushSender } from './web-push-sender';

/** Back-off between attempts of one delivery: 15 s, 30 s, 60 s, 120 s (capped at 10 min). */
const BACKOFF_BASE_SECONDS = 15;
const BACKOFF_MAX_SECONDS = 600;
const LEASE_SECONDS = 60;
const BATCH = 50;
const RETENTION_DAYS = 30;
/** How long a push service keeps a message for an offline device. After that, the in-app list (and the next repeat) still carry the alert. */
const TTL_SECONDS = 3600;
/** A subscription that fails this many times in a row (without any success) is revoked. */
const MAX_CONSECUTIVE_FAILURES = 20;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => new NotFoundException({ message: 'Not found.', details: { code: 'NOT_FOUND' } });

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
  priority: 'CRITICAL' | 'HIGH' | 'TEST';
  alertId?: string;
  renotify?: boolean;
}

/**
 * Admin Web Push: device subscriptions (each owned by exactly one Admin user), the delivery queue and its worker, device receipts and tests.
 *
 * Delivery is at-least-once with a lease (a crash between "the push service accepted it" and "ACCEPTED recorded" can resend once; the
 * notification `tag` makes the device replace rather than stack it). Stages are never inflated: ACCEPTED means only that the push service
 * took the message; displayed/clicked are recorded only when the device's service worker reports them with the one-time receipt token
 * that was inside that very message (stored here only as a SHA-256 hash).
 */
@Injectable()
export class AdminPushService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AdminPushService.name);
  private timer?: NodeJS.Timeout;
  private busy = false;
  private lastPurgeAt = 0;

  constructor(
    private readonly ds: DataSource,
    @Inject(WEB_PUSH_SENDER) private readonly sender: WebPushSender,
  ) {}

  onApplicationBootstrap(): void {
    const interval = Number(process.env.ADMIN_PUSH_WORKER_INTERVAL_MS ?? 3000);
    if (process.env.JOBS_WORKER_ENABLED === 'false' || !(interval > 0)) return;
    if (!this.sender.isConfigured()) this.logger.warn('Admin Web Push is not configured (WEB_PUSH_VAPID_PUBLIC_KEY / WEB_PUSH_VAPID_PRIVATE_KEY / WEB_PUSH_SUBJECT): in-app alarms only.');
    this.timer = setInterval(() => void this.tick(), interval);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  config() {
    return { configured: this.sender.isConfigured(), publicKey: this.sender.publicKey() };
  }

  // ------------------------------------------------------------------------------------------------------------------------ subscriptions

  async subscribe(userId: string, input: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; deviceLabel?: unknown }, userAgent?: string) {
    if (!this.sender.isConfigured()) throw new ConflictException({ message: 'Push notifications are not set up on the server yet.', details: { code: 'WEB_PUSH_NOT_CONFIGURED' } });
    const endpoint = typeof input?.endpoint === 'string' ? input.endpoint.trim() : '';
    const p256dh = typeof input?.keys?.p256dh === 'string' ? input.keys.p256dh.trim() : '';
    const auth = typeof input?.keys?.auth === 'string' ? input.keys.auth.trim() : '';
    if (!endpoint || endpoint.length > 1000 || !isAllowedPushEndpoint(endpoint)) throw new BadRequestException({ message: 'This browser push address is not accepted.', details: { code: 'PUSH_ENDPOINT_NOT_ALLOWED' } });
    if (!/^[A-Za-z0-9_-]{60,120}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,40}$/.test(auth)) throw new BadRequestException({ message: 'The browser push keys are invalid.', details: { code: 'VALIDATION_FAILED' } });
    const label = typeof input?.deviceLabel === 'string' ? input.deviceLabel.trim().slice(0, 80) || null : null;
    // One row per endpoint. Re-registering the same browser (any account) takes it over, so a device never notifies its previous user.
    const [row] = await this.ds.query(
      `INSERT INTO admin_push_subscriptions (user_id, endpoint, p256dh, auth, device_label, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ON CONSTRAINT "UQ_admin_push_subscriptions_endpoint" DO UPDATE
         SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, device_label = COALESCE(EXCLUDED.device_label, admin_push_subscriptions.device_label),
             user_agent = EXCLUDED.user_agent, revoked_at = NULL, revoked_reason = NULL, consecutive_failures = 0, updated_at = now()
       RETURNING id`,
      [userId, endpoint, p256dh, auth, label, (userAgent ?? '').slice(0, 300) || null],
    );
    return (await this.listFor(userId)).find((s: { id: string }) => s.id === row.id)!;
  }

  async listFor(userId: string) {
    const rows = await this.ds.query(
      `SELECT s.id, s.device_label, s.user_agent, s.created_at, s.updated_at, s.last_success_at, s.last_failure_at, s.last_failure_reason, s.revoked_at, s.revoked_reason,
              (SELECT max(d.displayed_at) FROM admin_push_deliveries d WHERE d.subscription_id = s.id) AS last_displayed_at,
              (SELECT max(d.clicked_at) FROM admin_push_deliveries d WHERE d.subscription_id = s.id) AS last_clicked_at,
              (SELECT max(d.accepted_at) FROM admin_push_deliveries d WHERE d.subscription_id = s.id AND d.kind = 'TEST') AS last_test_accepted_at,
              (SELECT max(d.displayed_at) FROM admin_push_deliveries d WHERE d.subscription_id = s.id AND d.kind = 'TEST') AS last_test_displayed_at,
              right(s.endpoint, 16) AS endpoint_tail, split_part(split_part(s.endpoint, '://', 2), '/', 1) AS push_service
         FROM admin_push_subscriptions s WHERE s.user_id = $1 ORDER BY (s.revoked_at IS NULL) DESC, s.updated_at DESC LIMIT 50`,
      [userId],
    );
    return rows.map((r: any) => ({
      id: r.id, deviceLabel: r.device_label, userAgent: r.user_agent, pushService: r.push_service, endpointTail: r.endpoint_tail, active: !r.revoked_at,
      createdAt: r.created_at, updatedAt: r.updated_at, lastSuccessAt: r.last_success_at, lastFailureAt: r.last_failure_at, lastFailureReason: r.last_failure_reason,
      revokedAt: r.revoked_at, revokedReason: r.revoked_reason, lastDisplayedAt: r.last_displayed_at, lastClickedAt: r.last_clicked_at,
      lastTestAcceptedAt: r.last_test_accepted_at, lastTestDisplayedAt: r.last_test_displayed_at,
    }));
  }

  /** Finds the caller's own subscription for a browser endpoint (so a device can tell whether IT is registered). */
  async findOwnByEndpoint(userId: string, endpoint: string) {
    const [row] = await this.ds.query(`SELECT id FROM admin_push_subscriptions WHERE user_id = $1 AND endpoint = $2`, [userId, endpoint]);
    if (!row) return null;
    return (await this.listFor(userId)).find((s: { id: string }) => s.id === row.id) ?? null;
  }

  async unsubscribe(userId: string, id: string) {
    if (!UUID_RE.test(id)) throw notFound();
    const [rows] = await this.ds.query(
      `UPDATE admin_push_subscriptions SET revoked_at = COALESCE(revoked_at, now()), revoked_reason = COALESCE(revoked_reason, 'REMOVED_BY_USER'), updated_at = now()
        WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, userId],
    ); // UPDATE … RETURNING answers [rows, count]
    if (rows.length === 0) throw notFound();
    await this.ds.query(`UPDATE admin_push_deliveries SET status = 'SKIPPED', skip_reason = 'SUBSCRIPTION_REMOVED', updated_at = now() WHERE subscription_id = $1 AND status IN ('QUEUED','FAILED')`, [id]);
    return { removed: true };
  }

  // ------------------------------------------------------------------------------------------------------------------------------- queueing

  /** Queues one delivery per ACTIVE device of each recipient for this alert round (idempotent per alert/device/round), in the caller's transaction. */
  async enqueueAlert(m: EntityManager, alertId: string, round: number, recipients: string[]): Promise<number> {
    if (!this.sender.isConfigured() || recipients.length === 0) return 0;
    const rows = await m.query(
      `INSERT INTO admin_push_deliveries (subscription_id, alert_id, kind, round)
       SELECT s.id, $1, 'ALERT', $2 FROM admin_push_subscriptions s WHERE s.user_id = ANY($3) AND s.revoked_at IS NULL
       ON CONFLICT DO NOTHING RETURNING id`,
      [alertId, round, recipients],
    );
    return rows.length;
  }

  async sendTest(userId: string, subscriptionId: string) {
    if (!this.sender.isConfigured()) throw new ConflictException({ message: 'Push notifications are not set up on the server yet.', details: { code: 'WEB_PUSH_NOT_CONFIGURED' } });
    if (!UUID_RE.test(subscriptionId)) throw notFound();
    const [sub] = await this.ds.query(`SELECT id FROM admin_push_subscriptions WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, [subscriptionId, userId]);
    if (!sub) throw notFound();
    const [row] = await this.ds.query(`INSERT INTO admin_push_deliveries (subscription_id, kind, max_attempts) VALUES ($1, 'TEST', 3) RETURNING id`, [subscriptionId]);
    return this.deliveryFor(userId, row.id);
  }

  async deliveryFor(userId: string, id: string) {
    if (!UUID_RE.test(id)) throw notFound();
    const [r] = await this.ds.query(
      `SELECT d.id, d.kind, d.status, d.attempts, d.created_at, d.accepted_at, d.displayed_at, d.clicked_at, d.last_error, d.skip_reason
         FROM admin_push_deliveries d JOIN admin_push_subscriptions s ON s.id = d.subscription_id WHERE d.id = $1 AND s.user_id = $2`,
      [id, userId],
    );
    if (!r) throw notFound();
    return { id: r.id, kind: r.kind, status: r.status, attempts: r.attempts, queuedAt: r.created_at, acceptedAt: r.accepted_at, displayedAt: r.displayed_at, clickedAt: r.clicked_at, lastError: r.last_error, skipReason: r.skip_reason };
  }

  // ------------------------------------------------------------------------------------------------------------------------------ receipts

  /** The device's service worker reports what happened to one message. Proven only by the one-time token that message carried. */
  async receipt(input: { deliveryId?: unknown; token?: unknown; event?: unknown }) {
    const id = typeof input?.deliveryId === 'string' ? input.deliveryId : '';
    const token = typeof input?.token === 'string' ? input.token : '';
    const event = input?.event;
    if (!UUID_RE.test(id) || !/^[A-Za-z0-9_-]{20,100}$/.test(token) || (event !== 'displayed' && event !== 'clicked')) throw notFound();
    const [row] = await this.ds.query(`SELECT receipt_token_hash FROM admin_push_deliveries WHERE id = $1`, [id]);
    const expected = Buffer.from(String(row?.receipt_token_hash ?? ''), 'utf8');
    const actual = Buffer.from(sha256(token), 'utf8');
    if (!row?.receipt_token_hash || expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw notFound();
    const column = event === 'displayed' ? 'displayed_at' : 'clicked_at';
    // A click implies it was displayed (some platforms show without running the handler's receipt in time).
    await this.ds.query(
      `UPDATE admin_push_deliveries SET ${column} = COALESCE(${column}, now())${event === 'clicked' ? ', displayed_at = COALESCE(displayed_at, now())' : ''}, updated_at = now() WHERE id = $1`,
      [id],
    );
    return { recorded: event };
  }

  // -------------------------------------------------------------------------------------------------------------------------------- worker

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.processBatch();
      if (Date.now() - this.lastPurgeAt > 3600_000) {
        this.lastPurgeAt = Date.now();
        await this.ds.query(
          `DELETE FROM admin_push_deliveries WHERE status IN ('ACCEPTED','EXPIRED','DEAD','SKIPPED') AND created_at < now() - ($1 || ' days')::interval`,
          [String(RETENTION_DAYS)],
        );
      }
    } catch (error) {
      this.logger.error(`Admin push worker tick failed: ${(error as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  /** Claims due deliveries (lease) and sends them. Returns counts, for tests and diagnostics. */
  async processBatch(): Promise<{ accepted: number; failed: number; expired: number; dead: number; skipped: number }> {
    const stats = { accepted: 0, failed: 0, expired: 0, dead: 0, skipped: 0 };
    if (!this.sender.isConfigured()) return stats;
    const token = randomUUID();
    const [rows]: [any[], number] = await this.ds.query(
      `UPDATE admin_push_deliveries d SET status = 'SENDING', lock_token = $1, locked_until = now() + ($2 || ' seconds')::interval, attempts = d.attempts + 1, updated_at = now()
        WHERE d.id IN (
          SELECT id FROM admin_push_deliveries
           WHERE (status IN ('QUEUED','FAILED') AND next_attempt_at <= now()) OR (status = 'SENDING' AND locked_until < now())
           ORDER BY next_attempt_at, created_at LIMIT $3 FOR UPDATE SKIP LOCKED)
        RETURNING d.id, d.subscription_id, d.alert_id, d.kind, d.round, d.attempts, d.max_attempts`,
      [token, String(LEASE_SECONDS), BATCH],
    );
    for (const row of rows) {
      const outcome = await this.deliver(row).catch((error) => ({ kind: 'retry' as const, error: `ERROR: ${(error as Error).message}`.slice(0, 300) }));
      await this.finish(row, token, outcome);
      stats[outcome.kind === 'accepted' ? 'accepted' : outcome.kind === 'expired' ? 'expired' : outcome.kind === 'skip' ? 'skipped' : outcome.kind === 'dead' ? 'dead' : row.attempts >= row.max_attempts ? 'dead' : 'failed']++;
    }
    return stats;
  }

  private async deliver(row: any): Promise<{ kind: 'accepted' } | { kind: 'skip'; reason: string } | { kind: 'expired'; error: string } | { kind: 'dead'; error: string } | { kind: 'retry'; error: string }> {
    const [sub] = await this.ds.query(`SELECT id, endpoint, p256dh, auth, revoked_at FROM admin_push_subscriptions WHERE id = $1`, [row.subscription_id]);
    if (!sub || sub.revoked_at) return { kind: 'skip', reason: 'SUBSCRIPTION_REMOVED' };
    let message: PushMessage;
    if (row.kind === 'TEST') {
      message = { title: 'Hatly test notification · إشعار تجريبي', body: 'Notifications work on this device. · الإشعارات تعمل على هذا الجهاز.', url: '/notification-setup', tag: `hatly-test-${row.id}`, priority: 'TEST' };
    } else {
      const [alert] = await this.ds.query(`SELECT id, category, priority, order_id, order_number, detail, acknowledged_at, resolved_at FROM ops_alerts WHERE id = $1`, [row.alert_id]);
      if (!alert) return { kind: 'skip', reason: 'ALERT_MISSING' };
      if (alert.resolved_at) return { kind: 'skip', reason: 'RESOLVED' };
      if (alert.acknowledged_at) return { kind: 'skip', reason: 'ACKNOWLEDGED' };
      message = alertMessage(alert, row.round);
    }
    const receiptToken = randomBytes(24).toString('base64url');
    await this.ds.query(`UPDATE admin_push_deliveries SET receipt_token_hash = $2 WHERE id = $1`, [row.id, sha256(receiptToken)]);
    const payload = JSON.stringify({ v: 1, deliveryId: row.id, receiptToken, ...message });
    const res = await this.sender.send({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }, payload, {
      ttlSeconds: TTL_SECONDS,
      urgency: message.priority === 'HIGH' ? 'normal' : 'high',
      topic: row.alert_id ? `a${String(row.alert_id).replace(/-/g, '').slice(0, 31)}` : undefined,
    });
    const code = res.statusCode;
    if (code >= 200 && code < 300) return { kind: 'accepted' };
    if (code === 404 || code === 410) return { kind: 'expired', error: `PUSH_SERVICE_${code}_SUBSCRIPTION_GONE` };
    if (code === 429 || code >= 500) return { kind: 'retry', error: `PUSH_SERVICE_${code}` };
    return { kind: 'dead', error: `PUSH_SERVICE_REFUSED_${code}` };
  }

  private async finish(row: any, token: string, outcome: Awaited<ReturnType<AdminPushService['deliver']>>): Promise<void> {
    const guard = `WHERE id = $1 AND lock_token = $2`;
    if (outcome.kind === 'accepted') {
      await this.ds.query(`UPDATE admin_push_deliveries SET status = 'ACCEPTED', accepted_at = now(), last_error = NULL, lock_token = NULL, locked_until = NULL, updated_at = now() ${guard}`, [row.id, token]);
      await this.ds.query(`UPDATE admin_push_subscriptions SET last_success_at = now(), consecutive_failures = 0, updated_at = now() WHERE id = $1`, [row.subscription_id]);
      return;
    }
    if (outcome.kind === 'skip') {
      await this.ds.query(`UPDATE admin_push_deliveries SET status = 'SKIPPED', skip_reason = $3, lock_token = NULL, locked_until = NULL, updated_at = now() ${guard}`, [row.id, token, outcome.reason]);
      return;
    }
    if (outcome.kind === 'expired') {
      await this.ds.query(`UPDATE admin_push_deliveries SET status = 'EXPIRED', last_error = $3, lock_token = NULL, locked_until = NULL, updated_at = now() ${guard}`, [row.id, token, outcome.error]);
      await this.ds.query(
        `UPDATE admin_push_subscriptions SET revoked_at = COALESCE(revoked_at, now()), revoked_reason = COALESCE(revoked_reason, 'EXPIRED'), last_failure_at = now(), last_failure_reason = $2, updated_at = now() WHERE id = $1`,
        [row.subscription_id, outcome.error],
      );
      await this.ds.query(`UPDATE admin_push_deliveries SET status = 'SKIPPED', skip_reason = 'SUBSCRIPTION_EXPIRED', updated_at = now() WHERE subscription_id = $1 AND status IN ('QUEUED','FAILED')`, [row.subscription_id]);
      return;
    }
    const dead = outcome.kind === 'dead' || row.attempts >= row.max_attempts;
    if (dead) {
      await this.ds.query(`UPDATE admin_push_deliveries SET status = 'DEAD', last_error = $3, lock_token = NULL, locked_until = NULL, updated_at = now() ${guard}`, [row.id, token, outcome.error]);
    } else {
      const delay = Math.min(BACKOFF_BASE_SECONDS * 2 ** (row.attempts - 1), BACKOFF_MAX_SECONDS);
      await this.ds.query(
        `UPDATE admin_push_deliveries SET status = 'FAILED', last_error = $3, next_attempt_at = now() + ($4 || ' seconds')::interval, lock_token = NULL, locked_until = NULL, updated_at = now() ${guard}`,
        [row.id, token, outcome.error, String(delay)],
      );
    }
    await this.ds.query(
      `UPDATE admin_push_subscriptions SET last_failure_at = now(), last_failure_reason = $2, consecutive_failures = consecutive_failures + 1,
              revoked_at = CASE WHEN consecutive_failures + 1 >= $3 AND last_success_at IS NULL THEN now() ELSE revoked_at END,
              revoked_reason = CASE WHEN consecutive_failures + 1 >= $3 AND last_success_at IS NULL THEN 'TOO_MANY_FAILURES' ELSE revoked_reason END,
              updated_at = now() WHERE id = $1`,
      [row.subscription_id, outcome.error, MAX_CONSECUTIVE_FAILURES],
    );
  }

  /** Delivery counts by status (diagnostics; no personal data). */
  async stats() {
    const rows = await this.ds.query(`SELECT status, count(*)::int AS n FROM admin_push_deliveries GROUP BY status`);
    const counts: Record<string, number> = { QUEUED: 0, SENDING: 0, ACCEPTED: 0, FAILED: 0, EXPIRED: 0, DEAD: 0, SKIPPED: 0 };
    for (const r of rows) counts[r.status] = r.n;
    const [{ active }] = await this.ds.query(`SELECT count(*)::int AS active FROM admin_push_subscriptions WHERE revoked_at IS NULL`);
    return { configured: this.sender.isConfigured(), activeSubscriptions: active, deliveries: counts };
  }
}

const CATEGORY_TEXT: Record<string, [string, string]> = {
  NEW_ORDER: ['New order', 'طلب جديد'],
  ACCEPTANCE_OVERDUE: ['Store has not accepted', 'المتجر لم يقبل الطلب'],
  PREPARATION_LATE: ['Preparation is late', 'التحضير متأخر'],
  DRIVER_ACK_OVERDUE: ['Driver has not acknowledged', 'السائق لم يؤكد الاستلام'],
  NO_DRIVER: ['Order needs a driver', 'طلب يحتاج سائقًا'],
  DRIVER_NOT_RESPONDING: ['Driver not responding', 'السائق لا يستجيب'],
  ASSIGNMENT_ERROR: ['Driver assignment failed', 'فشل إسناد السائق'],
  FAILED_DELIVERY: ['Delivery failed', 'فشل التوصيل'],
};

/** The visible text of an alert push. Order number only — never customer names, phones or addresses. */
export function alertMessage(alert: { id: string; category: string; priority: 'CRITICAL' | 'HIGH'; order_id: string | null; order_number: string | null }, round: number): PushMessage {
  const [en, ar] = CATEGORY_TEXT[alert.category] ?? ['Needs attention', 'يحتاج انتباهك'];
  const num = alert.order_number ?? '';
  return {
    title: `${round > 0 ? '⚠ ' : ''}${en} ${num}`.trim() + ` · ${ar}`,
    body: alert.priority === 'CRITICAL' ? 'Open Hatly Admin and acknowledge. · افتح لوحة هاتلي وأكّد الاستلام.' : 'Open Hatly Admin to check. · افتح لوحة هاتلي للمتابعة.',
    url: opsAlertHref(alert),
    tag: `ops-${alert.id}`,
    priority: alert.priority,
    alertId: alert.id,
    renotify: round > 0,
  };
}

/** Where an alert leads: the exact order (the Orders workspace opens it), or the failed-delivery queue. Relative to the Admin origin. */
export function opsAlertHref(alert: { category: string; order_id: string | null }): string {
  if (alert.category === 'FAILED_DELIVERY') return alert.order_id ? `/order-management?order=${alert.order_id}` : '/failed-deliveries';
  return alert.order_id ? `/order-management?order=${alert.order_id}` : '/inbox';
}

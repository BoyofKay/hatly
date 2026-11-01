import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { DeviceTokensService } from '../device-tokens.service';
import { PUSH_NOTIFICATION_PROVIDER, PushNotificationProvider } from '../push-provider.interface';

export type OutboxChannel = 'PUSH' | 'WHATSAPP' | 'SMS' | 'EMAIL';
export type OutboxStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'DEAD' | 'SKIPPED';

export interface OutboxMessage {
  /** Identifies the EVENT (e.g. `exception:<id>:items:2`); with the recipient and channel it is the idempotency key. */
  eventKey: string;
  recipientUserId: string;
  recipientKind: 'CUSTOMER' | 'STAFF';
  channel?: OutboxChannel;
  category: string;
  severity?: 'INFO' | 'CRITICAL';
  title: string;
  body: string;
  /** Small string map sent with the push (`type`, `orderId`, …). No personal data. */
  data?: Record<string, string>;
  /** Record the delivery as deliberately not attempted (e.g. the recipient turned this channel off) instead of queueing it. */
  skipReason?: string;
}

export interface OutboxRunStats {
  claimed: number;
  sent: number;
  skipped: number;
  retried: number;
  dead: number;
  /** Results discarded because another worker had taken over the lease of the row. */
  lostLease: number;
}

const LEASE_SECONDS = 60;
const BACKOFF_BASE_SECONDS = 30;
const BACKOFF_MAX_SECONDS = 3600;
const RETENTION_DAYS = 30;

/**
 * Transactional notification outbox.
 *
 * WRITE SIDE — {@link enqueue} runs inside the CALLER'S transaction (in a savepoint, so a failure is logged and never aborts the business
 * change): the notification exists if and only if the business change committed. `(event_key, recipient, channel)` is unique and the
 * insert is `ON CONFLICT DO NOTHING`, so a retried request, a replayed event or two concurrent writers produce exactly one row.
 *
 * WORKER SIDE — {@link processBatch} leases due rows with `FOR UPDATE SKIP LOCKED` (concurrent workers never take the same row), sends,
 * and records the outcome only while it still holds the lease (a worker that stalled past its lease cannot overwrite the result of the
 * worker that took over). Delivery is AT LEAST ONCE: a crash between "the provider accepted it" and "SENT was recorded" lets the lease
 * expire and the row be sent again; every push carries `eventKey` so a client can ignore a repeat.
 *
 * HONEST STATES — QUEUED → SENDING → SENT | FAILED (retry with exponential back-off) | DEAD (attempts exhausted) | SKIPPED (not attempted,
 * with a reason: NO_DEVICE, PROVIDER_NOT_CONFIGURED, NO_VALID_DEVICE, PREFERENCE_DISABLED). SENT means "the provider accepted it" and
 * nothing more: push gives the server no delivery or open receipt, so there is NO delivered/opened state here — and no code that could
 * claim one. In-app delivery is the inbox row (customer_notifications / staff_notifications) written in the same transaction as the
 * business change, so it never depends on any provider being up.
 */
@Injectable()
export class NotificationOutboxService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(NotificationOutboxService.name);
  private timer?: NodeJS.Timeout;
  private busy = false;
  private lastPurgeAt = 0;

  constructor(
    private readonly ds: DataSource,
    private readonly deviceTokens: DeviceTokensService,
    @Inject(PUSH_NOTIFICATION_PROVIDER) private readonly provider: PushNotificationProvider,
  ) {}

  onApplicationBootstrap(): void {
    const interval = Number(process.env.NOTIFICATION_OUTBOX_WORKER_INTERVAL_MS ?? 5000);
    if (process.env.JOBS_WORKER_ENABLED === 'false' || !(interval > 0)) return;
    this.timer = setInterval(() => void this.tick(), interval);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.processBatch();
      if (Date.now() - this.lastPurgeAt > 3600_000) {
        this.lastPurgeAt = Date.now();
        await this.ds.query(`DELETE FROM notification_outbox WHERE status IN ('SENT','SKIPPED') AND created_at < now() - ($1 || ' days')::interval`, [String(RETENTION_DAYS)]);
      }
    } catch (error) {
      this.logger.error(`Outbox worker tick failed: ${(error as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  // --------------------------------------------------------------------------------------------------------------------------------- write

  /** Returns whether a NEW row was written. Never throws. */
  async enqueue(manager: EntityManager, message: OutboxMessage): Promise<boolean> {
    try {
      return await manager.transaction(async (sp) => {
        const rows: Array<{ id: string }> = await sp.query(
          `INSERT INTO notification_outbox (event_key, recipient_user_id, recipient_kind, channel, category, severity, title, body, data, status, skip_reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
           ON CONFLICT ON CONSTRAINT "UQ_notification_outbox_event_recipient_channel" DO NOTHING
           RETURNING id`,
          [
            message.eventKey.slice(0, 160), message.recipientUserId, message.recipientKind, message.channel ?? 'PUSH', message.category, message.severity ?? 'INFO',
            message.title.slice(0, 160), message.body.slice(0, 400), JSON.stringify(message.data ?? {}), message.skipReason ? 'SKIPPED' : 'QUEUED', message.skipReason ?? null,
          ],
        );
        return rows.length > 0;
      });
    } catch (error) {
      this.logger.error(`Could not enqueue ${message.category} for ${message.recipientUserId}: ${(error as Error).message}`);
      return false;
    }
  }

  // ---------------------------------------------------------------------------------------------------------------------------------- work

  /** Leases and delivers up to `limit` due rows. Safe to run from several workers at once. */
  async processBatch(limit = 25): Promise<OutboxRunStats> {
    const stats: OutboxRunStats = { claimed: 0, sent: 0, skipped: 0, retried: 0, dead: 0, lostLease: 0 };
    const token = randomUUID();
    const rows: any[] = (
      await this.ds.query(
        `UPDATE notification_outbox o
            SET status = 'SENDING', lock_token = $1, locked_until = now() + ($2 || ' seconds')::interval, attempts = o.attempts + 1, updated_at = now()
          WHERE o.id IN (
            SELECT id FROM notification_outbox
             WHERE (status IN ('QUEUED','FAILED') AND next_attempt_at <= now()) OR (status = 'SENDING' AND locked_until < now())
             ORDER BY (severity = 'CRITICAL') DESC, next_attempt_at, created_at
             LIMIT $3
               FOR UPDATE SKIP LOCKED)
          RETURNING o.*`,
        [token, String(LEASE_SECONDS), limit],
      )
    )[0];
    stats.claimed = rows.length;
    for (const row of rows) {
      if (row.attempts > row.max_attempts) {
        // A lease expired on the last allowed attempt: it was tried as often as permitted and its outcome is unknown.
        await this.finish(row, token, stats, { kind: 'retry', error: 'LEASE_EXPIRED_ON_LAST_ATTEMPT' });
        continue;
      }
      await this.finish(row, token, stats, await this.deliver(row));
    }
    return stats;
  }

  private async deliver(row: any): Promise<{ kind: 'sent' } | { kind: 'skip'; reason: string } | { kind: 'retry'; error: string }> {
    if (row.channel !== 'PUSH') return { kind: 'skip', reason: 'PROVIDER_NOT_CONFIGURED' };
    if (this.provider.isConfigured && !this.provider.isConfigured()) return { kind: 'skip', reason: 'PROVIDER_NOT_CONFIGURED' };
    try {
      const tokens = await this.deviceTokens.getActiveTokensForUser(row.recipient_user_id);
      if (tokens.length === 0) return { kind: 'skip', reason: 'NO_DEVICE' };
      const result = await this.provider.sendToTokens({ tokens, title: row.title, body: row.body, data: { ...(row.data ?? {}), eventKey: row.event_key } });
      if (result.invalidTokens.length > 0) await this.deviceTokens.deactivateTokens(result.invalidTokens);
      if (result.success) return { kind: 'sent' };
      if (result.invalidTokens.length >= tokens.length) return { kind: 'skip', reason: 'NO_VALID_DEVICE' };
      return { kind: 'retry', error: 'PROVIDER_REJECTED' };
    } catch (error) {
      return { kind: 'retry', error: `PROVIDER_ERROR: ${(error as Error).message}`.slice(0, 300) };
    }
  }

  private async finish(row: any, token: string, stats: OutboxRunStats, outcome: Awaited<ReturnType<NotificationOutboxService['deliver']>>): Promise<void> {
    let sql: string;
    let params: unknown[];
    if (outcome.kind === 'sent') {
      sql = `UPDATE notification_outbox SET status = 'SENT', sent_at = now(), last_error = NULL, lock_token = NULL, locked_until = NULL, updated_at = now() WHERE id = $1 AND lock_token = $2`;
      params = [row.id, token];
    } else if (outcome.kind === 'skip') {
      sql = `UPDATE notification_outbox SET status = 'SKIPPED', skip_reason = $3, lock_token = NULL, locked_until = NULL, updated_at = now() WHERE id = $1 AND lock_token = $2`;
      params = [row.id, token, outcome.reason];
    } else if (row.attempts >= row.max_attempts) {
      sql = `UPDATE notification_outbox SET status = 'DEAD', last_error = $3, lock_token = NULL, locked_until = NULL, updated_at = now() WHERE id = $1 AND lock_token = $2`;
      params = [row.id, token, outcome.error];
    } else {
      const delay = Math.min(BACKOFF_BASE_SECONDS * 2 ** (row.attempts - 1), BACKOFF_MAX_SECONDS);
      sql = `UPDATE notification_outbox SET status = 'FAILED', last_error = $3, next_attempt_at = now() + ($4 || ' seconds')::interval, lock_token = NULL, locked_until = NULL, updated_at = now() WHERE id = $1 AND lock_token = $2`;
      params = [row.id, token, outcome.error, String(delay)];
    }
    const [, affected] = await this.ds.query(sql, params);
    if (!affected) {
      stats.lostLease++;
      return;
    }
    if (outcome.kind === 'sent') stats.sent++;
    else if (outcome.kind === 'skip') stats.skipped++;
    else if (row.attempts >= row.max_attempts) stats.dead++;
    else stats.retried++;
  }

  // ------------------------------------------------------------------------------------------------------------------------------ reading

  providers() {
    return { push: { configured: this.provider.isConfigured ? this.provider.isConfigured() : true }, whatsapp: { configured: false }, sms: { configured: false }, email: { configured: false } };
  }

  async summary() {
    const rows = await this.ds.query(`SELECT status, count(*)::int AS n FROM notification_outbox GROUP BY status`);
    const counts: Record<string, number> = { QUEUED: 0, SENDING: 0, SENT: 0, FAILED: 0, DEAD: 0, SKIPPED: 0 };
    for (const r of rows) counts[r.status] = r.n;
    const skipped = await this.ds.query(`SELECT skip_reason, count(*)::int AS n FROM notification_outbox WHERE status = 'SKIPPED' GROUP BY skip_reason`);
    const [{ oldest }] = await this.ds.query(`SELECT coalesce(extract(epoch FROM now() - min(created_at)), 0)::int AS oldest FROM notification_outbox WHERE status IN ('QUEUED','FAILED','SENDING')`);
    return { counts, skippedByReason: Object.fromEntries(skipped.map((s: any) => [s.skip_reason, s.n])), oldestPendingSeconds: oldest, providers: this.providers() };
  }

  async list(q: { status?: string; page?: string | number; limit?: string | number }) {
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 25));
    const statuses = (q.status ?? '').split(',').filter((s) => ['QUEUED', 'SENDING', 'SENT', 'FAILED', 'DEAD', 'SKIPPED'].includes(s));
    const where = statuses.length ? 'WHERE status = ANY($1)' : '';
    const params = statuses.length ? [statuses] : [];
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM notification_outbox ${where}`, params);
    const rows = await this.ds.query(
      `SELECT id, event_key, recipient_kind, channel, category, severity, status, attempts, max_attempts, next_attempt_at, last_error, skip_reason, sent_at, created_at
         FROM notification_outbox ${where} ORDER BY created_at DESC, id LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    );
    return {
      items: rows.map((r: any) => ({
        id: r.id, eventKey: r.event_key, recipientKind: r.recipient_kind, channel: r.channel, category: r.category, severity: r.severity, status: r.status, attempts: r.attempts, maxAttempts: r.max_attempts,
        nextAttemptAt: r.next_attempt_at, lastError: r.last_error, skipReason: r.skip_reason, sentAt: r.sent_at, createdAt: r.created_at,
      })),
      page, limit, total,
    };
  }
}

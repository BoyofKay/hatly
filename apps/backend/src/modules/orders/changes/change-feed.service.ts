import { BadRequestException, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';

export type ChangeEntity = 'ORDER' | 'SEGMENT' | 'EXCEPTION';
export interface ChangeItem {
  seq: string;
  entity: ChangeEntity;
  id: string;
  orderId: string;
  kind: string;
}
export interface ChangePage {
  /** Opaque. Send it back as `since` to get what happened after this page. */
  cursor: string;
  changes: ChangeItem[];
  /** More changes are waiting: ask again immediately with the new cursor. */
  hasMore: boolean;
  /** The cursor can no longer be honoured (feed pruned past it, or it is not from this system): reload the list once and continue from `cursor`. */
  reset: boolean;
}

const RETENTION_DAYS = Number(process.env.CHANGE_FEED_RETENTION_DAYS ?? 3);
const MAX_SEQ = '9223372036854775807';
const CURSOR_RE = /^v1\.(\d{1,19})\.(\d{1,19})$/;

/**
 * D-72 change detection. The database writes one small event ("this segment / order / exception changed") in the SAME transaction as the
 * change, through triggers — so no code path can forget it and an event never exists for a change that rolled back. A client asks for what
 * happened after its cursor instead of re-downloading a list.
 *
 * STABLE CURSOR — a plain sequence number is not safe: a transaction that started earlier can commit its (lower-numbered) event after a
 * later one was already read, and the client would skip it forever. Events are therefore ordered by (txid, seq) and returned only when their
 * transaction is older than every transaction still running (`txid < xmin`): anything that commits later necessarily sorts AFTER every
 * event already returned. The price is that an event can appear a moment after its commit (while an older transaction is still open), never
 * before it and never out of order.
 *
 * ENVELOPE — the feed carries ids, kinds and order ids only, never customer data; the client re-reads what it needs through its normal,
 * already-authorized endpoints. Vendors only ever receive events of branches they are linked to.
 */
@Injectable()
export class ChangeFeedService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ChangeFeedService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly ds: DataSource) {}

  onApplicationBootstrap(): void {
    if (process.env.JOBS_WORKER_ENABLED === 'false' || process.env.CHANGE_FEED_PRUNE_INTERVAL_MS === '0') return;
    this.timer = setInterval(() => void this.prune().catch((e) => this.logger.error(`Change feed prune failed: ${(e as Error).message}`)), Number(process.env.CHANGE_FEED_PRUNE_INTERVAL_MS ?? 3600_000));
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Removes events older than the retention window and remembers how far it pruned, so older cursors are answered with `reset`. */
  async prune(retentionDays = RETENTION_DAYS): Promise<number> {
    const rows = await this.ds.query(
      `WITH d AS (DELETE FROM change_events WHERE created_at < now() - ($1 || ' days')::interval RETURNING txid),
            s AS (UPDATE change_feed_state SET pruned_through_txid = greatest(pruned_through_txid, coalesce((SELECT max(txid) FROM d), 0)) WHERE id = 1 RETURNING 1)
       SELECT (SELECT count(*) FROM d)::int AS removed, (SELECT count(*) FROM s) AS touched`,
      [String(retentionDays)],
    );
    return rows[0]?.removed ?? 0;
  }

  /** `entities` limits what is returned; `branchIds` (vendors) limits it to those branches — `null` means "not branch-scoped" (admin). */
  async changes(scope: { entities: ChangeEntity[]; branchIds: string[] | null }, params: { since?: string; limit?: string | number }): Promise<ChangePage> {
    const limit = Math.min(500, Math.max(1, Number(params.limit) || 200));
    const [{ xmin }] = await this.ds.query(`SELECT txid_snapshot_xmin(txid_current_snapshot())::text AS xmin`);
    const baseline = `v1.${BigInt(xmin) - 1n}.${MAX_SEQ}`;

    if (params.since === undefined || params.since === '') return { cursor: baseline, changes: [], hasMore: false, reset: false };
    const m = CURSOR_RE.exec(params.since);
    if (!m) throw new BadRequestException({ message: 'The cursor is not valid.', details: { code: 'INVALID_CURSOR' } });
    const [, txid, seq] = m;
    const [{ pruned }] = await this.ds.query(`SELECT pruned_through_txid::text AS pruned FROM change_feed_state WHERE id = 1`);
    // Pruned past the cursor, or a cursor from the future (a restored database, another environment): it cannot be honoured safely.
    if (BigInt(txid) < BigInt(pruned) || BigInt(txid) >= BigInt(xmin)) return { cursor: baseline, changes: [], hasMore: false, reset: true };

    if (scope.branchIds && scope.branchIds.length === 0) return { cursor: params.since, changes: [], hasMore: false, reset: false };
    const values: unknown[] = [txid, seq, xmin, scope.entities, limit + 1];
    let branch = '';
    if (scope.branchIds) {
      values.push(scope.branchIds);
      // R2: vendors never receive changes of an InstaPay / Vodafone Cash order before its payment is verified.
      branch = `AND vendor_branch_id = ANY($${values.length})
        AND NOT EXISTS (SELECT 1 FROM orders vo WHERE vo.id = change_events.order_id AND vo.payment_method = 'MANUAL_TRANSFER'
                          AND NOT EXISTS (SELECT 1 FROM payments vp WHERE vp.order_id = vo.id AND vp.status = 'PAID'))`;
    }
    const rows: Array<{ seq: string; txid: string; entity: ChangeEntity; entity_id: string; order_id: string; kind: string }> = await this.ds.query(
      `SELECT seq, txid, entity, entity_id, order_id, kind FROM change_events
        WHERE (txid, seq) > ($1::bigint, $2::bigint) AND txid < $3::bigint AND entity = ANY($4) ${branch}
        ORDER BY txid, seq LIMIT $5`,
      values,
    );
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    // One entry per entity: the latest kind wins (the client re-reads the entity anyway).
    const latest = new Map<string, ChangeItem>();
    for (const r of page) latest.set(`${r.entity}:${r.entity_id}`, { seq: r.seq, entity: r.entity, id: r.entity_id, orderId: r.order_id, kind: r.kind });
    const last = page[page.length - 1];
    return { cursor: last ? `v1.${last.txid}.${last.seq}` : params.since, changes: [...latest.values()], hasMore, reset: false };
  }
}

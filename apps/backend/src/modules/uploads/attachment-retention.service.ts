import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UploadsService } from './uploads.service';

/** Terminal order states: the order is over, nothing can change any more. */
const FINISHED = ['DELIVERED', 'COLLECTED', 'CANCELLED', 'FAILED_DELIVERY'];

/**
 * Owner decision 2026-11-28: order attachments — the customer's request photos and voice notes, and the driver's proof-of-delivery photo —
 * are removed 90 days (ATTACHMENT_RETENTION_DAYS) after the order ended. The order, its items, amounts and history stay; the links are
 * cleared and `attachments_purged_at` records when. Files are deleted only after the database change has committed. Runs every 6 hours,
 * in batches, on the jobs worker only.
 */
@Injectable()
export class AttachmentRetentionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AttachmentRetentionService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly ds: DataSource, private readonly uploads: UploadsService) {}

  onApplicationBootstrap(): void {
    if (process.env.JOBS_WORKER_ENABLED === 'false' || process.env.ATTACHMENT_RETENTION_INTERVAL_MS === '0') return;
    const run = () => void this.purge().catch((e) => this.logger.error(`Attachment retention failed: ${(e as Error).message}`));
    this.timer = setInterval(run, Number(process.env.ATTACHMENT_RETENTION_INTERVAL_MS ?? 6 * 3600_000));
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  retentionDays(): number {
    const d = Number(process.env.ATTACHMENT_RETENTION_DAYS ?? 90);
    return Number.isFinite(d) && d >= 7 ? Math.floor(d) : 90;
  }

  /** Purges one batch of finished orders older than the retention window. Returns what it did (counts only). */
  async purge(limit = 200, now = new Date()): Promise<{ orders: number; files: number; failed: number }> {
    const cutoff = new Date(now.getTime() - this.retentionDays() * 86_400_000);
    const urls: string[] = [];
    const orderIds = await this.ds.transaction(async (m) => {
      const rows: Array<{ id: string }> = await m.query(
        `SELECT o.id FROM orders o
          WHERE o.status::text = ANY($1) AND o.attachments_purged_at IS NULL
            AND coalesce((SELECT max(e.created_at) FROM order_status_events e WHERE e.order_id = o.id AND e.to_status = o.status::text), o.created_at) < $2
          ORDER BY o.created_at LIMIT $3 FOR UPDATE OF o SKIP LOCKED`,
        [FINISHED, cutoff, limit],
      );
      const ids = rows.map((r) => r.id);
      if (ids.length === 0) return ids;
      const items: Array<{ image_urls_snapshot: unknown; voice_note_url_snapshot: string | null }> = await m.query(
        `SELECT i.image_urls_snapshot, i.voice_note_url_snapshot FROM order_items i JOIN order_vendor_segments s ON s.id = i.order_vendor_segment_id WHERE s.order_id = ANY($1)`,
        [ids],
      );
      for (const it of items) {
        if (Array.isArray(it.image_urls_snapshot)) for (const u of it.image_urls_snapshot) if (typeof u === 'string') urls.push(u);
        if (it.voice_note_url_snapshot) urls.push(it.voice_note_url_snapshot);
      }
      const proofs: Array<{ photo_url: string | null }> = await m.query(`SELECT photo_url FROM proof_of_deliveries WHERE order_id = ANY($1) AND photo_url IS NOT NULL`, [ids]);
      for (const p of proofs) if (p.photo_url) urls.push(p.photo_url);
      await m.query(
        `UPDATE order_items SET image_urls_snapshot = NULL, voice_note_url_snapshot = NULL
          WHERE order_vendor_segment_id IN (SELECT id FROM order_vendor_segments WHERE order_id = ANY($1))`,
        [ids],
      );
      await m.query(`UPDATE proof_of_deliveries SET photo_url = NULL WHERE order_id = ANY($1)`, [ids]);
      await m.query(`UPDATE orders SET attachments_purged_at = now() WHERE id = ANY($1)`, [ids]);
      // A file still referenced elsewhere (e.g. the same upload in a live cart) is kept.
      const unique = [...new Set(urls)];
      if (unique.length) {
        const stillUsed: Array<{ u: string }> = await m.query(
          `SELECT DISTINCT u FROM (
             SELECT jsonb_array_elements_text(i.image_urls_snapshot) AS u FROM order_items i WHERE i.image_urls_snapshot IS NOT NULL
             UNION ALL SELECT i.voice_note_url_snapshot FROM order_items i WHERE i.voice_note_url_snapshot IS NOT NULL
             UNION ALL SELECT jsonb_array_elements_text(c.image_urls) FROM cart_items c JOIN cart_vendor_groups g ON g.id = c.cart_vendor_group_id JOIN carts k ON k.id = g.cart_id WHERE k.status::text = 'ACTIVE' AND c.image_urls IS NOT NULL
             UNION ALL SELECT c.voice_note_url FROM cart_items c JOIN cart_vendor_groups g ON g.id = c.cart_vendor_group_id JOIN carts k ON k.id = g.cart_id WHERE k.status::text = 'ACTIVE' AND c.voice_note_url IS NOT NULL
             UNION ALL SELECT photo_url FROM proof_of_deliveries WHERE photo_url IS NOT NULL) x WHERE u = ANY($1)`,
          [unique],
        );
        const keep = new Set(stillUsed.map((r) => r.u));
        urls.splice(0, urls.length, ...unique.filter((u) => !keep.has(u)));
        if (urls.length) await m.query(`DELETE FROM uploads WHERE url = ANY($1)`, [urls]);
      }
      return ids;
    });
    if (orderIds.length === 0) return { orders: 0, files: 0, failed: 0 };
    const r = urls.length ? await this.uploads.removeStoredFiles(urls) : { removed: 0, failed: 0 };
    this.logger.log(`Attachment retention: ${orderIds.length} order(s), ${r.removed} file(s) removed, ${r.failed} not removed.`);
    return { orders: orderIds.length, files: r.removed, failed: r.failed };
  }
}

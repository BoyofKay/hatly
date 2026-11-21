import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { addCairoRange, assertDate, assertMaxRange, assertUuid, num, pageParams, REPORTING_TIMEZONE, returned } from '../common/platform-sql';
import { HomeSectionsCache } from '../../home-products/home-sections.cache';

const maxPerDay = () => Number(process.env.BROADCAST_MAX_PER_CUSTOMER_PER_DAY ?? 1);
const QUIET = () => (process.env.BROADCAST_QUIET_HOURS ?? '22:00-08:00').split('-').map((x) => Number(x.split(':')[0]));
export const DEEP_LINKS = /^(order\/[0-9a-f-]{36}|vendor\/[0-9a-f-]{36}|sector\/[0-9a-f-]{36}|offer\/[0-9a-f-]{36}|product\/[0-9a-f-]{36}|inbox|home)$/;

export interface AudienceRules {
  lastOrderWithinDays?: number;
  noOrderForDays?: number;
  minOrders?: number;
  neverOrdered?: boolean;
  registeredFrom?: string;
  registeredTo?: string;
  usedOfferId?: string;
}

const bad = (message: string, code = 'VALIDATION_FAILED', extra: Record<string, unknown> = {}) => new BadRequestException({ message, details: { code, ...extra } });

/** Compiles audience rules into a parameterised customer selection. Only active, non-deleted customers are ever selected. */
export function compileAudience(rules: AudienceRules): { sql: string; values: unknown[] } {
  const known = new Set(['lastOrderWithinDays', 'noOrderForDays', 'minOrders', 'neverOrdered', 'registeredFrom', 'registeredTo', 'usedOfferId']);
  for (const k of Object.keys(rules ?? {})) if (!known.has(k)) throw bad(`Unknown audience rule "${k}".`, 'UNKNOWN_RULE');
  const w: string[] = [`u.role = 'CUSTOMER'`, 'u.is_active', 'u.deleted_at IS NULL'];
  const v: unknown[] = [];
  const posInt = (n: unknown, name: string, max = 3650) => {
    if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > max) throw bad(`${name} must be a whole number between 1 and ${max}.`);
    return n as number;
  };
  if (rules.lastOrderWithinDays !== undefined) { v.push(posInt(rules.lastOrderWithinDays, 'lastOrderWithinDays')); w.push(`EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = u.id AND o.created_at > now() - ($${v.length} || ' days')::interval)`); }
  if (rules.noOrderForDays !== undefined) { v.push(posInt(rules.noOrderForDays, 'noOrderForDays')); w.push(`NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = u.id AND o.created_at > now() - ($${v.length} || ' days')::interval)`); }
  if (rules.minOrders !== undefined) { v.push(posInt(rules.minOrders, 'minOrders', 100000)); w.push(`(SELECT count(*) FROM orders o WHERE o.customer_id = u.id AND o.status <> 'CANCELLED') >= $${v.length}`); }
  if (rules.neverOrdered === true) w.push(`NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = u.id)`);
  addCairoRange(w, v, 'u.created_at', assertDate(rules.registeredFrom, 'registeredFrom'), assertDate(rules.registeredTo, 'registeredTo'));
  if (rules.usedOfferId) { v.push(assertUuid(rules.usedOfferId, 'usedOfferId')); w.push(`EXISTS (SELECT 1 FROM offer_consumptions c WHERE c.customer_id = u.id AND c.offer_id = $${v.length} AND NOT c.is_reversed)`); }
  return { sql: `SELECT u.id FROM users u WHERE ${w.join(' AND ')}`, values: v };
}

export function inQuietHours(hour: number): boolean {
  const [from, to] = QUIET();
  return from > to ? hour >= from || hour < to : hour >= from && hour < to;
}

@Injectable()
export class MarketingService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MarketingService.name);
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(
    private readonly ds: DataSource,
    private readonly homeCache: HomeSectionsCache,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.JOBS_WORKER_ENABLED === 'false' || process.env.FEATURE_BROADCASTS === 'false') return;
    this.timer = setInterval(() => void this.tick(), Number(process.env.MARKETING_WORKER_INTERVAL_MS ?? 30000));
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async cairoHour(): Promise<number> {
    const [r] = await this.ds.query(`SELECT extract(hour FROM now() AT TIME ZONE '${REPORTING_TIMEZONE}')::int AS h`);
    return r.h;
  }

  // ------------------------------------------------------------------ audiences

  async createAudience(input: { name: string; rules: AudienceRules }, actorId: string) {
    if (!input?.name || input.name.length > 80) throw bad('name is required (max 80 characters).');
    compileAudience(input.rules ?? {});
    const [r] = await this.ds.query(`INSERT INTO audiences (name, rules, created_by_user_id) VALUES ($1,$2,$3) RETURNING *`, [input.name, JSON.stringify(input.rules ?? {}), actorId]);
    return this.audienceView(r);
  }

  private audienceView(r: any) {
    return { id: r.id, name: r.name, rules: r.rules, createdAt: new Date(r.created_at).toISOString() };
  }

  async listAudiences() {
    return (await this.ds.query(`SELECT * FROM audiences WHERE archived_at IS NULL ORDER BY created_at DESC LIMIT 200`)).map((r: any) => this.audienceView(r));
  }

  /** A count below 20 is shown as "<20" (no re-identification of a tiny segment). */
  async previewAudience(rules: AudienceRules) {
    const { sql, values } = compileAudience(rules ?? {});
    const [{ n }] = await this.ds.query(`SELECT count(*)::int AS n FROM (${sql}) a`, values);
    return { count: n < 20 ? null : n, display: n < 20 ? (n === 0 ? '0' : '<20') : String(n), empty: n === 0 };
  }

  // ------------------------------------------------------------------ broadcasts

  private bView(r: any) {
    return {
      id: r.id, titleEn: r.title_en, titleAr: r.title_ar, bodyEn: r.body_en, bodyAr: r.body_ar, deepLink: r.deep_link, audienceId: r.audience_id, audienceName: r.audience_name ?? null, channels: r.channels, status: r.status,
      scheduledAt: r.scheduled_at, createdBy: r.created_by_user_id, createdByName: r.created_by_name ?? null, approvedBy: r.approved_by_user_id, approvedAt: r.approved_at, rejectionReason: r.rejection_reason, startedAt: r.started_at, finishedAt: r.finished_at,
      createdAt: new Date(r.created_at).toISOString(), version: r.version,
    };
  }

  private validateBroadcast(i: any, partial = false) {
    const need = (k: string, max: number) => {
      if (partial && i[k] === undefined) return;
      if (typeof i[k] !== 'string' || !i[k].trim() || i[k].length > max) throw bad(`${k} is required (max ${max} characters).`);
    };
    need('titleEn', 60); need('titleAr', 60); need('bodyEn', 240); need('bodyAr', 240);
    if (i.deepLink !== undefined && i.deepLink !== null && i.deepLink !== '' && !DEEP_LINKS.test(i.deepLink)) throw bad('deepLink must be inbox, home, or order/vendor/sector/offer/product followed by a valid id.', 'INVALID_DEEP_LINK');
    if (i.channels !== undefined) {
      if (!Array.isArray(i.channels) || i.channels.some((c: string) => !['INBOX', 'PUSH'].includes(c)) || !i.channels.includes('INBOX')) throw bad('channels must include INBOX and may include PUSH (SMS is not available).', 'INVALID_CHANNELS');
    }
    if (i.scheduledAt !== undefined && i.scheduledAt !== null && Number.isNaN(Date.parse(i.scheduledAt))) throw bad('scheduledAt must be an ISO date-time.');
  }

  async createBroadcast(i: any, actorId: string) {
    this.validateBroadcast(i);
    const aud = await this.ds.query(`SELECT id FROM audiences WHERE id = $1 AND archived_at IS NULL`, [assertUuid(i.audienceId, 'audienceId')]);
    if (!aud[0]) throw new NotFoundException('Audience not found.');
    const [r] = await this.ds.query(
      `INSERT INTO notification_broadcasts (title_en, title_ar, body_en, body_ar, deep_link, audience_id, channels, scheduled_at, created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [i.titleEn.trim(), i.titleAr.trim(), i.bodyEn.trim(), i.bodyAr.trim(), i.deepLink || null, i.audienceId, i.channels ?? ['INBOX'], i.scheduledAt ?? null, actorId],
    );
    return this.bView(r);
  }

  async listBroadcasts(q: { status?: string; page?: string | number; limit?: string | number }) {
    const { page, limit, offset } = pageParams(q);
    const params: unknown[] = [];
    let w = '';
    if (q.status) { params.push(q.status); w = 'WHERE b.status = $1'; }
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM notification_broadcasts b ${w}`, params);
    const rows = await this.ds.query(`SELECT b.*, a.name AS audience_name, u.full_name AS created_by_name FROM notification_broadcasts b JOIN audiences a ON a.id = b.audience_id JOIN users u ON u.id = b.created_by_user_id ${w} ORDER BY b.created_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
    return { items: rows.map((r: any) => this.bView(r)), page, limit, total };
  }

  async getBroadcast(id: string) {
    assertUuid(id, 'id');
    const [r] = await this.ds.query(`SELECT b.*, a.name AS audience_name, u.full_name AS created_by_name FROM notification_broadcasts b JOIN audiences a ON a.id = b.audience_id JOIN users u ON u.id = b.created_by_user_id WHERE b.id = $1`, [id]);
    if (!r) throw new NotFoundException('Broadcast not found.');
    const [stats] = await this.ds.query(
      `SELECT count(*)::int AS recipients, count(*) FILTER (WHERE status = 'SENT')::int AS sent, count(*) FILTER (WHERE status = 'FAILED')::int AS failed, count(*) FILTER (WHERE status = 'PENDING' OR status = 'SENDING')::int AS pending,
              count(*) FILTER (WHERE status LIKE 'SKIPPED%')::int AS skipped FROM broadcast_recipients WHERE broadcast_id = $1`,
      [id],
    );
    const [read] = await this.ds.query(`SELECT count(*) FILTER (WHERE read_at IS NOT NULL)::int AS opened FROM customer_inbox_messages WHERE broadcast_id = $1`, [id]);
    return { ...this.bView(r), stats: { ...stats, opened: read.opened } };
  }

  async updateBroadcast(id: string, i: any, actorId: string) {
    const b = await this.getBroadcast(id);
    if (b.status !== 'DRAFT') throw new ConflictException({ message: 'Only a draft can be edited.', details: { code: 'STATE_CONFLICT', status: b.status } });
    this.validateBroadcast(i, true);
    if (i.audienceId) assertUuid(i.audienceId, 'audienceId');
    const rows = returned(await this.ds.query(
      `UPDATE notification_broadcasts SET title_en = coalesce($2, title_en), title_ar = coalesce($3, title_ar), body_en = coalesce($4, body_en), body_ar = coalesce($5, body_ar), deep_link = CASE WHEN $6::boolean THEN $7 ELSE deep_link END,
         audience_id = coalesce($8, audience_id), channels = coalesce($9, channels), scheduled_at = CASE WHEN $10::boolean THEN $11::timestamptz ELSE scheduled_at END, last_edited_by_user_id = $12, version = version + 1, updated_at = now() WHERE id = $1 AND status = 'DRAFT' RETURNING id`,
      [id, i.titleEn ?? null, i.titleAr ?? null, i.bodyEn ?? null, i.bodyAr ?? null, i.deepLink !== undefined, i.deepLink || null, i.audienceId ?? null, i.channels ?? null, i.scheduledAt !== undefined, i.scheduledAt ?? null, actorId],
    ));
    if (!rows[0]) throw new ConflictException({ message: 'Only a draft can be edited.', details: { code: 'STATE_CONFLICT' } });
    return this.getBroadcast(id);
  }

  private async transition(table: 'notification_broadcasts' | 'campaigns', id: string, from: string[], to: string, extra = '', params: unknown[] = []) {
    const rows = returned(await this.ds.query(`UPDATE ${table} SET status = $2, updated_at = now()${extra} WHERE id = $1 AND status = ANY($${params.length + 3}) RETURNING id`, [id, to, ...params, from]));
    if (!rows[0]) throw new ConflictException({ message: `This ${table === 'campaigns' ? 'campaign' : 'broadcast'} is not in a state that allows this action.`, details: { code: 'STATE_CONFLICT' } });
  }

  async submitBroadcast(id: string) {
    const b = await this.getBroadcast(id);
    const aud = await this.ds.query(`SELECT rules FROM audiences WHERE id = $1`, [b.audienceId]);
    const { sql, values } = compileAudience(aud[0].rules);
    const [{ n }] = await this.ds.query(`SELECT count(*)::int AS n FROM (${sql}) a`, values);
    if (n === 0) throw bad('The audience is empty, so there is nobody to send this to.', 'AUDIENCE_EMPTY');
    await this.transition('notification_broadcasts', id, ['DRAFT'], 'PENDING_APPROVAL');
    return this.getBroadcast(id);
  }

  /** Four-eyes: the approver is neither the creator nor the last editor. Approval of a broadcast with no future schedule starts the send. */
  async approveBroadcast(id: string, actorId: string, overrideQuietHours: boolean) {
    const b: any = await this.ds.query(`SELECT created_by_user_id, last_edited_by_user_id, scheduled_at, status FROM notification_broadcasts WHERE id = $1`, [id]).then((r) => r[0]);
    if (!b) throw new NotFoundException('Broadcast not found.');
    if (b.created_by_user_id === actorId || b.last_edited_by_user_id === actorId) throw new ForbiddenException({ message: 'You cannot approve a broadcast you created or edited.', details: { code: 'FOUR_EYES' } });
    const when = b.scheduled_at && new Date(b.scheduled_at) > new Date() ? new Date(b.scheduled_at) : new Date();
    const [h] = await this.ds.query(`SELECT extract(hour FROM $1::timestamptz AT TIME ZONE '${REPORTING_TIMEZONE}')::int AS h`, [when]);
    if (inQuietHours(h.h) && !overrideQuietHours) throw bad(`This would send during quiet hours (${process.env.BROADCAST_QUIET_HOURS ?? '22:00-08:00'} Cairo). Schedule it for later, or approve with an explicit override.`, 'QUIET_HOURS');
    const scheduled = b.scheduled_at && new Date(b.scheduled_at) > new Date();
    await this.transition('notification_broadcasts', id, ['PENDING_APPROVAL'], scheduled ? 'SCHEDULED' : 'APPROVED', ', approved_by_user_id = $3, approved_at = now()', [actorId]);
    if (!scheduled) void this.tick();
    return this.getBroadcast(id);
  }

  async rejectBroadcast(id: string, reason: string, actorId: string) {
    if (!reason || reason.trim().length < 5) throw bad('A reason is required (at least 5 characters).');
    const [b] = await this.ds.query(`SELECT created_by_user_id, last_edited_by_user_id FROM notification_broadcasts WHERE id = $1`, [id]);
    if (!b) throw new NotFoundException('Broadcast not found.');
    if (b.created_by_user_id === actorId) throw new ForbiddenException({ message: 'You cannot review your own broadcast.', details: { code: 'FOUR_EYES' } });
    await this.transition('notification_broadcasts', id, ['PENDING_APPROVAL'], 'DRAFT', ', rejection_reason = $3, approved_by_user_id = NULL', [reason.slice(0, 300)]);
    return this.getBroadcast(id);
  }

  async cancelBroadcast(id: string) {
    await this.transition('notification_broadcasts', id, ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'SENDING'], 'CANCELLED', ', finished_at = now()');
    await this.ds.query(`UPDATE broadcast_recipients SET status = 'FAILED', last_error = 'CANCELLED' WHERE broadcast_id = $1 AND status IN ('PENDING','SENDING')`, [id]);
    return this.getBroadcast(id);
  }

  async recipients(id: string, q: { status?: string; page?: string | number; limit?: string | number }) {
    assertUuid(id, 'id');
    const { page, limit, offset } = pageParams(q, 50, 100);
    const params: unknown[] = [id];
    let w = 'r.broadcast_id = $1';
    if (q.status) { params.push(q.status); w += ` AND r.status = $2`; }
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM broadcast_recipients r WHERE ${w}`, params);
    const rows = await this.ds.query(`SELECT r.id, r.status, r.attempts, r.last_error, r.sent_at, u.id AS customer_id FROM broadcast_recipients r JOIN users u ON u.id = r.customer_user_id WHERE ${w} ORDER BY r.created_at, r.id LIMIT ${limit} OFFSET ${offset}`, params);
    return { items: rows.map((r: any) => ({ id: r.id, customerId: r.customer_id, status: r.status, attempts: r.attempts, lastError: r.last_error, sentAt: r.sent_at })), page, limit, total };
  }

  // ------------------------------------------------------------------ sending engine (idempotent: unique recipient + unique inbox row)

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.ds.query(`UPDATE notification_broadcasts SET status = 'APPROVED' WHERE status = 'SCHEDULED' AND scheduled_at <= now()`);
      const [b] = await this.ds.query(`SELECT * FROM notification_broadcasts WHERE status IN ('APPROVED','SENDING') ORDER BY created_at LIMIT 1`);
      if (b) await this.send(b);
      await this.runCampaigns();
    } catch (e) {
      this.logger.error(`marketing worker pass failed: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  private async send(b: any): Promise<void> {
    if (b.status === 'APPROVED') {
      const [aud] = await this.ds.query(`SELECT rules FROM audiences WHERE id = $1`, [b.audience_id]);
      const { sql, values } = compileAudience(aud.rules);
      await this.ds.query(`INSERT INTO broadcast_recipients (broadcast_id, customer_user_id) SELECT $${values.length + 1}, a.id FROM (${sql}) a ON CONFLICT DO NOTHING`, [...values, b.id]);
      await this.ds.query(`UPDATE notification_broadcasts SET status = 'SENDING', started_at = coalesce(started_at, now()), updated_at = now() WHERE id = $1 AND status = 'APPROVED'`, [b.id]);
    }
    for (let guard = 0; guard < 50; guard++) {
      const [{ status }] = await this.ds.query(`SELECT status FROM notification_broadcasts WHERE id = $1`, [b.id]);
      if (status !== 'SENDING') return;
      const batch = returned(await this.ds.query(
        `UPDATE broadcast_recipients SET status = 'SENDING', attempts = attempts + 1 WHERE id IN (SELECT id FROM broadcast_recipients WHERE broadcast_id = $1 AND status = 'PENDING' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 200) RETURNING id, customer_user_id`,
        [b.id],
      ));
      if (batch.length === 0) {
        await this.ds.query(`UPDATE notification_broadcasts SET status = 'COMPLETED', finished_at = now(), updated_at = now() WHERE id = $1 AND status = 'SENDING'`, [b.id]);
        return;
      }
      for (const r of batch) {
        const [capped] = await this.ds.query(
          `SELECT count(*)::int AS n FROM customer_inbox_messages WHERE customer_user_id = $1 AND broadcast_id IS NOT NULL AND broadcast_id <> $2 AND created_at > date_trunc('day', now() AT TIME ZONE '${REPORTING_TIMEZONE}') AT TIME ZONE '${REPORTING_TIMEZONE}'`,
          [r.customer_user_id, b.id],
        );
        if (capped.n >= maxPerDay()) {
          await this.ds.query(`UPDATE broadcast_recipients SET status = 'SKIPPED_CAP' WHERE id = $1`, [r.id]);
          continue;
        }
        try {
          await this.ds.query(
            `INSERT INTO customer_inbox_messages (customer_user_id, broadcast_id, title_en, title_ar, body_en, body_ar, deep_link) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
            [r.customer_user_id, b.id, b.title_en, b.title_ar, b.body_en, b.body_ar, b.deep_link],
          );
          await this.ds.query(`UPDATE broadcast_recipients SET status = 'SENT', sent_at = now() WHERE id = $1`, [r.id]);
        } catch (e: any) {
          await this.ds.query(`UPDATE broadcast_recipients SET status = $2, last_error = $3 WHERE id = $1`, [r.id, r.attempts >= 3 ? 'FAILED' : 'PENDING', String(e?.message ?? 'error').slice(0, 120)]);
        }
      }
    }
  }

  // ------------------------------------------------------------------ customer inbox (the customer's own rows only)

  async inbox(customerId: string, q: { page?: string | number; limit?: string | number }) {
    const { page, limit, offset } = pageParams(q, 20, 50);
    const [{ total, unread }] = await this.ds.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE read_at IS NULL)::int AS unread FROM customer_inbox_messages WHERE customer_user_id = $1`, [customerId]);
    const rows = await this.ds.query(`SELECT * FROM customer_inbox_messages WHERE customer_user_id = $1 ORDER BY created_at DESC, id LIMIT ${limit} OFFSET ${offset}`, [customerId]);
    return { items: rows.map((r: any) => ({ id: r.id, titleEn: r.title_en, titleAr: r.title_ar, bodyEn: r.body_en, bodyAr: r.body_ar, deepLink: r.deep_link, read: Boolean(r.read_at), createdAt: new Date(r.created_at).toISOString() })), unread, page, limit, total };
  }

  async unread(customerId: string) {
    const [r] = await this.ds.query(`SELECT count(*)::int AS n FROM customer_inbox_messages WHERE customer_user_id = $1 AND read_at IS NULL`, [customerId]);
    return { unread: r.n };
  }

  async markRead(customerId: string, id: string | null) {
    if (id) assertUuid(id, 'id');
    const rows = returned(await this.ds.query(`UPDATE customer_inbox_messages SET read_at = coalesce(read_at, now()) WHERE customer_user_id = $1 ${id ? 'AND id = $2' : ''} RETURNING id`, id ? [customerId, id] : [customerId]));
    if (id && !rows[0]) throw new NotFoundException('Message not found.');
    return { updated: rows.length };
  }

  // ------------------------------------------------------------------ offers: edit, clone, performance (no discount arithmetic is changed)

  private static readonly LOCKED_AFTER_USE = ['mechanism', 'discountType', 'discountValue', 'couponCode', 'vendorBranchId', 'specialPriceMinor', 'minimumEligibleSubtotalMinor', 'maximumDiscountMinor'];

  async editOffer(id: string, input: Record<string, any>, actorId: string) {
    assertUuid(id, 'id');
    const [o] = await this.ds.query(`SELECT * FROM offers WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (!o) throw new NotFoundException('Offer not found.');
    const [{ n }] = await this.ds.query(`SELECT count(*)::int AS n FROM offer_consumptions WHERE offer_id = $1`, [id]);
    const locked = MarketingService.LOCKED_AFTER_USE.filter((k) => input[k] !== undefined);
    if (n > 0 && locked.length) throw new ConflictException({ message: `This offer already has ${n} use(s); ${locked.join(', ')} can no longer change. Clone the offer instead.`, details: { code: 'OFFER_FIELD_LOCKED', fields: locked } });
    if (locked.length) throw bad('Changing the discount rules is not supported here; clone the offer and edit the clone.', 'OFFER_RULES_VIA_CLONE');
    const set: string[] = []; const v: unknown[] = [id];
    const add = (col: string, val: unknown) => { v.push(val); set.push(`${col} = $${v.length}`); };
    if (input.name !== undefined) { if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 150) throw bad('name must be 1–150 characters.'); add('name', input.name.trim()); }
    if (input.nameAr !== undefined) { if (input.nameAr !== null && (typeof input.nameAr !== 'string' || input.nameAr.length > 150)) throw bad('nameAr must be at most 150 characters.'); add('name_ar', input.nameAr ? String(input.nameAr).trim() : null); }
    if (input.endAt !== undefined) { if (Number.isNaN(Date.parse(input.endAt)) || new Date(input.endAt) <= new Date(o.start_at)) throw bad('endAt must be after the start.'); add('end_at', input.endAt); }
    if (input.startAt !== undefined) { if (n > 0) throw new ConflictException({ message: 'The start cannot move once the offer has been used.', details: { code: 'OFFER_FIELD_LOCKED', fields: ['startAt'] } }); if (Number.isNaN(Date.parse(input.startAt))) throw bad('startAt is invalid.'); add('start_at', input.startAt); }
    for (const [key, col, raiseOnly] of [['totalAllocationLimit', 'total_allocation_limit', true], ['budgetCapMinor', 'budget_cap_minor', true], ['perCustomerLifetimeLimit', 'per_customer_lifetime_limit', true], ['perOrderLimit', 'per_order_limit', false]] as const) {
      if (input[key] === undefined) continue;
      if (!Number.isInteger(input[key]) || input[key] < 0) throw bad(`${key} must be a non-negative integer.`);
      if (raiseOnly && n > 0 && o[col] !== null && input[key] < Number(o[col])) throw bad(`${key} can only be raised once the offer has been used.`, 'LIMIT_CAN_ONLY_RISE');
      add(col, input[key]);
    }
    if (set.length === 0) throw bad('Nothing to change.');
    await this.ds.query(`UPDATE offers SET ${set.join(', ')}, updated_at = now() WHERE id = $1`, v);
    await this.homeCache.bumpEpoch();
    return this.offerView(id);
  }

  async offerView(id: string) {
    const [o] = await this.ds.query(`SELECT * FROM offers WHERE id = $1`, [id]);
    return o;
  }

  async cloneOffer(id: string, input: { name?: string; couponCode?: string | null }, actorId: string) {
    assertUuid(id, 'id');
    const [o] = await this.ds.query(`SELECT * FROM offers WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (!o) throw new NotFoundException('Offer not found.');
    const code = input.couponCode === undefined ? null : input.couponCode;
    if (code && !/^[A-Za-z0-9]{4,20}$/.test(code)) throw bad('couponCode must be 4–20 letters/digits.');
    try {
      const [c] = await this.ds.query(
        `INSERT INTO offers (vendor_branch_id, name, name_ar, mechanism, discount_type, discount_value, minimum_eligible_subtotal_minor, maximum_discount_minor, special_price_minor, start_at, end_at, is_active, coupon_code,
           per_order_limit, per_customer_lifetime_limit, total_allocation_limit, budget_cap_minor, consumed_units_count, consumed_discount_minor, created_by_user_id)
         SELECT vendor_branch_id, $2, name_ar, mechanism, discount_type, discount_value, minimum_eligible_subtotal_minor, maximum_discount_minor, special_price_minor, start_at, end_at, false, $3,
           per_order_limit, per_customer_lifetime_limit, total_allocation_limit, budget_cap_minor, 0, 0, $4 FROM offers WHERE id = $1 RETURNING id`,
        [id, (input.name ?? `${o.name} (copy)`).slice(0, 150), code, actorId],
      );
      await this.ds.query(`INSERT INTO offer_products (offer_id, product_id) SELECT $2, product_id FROM offer_products WHERE offer_id = $1`, [id, c.id]);
      await this.ds.query(`INSERT INTO offer_categories (offer_id, category_id) SELECT $2, category_id FROM offer_categories WHERE offer_id = $1`, [id, c.id]).catch(() => undefined);
      return { id: c.id, active: false };
    } catch (e: any) {
      if (e?.code === '23505') throw new ConflictException({ message: 'That coupon code is already used by another offer.', details: { code: 'COUPON_CODE_EXISTS' } });
      throw e;
    }
  }

  async offerPerformance(id: string) {
    assertUuid(id, 'id');
    const [o] = await this.ds.query(`SELECT id, name, coupon_code, is_active, budget_cap_minor, total_allocation_limit, start_at, end_at FROM offers WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (!o) throw new NotFoundException('Offer not found.');
    const [p] = await this.ds.query(
      `SELECT count(*)::int AS consumptions, count(*) FILTER (WHERE is_reversed)::int AS reversed, coalesce(sum(discount_applied_minor) FILTER (WHERE NOT is_reversed), 0)::bigint AS net_discount,
              coalesce(sum(discount_applied_minor), 0)::bigint AS gross_discount, count(DISTINCT customer_id)::int AS customers FROM offer_consumptions WHERE offer_id = $1`,
      [id],
    );
    const [ord] = await this.ds.query(`SELECT count(DISTINCT c.order_id)::int AS orders, coalesce(sum(od.total_minor), 0)::bigint AS total FROM offer_consumptions c JOIN orders od ON od.id = c.order_id WHERE c.offer_id = $1 AND NOT c.is_reversed AND od.status <> 'CANCELLED'`, [id]);
    return {
      offer: { id: o.id, name: o.name, couponCode: o.coupon_code, active: o.is_active, startAt: o.start_at, endAt: o.end_at, budgetCapMinor: o.budget_cap_minor === null ? null : num(o.budget_cap_minor), totalAllocationLimit: o.total_allocation_limit },
      consumptions: p.consumptions, reversed: p.reversed, netConsumptions: p.consumptions - p.reversed, netDiscountMinor: num(p.net_discount), grossDiscountMinor: num(p.gross_discount), customers: p.customers,
      budgetRemainingMinor: o.budget_cap_minor === null ? null : num(o.budget_cap_minor) - num(p.net_discount), ordersUsing: ord.orders, ordersTotalMinor: num(ord.total),
      note: 'Equal to the consumption rows: reversed uses (cancelled orders / rejected parts) are excluded from the net.',
    };
  }

  async offerConsumptions(id: string, q: { page?: string | number; limit?: string | number }) {
    assertUuid(id, 'id');
    const { page, limit, offset } = pageParams(q, 25, 100);
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM offer_consumptions WHERE offer_id = $1`, [id]);
    const rows = await this.ds.query(`SELECT c.id, c.created_at, c.discount_applied_minor, c.is_reversed, c.reversed_at, o.order_number FROM offer_consumptions c LEFT JOIN orders o ON o.id = c.order_id WHERE c.offer_id = $1 ORDER BY c.created_at DESC, c.id LIMIT ${limit} OFFSET ${offset}`, [id]);
    return { items: rows.map((r: any) => ({ id: r.id, createdAt: new Date(r.created_at).toISOString(), discountMinor: num(r.discount_applied_minor), reversed: r.is_reversed, reversedAt: r.reversed_at, orderNumber: r.order_number })), page, limit, total };
  }

  // ------------------------------------------------------------------ campaigns (orchestrate existing offers / banners; never compute a discount)

  private cView(r: any) {
    return { id: r.id, nameEn: r.name_en, nameAr: r.name_ar, status: r.status, startsAt: r.starts_at, endsAt: r.ends_at, createdBy: r.created_by_user_id, createdByName: r.created_by_name ?? null, approvedBy: r.approved_by_user_id, rejectionReason: r.rejection_reason, version: r.version, createdAt: new Date(r.created_at).toISOString() };
  }

  async createCampaign(i: any, actorId: string) {
    if (!i?.nameEn || !i?.nameAr || i.nameEn.length > 80 || i.nameAr.length > 80) throw bad('nameEn and nameAr are required (max 80 characters).');
    if (Number.isNaN(Date.parse(i.startsAt)) || Number.isNaN(Date.parse(i.endsAt)) || new Date(i.endsAt) <= new Date(i.startsAt)) throw bad('endsAt must be after startsAt.');
    const [r] = await this.ds.query(`INSERT INTO campaigns (name_en, name_ar, starts_at, ends_at, created_by_user_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [i.nameEn, i.nameAr, i.startsAt, i.endsAt, actorId]);
    await this.ds.query(`INSERT INTO campaign_events (campaign_id, to_status, actor_user_id) VALUES ($1,'DRAFT',$2)`, [r.id, actorId]);
    return this.cView(r);
  }

  async listCampaigns(q: { status?: string; page?: string | number; limit?: string | number }) {
    const { page, limit, offset } = pageParams(q);
    const params: unknown[] = [];
    let w = '';
    if (q.status) { params.push(q.status); w = 'WHERE c.status = $1'; }
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM campaigns c ${w}`, params);
    const rows = await this.ds.query(`SELECT c.*, u.full_name AS created_by_name FROM campaigns c JOIN users u ON u.id = c.created_by_user_id ${w} ORDER BY c.created_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
    return { items: rows.map((r: any) => this.cView(r)), page, limit, total };
  }

  async getCampaign(id: string) {
    assertUuid(id, 'id');
    const [r] = await this.ds.query(`SELECT c.*, u.full_name AS created_by_name FROM campaigns c JOIN users u ON u.id = c.created_by_user_id WHERE c.id = $1`, [id]);
    if (!r) throw new NotFoundException('Campaign not found.');
    const items = await this.ds.query(
      `SELECT i.item_type, i.item_id, i.sort_order,
         CASE i.item_type WHEN 'OFFER' THEN (SELECT name FROM offers WHERE id = i.item_id) WHEN 'BANNER' THEN (SELECT title FROM home_banners WHERE id = i.item_id) ELSE (SELECT title_en FROM notification_broadcasts WHERE id = i.item_id) END AS label
       FROM campaign_items i WHERE i.campaign_id = $1 ORDER BY i.sort_order`,
      [id],
    );
    const events = await this.ds.query(`SELECT e.*, u.full_name FROM campaign_events e LEFT JOIN users u ON u.id = e.actor_user_id WHERE e.campaign_id = $1 ORDER BY e.created_at, e.id`, [id]);
    return { ...this.cView(r), items: items.map((i: any) => ({ type: i.item_type, id: i.item_id, label: i.label, sortOrder: i.sort_order })), timeline: events.map((e: any) => ({ from: e.from_status, to: e.to_status, actor: e.full_name, note: e.note, at: new Date(e.created_at).toISOString() })) };
  }

  /** An edit after approval invalidates it (back to DRAFT) — recorded in the timeline. */
  async updateCampaign(id: string, i: any, actorId: string) {
    const c = await this.getCampaign(id);
    if (!['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED'].includes(c.status)) throw new ConflictException({ message: 'A running or finished campaign cannot be edited.', details: { code: 'STATE_CONFLICT', status: c.status } });
    const starts = i.startsAt ?? c.startsAt; const ends = i.endsAt ?? c.endsAt;
    if (new Date(ends) <= new Date(starts)) throw bad('endsAt must be after startsAt.');
    await this.ds.query(`UPDATE campaigns SET name_en = coalesce($2, name_en), name_ar = coalesce($3, name_ar), starts_at = $4, ends_at = $5, status = 'DRAFT', approved_by_user_id = NULL, approved_at = NULL, last_edited_by_user_id = $6, version = version + 1, updated_at = now() WHERE id = $1`, [id, i.nameEn ?? null, i.nameAr ?? null, starts, ends, actorId]);
    if (c.status !== 'DRAFT') await this.ds.query(`INSERT INTO campaign_events (campaign_id, from_status, to_status, actor_user_id, note) VALUES ($1,$2,'DRAFT',$3,'Edited after submission — approval invalidated')`, [id, c.status, actorId]);
    return this.getCampaign(id);
  }

  async setCampaignItems(id: string, items: Array<{ type: string; id: string }>, actorId: string) {
    const c = await this.getCampaign(id);
    if (c.status !== 'DRAFT') throw new ConflictException({ message: 'Items can only change while the campaign is a draft.', details: { code: 'STATE_CONFLICT' } });
    if (!Array.isArray(items) || items.length > 50) throw bad('items must be a list of at most 50.');
    for (const it of items) {
      if (!['OFFER', 'BANNER', 'BROADCAST'].includes(it.type)) throw bad('item type must be OFFER, BANNER or BROADCAST.');
      assertUuid(it.id, 'item id');
      const table = it.type === 'OFFER' ? 'offers' : it.type === 'BANNER' ? 'home_banners' : 'notification_broadcasts';
      const [e] = await this.ds.query(`SELECT 1 FROM ${table} WHERE id = $1 ${it.type === 'BROADCAST' ? '' : 'AND deleted_at IS NULL'}`, [it.id]);
      if (!e) throw new NotFoundException(`${it.type} ${it.id} not found.`);
    }
    await this.ds.transaction(async (m) => {
      await m.query(`DELETE FROM campaign_items WHERE campaign_id = $1`, [id]);
      for (let i = 0; i < items.length; i++) await m.query(`INSERT INTO campaign_items (campaign_id, item_type, item_id, sort_order) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [id, items[i].type, items[i].id, i]);
      await m.query(`UPDATE campaigns SET last_edited_by_user_id = $2, version = version + 1, updated_at = now() WHERE id = $1`, [id, actorId]);
    });
    return this.getCampaign(id);
  }

  private async event(id: string, from: string, to: string, actor: string | null, note?: string) {
    await this.ds.query(`INSERT INTO campaign_events (campaign_id, from_status, to_status, actor_user_id, note) VALUES ($1,$2,$3,$4,$5)`, [id, from, to, actor, note ?? null]);
  }

  async submitCampaign(id: string, actorId: string) {
    const c = await this.getCampaign(id);
    if (c.items.length === 0) throw bad('Add at least one offer, banner or broadcast before submitting.', 'CAMPAIGN_EMPTY');
    await this.transition('campaigns', id, ['DRAFT'], 'PENDING_APPROVAL');
    await this.event(id, 'DRAFT', 'PENDING_APPROVAL', actorId);
    return this.getCampaign(id);
  }

  async approveCampaign(id: string, actorId: string) {
    const [c] = await this.ds.query(`SELECT created_by_user_id, last_edited_by_user_id, starts_at FROM campaigns WHERE id = $1`, [id]);
    if (!c) throw new NotFoundException('Campaign not found.');
    if (c.created_by_user_id === actorId || c.last_edited_by_user_id === actorId) throw new ForbiddenException({ message: 'You cannot approve a campaign you created or edited.', details: { code: 'FOUR_EYES' } });
    await this.transition('campaigns', id, ['PENDING_APPROVAL'], 'SCHEDULED', ', approved_by_user_id = $3, approved_at = now()', [actorId]);
    await this.event(id, 'PENDING_APPROVAL', 'SCHEDULED', actorId);
    void this.tick();
    return this.getCampaign(id);
  }

  async rejectCampaign(id: string, reason: string, actorId: string) {
    if (!reason || reason.trim().length < 5) throw bad('A reason is required (at least 5 characters).');
    const [c] = await this.ds.query(`SELECT created_by_user_id FROM campaigns WHERE id = $1`, [id]);
    if (!c) throw new NotFoundException('Campaign not found.');
    if (c.created_by_user_id === actorId) throw new ForbiddenException({ message: 'You cannot review your own campaign.', details: { code: 'FOUR_EYES' } });
    await this.transition('campaigns', id, ['PENDING_APPROVAL'], 'DRAFT', ', rejection_reason = $3', [reason.slice(0, 300)]);
    await this.event(id, 'PENDING_APPROVAL', 'DRAFT', actorId, reason);
    return this.getCampaign(id);
  }

  async cancelCampaign(id: string, actorId: string) {
    const c = await this.getCampaign(id);
    await this.transition('campaigns', id, ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'RUNNING'], 'CANCELLED');
    if (c.status === 'RUNNING') await this.stopItems(id);
    await this.event(id, c.status, 'CANCELLED', actorId);
    return this.getCampaign(id);
  }

  /** Activates the items THIS campaign started (offers/banners the campaign switched on are the only ones it ever switches off). */
  private async startItems(id: string) {
    for (const t of [['OFFER', 'offers'], ['BANNER', 'home_banners']] as const) {
      await this.ds.query(`UPDATE campaign_items ci SET started_by_campaign = true FROM ${t[1]} x WHERE ci.campaign_id = $1 AND ci.item_type = $2 AND x.id = ci.item_id AND x.is_active = false`, [id, t[0]]);
      await this.ds.query(`UPDATE ${t[1]} SET is_active = true, updated_at = now() WHERE id IN (SELECT item_id FROM campaign_items WHERE campaign_id = $1 AND item_type = $2 AND started_by_campaign)`, [id, t[0]]);
    }
    await this.homeCache.bumpEpoch();
  }

  private async stopItems(id: string) {
    for (const t of [['OFFER', 'offers'], ['BANNER', 'home_banners']] as const) {
      await this.ds.query(`UPDATE ${t[1]} SET is_active = false, updated_at = now() WHERE id IN (SELECT item_id FROM campaign_items WHERE campaign_id = $1 AND item_type = $2 AND started_by_campaign)`, [id, t[0]]);
    }
    await this.homeCache.bumpEpoch();
  }

  async runCampaigns() {
    const due = await this.ds.query(`SELECT id FROM campaigns WHERE status = 'SCHEDULED' AND starts_at <= now() FOR UPDATE SKIP LOCKED`);
    for (const { id } of due) {
      const rows = returned(await this.ds.query(`UPDATE campaigns SET status = 'RUNNING', updated_at = now() WHERE id = $1 AND status = 'SCHEDULED' RETURNING id`, [id]));
      if (!rows[0]) continue;
      await this.event(id, 'SCHEDULED', 'RUNNING', null, 'Started on schedule');
      await this.startItems(id);
    }
    const over = await this.ds.query(`SELECT id FROM campaigns WHERE status = 'RUNNING' AND ends_at <= now()`);
    for (const { id } of over) {
      const rows = returned(await this.ds.query(`UPDATE campaigns SET status = 'COMPLETED', updated_at = now() WHERE id = $1 AND status = 'RUNNING' RETURNING id`, [id]));
      if (!rows[0]) continue;
      await this.stopItems(id);
      await this.event(id, 'RUNNING', 'COMPLETED', null, 'Ended on schedule');
    }
  }

  async campaignPerformance(id: string) {
    const c = await this.getCampaign(id);
    const offerIds = c.items.filter((i: any) => i.type === 'OFFER').map((i: any) => i.id);
    const [o] = offerIds.length
      ? await this.ds.query(`SELECT count(*)::int AS consumptions, count(*) FILTER (WHERE is_reversed)::int AS reversed, coalesce(sum(discount_applied_minor) FILTER (WHERE NOT is_reversed), 0)::bigint AS net FROM offer_consumptions WHERE offer_id = ANY($1) AND created_at >= $2 AND created_at <= $3`, [offerIds, c.startsAt, c.endsAt])
      : [{ consumptions: 0, reversed: 0, net: 0 }];
    const bIds = c.items.filter((i: any) => i.type === 'BROADCAST').map((i: any) => i.id);
    const [b] = bIds.length ? await this.ds.query(`SELECT count(*)::int AS recipients, count(*) FILTER (WHERE status = 'SENT')::int AS sent FROM broadcast_recipients WHERE broadcast_id = ANY($1)`, [bIds]) : [{ recipients: 0, sent: 0 }];
    return { campaignId: id, status: c.status, offers: { consumptions: o.consumptions, reversed: o.reversed, netDiscountMinor: num(o.net) }, broadcasts: { recipients: b.recipients, sent: b.sent }, note: 'Only recorded data — no ROI is computed.' };
  }

  // ------------------------------------------------------------------ growth overview (real data only)

  async growth(from?: string, to?: string) {
    assertMaxRange(from, to, 366);
    const p1: unknown[] = []; const w1: string[] = [`u.role = 'CUSTOMER'`];
    addCairoRange(w1, p1, 'u.created_at', from, to);
    const [reg] = await this.ds.query(`SELECT count(*)::int AS n FROM users u WHERE ${w1.join(' AND ')}`, p1);
    const p2: unknown[] = []; const w2: string[] = ['true'];
    addCairoRange(w2, p2, 'o.created_at', from, to);
    const [ord] = await this.ds.query(
      `SELECT count(*)::int AS orders, count(DISTINCT o.customer_id)::int AS customers,
         count(DISTINCT o.customer_id) FILTER (WHERE (SELECT count(*) FROM orders x WHERE x.customer_id = o.customer_id AND x.created_at < o.created_at) > 0)::int AS returning_customers,
         count(*) FILTER (WHERE o.coupon_snapshot IS NOT NULL)::int AS coupon_orders FROM orders o WHERE ${w2.join(' AND ')}`,
      p2,
    );
    const p3: unknown[] = []; const w3: string[] = ['true'];
    addCairoRange(w3, p3, 't.created_at', from, to);
    const [loy] = await this.ds.query(`SELECT coalesce(sum(points_delta) FILTER (WHERE points_delta > 0), 0)::int AS issued, coalesce(-sum(points_delta) FILTER (WHERE points_delta < 0), 0)::int AS redeemed FROM loyalty_points_transactions t WHERE ${w3.join(' AND ')}`, p3);
    const [msgs] = await this.ds.query(`SELECT count(*)::int AS delivered, count(*) FILTER (WHERE read_at IS NOT NULL)::int AS opened FROM customer_inbox_messages`);
    const has = ord.orders > 0;
    return {
      newCustomers: reg.n, orders: has ? ord.orders : null, orderingCustomers: has ? ord.customers : null,
      repeatRatePct: has && ord.customers > 0 ? Math.round((ord.returning_customers / ord.customers) * 1000) / 10 : null,
      ordersPerCustomer: has && ord.customers > 0 ? Math.round((ord.orders / ord.customers) * 100) / 100 : null, couponOrders: has ? ord.coupon_orders : null,
      loyaltyPointsIssued: loy.issued, loyaltyPointsRedeemed: loy.redeemed, inboxMessagesDelivered: msgs.delivered, inboxMessagesOpened: msgs.opened,
    };
  }

  async retention(months = 6) {
    const m = Math.min(24, Math.max(1, Math.floor(months) || 6));
    const rows = await this.ds.query(
      `WITH first AS (SELECT customer_id, date_trunc('month', min(created_at) AT TIME ZONE '${REPORTING_TIMEZONE}')::date AS cohort FROM orders WHERE status <> 'CANCELLED' GROUP BY 1),
            act AS (SELECT DISTINCT customer_id, date_trunc('month', created_at AT TIME ZONE '${REPORTING_TIMEZONE}')::date AS month FROM orders WHERE status <> 'CANCELLED')
       SELECT to_char(f.cohort, 'YYYY-MM') AS cohort, ((extract(year FROM a.month) - extract(year FROM f.cohort)) * 12 + extract(month FROM a.month) - extract(month FROM f.cohort))::int AS offset, count(*)::int AS customers
         FROM first f JOIN act a ON a.customer_id = f.customer_id WHERE f.cohort >= (date_trunc('month', now() AT TIME ZONE '${REPORTING_TIMEZONE}') - ($1 || ' months')::interval)::date GROUP BY 1, 2 ORDER BY 1, 2`,
      [String(m)],
    );
    return { months: m, cells: rows.map((r: any) => ({ cohort: r.cohort, monthOffset: r.offset, customers: r.customers })) };
  }
}

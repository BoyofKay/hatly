import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor, NotFoundException, OnApplicationBootstrap, OnModuleDestroy, Optional, BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type Redis from 'ioredis';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { promises as fs, constants as fsc } from 'fs';
import * as os from 'os';
import { REDIS_CLIENT } from '../../../common/redis/redis.constants';
import { assertUuid, num, pageParams, returned } from '../common/platform-sql';

const BUCKETS = [25, 50, 100, 200, 400, 800, 1600, 3200];
const INSTANCE = `${os.hostname()}:${process.pid}`.slice(0, 40);

interface Agg {
  count: number;
  sum: number;
  max: number;
  hist: number[];
}

/** In-memory, per-instance request aggregation (route PATTERN + status class + duration histogram). No ids, no payloads, no PII. Flushed per minute. */
@Injectable()
export class MetricsRecorder implements OnApplicationBootstrap, OnModuleDestroy {
  private current = new Map<string, Agg>();
  private timer?: NodeJS.Timeout;

  constructor(private readonly ds: DataSource) {}

  record(key: string, dims: string, ms: number): void {
    const k = `${key}\u0000${dims}`;
    let a = this.current.get(k);
    if (!a) this.current.set(k, (a = { count: 0, sum: 0, max: 0, hist: new Array(BUCKETS.length + 1).fill(0) }));
    a.count += 1;
    a.sum += ms;
    a.max = Math.max(a.max, ms);
    let i = BUCKETS.findIndex((b) => ms <= b);
    if (i < 0) i = BUCKETS.length;
    a.hist[i] += 1;
  }

  onApplicationBootstrap(): void {
    if (process.env.METRICS_ENABLED === 'false') return;
    this.timer = setInterval(() => void this.flush(), 60_000);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  async flush(): Promise<void> {
    if (this.current.size === 0) return;
    const snapshot = this.current;
    this.current = new Map();
    const minute = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    for (const [k, a] of snapshot) {
      const [key, dims] = k.split('\u0000');
      try {
        await this.ds.query(
          `INSERT INTO system_metric_buckets (bucket_start, instance_id, metric_key, dims, count, sum, max, histogram) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (bucket_start, instance_id, metric_key, dims) DO UPDATE SET count = system_metric_buckets.count + EXCLUDED.count, sum = system_metric_buckets.sum + EXCLUDED.sum,
             max = greatest(system_metric_buckets.max, EXCLUDED.max), histogram = jsonb_build_object('0', coalesce((system_metric_buckets.histogram ->> '0')::int, 0) + coalesce((EXCLUDED.histogram ->> '0')::int, 0), '1', coalesce((system_metric_buckets.histogram ->> '1')::int, 0) + coalesce((EXCLUDED.histogram ->> '1')::int, 0), '2', coalesce((system_metric_buckets.histogram ->> '2')::int, 0) + coalesce((EXCLUDED.histogram ->> '2')::int, 0), '3', coalesce((system_metric_buckets.histogram ->> '3')::int, 0) + coalesce((EXCLUDED.histogram ->> '3')::int, 0), '4', coalesce((system_metric_buckets.histogram ->> '4')::int, 0) + coalesce((EXCLUDED.histogram ->> '4')::int, 0), '5', coalesce((system_metric_buckets.histogram ->> '5')::int, 0) + coalesce((EXCLUDED.histogram ->> '5')::int, 0), '6', coalesce((system_metric_buckets.histogram ->> '6')::int, 0) + coalesce((EXCLUDED.histogram ->> '6')::int, 0), '7', coalesce((system_metric_buckets.histogram ->> '7')::int, 0) + coalesce((EXCLUDED.histogram ->> '7')::int, 0), '8', coalesce((system_metric_buckets.histogram ->> '8')::int, 0) + coalesce((EXCLUDED.histogram ->> '8')::int, 0))`,
          [minute, INSTANCE, key, dims, a.count, a.sum, a.max, JSON.stringify(Object.fromEntries(a.hist.map((n, i) => [String(i), n])))],
        );
      } catch {
        /* metrics must never affect a request */
      }
    }
  }
}

/** Global: records every request's pattern/status/duration, and answers with a `Server-Timing: total` header (no identifiers). */
@Injectable()
export class RequestMetricsInterceptor implements NestInterceptor {
  constructor(private readonly recorder: MetricsRecorder) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();
    const started = process.hrtime.bigint();
    const done = () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const route = String(req.route?.path ?? 'unmatched').slice(0, 100);
      this.recorder.record('http.request', `${req.method} ${route}|${Math.floor((res.statusCode ?? 0) / 100)}xx`, ms);
    };
    res.once('finish', done);
    return next.handle().pipe(
      tap(() => {
        if (process.env.SERVER_TIMING_ENABLED !== 'false' && !res.headersSent) {
          const ms = Number(process.hrtime.bigint() - started) / 1e6;
          res.setHeader('Server-Timing', `total;dur=${ms.toFixed(1)}`);
        }
      }),
    );
  }
}

type Status = 'OK' | 'DEGRADED' | 'DOWN' | 'DISABLED';

@Injectable()
export class SystemService {
  constructor(
    private readonly ds: DataSource,
    private readonly config: ConfigService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  private async timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; ms: number; value?: T; error?: string }> {
    const t = Date.now();
    try {
      const value = await fn();
      return { ok: true, ms: Date.now() - t, value };
    } catch (e) {
      return { ok: false, ms: Date.now() - t, error: String((e as Error).message).slice(0, 160) };
    }
  }

  /** Real probes only. An unconfigured integration is DISABLED (never "healthy"); paid providers are checked for CONFIGURATION, never called. */
  async overview(record = true) {
    const checks: Array<{ key: string; status: Status; latencyMs: number | null; detail: string }> = [];
    checks.push({ key: 'api', status: 'OK', latencyMs: null, detail: `uptime ${Math.round(process.uptime())}s · node ${process.version}` });

    const db = await this.timed(() => this.ds.query('SELECT 1'));
    const pool = (this.ds.driver as any)?.master;
    checks.push({ key: 'database', status: db.ok ? (db.ms > 500 ? 'DEGRADED' : 'OK') : 'DOWN', latencyMs: db.ms, detail: db.ok ? `pool total ${pool?.totalCount ?? '?'} idle ${pool?.idleCount ?? '?'} waiting ${pool?.waitingCount ?? '?'}` : db.error! });

    if (this.redis) {
      const r = await this.timed(() => this.redis!.ping());
      checks.push({ key: 'redis', status: r.ok ? 'OK' : 'DOWN', latencyMs: r.ms, detail: r.ok ? 'PING ok' : r.error! });
    } else checks.push({ key: 'redis', status: 'DISABLED', latencyMs: null, detail: 'Redis is not configured (caches and shared rate limits fall back to the process).' });

    const driver = this.config.get<string>('storage.driver') ?? 'local';
    if (driver === 'local') {
      const dir = this.config.get<string>('uploads.localDir') || './uploads-storage';
      const w = await this.timed(async () => { await fs.mkdir(dir, { recursive: true }); await fs.access(dir, fsc.W_OK); });
      checks.push({ key: 'storage', status: w.ok ? 'OK' : 'DOWN', latencyMs: w.ms, detail: w.ok ? 'local disk, writable' : w.error! });
    } else {
      const ok = Boolean(this.config.get('storage.bucket') && this.config.get('storage.accessKey'));
      checks.push({ key: 'storage', status: ok ? 'OK' : 'DOWN', latencyMs: null, detail: ok ? 'S3-compatible storage configured (not probed with a write)' : 'S3 driver selected but bucket/credentials missing' });
    }

    const sms = Boolean(this.config.get('sms.unifonicAppSid') && this.config.get('sms.unifonicSenderId'));
    checks.push({ key: 'sms', status: sms ? 'OK' : 'DISABLED', latencyMs: null, detail: sms ? 'Unifonic configured (no message is sent by a check)' : 'No SMS provider configured (set UNIFONIC_APP_SID and UNIFONIC_SENDER_ID).' });
    const maps = this.config.get<string>('maps.provider') ?? 'google';
    const mapsKey = Boolean(this.config.get('maps.googleApiKey'));
    checks.push({ key: 'maps', status: maps === 'none' ? 'DISABLED' : mapsKey ? 'OK' : 'DEGRADED', latencyMs: null, detail: maps === 'none' ? 'MAPS_PROVIDER=none (map features are off)' : mapsKey ? `provider ${maps}, key configured` : `provider ${maps} but no API key` });
    const fcm = Boolean(this.config.get('fcm.projectId') && this.config.get('fcm.clientEmail') && this.config.get('fcm.privateKey'));
    checks.push({ key: 'push', status: fcm ? 'OK' : 'DISABLED', latencyMs: null, detail: fcm ? 'Firebase Cloud Messaging configured (no push is sent by a check)' : 'FCM is not configured; push is off (in-app messages still work).' });

    const [q] = await this.ds.query(`SELECT count(*) FILTER (WHERE status = 'QUEUED')::int AS queued, count(*) FILTER (WHERE status = 'RUNNING')::int AS running, count(*) FILTER (WHERE status = 'FAILED' AND finished_at > now() - interval '24 hours')::int AS failed_24h,
        coalesce(extract(epoch FROM now() - min(created_at) FILTER (WHERE status = 'QUEUED')), 0)::int AS oldest FROM report_exports`);
    checks.push({ key: 'jobs', status: q.oldest > 300 ? 'DEGRADED' : 'OK', latencyMs: null, detail: `exports: ${q.queued} queued, ${q.running} running, ${q.failed_24h} failed in 24 h, oldest queued ${q.oldest}s` });
    const [m] = await this.ds.query(`SELECT count(*)::int AS n, max(name) AS latest FROM migrations`);
    checks.push({ key: 'migrations', status: 'OK', latencyMs: null, detail: `${m.n} applied (latest ${m.latest})` });

    if (record) {
      for (const c of checks) if (['database', 'redis', 'storage', 'sms', 'maps', 'push', 'jobs'].includes(c.key)) {
        await this.ds.query(`INSERT INTO integration_checks (integration_key, status, latency_ms, detail) VALUES ($1,$2,$3,$4)`, [c.key, c.status, c.latencyMs, c.detail.slice(0, 200)]).catch(() => undefined);
      }
      await this.ds.query(`DELETE FROM integration_checks WHERE checked_at < now() - interval '30 days'`).catch(() => undefined);
    }
    return { checkedAt: new Date().toISOString(), checks, overall: checks.some((c) => c.status === 'DOWN') ? 'DOWN' : checks.some((c) => c.status === 'DEGRADED') ? 'DEGRADED' : 'OK' };
  }

  async history(key: string) {
    const rows = await this.ds.query(`SELECT status, latency_ms, detail, checked_at FROM integration_checks WHERE integration_key = $1 ORDER BY checked_at DESC LIMIT 50`, [key]);
    return rows.map((r: any) => ({ status: r.status, latencyMs: r.latency_ms, detail: r.detail, checkedAt: new Date(r.checked_at).toISOString() }));
  }

  /** Request metrics from the flushed buckets for the last N hours, grouped by route pattern. Percentiles come from the merged histogram (bucket upper bound). */
  async requests(hours = 24) {
    const h = Math.min(24 * 14, Math.max(1, Math.floor(hours) || 24));
    const rows = await this.ds.query(`SELECT dims, sum(count)::bigint AS count, sum(sum) AS total_ms, max(max) AS max_ms FROM system_metric_buckets WHERE metric_key = 'http.request' AND bucket_start > now() - ($1 || ' hours')::interval GROUP BY dims`, [String(h)]);
    const hist = await this.ds.query(`SELECT b.dims, e.key AS bucket, sum((e.value)::int)::bigint AS n FROM system_metric_buckets b, LATERAL jsonb_each_text(b.histogram) e WHERE b.metric_key = 'http.request' AND b.bucket_start > now() - ($1 || ' hours')::interval GROUP BY b.dims, e.key`, [String(h)]);
    const byDims = new Map<string, number[]>();
    for (const r of hist) {
      const arr = byDims.get(r.dims) ?? new Array(BUCKETS.length + 1).fill(0);
      arr[Number(r.bucket)] = num(r.n);
      byDims.set(r.dims, arr);
    }
    const pct = (arr: number[], p: number) => {
      const total = arr.reduce((s, n) => s + n, 0);
      if (!total) return null;
      let acc = 0;
      for (let i = 0; i < arr.length; i++) { acc += arr[i]; if (acc / total >= p) return i < BUCKETS.length ? BUCKETS[i] : null; }
      return null;
    };
    const groups = new Map<string, { route: string; count: number; errors: number; totalMs: number; maxMs: number; hist: number[] }>();
    for (const r of rows) {
      const [route, cls] = String(r.dims).split('|');
      const g = groups.get(route) ?? { route, count: 0, errors: 0, totalMs: 0, maxMs: 0, hist: new Array(BUCKETS.length + 1).fill(0) };
      g.count += num(r.count);
      if (cls === '5xx') g.errors += num(r.count);
      g.totalMs += num(r.total_ms);
      g.maxMs = Math.max(g.maxMs, num(r.max_ms));
      (byDims.get(r.dims) ?? []).forEach((n, i) => (g.hist[i] += n));
      groups.set(route, g);
    }
    const items = [...groups.values()].map((g) => ({ route: g.route, count: g.count, serverErrors: g.errors, errorRatePct: g.count ? Math.round((g.errors / g.count) * 1000) / 10 : 0, avgMs: g.count ? Math.round(g.totalMs / g.count) : null, p50Ms: pct(g.hist, 0.5), p95Ms: pct(g.hist, 0.95), maxMs: Math.round(g.maxMs) })).sort((a, b) => b.count - a.count).slice(0, 60);
    const total = items.reduce((s, i) => s + i.count, 0);
    const errors = items.reduce((s, i) => s + i.serverErrors, 0);
    return { hours: h, totalRequests: total, serverErrors: errors, errorRatePct: total ? Math.round((errors / total) * 1000) / 10 : null, items, note: 'Percentiles are histogram upper bounds (25/50/100/200/400/800/1600/3200 ms). Data starts when this version was deployed.' };
  }

  async databaseAndCache() {
    const pool = (this.ds.driver as any)?.master;
    const [db] = await this.ds.query(`SELECT pg_database_size(current_database())::bigint AS bytes, (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::int AS connections`);
    const tables = await this.ds.query(`SELECT relname AS name, n_live_tup::bigint AS rows FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 8`);
    return { database: { sizeBytes: num(db.bytes), connections: db.connections, pool: pool ? { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount } : null, largestTables: tables.map((t: any) => ({ name: t.name, rows: num(t.rows) })) }, redis: this.redis ? { status: this.redis.status } : null };
  }

  // ---------------------------------------------------------------- jobs (report exports)

  async jobs(q: { status?: string; page?: string | number; limit?: string | number }) {
    const { page, limit, offset } = pageParams(q, 25, 100);
    const params: unknown[] = [];
    let w = '';
    if (q.status) { params.push(q.status); w = 'WHERE e.status = $1'; }
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM report_exports e ${w}`, params);
    const rows = await this.ds.query(`SELECT e.id, e.report_id, e.format, e.status, e.progress, e.attempts, e.error_code, e.created_at, e.started_at, e.finished_at, u.full_name FROM report_exports e JOIN users u ON u.id = e.requested_by_user_id ${w} ORDER BY e.created_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
    return { items: rows.map((r: any) => ({ id: r.id, type: 'REPORT_EXPORT', label: `${r.report_id} ${r.format}`, status: r.status, progress: r.progress, attempts: r.attempts, errorCode: r.error_code, requestedBy: r.full_name, createdAt: new Date(r.created_at).toISOString(), startedAt: r.started_at, finishedAt: r.finished_at })), page, limit, total };
  }

  async retryJob(id: string) {
    assertUuid(id, 'id');
    const rows = returned(await this.ds.query(`UPDATE report_exports SET status = 'QUEUED', attempts = 0, error_code = NULL, error_message = NULL, progress = 0, cancel_requested = false, finished_at = NULL, updated_at = now() WHERE id = $1 AND status = 'FAILED' RETURNING id`, [id]));
    if (!rows[0]) {
      const [e] = await this.ds.query(`SELECT status FROM report_exports WHERE id = $1`, [id]);
      if (!e) throw new NotFoundException('Job not found.');
      throw new ConflictException({ message: 'Only a failed job can be retried.', details: { code: 'STATE_CONFLICT', status: e.status } });
    }
    return { id, status: 'QUEUED' };
  }

  // ---------------------------------------------------------------- client telemetry (privacy-safe aggregates)

  static readonly CLIENT_KEYS = new Set(['app.cold_start_ms', 'app.ttfmc_ms', 'screen.ready_ms', 'api.latency_ms', 'image.load_ms', 'web.lcp_ms', 'web.inp_ms', 'web.cls_x1000']);

  async ingestClient(body: any, recorder: MetricsRecorder) {
    const apps = ['customer', 'driver', 'vendor-web', 'admin-web'];
    if (!body || !apps.includes(body.app) || !Array.isArray(body.metrics) || body.metrics.length > 40) throw new BadRequestException({ message: 'Invalid telemetry payload.', details: { code: 'VALIDATION_FAILED' } });
    const mode = ['release', 'profile', 'debug'].includes(body.buildMode) ? body.buildMode : 'unknown';
    const platform = ['android', 'ios', 'web'].includes(body.platform) ? body.platform : 'unknown';
    const device = ['low', 'mid', 'high'].includes(body.deviceClass) ? body.deviceClass : 'unknown';
    const net = ['wifi', '4g', '3g', '2g', 'offline'].includes(body.network) ? body.network : 'unknown';
    const version = String(body.appVersion ?? '').replace(/[^0-9A-Za-z._+-]/g, '').slice(0, 20);
    let accepted = 0;
    for (const m of body.metrics) {
      if (!SystemService.CLIENT_KEYS.has(m?.key) || typeof m.value !== 'number' || !Number.isFinite(m.value) || m.value < 0 || m.value > 600_000) continue;
      const screen = m.key === 'screen.ready_ms' ? `.${String(m.screen ?? '').replace(/[^a-z_]/g, '').slice(0, 20)}` : '';
      recorder.record(`client.${m.key}${screen}`, `${body.app}|${mode}|${platform}|${device}|${net}|${version}`, m.value);
      accepted += 1;
    }
    return { accepted };
  }

  /** Release-tagged client telemetry only by default (debug builds are never evidence). A cell under 20 samples shows "no data". */
  async clientMetrics(q: { app?: string; includeDebug?: string; hours?: string }) {
    const h = Math.min(24 * 14, Math.max(1, Number(q.hours) || 24 * 7));
    const rows = await this.ds.query(
      `SELECT metric_key, dims, sum(count)::bigint AS n, sum(sum) AS total, max(max) AS max_ms FROM system_metric_buckets WHERE metric_key LIKE 'client.%' AND bucket_start > now() - ($1 || ' hours')::interval GROUP BY metric_key, dims`,
      [String(h)],
    );
    const items = rows
      .map((r: any) => { const [app, mode, platform, device, network, version] = String(r.dims).split('|'); return { metric: String(r.metric_key).slice(7), app, buildMode: mode, platform, deviceClass: device, network, appVersion: version, samples: num(r.n), avgMs: num(r.n) >= 20 ? Math.round(num(r.total) / num(r.n)) : null, maxMs: Math.round(num(r.max_ms)) }; })
      .filter((i: any) => (q.app ? i.app === q.app : true) && (q.includeDebug === 'true' || i.buildMode !== 'debug'));
    return { hours: h, items, minimumSamples: 20, note: 'Only Release builds are shown unless debug is included. Averages appear once a cell has at least 20 samples.' };
  }
}

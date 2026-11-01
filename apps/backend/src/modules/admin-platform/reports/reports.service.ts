import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PermissionsService } from '../../permissions/permissions.service';
import { Permission } from '../../permissions/permission.enum';
import { Role } from '../../../common/enums/role.enum';
import { ExecutiveService } from '../executive/executive.service';
import { assertDate, assertMaxRange, maskName, maskPhone, num, REPORTING_TIMEZONE, returned } from '../common/platform-sql';
import { REPORTS, REPORT_BY_ID } from './report-registry';
import { ReportColumn, ReportDefinition } from './report-types';
import { Locale, WriterInput, writeCsv, writePdf, writeXlsx } from './export-writers';

export interface Actor {
  id: string;
  role: string;
}
export interface Access {
  canView: boolean;
  canExport: boolean;
  money: boolean;
  pii: boolean;
}

const XLSX_MAX_ROWS = 100_000;
const PDF_MAX_ROWS = 5_000;
const PREVIEW_MAX = 200;
const BATCH = 2_000;
const RETENTION_HOURS = () => Number(process.env.EXPORT_RETENTION_HOURS ?? 72);
const MAX_PER_HOUR = () => Number(process.env.EXPORT_MAX_PER_HOUR ?? 10);
const KPI_LABELS: Record<string, [string, string]> = {
  ordersPlaced: ['Orders placed', 'الطلبات'], ordersDelivered: ['Orders delivered', 'الطلبات المسلمة'], cancellationRate: ['Cancellation rate %', 'نسبة الإلغاء %'],
  gmvMinor: ['GMV (goods value)', 'قيمة البضائع'], averageOrderValueMinor: ['Average order value', 'متوسط قيمة الطلب'], deliveryFeesMinor: ['Delivery fees (delivered orders)', 'رسوم التوصيل (الطلبات المسلمة)'],
  hatlyRevenueMinor: ['Hatly revenue (recognised)', 'إيراد حاتلي'], hatlyFundedDiscountNetMinor: ['Hatly-funded discount (net)', 'صافي الخصم الممول من حاتلي'],
  activeVendors: ['Active vendors', 'الموردون النشطون'], activeDrivers: ['Active drivers', 'السائقون النشطون'], medianDeliveryMinutes: ['Median delivery minutes', 'وسيط دقائق التوصيل'],
  openDispatchAlerts: ['Open dispatch alerts', 'تنبيهات التوزيع المفتوحة'], outstandingRefundsMinor: ['Outstanding refunds (recorded, not sent)', 'المستردات المسجلة وغير المرسلة'],
};

@Injectable()
export class ReportsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ReportsService.name);
  private timer?: NodeJS.Timeout;
  private busy = false;
  private readonly workerId = `${os.hostname()}:${process.pid}`;

  constructor(
    private readonly ds: DataSource,
    private readonly permissions: PermissionsService,
    private readonly executive: ExecutiveService,
    private readonly config: ConfigService,
  ) {}

  // ------------------------------------------------------------- worker lifecycle (DB-backed job table, SKIP LOCKED)

  onApplicationBootstrap(): void {
    if (process.env.JOBS_WORKER_ENABLED === 'false') return;
    this.timer = setInterval(() => void this.tick(), Number(process.env.EXPORT_WORKER_INTERVAL_MS ?? 15000));
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  get exportDir(): string {
    const base = this.config.get<string>('uploads.localDir') || './uploads-storage';
    return process.env.EXPORTS_DIR ?? path.join(path.resolve(base), '.exports');
  }

  // ------------------------------------------------------------- access

  async access(actor: Actor, def: ReportDefinition): Promise<Access> {
    const isSuper = actor.role === Role.SUPER_ADMIN;
    let canView = def.superAdminOnly ? isSuper : true;
    if (canView && !def.superAdminOnly) for (const p of def.view) if (!(await this.permissions.actorHolds(actor, p))) { canView = false; break; }
    const canExport = canView && (isSuper || (await this.permissions.actorHolds(actor, def.exportPermission)));
    const money = canView && (await this.permissions.actorHolds(actor, def.moneyPermission));
    const pii = canView && (await this.permissions.actorHolds(actor, Permission.VIEW_CUSTOMER_PII));
    return { canView, canExport, money, pii };
  }

  private def(id: string): ReportDefinition {
    const def = REPORT_BY_ID.get(id);
    if (!def) throw new NotFoundException('Report not found.');
    return def;
  }

  private visibleColumns(def: ReportDefinition, access: Access): ReportColumn[] {
    return def.columns.filter((c) => access.money || c.type !== 'money');
  }

  async catalogue(actor: Actor) {
    const out = [];
    for (const def of REPORTS) {
      const a = await this.access(actor, def);
      if (!a.canView) continue;
      out.push({ id: def.id, family: def.family, en: def.en, ar: def.ar, descriptionEn: def.descriptionEn, descriptionAr: def.descriptionAr, canExport: a.canExport, params: def.params, formats: ['CSV', 'XLSX', 'PDF'] });
    }
    return out;
  }

  async definition(actor: Actor, id: string) {
    const def = this.def(id);
    const a = await this.access(actor, def);
    if (!a.canView) throw new NotFoundException('Report not found.'); // do not reveal that it exists
    return { id: def.id, family: def.family, en: def.en, ar: def.ar, descriptionEn: def.descriptionEn, descriptionAr: def.descriptionAr, params: def.params, columns: this.visibleColumns(def, a).map((c) => ({ key: c.key, en: c.en, ar: c.ar, type: c.type, total: c.total ?? null })), canExport: a.canExport, moneyHidden: !a.money, piiMasked: !a.pii };
  }

  // ------------------------------------------------------------- parameters

  cleanParams(def: ReportDefinition, raw: Record<string, unknown> | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    const allowed = new Set(def.params.map((p) => p.key));
    for (const [k, v] of Object.entries(raw ?? {})) {
      if (v === undefined || v === null || v === '') continue;
      if (!allowed.has(k)) throw new BadRequestException({ message: `Unknown parameter "${k}".`, details: { code: 'UNKNOWN_FILTER' } });
      if (typeof v !== 'string' && typeof v !== 'number') throw new BadRequestException({ message: `Parameter "${k}" is invalid.`, details: { code: 'VALIDATION_FAILED' } });
      const s = String(v).slice(0, 120);
      const spec = def.params.find((p) => p.key === k)!;
      if (spec.type === 'date') assertDate(s, k);
      if (spec.type === 'enum' && spec.options && !spec.options.includes(s)) throw new BadRequestException({ message: `Parameter "${k}" must be one of ${spec.options.join(', ')}.`, details: { code: 'VALIDATION_FAILED' } });
      out[k] = s;
    }
    if (out.from && out.to && out.from > out.to) throw new BadRequestException({ message: 'from must not be after to.', details: { code: 'INVALID_RANGE' } });
    return out;
  }

  // ------------------------------------------------------------- execution

  /** Projects every row to the VISIBLE columns only (a hidden money column must not travel in the payload) and masks PII columns. */
  private applyColumnRules(rows: Array<Record<string, unknown>>, def: ReportDefinition, access: Access): Array<Record<string, unknown>> {
    const visible = this.visibleColumns(def, access);
    return rows.map((r) => {
      const out: Record<string, unknown> = {};
      for (const c of visible) {
        const v = r[c.key];
        out[c.key] = c.pii && !access.pii ? (v === null || v === undefined ? v : c.pii === 'phone' ? maskPhone(String(v)) : maskName(String(v))) : v;
      }
      return out;
    });
  }

  private async s01Rows(params: Record<string, string>, access: Access) {
    const res = await this.executive.kpis(params.from, params.to, true, access.money);
    const fmt = (key: string, v: number | null) => (v === null ? '—' : key.endsWith('Minor') ? (v / 100).toFixed(2) : String(v));
    return res.kpis.map((k) => ({ kpi: (KPI_LABELS[k.key] ?? [k.key, k.key])[0], value: fmt(k.key, k.value), previous: k.previous === null ? '—' : fmt(k.key, k.previous), deltaPct: k.deltaPct }));
  }

  async count(def: ReportDefinition, params: Record<string, string>, access: Access): Promise<number> {
    if (!def.build) return (await this.s01Rows(params, access)).length;
    const { sql, values } = def.build(params);
    const [r] = await this.ds.query(`SELECT count(*)::bigint AS n FROM (${sql}) c`, values);
    return num(r.n);
  }

  async run(actor: Actor, id: string, rawParams: Record<string, unknown> | undefined, page = 1, limit = 50) {
    const def = this.def(id);
    const access = await this.access(actor, def);
    if (!access.canView) throw new NotFoundException('Report not found.');
    const params = this.cleanParams(def, rawParams);
    const cols = this.visibleColumns(def, access);
    const lim = Math.min(PREVIEW_MAX, Math.max(1, Math.floor(limit) || 50));
    const offset = (Math.max(1, Math.floor(page) || 1) - 1) * lim;

    if (!def.build) {
      const rows = this.applyColumnRules(await this.s01Rows(params, access), def, access);
      return { reportId: def.id, columns: cols, rows, rowCount: rows.length, totals: null, page: 1, limit: rows.length, generatedAt: new Date().toISOString(), timezone: REPORTING_TIMEZONE };
    }
    const { sql, values } = def.build(params);
    const timeout = Number(process.env.REPORT_STATEMENT_TIMEOUT_MS ?? 30000);
    const qr = this.ds.createQueryRunner();
    try {
      await qr.connect();
      await qr.query(`SET statement_timeout = ${Math.floor(timeout)}`);
      await qr.query('BEGIN READ ONLY');
      const [{ n }] = await qr.query(`SELECT count(*)::bigint AS n FROM (${sql}) c`, values);
      const rows = await qr.query(`SELECT * FROM (${sql}) r LIMIT ${lim} OFFSET ${offset}`, values);
      const totalCols = cols.filter((c) => c.total === 'sum');
      let totals: Record<string, number> | null = null;
      if (totalCols.length > 0) {
        const [t] = await qr.query(`SELECT ${totalCols.map((c) => `coalesce(sum("${c.key}"), 0)::numeric AS "${c.key}"`).join(', ')} FROM (${sql}) r`, values);
        totals = Object.fromEntries(totalCols.map((c) => [c.key, num(t[c.key])]));
      }
      await qr.query('COMMIT');
      return { reportId: def.id, columns: cols, rows: this.applyColumnRules(rows, def, access), rowCount: num(n), totals, page: Math.floor(offset / lim) + 1, limit: lim, generatedAt: new Date().toISOString(), timezone: REPORTING_TIMEZONE };
    } catch (error: any) {
      await qr.query('ROLLBACK').catch(() => undefined);
      if (error?.code === '57014') throw new BadRequestException({ message: 'The report took too long. Narrow the date range or add a filter.', details: { code: 'REPORT_TIMEOUT' } });
      throw error;
    } finally {
      await qr.release();
    }
  }

  // ------------------------------------------------------------- exports (queue)

  async createExport(actor: Actor, id: string, input: { params?: Record<string, unknown>; format: string; locale?: string; includeMinor?: boolean }, idempotencyKey?: string) {
    const def = this.def(id);
    const access = await this.access(actor, def);
    if (!access.canView) throw new NotFoundException('Report not found.');
    if (!access.canExport) throw new ForbiddenException({ message: 'You do not have permission to export this report.', details: { code: 'EXPORT_NOT_PERMITTED' } });
    const format = String(input.format ?? '').toUpperCase();
    if (!['CSV', 'XLSX', 'PDF'].includes(format)) throw new BadRequestException({ message: 'format must be CSV, XLSX or PDF.', details: { code: 'VALIDATION_FAILED' } });
    const locale: Locale = input.locale === 'ar' ? 'ar' : 'en';
    const params = this.cleanParams(def, input.params);
    if (def.params.some((p) => p.key === 'from') ) {
      // A bounded export: unbounded ranges are refused (the report's own range rule applies again when it runs).
      assertMaxRange(params.from, params.to, 3660);
    }

    if (idempotencyKey) {
      const [prior] = await this.ds.query(`SELECT * FROM report_exports WHERE requested_by_user_id = $1 AND idempotency_key = $2`, [actor.id, idempotencyKey]);
      if (prior) {
        if (prior.report_id !== id || prior.format !== format) throw new ConflictException({ message: 'This Idempotency-Key was already used for a different export.', details: { code: 'IDEMPOTENCY_CONFLICT' } });
        return { export: this.exportView(prior), replayed: true };
      }
    }
    const [{ n }] = await this.ds.query(`SELECT count(*)::int AS n FROM report_exports WHERE requested_by_user_id = $1 AND created_at > now() - interval '1 hour'`, [actor.id]);
    if (n >= MAX_PER_HOUR()) throw new BadRequestException({ message: `You can request at most ${MAX_PER_HOUR()} exports per hour.`, details: { code: 'RATE_LIMITED' } });

    const rowCount = await this.count(def, params, access);
    const cap = def.maxRows ?? 100_000;
    if (rowCount > cap) throw new BadRequestException({ message: `This report has ${rowCount} rows, above the ${cap} limit. Narrow the date range or add a filter.`, details: { code: 'EXPORT_TOO_LARGE', rowCount, maxRows: cap } });
    if (format === 'XLSX' && rowCount > XLSX_MAX_ROWS) throw new BadRequestException({ message: `XLSX is limited to ${XLSX_MAX_ROWS} rows (this report has ${rowCount}). Export CSV instead.`, details: { code: 'EXPORT_TOO_LARGE', rowCount, maxRows: XLSX_MAX_ROWS } });
    if (format === 'PDF' && rowCount > PDF_MAX_ROWS) throw new BadRequestException({ message: `PDF is limited to ${PDF_MAX_ROWS} rows (this report has ${rowCount}). Export CSV or XLSX instead.`, details: { code: 'EXPORT_TOO_LARGE', rowCount, maxRows: PDF_MAX_ROWS } });

    try {
      const [row] = await this.ds.query(
        `INSERT INTO report_exports (report_id, params, format, locale, requested_by_user_id, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [id, JSON.stringify(input.includeMinor ? { ...params, __includeMinor: '1' } : params), format, locale, actor.id, idempotencyKey ?? null],
      );
      await this.ds.query(`UPDATE report_exports SET row_count = $2 WHERE id = $1`, [row.id, rowCount]);
      row.row_count = rowCount;
      void this.tick();
      return { export: this.exportView(row), replayed: false };
    } catch (error: any) {
      if (error?.code === '23505' && idempotencyKey) {
        const [prior] = await this.ds.query(`SELECT * FROM report_exports WHERE requested_by_user_id = $1 AND idempotency_key = $2`, [actor.id, idempotencyKey]);
        if (prior) return { export: this.exportView(prior), replayed: true };
      }
      throw error;
    }
  }

  exportView(r: any) {
    return {
      id: r.id, reportId: r.report_id, reportName: REPORT_BY_ID.get(r.report_id)?.en ?? r.report_id, format: r.format, locale: r.locale, status: r.status, progress: r.progress, rowCount: r.row_count, fileBytes: r.file_bytes === null ? null : num(r.file_bytes),
      params: Object.fromEntries(Object.entries((r.params ?? {}) as Record<string, string>).filter(([k]) => !k.startsWith('__'))), errorCode: r.error_code, errorMessage: r.error_message, createdAt: new Date(r.created_at).toISOString(), startedAt: r.started_at, finishedAt: r.finished_at, expiresAt: r.expires_at, downloadCount: r.download_count,
      requestedBy: r.requested_by_user_id, requestedByName: r.requested_by_name ?? null,
    };
  }

  async listExports(actor: Actor, q: { mine?: string; status?: string; reportId?: string; page?: string | number; limit?: string | number }) {
    const holdsAll = actor.role === Role.SUPER_ADMIN || (await this.permissions.actorHolds(actor, Permission.AUDIT_EXPORT));
    const params: unknown[] = [];
    const where: string[] = [];
    if (!holdsAll || q.mine !== 'false') { params.push(actor.id); where.push(`e.requested_by_user_id = $${params.length}`); }
    if (q.status) { params.push(q.status); where.push(`e.status = $${params.length}`); }
    if (q.reportId) { params.push(q.reportId); where.push(`e.report_id = $${params.length}`); }
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 25));
    const offset = (Math.max(1, Number(q.page) || 1) - 1) * limit;
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM report_exports e ${w}`, params);
    const rows = await this.ds.query(`SELECT e.*, u.full_name AS requested_by_name FROM report_exports e JOIN users u ON u.id = e.requested_by_user_id ${w} ORDER BY e.created_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
    return { items: rows.map((r: any) => this.exportView(r)), page: Math.floor(offset / limit) + 1, limit, total };
  }

  private async ownExport(actor: Actor, id: string) {
    const [row] = await this.ds.query(`SELECT e.*, u.full_name AS requested_by_name FROM report_exports e JOIN users u ON u.id = e.requested_by_user_id WHERE e.id = $1`, [id]);
    if (!row) throw new NotFoundException('Export not found.');
    const holdsAll = actor.role === Role.SUPER_ADMIN || (await this.permissions.actorHolds(actor, Permission.AUDIT_EXPORT));
    if (row.requested_by_user_id !== actor.id && !holdsAll) throw new NotFoundException('Export not found.'); // another admin's export: indistinguishable from absent
    return row;
  }

  async getExport(actor: Actor, id: string) {
    return this.exportView(await this.ownExport(actor, id));
  }

  /** Permission is re-checked AT DOWNLOAD (a revoked admin cannot fetch a file they requested earlier). */
  async prepareDownload(actor: Actor, id: string): Promise<{ file: string; filename: string; contentType: string; reportId: string; checksum: string | null }> {
    const row = await this.ownExport(actor, id);
    const def = this.def(row.report_id);
    const a = await this.access(actor, def);
    if (!a.canExport) throw new ForbiddenException({ message: 'You no longer have permission to download this export.', details: { code: 'EXPORT_NOT_PERMITTED' } });
    if (row.status === 'EXPIRED') throw new BadRequestException({ message: 'This export has expired. Run it again.', details: { code: 'EXPORT_EXPIRED' } });
    if (row.status !== 'SUCCEEDED' || !row.storage_key) throw new ConflictException({ message: 'This export is not ready.', details: { code: 'EXPORT_NOT_READY', status: row.status } });
    if (row.expires_at && new Date(row.expires_at) < new Date()) throw new BadRequestException({ message: 'This export has expired. Run it again.', details: { code: 'EXPORT_EXPIRED' } });
    const file = path.join(this.exportDir, path.basename(row.storage_key));
    try {
      await fs.access(file);
    } catch {
      throw new BadRequestException({ message: 'This export file is no longer available. Run it again.', details: { code: 'EXPORT_EXPIRED' } });
    }
    await this.ds.query(`UPDATE report_exports SET download_count = download_count + 1, last_downloaded_at = now() WHERE id = $1`, [id]);
    const ext = row.format.toLowerCase();
    const contentType = row.format === 'CSV' ? 'text/csv; charset=utf-8' : row.format === 'XLSX' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf';
    const stamp = new Date(row.finished_at ?? row.created_at).toISOString().slice(0, 10);
    return { file, filename: `hatly-${row.report_id}-${stamp}.${ext}`, contentType, reportId: row.report_id, checksum: row.checksum_sha256 };
  }

  async cancelExport(actor: Actor, id: string) {
    const row = await this.ownExport(actor, id);
    if (['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(row.status)) throw new ConflictException({ message: `This export is already ${row.status}.`, details: { code: 'STATE_CONFLICT' } });
    if (row.status === 'QUEUED') {
      await this.ds.query(`UPDATE report_exports SET status = 'CANCELLED', finished_at = now(), updated_at = now() WHERE id = $1 AND status = 'QUEUED'`, [id]);
    } else {
      await this.ds.query(`UPDATE report_exports SET cancel_requested = true, updated_at = now() WHERE id = $1`, [id]);
    }
    return this.getExport(actor, id);
  }

  async expireExport(actor: Actor, id: string) {
    const row = await this.ownExport(actor, id);
    if (row.status === 'RUNNING') throw new ConflictException({ message: 'Cancel the running export first.', details: { code: 'STATE_CONFLICT' } });
    await this.removeFile(row.storage_key);
    await this.ds.query(`UPDATE report_exports SET status = 'EXPIRED', storage_key = NULL, updated_at = now() WHERE id = $1`, [id]);
  }

  private async removeFile(key: string | null): Promise<void> {
    if (!key) return;
    await fs.unlink(path.join(this.exportDir, path.basename(key))).catch(() => undefined);
  }

  // ------------------------------------------------------------- worker

  /** One worker pass: recover stale jobs, claim at most one queued job (FOR UPDATE SKIP LOCKED), run it, purge expired files. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.ds.query(`UPDATE report_exports SET status = CASE WHEN attempts >= 3 THEN 'FAILED' ELSE 'QUEUED' END, error_code = CASE WHEN attempts >= 3 THEN 'WORKER_LOST' ELSE error_code END, finished_at = CASE WHEN attempts >= 3 THEN now() ELSE finished_at END, locked_by = NULL
                            WHERE status = 'RUNNING' AND heartbeat_at < now() - interval '90 seconds'`);
      const claimed = returned(
        await this.ds.query(
          `UPDATE report_exports SET status = 'RUNNING', locked_by = $1, heartbeat_at = now(), started_at = coalesce(started_at, now()), attempts = attempts + 1, updated_at = now()
            WHERE id = (SELECT id FROM report_exports WHERE status = 'QUEUED' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
          [this.workerId],
        ),
      );
      if (claimed[0]) await this.execute(claimed[0]);
      await this.purgeExpired();
    } catch (error) {
      this.logger.error(`export worker pass failed: ${(error as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  private async purgeExpired(): Promise<void> {
    const rows = returned(await this.ds.query(`UPDATE report_exports SET status = 'EXPIRED', updated_at = now() WHERE status = 'SUCCEEDED' AND expires_at < now() RETURNING id, storage_key`));
    for (const r of rows) await this.removeFile(r.storage_key);
  }

  private async execute(row: any): Promise<void> {
    const def = REPORT_BY_ID.get(row.report_id);
    const fail = async (code: string, message: string) => {
      await this.ds.query(`UPDATE report_exports SET status = 'FAILED', error_code = $2, error_message = $3, finished_at = now(), updated_at = now() WHERE id = $1`, [row.id, code, message.slice(0, 300)]);
    };
    if (!def) return fail('UNKNOWN_REPORT', 'The report no longer exists.');
    const [user] = await this.ds.query(`SELECT id, role, full_name, is_active FROM users WHERE id = $1`, [row.requested_by_user_id]);
    if (!user || !user.is_active) return fail('PERMISSION_REVOKED', 'The requesting account is no longer active.');
    const actor: Actor = { id: user.id, role: user.role };
    const access = await this.access(actor, def);
    if (!access.canExport) return fail('PERMISSION_REVOKED', 'The requester no longer has permission to export this report.');

    const ext = String(row.format).toLowerCase();
    const key = `${row.id}.${ext}`;
    const file = path.join(this.exportDir, key);
    await fs.mkdir(this.exportDir, { recursive: true });
    await fs.unlink(file).catch(() => undefined);
    const heartbeat = setInterval(() => void this.ds.query(`UPDATE report_exports SET heartbeat_at = now() WHERE id = $1`, [row.id]).catch(() => undefined), 15_000);
    heartbeat.unref();
    try {
      const { __includeMinor, ...params } = row.params as Record<string, string>;
      const cols = this.visibleColumns(def, access);
      const total = num(row.row_count) || 1;
      const self = this;
      const input: WriterInput = {
        title: row.locale === 'ar' ? def.ar : def.en,
        columns: cols,
        locale: row.locale,
        parameterLines: Object.entries(params).map(([k, v]) => `${row.locale === 'ar' ? def.params.find((p) => p.key === k)?.ar ?? k : def.params.find((p) => p.key === k)?.en ?? k}: ${v}`).concat([`${row.locale === 'ar' ? 'المنطقة الزمنية' : 'Time zone'}: ${REPORTING_TIMEZONE}`]),
        generatedAtCairo: await this.cairoNow(),
        generatedBy: user.full_name ?? user.id,
        includeMinor: Boolean(__includeMinor),
        totals: null,
        isCancelled: async () => {
          const [c] = await this.ds.query(`SELECT cancel_requested FROM report_exports WHERE id = $1`, [row.id]);
          return Boolean(c?.cancel_requested);
        },
        onProgress: async (written) => {
          await this.ds.query(`UPDATE report_exports SET progress = $2, heartbeat_at = now() WHERE id = $1`, [row.id, Math.min(99, Math.floor((written / total) * 100))]);
        },
        batches: async function* () {
          if (!def.build) {
            yield self.applyColumnRules(await self.s01Rows(params, access), def, access);
            return;
          }
          const { sql, values } = def.build(params);
          for (let offset = 0; ; offset += BATCH) {
            const qr = self.ds.createQueryRunner();
            try {
              await qr.connect();
              await qr.query(`SET statement_timeout = ${Number(process.env.REPORT_EXPORT_TIMEOUT_MS ?? 300000)}`);
              const rows = await qr.query(`SELECT * FROM (${sql}) r LIMIT ${BATCH} OFFSET ${offset}`, values);
              if (rows.length === 0) return;
              yield self.applyColumnRules(rows, def, access);
              if (rows.length < BATCH) return;
            } finally {
              await qr.release();
            }
          }
        },
      };
      const totalCols = cols.filter((c) => c.total === 'sum');
      if (def.build && totalCols.length > 0) {
        const { sql, values } = def.build(params);
        const [t] = await this.ds.query(`SELECT ${totalCols.map((c) => `coalesce(sum("${c.key}"), 0)::numeric AS "${c.key}"`).join(', ')} FROM (${sql}) r`, values);
        input.totals = Object.fromEntries(totalCols.map((c) => [c.key, num(t[c.key])]));
      }
      const result = row.format === 'CSV' ? await writeCsv(file, input) : row.format === 'XLSX' ? await writeXlsx(file, input, XLSX_MAX_ROWS) : await writePdf(file, input, PDF_MAX_ROWS);
      const [state] = await this.ds.query(`SELECT cancel_requested FROM report_exports WHERE id = $1`, [row.id]);
      if (state?.cancel_requested) {
        await fs.unlink(file).catch(() => undefined);
        await this.ds.query(`UPDATE report_exports SET status = 'CANCELLED', finished_at = now(), updated_at = now() WHERE id = $1`, [row.id]);
        return;
      }
      await this.ds.query(
        `UPDATE report_exports SET status = 'SUCCEEDED', progress = 100, row_count = $2, file_bytes = $3, storage_key = $4, checksum_sha256 = $5, finished_at = now(), expires_at = now() + ($6 || ' hours')::interval, updated_at = now() WHERE id = $1`,
        [row.id, result.rowCount, result.bytes, key, result.checksum, String(RETENTION_HOURS())],
      );
    } catch (error: any) {
      await fs.unlink(file).catch(() => undefined);
      const code = error?.code === 'EXPORT_TOO_LARGE' ? 'EXPORT_TOO_LARGE' : error?.code === '57014' ? 'REPORT_TIMEOUT' : 'EXPORT_FAILED';
      this.logger.error(`export ${row.id} (${row.report_id}/${row.format}) failed: ${error?.message}`);
      await fail(code, code === 'EXPORT_FAILED' ? 'The export failed. Try again or narrow the filters.' : String(error.message));
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async cairoNow(): Promise<string> {
    const [r] = await this.ds.query(`SELECT to_char(now() AT TIME ZONE '${REPORTING_TIMEZONE}', 'YYYY-MM-DD HH24:MI') AS t`);
    return r.t;
  }
}

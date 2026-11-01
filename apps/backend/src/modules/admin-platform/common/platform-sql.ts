import { BadRequestException } from '@nestjs/common';

/**
 * Shared helpers for the enterprise admin read/reporting endpoints (raw, parameterised SQL — never string-built from user input).
 *
 * TIME ZONE POLICY: a report/filter date is an Africa/Cairo CALENDAR date. `[from, to]` (both inclusive) becomes
 * `[from 00:00 Cairo, to+1 00:00 Cairo)` converted by PostgreSQL itself (`AT TIME ZONE`), so day boundaries and DST are the database's
 * business, never JavaScript's. The zone is `REPORTING_TIMEZONE` (default Africa/Cairo).
 */
export const REPORTING_TIMEZONE = process.env.REPORTING_TIMEZONE?.match(/^[A-Za-z_]+\/[A-Za-z_]+$/) ? process.env.REPORTING_TIMEZONE : 'Africa/Cairo';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertDate(value: string | undefined, name: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new BadRequestException({ message: `${name} must be a calendar date (YYYY-MM-DD).`, details: { code: 'INVALID_DATE' } });
  }
  return value;
}

/** Appends `AND <col> >= from AND <col> < to+1day` (Cairo) to `where`, pushing the parameters. Returns nothing; mutates the arrays. */
export function addCairoRange(where: string[], params: unknown[], column: string, from?: string, to?: string): void {
  const f = assertDate(from, 'from');
  const t = assertDate(to, 'to');
  if (f && t && f > t) throw new BadRequestException({ message: 'from must not be after to.', details: { code: 'INVALID_RANGE' } });
  if (f) {
    params.push(f);
    where.push(`${column} >= (($${params.length}::date)::timestamp AT TIME ZONE '${REPORTING_TIMEZONE}')`);
  }
  if (t) {
    params.push(t);
    where.push(`${column} < ((($${params.length}::date + 1))::timestamp AT TIME ZONE '${REPORTING_TIMEZONE}')`);
  }
}

/** The number of days spanned by an inclusive range (used to cap summary ranges). */
export function rangeDays(from?: string, to?: string): number | null {
  if (!from || !to) return null;
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export function assertMaxRange(from: string | undefined, to: string | undefined, maxDays: number): void {
  const days = rangeDays(from, to);
  if (days !== null && days > maxDays) {
    throw new BadRequestException({ message: `The date range may not exceed ${maxDays} days.`, details: { code: 'RANGE_TOO_LARGE', maxDays } });
  }
}

export interface PageParams {
  page: number;
  limit: number;
  offset: number;
}

/** Offset pagination with a hard ceiling — an enormous `limit` can never turn a list into a table dump. */
export function pageParams(query: { page?: string | number; limit?: string | number }, defaultLimit = 25, maxLimit = 100): PageParams {
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const limit = Math.min(maxLimit, Math.max(1, Math.floor(Number(query.limit) || defaultLimit)));
  return { page, limit, offset: (page - 1) * limit };
}

/** Whitelisted ORDER BY — an unknown sort field is a 400, never interpolated. */
export function orderBy(sort: string | undefined, allowed: Record<string, string>, fallback: string): string {
  if (!sort) return fallback;
  const [field, dir] = sort.split(':');
  const column = allowed[field];
  if (!column) throw new BadRequestException({ message: `Unknown sort field "${field}".`, details: { code: 'UNKNOWN_SORT' } });
  return `${column} ${dir?.toLowerCase() === 'asc' ? 'ASC' : 'DESC'}, 1`;
}

export const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function assertUuid(value: string | undefined, name: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (!UUID_RE.test(value)) throw new BadRequestException({ message: `${name} must be a UUID.`, details: { code: 'INVALID_ID' } });
  return value;
}

/** Escapes LIKE wildcards in a user-typed search term. */
export function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export function num(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

/** Masks a phone number except its last 4 digits (PII masking without VIEW_CUSTOMER_PII). */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\s/g, '');
  return digits.length <= 4 ? '••••' : `${'•'.repeat(Math.min(7, digits.length - 4))}${digits.slice(-4)}`;
}

export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!domain) return '••••';
  return `${local.slice(0, 1)}•••@${domain}`;
}

export function maskName(name: string | null | undefined): string | null {
  if (!name) return null;
  const parts = name.trim().split(/\s+/);
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[1].slice(0, 1)}.`;
}

/**
 * TypeORM's `query()` returns `[rows, affectedCount]` for UPDATE / DELETE ... RETURNING (but plain rows for SELECT / INSERT ... RETURNING).
 * Normalises both shapes to the row array.
 */
export function returned<T = any>(result: any): T[] {
  return Array.isArray(result) && result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number' ? result[0] : result;
}

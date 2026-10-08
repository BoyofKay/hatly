/**
 * Money helpers for the Admin dashboard. The backend speaks integer MINOR units (piastres): every amount is parsed from the
 * admin's text and formatted back with integer/string arithmetic only — never a float multiplication — so `150.10` can never
 * become 15009.999… (the backend rejects anything that is not a positive integer).
 */

/** Whole pounds up to 9 digits keeps the minor-unit value far below Number.MAX_SAFE_INTEGER. */
const EGP_INPUT = /^(\d{1,9})(?:\.(\d{1,2}))?$/;

export type ParsedEgp = { ok: true; minor: number } | { ok: false; reason: 'EMPTY' | 'FORMAT' | 'NOT_POSITIVE' };

/** Western, Arabic-Indic and Persian digits are all accepted, and the Arabic decimal separator (٫) is read as a point. */
function normalizeDigits(raw: string): string {
  return raw
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.');
}

/** "150" → 15000, "150.5" → 15050, "0.07" → 7. A zero amount is NOT_POSITIVE: a confirmed price must be at least one minor unit. */
export function parseEgpToMinor(raw: string): ParsedEgp {
  const text = normalizeDigits(raw);
  if (text === '') return { ok: false, reason: 'EMPTY' };
  const match = EGP_INPUT.exec(text);
  if (!match) return { ok: false, reason: 'FORMAT' };
  const minor = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (minor <= 0) return { ok: false, reason: 'NOT_POSITIVE' };
  return { ok: true, minor };
}

/** 15050 → "150.50" (integer arithmetic; the currency label is added by the caller from the message catalog). */
export function formatMinor(minor: number): string {
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.trunc(abs / 100);
  const fraction = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * Like `parseEgpToMinor`, but a zero amount is VALID — for prices where 0 is a real business choice (e.g. a free-delivery
 * zone). Still integer/string arithmetic only.
 */
export function parseEgpToMinorAllowZero(raw: string): ParsedEgp {
  const parsed = parseEgpToMinor(raw);
  if (!parsed.ok && parsed.reason === 'NOT_POSITIVE') return { ok: true, minor: 0 };
  return parsed;
}

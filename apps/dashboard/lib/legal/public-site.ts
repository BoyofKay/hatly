/**
 * Settings for the PUBLIC legal pages (/privacy, /account-deletion), resolved at BUILD time. The owner-approved values live here, in this
 * one place (the dashboard image build passes no env file — `.env.*` is excluded from its Docker context — so a value outside this module
 * would never reach a real build). Each can be overridden at build time with the same name, e.g. for a later policy revision:
 *   NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL   the privacy/support e-mail address
 *   NEXT_PUBLIC_PRIVACY_EFFECTIVE_DATE  the policy's effective date, YYYY-MM-DD (a real calendar date)
 * Nothing is ever invented: a value that is missing or invalid is `null`, and while either is `null` the pages show a visible DRAFT banner
 * (and `scripts/launch/verify-public-pages.sh` refuses a published page that still shows it). An INVALID override does not fall back to
 * the approved value — it makes the page a draft, so a typo cannot be published silently.
 */

/** Approved by the owner on 2026-10-23. */
export const APPROVED_PRIVACY_CONTACT_EMAIL = 'Amrrizk1111@gmail.com';
/** Approved by the owner on 2026-10-23. */
export const APPROVED_PRIVACY_EFFECTIVE_DATE = '2026-10-23';

/** Marker the publishing check looks for; keep in sync with scripts/launch/verify-public-pages.sh. */
export const DRAFT_MARKER = 'data-legal-draft';

export interface PublicLegalSettings {
  contactEmail: string | null;
  effectiveDate: string | null;
  isDraft: boolean;
}

const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

export function validEmail(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  return v.length <= 254 && EMAIL.test(v) ? v : null;
}

/** YYYY-MM-DD that is a real calendar date (2026-02-30 is refused). */
export function validDate(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? v : null;
}

/**
 * The settings for a given environment. An override that is SET (non-empty) wins and is validated on its own; an unset one uses the
 * approved value. Pure, for tests; the pages use `PUBLIC_LEGAL` below.
 */
export function resolvePublicLegalSettings(
  env: Record<string, string | undefined>,
  approved: { contactEmail: string | null; effectiveDate: string | null } = { contactEmail: APPROVED_PRIVACY_CONTACT_EMAIL, effectiveDate: APPROVED_PRIVACY_EFFECTIVE_DATE },
): PublicLegalSettings {
  const pick = (override: string | undefined, fallback: string | null) => ((override ?? '').trim() !== '' ? override : fallback);
  const contactEmail = validEmail(pick(env.NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL, approved.contactEmail));
  const effectiveDate = validDate(pick(env.NEXT_PUBLIC_PRIVACY_EFFECTIVE_DATE, approved.effectiveDate));
  return { contactEmail, effectiveDate, isDraft: contactEmail === null || effectiveDate === null };
}

// Next.js inlines NEXT_PUBLIC_* only for literal `process.env.NAME` reads, so they are read by name here.
export const PUBLIC_LEGAL: PublicLegalSettings = resolvePublicLegalSettings({
  NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL: process.env.NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL,
  NEXT_PUBLIC_PRIVACY_EFFECTIVE_DATE: process.env.NEXT_PUBLIC_PRIVACY_EFFECTIVE_DATE,
});
export const PRIVACY_CONTACT_EMAIL = PUBLIC_LEGAL.contactEmail;
export const PRIVACY_EFFECTIVE_DATE = PUBLIC_LEGAL.effectiveDate;
export const PUBLIC_PAGES_ARE_DRAFT = PUBLIC_LEGAL.isDraft;

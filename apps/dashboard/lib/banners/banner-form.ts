// Pure helpers for the Home-banner form (no React, no network) so they can be tested with the plain Node test runner.
import type { BannerActionType, CreateHomeBannerInput, UpdateHomeBannerInput } from '../api/admin-home-banners';

export interface BannerFormState {
  title: string;
  titleAr: string;
  actionType: BannerActionType;
  /** One of these is the destination, depending on `actionType` (the product also needs its branch only to be found). */
  productId: string;
  branchId: string;
  sectorId: string;
  sortOrder: string;
  /** `datetime-local` values: `YYYY-MM-DDTHH:mm` in the admin's own time zone, or empty. */
  startsAt: string;
  endsAt: string;
}

export const EMPTY_BANNER_FORM: BannerFormState = {
  title: '',
  titleAr: '',
  actionType: 'NONE',
  productId: '',
  branchId: '',
  sectorId: '',
  sortOrder: '0',
  startsAt: '',
  endsAt: '',
};

export type BannerValidation<T> = { ok: true; body: T } | { ok: false; error: string };

/** The destination id the form currently points at, or '' when none is chosen. */
export function bannerTargetId(f: Pick<BannerFormState, 'actionType' | 'productId' | 'branchId' | 'sectorId'>): string {
  if (f.actionType === 'PRODUCT') return f.productId;
  if (f.actionType === 'VENDOR') return f.branchId;
  if (f.actionType === 'SECTOR') return f.sectorId;
  return '';
}

/** `2026-10-28T14:30` (the admin's local time) → an ISO instant the API stores; '' → null. NaN dates are rejected by the caller. */
export function localInputToIso(local: string): string | null {
  const v = local.trim();
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** An ISO instant → the `datetime-local` value showing the same moment in the admin's time zone. */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function checked(f: BannerFormState): BannerValidation<{ title: string; sortOrder: number; startsAt: string | null; endsAt: string | null; target: string }> {
  const title = f.title.trim();
  if (!title) return { ok: false, error: 'A title is required (it is the banner\'s description for screen readers).' };
  if (title.length > 120 || f.titleAr.trim().length > 120) return { ok: false, error: 'Titles can be at most 120 characters.' };
  const sortText = f.sortOrder.trim() === '' ? '0' : f.sortOrder.trim();
  const sortOrder = Number(sortText);
  if (!/^\d+$/.test(sortText) || !Number.isInteger(sortOrder) || sortOrder > 10000) return { ok: false, error: 'Display order must be a whole number from 0 to 10000.' };
  if (f.startsAt.trim() && localInputToIso(f.startsAt) === null) return { ok: false, error: 'The start time is not a valid date.' };
  if (f.endsAt.trim() && localInputToIso(f.endsAt) === null) return { ok: false, error: 'The end time is not a valid date.' };
  const startsAt = localInputToIso(f.startsAt);
  const endsAt = localInputToIso(f.endsAt);
  if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) return { ok: false, error: 'The end time must be after the start time.' };
  const target = bannerTargetId(f).trim();
  if (f.actionType !== 'NONE' && !target) {
    const what = f.actionType === 'PRODUCT' ? 'product' : f.actionType === 'VENDOR' ? 'vendor branch' : 'sector';
    return { ok: false, error: `Choose the ${what} this banner opens, or set the action to "None".` };
  }
  return { ok: true, body: { title, sortOrder, startsAt, endsAt, target } };
}

/** A new banner (always created as a draft without an image — those come next). Optional values that are empty are simply left out. */
export function buildCreateBody(f: BannerFormState): BannerValidation<CreateHomeBannerInput> {
  const v = checked(f);
  if (!v.ok) return v;
  const { title, sortOrder, startsAt, endsAt, target } = v.body;
  const body: CreateHomeBannerInput = { title, sortOrder, actionType: f.actionType };
  if (f.titleAr.trim()) body.titleAr = f.titleAr.trim();
  if (f.actionType !== 'NONE') body.actionTargetId = target;
  if (startsAt) body.startsAt = startsAt;
  if (endsAt) body.endsAt = endsAt;
  return { ok: true, body };
}

/** An edit: an emptied optional value is sent as `null` so it is really cleared on the server. */
export function buildUpdateBody(f: BannerFormState): BannerValidation<UpdateHomeBannerInput> {
  const v = checked(f);
  if (!v.ok) return v;
  const { title, sortOrder, startsAt, endsAt, target } = v.body;
  return {
    ok: true,
    body: {
      title,
      titleAr: f.titleAr.trim() ? f.titleAr.trim() : null,
      actionType: f.actionType,
      actionTargetId: f.actionType === 'NONE' ? null : target,
      sortOrder,
      startsAt,
      endsAt,
    },
  };
}

/** A chosen file is checked in the browser first (the server checks again, including the real image bytes). */
export function checkImageFile(file: { type: string; size: number }, allowed: string[], maxBytes: number): string | null {
  if (!allowed.includes(file.type)) return 'Only JPEG, PNG or WebP images are allowed.';
  if (file.size > maxBytes) return 'The image is larger than 5 MB.';
  if (file.size === 0) return 'The file is empty.';
  return null;
}

export const BANNER_MIN_WIDTH = 800;
export const BANNER_MIN_HEIGHT = 320;
export const BANNER_MIN_ASPECT = 1.6;
export const BANNER_MAX_ASPECT = 2.6;

/** A banner is a wide image (shown 2 : 1; recommended 1200×600). Mirrors the server's rule so the problem is shown before uploading. */
export function checkBannerShape(width: number, height: number): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 'The size of this image could not be read.';
  if (width < BANNER_MIN_WIDTH || height < BANNER_MIN_HEIGHT) {
    return `The image is ${width}×${height}. A banner must be at least ${BANNER_MIN_WIDTH}×${BANNER_MIN_HEIGHT} pixels (recommended 1200×600).`;
  }
  const aspect = width / height;
  if (aspect < BANNER_MIN_ASPECT || aspect > BANNER_MAX_ASPECT) {
    return `The image is ${width}×${height}. A banner must be wide, about 2:1 (recommended 1200×600).`;
  }
  return null;
}

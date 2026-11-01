// Pure helpers for the "new sector" form (no React, no network) so they can be tested with the plain Node test runner.

/** Same rule as the backend's `CreateSectorDto.slug`: lowercase letters/digits separated by single hyphens or underscores. */
export const SECTOR_SLUG_PATTERN = /^[a-z0-9]+([_-][a-z0-9]+)*$/;

export interface SectorFormState {
  name: string;
  nameAr: string;
  slug: string;
  sortOrder: string;
  /** Show on customers' Home right away? Off by default: a category with no vendors yet is an empty page for customers. */
  active: boolean;
}

export const EMPTY_SECTOR_FORM: SectorFormState = { name: '', nameAr: '', slug: '', sortOrder: '0', active: false };

/** A suggestion only (the admin can edit it): `Fast Food` → `fast-food`. Non-Latin names give '' and the admin types the slug. */
export function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface CreateSectorBody {
  name: string;
  nameAr?: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
}

export function buildCreateSectorBody(f: SectorFormState): { ok: true; body: CreateSectorBody } | { ok: false; error: string } {
  const name = f.name.trim();
  if (!name) return { ok: false, error: 'A name is required.' };
  if (name.length > 100 || f.nameAr.trim().length > 100) return { ok: false, error: 'Names can be at most 100 characters.' };
  const slug = f.slug.trim();
  if (!slug) return { ok: false, error: 'A slug is required (lowercase letters, numbers, hyphens), e.g. "restaurants".' };
  if (slug.length > 100 || !SECTOR_SLUG_PATTERN.test(slug)) return { ok: false, error: 'The slug may only contain lowercase letters, numbers, hyphens or underscores (no spaces).' };
  const sortText = f.sortOrder.trim() === '' ? '0' : f.sortOrder.trim();
  if (!/^\d+$/.test(sortText)) return { ok: false, error: 'Display order must be a whole number ≥ 0.' };
  const body: CreateSectorBody = { name, slug, sortOrder: Number(sortText), isActive: f.active };
  if (f.nameAr.trim()) body.nameAr = f.nameAr.trim();
  return { ok: true, body };
}

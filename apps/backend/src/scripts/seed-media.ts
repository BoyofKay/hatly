import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Marketplace media convention shared by the dev seed (applies delivered asset files) and the manifest
 * generator (lists what files are expected). Pure helpers only — no DB, no network.
 *
 * Keys are derived from NATURAL keys (slug / names), never from generated UUIDs, so an asset pack
 * authored once applies identically to any database seeded from the same definitions.
 *
 * Files live in a media directory as `<key>.<ext>` (webp preferred; png/jpg accepted). Applying them copies
 * the file into the backend's existing uploads directory under `marketplace/` and stores the SAME
 * server-relative form the real upload provider already stores (`/uploads/files/...`) — no new static route,
 * no new column, no new media system.
 */
export const MEDIA_EXTENSIONS = ['.webp', '.png', '.jpg', '.jpeg'] as const;
export const MARKETPLACE_MEDIA_SUBDIR = 'marketplace';
export const MEDIA_URL_PREFIX = '/uploads/files';

/**
 * The committed marketplace asset pack (`docs/assets/pack`, `<key>.<ext>`). The seed applies it by default so a fresh or
 * reset dev/tester database always gets the same images; `SEED_MEDIA_DIR` still overrides it.
 */
export const DEFAULT_MEDIA_DIR = path.resolve(__dirname, '../../../../docs/assets/pack');

/** True for a URL the seed itself stored (`/uploads/files/marketplace/...`) — never true for a real admin upload. */
export function isSeededMediaUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && url.startsWith(`${MEDIA_URL_PREFIX}/${MARKETPLACE_MEDIA_SUBDIR}/`);
}

/**
 * For a server-relative stored URL (`/uploads/files/<file>`): does the file exist in the local uploads directory?
 * Returns null for any other shape (absolute https:// object storage etc.) — not checkable on local disk.
 */
export async function localUploadExists(uploadsDir: string, url: string): Promise<boolean | null> {
  if (!url.startsWith(`${MEDIA_URL_PREFIX}/`)) return null;
  const relative = url.slice(MEDIA_URL_PREFIX.length + 1);
  if (relative.split('/').some((segment) => segment === '..' || segment === '')) return false;
  try {
    const stat = await fs.stat(path.join(uploadsDir, relative));
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** A key is valid only if every path segment is a non-empty ASCII slug (guards against Arabic-only names slugifying to ''). */
export function isValidMediaKey(key: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)+$/.test(key);
}

export const mediaKeys = {
  sector: (sectorSlug: string) => `sectors/${sectorSlug}`,
  subcategory: (sectorSlug: string, subcategoryName: string) => `subcategories/${sectorSlug}/${slugify(subcategoryName)}`,
  vendorLogo: (vendorName: string) => `vendors/${slugify(vendorName)}/logo`,
  // Vendor + product name only: branch names are Arabic-only in the data (no ASCII slug), and the same product sold
  // by two branches of one vendor is legitimately the same picture.
  product: (vendorName: string, productName: string) => `products/${slugify(vendorName)}/${slugify(productName)}`,
  catalogProduct: (productName: string) => `catalog-products/${slugify(productName)}`,
};

/** Returns the existing file for `key` in `mediaDir` (first matching extension), or null. */
export async function findMediaFile(mediaDir: string, key: string): Promise<{ filePath: string; ext: string } | null> {
  for (const ext of MEDIA_EXTENSIONS) {
    const filePath = path.join(mediaDir, `${key}${ext}`);
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile() && stat.size > 0) return { filePath, ext };
    } catch {
      // not present with this extension
    }
  }
  return null;
}

/**
 * Copies the asset for `key` into `<uploadsDir>/marketplace/<key><ext>` and returns the server-relative URL, or
 * null when no file was delivered for that key (the caller then leaves the column null — the Customer app's
 * placeholder handles it; a URL is never fabricated for a missing file).
 */
export async function stageMediaFile(params: { mediaDir: string; uploadsDir: string; key: string }): Promise<string | null> {
  const found = await findMediaFile(params.mediaDir, params.key);
  if (!found) return null;
  const relative = `${MARKETPLACE_MEDIA_SUBDIR}/${params.key}${found.ext}`;
  const destination = path.join(params.uploadsDir, relative);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(found.filePath, destination);
  return `${MEDIA_URL_PREFIX}/${relative}`;
}

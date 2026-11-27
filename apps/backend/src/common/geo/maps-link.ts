/**
 * A location from what an admin pastes (owner request 2026-11-27): "30.417, 31.562", a Google Maps link (…/@30.417,31.562,17z,
 * ?q=30.417,31.562, !3d30.417!4d31.562, ll=…), an Apple Maps link (?ll=… / ?q=…&sll=…) — and SHORT share links (maps.app.goo.gl/…,
 * goo.gl/maps/…), which are opened (redirects followed, nothing else read) because their coordinates are only in the final address.
 * Only Google / Apple map hosts are ever opened (no other URL is fetched by the server).
 */
const PATTERNS = [
  /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
  /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
  /[?&](?:q|ll|sll|query|destination|center|daddr|saddr)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
  /lat=(-?\d+(?:\.\d+)?)[^\d-]+(?:lon|lng)=(-?\d+(?:\.\d+)?)/,
  /^(-?\d+(?:\.\d+)?)\s*[,،\s]\s*(-?\d+(?:\.\d+)?)$/,
];

export function parseLatLng(text: string): { lat: number; lng: number } | null {
  let s = (text ?? '').trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep as is */
  }
  for (const re of PATTERNS) {
    const m = s.match(re);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) return { lat, lng };
    }
  }
  return null;
}

const ALLOWED_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'maps.google.com', 'www.google.com', 'google.com', 'maps.apple.com', 'www.google.com.eg', 'google.com.eg']);

export function isAllowedMapsUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Follows at most 6 redirects of an allowed maps link and reads the location from each address. Two real-world cases (owner UAT
 * 2026-11-27, ML-01): a server in the EU is first sent to Google's consent page — its `continue=` address is the real link; and a shared
 * PLACE often ends on a page whose address has only the place name — its coordinates are then read from the page (the map preview's
 * `center=` value). Only Google / Apple map hosts are ever opened, and at most 1 MB of a page is read.
 */
export async function resolveMapsLink(raw: string, fetchImpl: typeof fetch = fetch): Promise<{ lat: number; lng: number } | null> {
  const direct = parseLatLng(raw);
  if (direct) return direct;
  if (!isAllowedMapsUrl(raw)) return null;
  let url = raw.trim();
  for (let i = 0; i < 6; i++) {
    const res = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(6_000), headers: { 'Accept-Language': 'en', 'User-Agent': 'Mozilla/5.0 (compatible; HatlyLinkReader/1.0)' } });
    const next = res.headers.get('location');
    if (!next) {
      if (res.status !== 200) return null;
      return fromPage(await readCapped(res, 1_000_000));
    }
    let abs = new URL(next, url).toString();
    const consent = consentContinue(abs);
    if (consent) abs = consent;
    const found = parseLatLng(abs);
    if (found) return found;
    if (!isAllowedMapsUrl(abs)) return null; // never leave the map hosts
    url = abs;
  }
  return null;
}

/** consent.google.com/…?continue=<the real address> → the real address (only when it is itself a map link). */
function consentContinue(abs: string): string | null {
  try {
    const u = new URL(abs);
    if (u.hostname.toLowerCase() !== 'consent.google.com') return null;
    const c = u.searchParams.get('continue');
    return c && isAllowedMapsUrl(c) ? c : null;
  } catch {
    return null;
  }
}

const PAGE_PATTERNS = [
  /center=(-?\d{1,2}\.\d+)(?:%2C|,)(-?\d{1,3}\.\d+)/i,
  /\/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+),/,
  /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/,
];

export function fromPage(html: string): { lat: number; lng: number } | null {
  for (const re of PAGE_PATTERNS) {
    const m = html.match(re);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) return { lat, lng };
    }
  }
  return null;
}

async function readCapped(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < max) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }
  await reader.cancel().catch(() => undefined);
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

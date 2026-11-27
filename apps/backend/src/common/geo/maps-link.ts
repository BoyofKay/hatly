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

/** Follows at most 5 redirects of an allowed maps link (HEAD/GET without reading bodies) and reads the location from each address. */
export async function resolveMapsLink(raw: string, fetchImpl: typeof fetch = fetch): Promise<{ lat: number; lng: number } | null> {
  const direct = parseLatLng(raw);
  if (direct) return direct;
  if (!isAllowedMapsUrl(raw)) return null;
  let url = raw.trim();
  for (let i = 0; i < 5; i++) {
    const res = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(5_000) });
    const next = res.headers.get('location');
    if (!next) return null;
    const abs = new URL(next, url).toString();
    const found = parseLatLng(abs);
    if (found) return found;
    if (!isAllowedMapsUrl(abs)) return null; // never leave the map hosts
    url = abs;
  }
  return null;
}

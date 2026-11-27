/**
 * Address search when no Google Maps server key is configured (owner UAT 2026-11-27, ML-03: "the search for your address doesn't work").
 * OpenStreetMap's Nominatim, restricted to Egypt and biased to the box around Hatly's active service areas. Nominatim's usage policy:
 * an identifying User-Agent, at most one request per second, results cached — all done here. Only the typed search text is sent
 * (never who searched). Off unless GEOCODER_FALLBACK=nominatim (the default outside tests).
 */
export interface Box { south: number; west: number; north: number; east: number }

const cache = new Map<string, { at: number; value: { latitude: number; longitude: number } | null }>();
let lastCall = 0;

export function openGeocoderEnabled(): boolean {
  const v = process.env.GEOCODER_FALLBACK ?? (process.env.NODE_ENV === 'test' ? 'none' : 'nominatim');
  return v === 'nominatim';
}

export async function nominatimSearch(query: string, box: Box | null, fetchImpl: typeof fetch = fetch): Promise<{ latitude: number; longitude: number } | null> {
  const q = query.trim().slice(0, 200);
  if (q.length < 3) return null;
  const key = `${q.toLowerCase()}|${box ? [box.south, box.west, box.north, box.east].map((n) => n.toFixed(2)).join(',') : ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.value;
  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'eg');
  url.searchParams.set('accept-language', 'ar,en');
  url.searchParams.set('q', q);
  if (box) url.searchParams.set('viewbox', `${box.west},${box.north},${box.east},${box.south}`);
  const res = await fetchImpl(url.toString(), { headers: { 'User-Agent': 'HatlyDelivery/1.2 (address search)', Accept: 'application/json' }, signal: AbortSignal.timeout(6_000) });
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<{ lat?: string; lon?: string }>;
  const first = Array.isArray(rows) ? rows[0] : undefined;
  const value = first && Number.isFinite(Number(first.lat)) && Number.isFinite(Number(first.lon)) ? { latitude: Number(first.lat), longitude: Number(first.lon) } : null;
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 2000) cache.delete(cache.keys().next().value as string);
  return value;
}

/** The box around circular service areas (centre ± radius), for biasing results to where Hatly works. */
export function boxAround(areas: Array<{ centerLatitude: number; centerLongitude: number; radiusMeters: number }>): Box | null {
  if (areas.length === 0) return null;
  let south = 90, north = -90, west = 180, east = -180;
  for (const a of areas) {
    const dLat = Number(a.radiusMeters) / 111_320;
    const dLng = Number(a.radiusMeters) / (111_320 * Math.cos((Number(a.centerLatitude) * Math.PI) / 180));
    south = Math.min(south, Number(a.centerLatitude) - dLat);
    north = Math.max(north, Number(a.centerLatitude) + dLat);
    west = Math.min(west, Number(a.centerLongitude) - dLng);
    east = Math.max(east, Number(a.centerLongitude) + dLng);
  }
  return { south, west, north, east };
}

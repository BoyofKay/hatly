/**
 * Reads a location from what an admin can paste: "30.417, 31.562", a Google Maps link (…/@30.417,31.562,17z, ?q=30.417,31.562,
 * !3d30.417!4d31.562, ll=…), or an Apple/OSM-style "lat=…&lon=…". Returns null when nothing valid is found. Short links (maps.app.goo.gl)
 * cannot be read without opening them — the admin then copies the coordinates instead.
 */
export function parseLatLng(text: string): { lat: number; lng: number } | null {
  const s = decodeURIComponent((text ?? '').trim());
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|ll|query|destination|center)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /lat=(-?\d+(?:\.\d+)?)[^\d-]+(?:lon|lng)=(-?\d+(?:\.\d+)?)/,
    /^(-?\d+(?:\.\d+)?)\s*[,،\s]\s*(-?\d+(?:\.\d+)?)$/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}

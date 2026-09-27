import { Injectable } from '@nestjs/common';
import { GeoPoint, MapProvider } from '../map-provider.interface';

const EARTH_RADIUS_METERS = 6371000;
// A fixed, documented assumption — NOT a real driving speed for any specific road network.
// Only used to turn a straight-line distance into a plausible, deterministic ETA for
// tests/local development; this number carries no business meaning and is never read
// anywhere else.
const ASSUMED_AVERAGE_SPEED_METERS_PER_SECOND = 6.67; // ≈ 24 km/h

function haversineDistanceMeters(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Deterministic, no-network, no-credential MapProvider — for local development and
 * automated tests ONLY, never production (see `resolveMapProvider` in `location.module.ts`,
 * which refuses to select this class when `NODE_ENV=production`, structurally, at module
 * bootstrap — not merely by convention).
 *
 * Deliberately straight-line (Haversine), not real road/driving distance — this is an
 * approximation for exercising the checkout/delivery-fee flow end to end without a real
 * Google Maps key, NOT a substitute for the `MapProvider` interface's own documented "real
 * ROAD/DRIVING distance" business decision. It never claims otherwise: every distance this
 * class returns is computed locally and reproducibly from the two input points alone, so the
 * same two coordinates always produce the same fee/ETA — useful for deterministic tests,
 * useless (and structurally blocked) for real pricing.
 *
 * `geocode`/`reverseGeocode` honestly return `null` (matches the interface's own "no such
 * place"/"no suggestion" contract) rather than fabricating an address — this class has no
 * way to turn free text into a real place.
 */
@Injectable()
export class DeterministicMapProvider implements MapProvider {
  async geocode(_address: string): Promise<GeoPoint | null> {
    return null;
  }

  async reverseGeocode(_point: GeoPoint): Promise<string | null> {
    return null;
  }

  async distanceAndEta(from: GeoPoint, to: GeoPoint): Promise<{ distanceMeters: number; etaSeconds: number }> {
    const distanceMeters = haversineDistanceMeters(from, to);
    const etaSeconds = Math.round(distanceMeters / ASSUMED_AVERAGE_SPEED_METERS_PER_SECOND);
    return { distanceMeters, etaSeconds };
  }
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface MapProvider {
  /** `false` only when Maps are deliberately disabled (`MAPS_PROVIDER=none`, see `isMapsDisabled`). Absent = available. */
  readonly available?: boolean;
  geocode(address: string): Promise<GeoPoint | null>;
  reverseGeocode(point: GeoPoint): Promise<string | null>;
  /**
   * Real ROAD/DRIVING distance between two points — confirmed business
   * decision, not straight-line/haversine. Every caller (registered-
   * vendor delivery-fee pricing today; any future Hatly Service
   * pricing) relies on this being the distance a driver would actually
   * travel, matching the "actual route distance" language used
   * throughout the approved pricing rules — not an as-the-crow-flies
   * approximation.
   */
  distanceAndEta(from: GeoPoint, to: GeoPoint): Promise<{ distanceMeters: number; etaSeconds: number }>;
}

export const MAP_PROVIDER = Symbol('MAP_PROVIDER');

/**
 * PD-009 G — Maps deliberately DISABLED (`MAPS_PROVIDER=none`). The provider that backs `MAP_PROVIDER` then sets `available = false`
 * and every method throws `MapsUnavailableError`: nothing is ever priced, bounded or ranked on a distance that was not measured.
 * Callers that have a defined Maps-free behaviour ask `isMapsDisabled()` (pricing → the selected Delivery Zone; dispatch ranking →
 * straight-line distance); everything else keeps failing closed exactly as on a provider error. Providers that omit the flag are
 * available (Google, the dev/test deterministic stub, test doubles).
 */
export class MapsUnavailableError extends Error {
  readonly code = 'MAPS_DISABLED';
  constructor(operation: string) {
    super(`Maps are disabled in this deployment (MAPS_PROVIDER=none) — ${operation} is not available.`);
    this.name = 'MapsUnavailableError';
  }
}

export function isMapsDisabled(provider: Pick<MapProvider, 'available'> | null | undefined): boolean {
  return provider?.available === false;
}

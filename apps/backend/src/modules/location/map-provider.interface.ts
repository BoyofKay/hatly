export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface MapProvider {
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

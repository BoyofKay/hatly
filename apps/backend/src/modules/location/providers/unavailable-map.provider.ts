import { Injectable } from '@nestjs/common';
import { GeoPoint, MapProvider, MapsUnavailableError } from '../map-provider.interface';

/**
 * The `MapProvider` behind `MAPS_PROVIDER=none` (PD-009 G — Maps deferred). It never calls anything and never invents a value:
 * every method throws `MapsUnavailableError`, so any caller without a defined Maps-free path fails closed exactly as it would on a
 * provider outage. `available = false` lets the callers that DO have one (zone pricing, straight-line dispatch ranking) choose it
 * up front instead of failing.
 */
@Injectable()
export class UnavailableMapProvider implements MapProvider {
  readonly available = false;

  async geocode(_address: string): Promise<GeoPoint | null> {
    throw new MapsUnavailableError('address search');
  }

  async reverseGeocode(_point: GeoPoint): Promise<string | null> {
    throw new MapsUnavailableError('reverse geocoding');
  }

  async distanceAndEta(_from: GeoPoint, _to: GeoPoint): Promise<{ distanceMeters: number; etaSeconds: number }> {
    throw new MapsUnavailableError('road distance');
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { GeoPoint, MapProvider } from '../map-provider.interface';
import { REDIS_CLIENT } from '../../../common/redis/redis.constants';
import { RequestContextService } from '../../../common/request-context/request-context.service';
import { logBusinessEvent } from '../../../common/logging/log-business-event';
import { BusinessEvent } from '../../../common/logging/business-events';

const CACHE_TTL_SECONDS = 600; // 10 minutes — confirmed business decision
// Rounds to ~1.1m precision at the equator — normalizes trivial GPS/float
// differences so repeated calls against "the same real-world spot" reliably
// hit the cache, without materially changing which spot is meant.
const COORDINATE_CACHE_PRECISION = 5;

function roundForCacheKey(value: number): string {
  return value.toFixed(COORDINATE_CACHE_PRECISION);
}

/**
 * Real Google Maps integration — replaces the Phase 1 throwing stub.
 * Every caller depends only on the MapProvider interface (see its own
 * doc comment on distanceAndEta), never on this class or the Google
 * SDK directly.
 *
 * distanceAndEta() calls Google's Distance Matrix API in `driving`
 * mode — real road distance, per the confirmed business decision, not
 * straight-line. Google's own status codes are surfaced as thrown
 * errors (never silently treated as "no distance" or a fabricated
 * number) — every existing caller (DeliveryFeeCalculationService's
 * wrapMapProviderErrors) already fails closed on any error from this
 * method, so this class's job is just to throw descriptively, not to
 * degrade gracefully itself.
 *
 * CACHING: wraps every call in a Redis cache (10-minute TTL, per the
 * confirmed business decision — not implemented as a business rule
 * that could vary, just an operational cost/latency optimization).
 * Deliberately placed at THIS layer, not in any calling service, so
 * every current and future MapProvider consumer benefits automatically
 * without needing to know caching exists. A→B and B→A are cached
 * separately (real driving distance can differ by direction — one-way
 * streets, etc. — so they are NOT treated as equivalent).
 *
 * geocode()/reverseGeocode() (Geocoding API) back the checkout address picker's ASSISTIVE suggestions only: a suggestion is never
 * the authoritative address — the pin's coordinates are. Results are cached like distances; a provider problem throws
 * descriptively (the caller decides — the picker just shows no suggestion).
 */
@Injectable()
export class GoogleMapsProvider implements MapProvider {
  private readonly logger = new Logger(GoogleMapsProvider.name);
  private readonly apiKey: string | undefined;

  constructor(
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly requestContextService: RequestContextService,
  ) {
    this.apiKey = this.configService.get<string>('maps.googleApiKey');
  }

  private logFailure(level: 'warn' | 'error', reason: string): void {
    logBusinessEvent(this.logger, level, BusinessEvent.EXTERNAL_PROVIDER_FAILED, () => this.requestContextService.getCorrelationId(), {
      provider: 'google_maps',
      operation: 'distance_and_eta',
      reason,
    });
  }

  /** Address text → a point (Egypt only). Null when the provider knows no such place. */
  async geocode(address: string): Promise<GeoPoint | null> {
    const query = address.trim().toLowerCase();
    const cacheKey = `map-geocode:${query}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const body = await this.callGeocoding({ address: address.trim(), components: 'country:EG' });
    const location = body.results?.[0]?.geometry?.location;
    const point = location ? { latitude: location.lat, longitude: location.lng } : null;
    await this.redis.set(cacheKey, JSON.stringify(point), 'EX', CACHE_TTL_SECONDS);
    return point;
  }

  /** A point → the provider's formatted address (Arabic). Null when the provider has none for that spot. */
  async reverseGeocode(point: GeoPoint): Promise<string | null> {
    const cacheKey = `map-reverse:${roundForCacheKey(point.latitude)},${roundForCacheKey(point.longitude)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const body = await this.callGeocoding({ latlng: `${point.latitude},${point.longitude}` });
    const formatted = body.results?.[0]?.formatted_address ?? null;
    await this.redis.set(cacheKey, JSON.stringify(formatted), 'EX', CACHE_TTL_SECONDS);
    return formatted;
  }

  private async callGeocoding(params: Record<string, string>): Promise<{
    status: string;
    results?: Array<{ formatted_address?: string; geometry?: { location?: { lat: number; lng: number } } }>;
  }> {
    if (!this.apiKey) {
      this.logFailure('error', 'not_configured');
      throw new Error('GOOGLE_MAPS_API_KEY is not configured.');
    }
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('language', 'ar');
    url.searchParams.set('region', 'eg');
    url.searchParams.set('key', this.apiKey);

    let response: Response;
    try {
      response = await fetch(url.toString());
    } catch {
      this.logFailure('error', 'unreachable');
      throw new Error('Could not reach the maps provider.');
    }
    if (!response.ok) {
      this.logFailure('error', `http_${response.status}`);
      throw new Error(`Maps provider returned HTTP ${response.status}.`);
    }
    const body = (await response.json()) as { status: string; results?: never[] };
    if (body.status !== 'OK' && body.status !== 'ZERO_RESULTS') {
      this.logFailure('error', `provider_status_${body.status}`);
      throw new Error(`Maps provider error: ${body.status}.`);
    }
    return body as never;
  }

  async distanceAndEta(from: GeoPoint, to: GeoPoint): Promise<{ distanceMeters: number; etaSeconds: number }> {
    const cacheKey = this.buildCacheKey(from, to);

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const result = await this.fetchFromGoogle(from, to);

    await this.redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL_SECONDS);
    return result;
  }

  private buildCacheKey(from: GeoPoint, to: GeoPoint): string {
    return [
      'map-distance',
      `${roundForCacheKey(from.latitude)},${roundForCacheKey(from.longitude)}`,
      `${roundForCacheKey(to.latitude)},${roundForCacheKey(to.longitude)}`,
    ].join(':');
  }

  private async fetchFromGoogle(
    from: GeoPoint,
    to: GeoPoint,
  ): Promise<{ distanceMeters: number; etaSeconds: number }> {
    if (!this.apiKey) {
      this.logFailure('error', 'not_configured');
      throw new Error('GOOGLE_MAPS_API_KEY is not configured.');
    }

    const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
    url.searchParams.set('origins', `${from.latitude},${from.longitude}`);
    url.searchParams.set('destinations', `${to.latitude},${to.longitude}`);
    url.searchParams.set('mode', 'driving');
    url.searchParams.set('key', this.apiKey);

    let response: Response;
    try {
      response = await fetch(url.toString());
    } catch {
      // Never log the raw error object/message here — a network-level
      // fetch failure can in principle include request internals; a
      // safe, fixed category is enough to know "the dependency was
      // unreachable" without risking exposure.
      this.logFailure('error', 'unreachable');
      throw new Error('Could not reach the maps provider.');
    }

    if (!response.ok) {
      this.logFailure('error', `http_${response.status}`);
      throw new Error(`Maps provider returned HTTP ${response.status}.`);
    }

    const body = (await response.json()) as {
      status: string;
      rows?: Array<{ elements?: Array<{ status: string; distance?: { value: number }; duration?: { value: number } }> }>;
    };

    if (body.status !== 'OK') {
      this.logFailure('error', `provider_status_${body.status}`);
      throw new Error(`Maps provider error: ${body.status}.`);
    }

    const element = body.rows?.[0]?.elements?.[0];
    if (!element || element.status !== 'OK' || !element.distance || !element.duration) {
      // Covers ZERO_RESULTS (no route exists between these points) and
      // any other per-element failure — never fabricate a distance.
      // WARN, not ERROR: this can be a legitimate answer from the
      // dependency (no drivable route exists), not necessarily the
      // dependency being broken — see section 10's own WARN/ERROR
      // policy ("degraded dependency behavior" is WARN).
      this.logFailure('warn', `no_route_${element?.status ?? 'unknown'}`);
      throw new Error(`No route found between the given points (${element?.status ?? 'unknown'}).`);
    }

    return {
      distanceMeters: element.distance.value,
      etaSeconds: element.duration.value,
    };
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { GeoPoint, MapProvider } from '../map-provider.interface';
import { REDIS_CLIENT } from '../../../common/redis/redis.constants';
import { RequestContextService } from '../../../common/request-context/request-context.service';
import { logBusinessEvent } from '../../../common/logging/log-business-event';
import { BusinessEvent } from '../../../common/logging/business-events';

const CACHE_TTL_SECONDS = 600; // 10 minutes — confirmed business decision
/**
 * Upper bound on one provider call. `fetch` has no timeout of its own: a hung connection to the provider used to hold the API request
 * (and checkout, which needs the road distance) open indefinitely. Past this the call fails like an unreachable provider — the
 * callers already treat that as "no suggestion" (address picker) or the documented distance fallback (checkout).
 */
export const MAPS_REQUEST_TIMEOUT_MS = 5_000;
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
 * distanceAndEta() calls Google's Routes API (`computeRoutes`, DRIVE, traffic-unaware = the basic price tier) — real road distance.
 * 2026-11-23: moved off the legacy Distance Matrix API, which Google no longer enables for NEW projects (since October 2026); the key
 * travels in the X-Goog-Api-Key header, never in the URL. Before: `distancematrix/json` in `driving`
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

  /**
   * One provider HTTP call, bounded by MAPS_REQUEST_TIMEOUT_MS. Never logs the raw error object/message — a network-level fetch failure
   * can in principle include request internals (the URL carries the API key); a fixed category is enough.
   */
  private async fetchBounded(url: URL, init: RequestInit = {}): Promise<Response> {
    try {
      return await fetch(url.toString(), { ...init, signal: AbortSignal.timeout(MAPS_REQUEST_TIMEOUT_MS) });
    } catch (error) {
      const timedOut = (error as { name?: string })?.name === 'TimeoutError';
      this.logFailure('error', timedOut ? 'timeout' : 'unreachable');
      throw new Error(timedOut ? 'The maps provider did not answer in time.' : 'Could not reach the maps provider.');
    }
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

    const response = await this.fetchBounded(url);
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

    const url = new URL('https://routes.googleapis.com/directions/v2:computeRoutes');
    const response = await this.fetchBounded(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
        // Only the two numbers we use — the field mask also decides the price tier (distance + duration = basic).
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.latitude, longitude: from.longitude } } },
        destination: { location: { latLng: { latitude: to.latitude, longitude: to.longitude } } },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
      }),
    });

    if (!response.ok) {
      // e.g. 403 when the Routes API is not enabled for the key's project or the key is restricted to other APIs/addresses.
      this.logFailure('error', `http_${response.status}`);
      throw new Error(`Maps provider returned HTTP ${response.status}.`);
    }

    const body = (await response.json()) as { routes?: Array<{ distanceMeters?: number; duration?: string }> };
    const route = body.routes?.[0];
    const seconds = typeof route?.duration === 'string' ? Number.parseFloat(route.duration) : Number.NaN;
    if (!route || typeof route.distanceMeters !== 'number' || !Number.isFinite(seconds)) {
      // No drivable route between the points (the API answers `{}`) — never fabricate a distance. WARN, not ERROR: a legitimate
      // answer from the dependency, not the dependency being broken (section 10's WARN/ERROR policy).
      this.logFailure('warn', 'no_route_ZERO_RESULTS');
      throw new Error('No route found between the given points (ZERO_RESULTS).');
    }

    return { distanceMeters: route.distanceMeters, etaSeconds: Math.round(seconds) };
  }
}

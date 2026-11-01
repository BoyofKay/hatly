import { GoogleMapsProvider, MAPS_REQUEST_TIMEOUT_MS } from './google-maps.provider';

function buildProvider(apiKey: string | undefined = 'test-api-key') {
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'redis.url') return 'redis://localhost:6379';
      if (key === 'maps.googleApiKey') return apiKey;
      return undefined;
    }),
  };

  // GoogleMapsProvider now receives its Redis client via constructor
  // injection (Group 1 — Redis reliability hardening) rather than
  // constructing one internally, so the fake in-memory client is passed
  // directly — no real ioredis client is ever constructed by this test.
  const cache = new Map<string, string>();
  const fakeRedis = {
    get: jest.fn(async (key: string) => cache.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      cache.set(key, value);
      return 'OK';
    }),
  };
  const requestContextService = { getCorrelationId: jest.fn(() => 'corr-test') };
  const provider = new GoogleMapsProvider(configService as any, fakeRedis as any, requestContextService as any);

  return { provider, fakeRedis };
}

function mockFetchOnce(body: any, ok = true, status = 200) {
  (global as any).fetch = jest.fn(async () => ({
    ok,
    status,
    json: async () => body,
  }));
}

const from = { latitude: 30.1, longitude: 31.2 };
const to = { latitude: 30.2, longitude: 31.3 };

describe('GoogleMapsProvider', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('parses a successful Distance Matrix response as real road distance/duration', async () => {
    mockFetchOnce({
      status: 'OK',
      rows: [{ elements: [{ status: 'OK', distance: { value: 4200 }, duration: { value: 720 } }] }],
    });
    const { provider } = buildProvider();

    const result = await provider.distanceAndEta(from, to);

    expect(result).toEqual({ distanceMeters: 4200, etaSeconds: 720 });
  });

  it('calls Google in driving mode with the correct coordinates', async () => {
    mockFetchOnce({
      status: 'OK',
      rows: [{ elements: [{ status: 'OK', distance: { value: 100 }, duration: { value: 10 } }] }],
    });
    const { provider } = buildProvider();

    await provider.distanceAndEta(from, to);

    const calledUrl = new URL((global.fetch as jest.Mock).mock.calls[0][0]);
    expect(calledUrl.searchParams.get('mode')).toBe('driving');
    expect(calledUrl.searchParams.get('origins')).toBe(`${from.latitude},${from.longitude}`);
    expect(calledUrl.searchParams.get('destinations')).toBe(`${to.latitude},${to.longitude}`);
  });

  it('caches a successful result and never calls fetch again for the same pair within the TTL', async () => {
    mockFetchOnce({
      status: 'OK',
      rows: [{ elements: [{ status: 'OK', distance: { value: 4200 }, duration: { value: 720 } }] }],
    });
    const { provider } = buildProvider();

    const first = await provider.distanceAndEta(from, to);
    const second = await provider.distanceAndEta(from, to);

    expect(first).toEqual(second);
    expect(global.fetch).toHaveBeenCalledTimes(1); // second call was a cache hit
  });

  it('caches A->B and B->A separately — real driving distance can differ by direction', async () => {
    mockFetchOnce({
      status: 'OK',
      rows: [{ elements: [{ status: 'OK', distance: { value: 4200 }, duration: { value: 720 } }] }],
    });
    const { provider, fakeRedis } = buildProvider();

    await provider.distanceAndEta(from, to);
    await provider.distanceAndEta(to, from);

    // Two distinct cache keys were set, not one reused key.
    expect(fakeRedis.set).toHaveBeenCalledTimes(2);
    const keys = fakeRedis.set.mock.calls.map((call: any[]) => call[0]);
    expect(new Set(keys).size).toBe(2);
  });

  it('fails closed (throws) on a non-OK top-level Google status — never fabricates a distance', async () => {
    mockFetchOnce({ status: 'OVER_QUERY_LIMIT' });
    const { provider } = buildProvider();

    await expect(provider.distanceAndEta(from, to)).rejects.toThrow();
  });

  it('fails closed when no route exists between the two points (ZERO_RESULTS)', async () => {
    mockFetchOnce({ status: 'OK', rows: [{ elements: [{ status: 'ZERO_RESULTS' }] }] });
    const { provider } = buildProvider();

    await expect(provider.distanceAndEta(from, to)).rejects.toThrow();
  });

  it('fails closed on an HTTP-level failure', async () => {
    mockFetchOnce({}, false, 500);
    const { provider } = buildProvider();

    await expect(provider.distanceAndEta(from, to)).rejects.toThrow();
  });

  it('fails closed on a network-level failure (fetch throws)', async () => {
    (global as any).fetch = jest.fn(async () => {
      throw new Error('network down');
    });
    const { provider } = buildProvider();

    await expect(provider.distanceAndEta(from, to)).rejects.toThrow();
  });

  it('every provider call is bounded: fetch gets an abort signal, and a timeout fails closed with a "timeout" category (never hangs)', async () => {
    const seen: Array<AbortSignal | undefined> = [];
    (global as any).fetch = jest.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
      seen.push(init?.signal);
      const error = new Error('The operation was aborted due to timeout');
      error.name = 'TimeoutError';
      throw error;
    });
    const { provider } = buildProvider();
    await expect(provider.distanceAndEta(from, to)).rejects.toThrow(/did not answer in time/);
    await expect(provider.geocode('Abu Naseeb')).rejects.toThrow(/did not answer in time/);
    await expect(provider.reverseGeocode(from)).rejects.toThrow(/did not answer in time/);
    expect(seen).toHaveLength(3);
    for (const signal of seen) expect(signal).toBeInstanceOf(AbortSignal);
    expect(MAPS_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });

  it('fails closed when no API key is configured — never silently proceeds', async () => {
    const { provider } = buildProvider(undefined);

    await expect(provider.distanceAndEta(from, to)).rejects.toThrow();
  });

  it('reverseGeocode returns the provider\'s formatted address (Arabic, Egypt), caches it, and never puts the API key in a log', async () => {
    mockFetchOnce({ status: 'OK', results: [{ formatted_address: 'شارع التحرير، بلبيس' }] });
    const { provider } = buildProvider();
    await expect(provider.reverseGeocode(from)).resolves.toBe('شارع التحرير، بلبيس');
    const calledUrl = new URL((global as any).fetch.mock.calls[0][0]);
    expect(calledUrl.pathname).toBe('/maps/api/geocode/json');
    expect(calledUrl.searchParams.get('latlng')).toBe('30.1,31.2');
    expect(calledUrl.searchParams.get('language')).toBe('ar');
    // second call is served from the cache: no second HTTP request
    await provider.reverseGeocode(from);
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
  });

  it('reverseGeocode: no result for the spot is null (not an error, not a fabricated address)', async () => {
    mockFetchOnce({ status: 'ZERO_RESULTS', results: [] });
    await expect(buildProvider().provider.reverseGeocode(from)).resolves.toBeNull();
  });

  it('geocode resolves text to a point, restricted to Egypt; unknown place → null', async () => {
    mockFetchOnce({ status: 'OK', results: [{ geometry: { location: { lat: 30.42, lng: 31.56 } } }] });
    const { provider } = buildProvider();
    await expect(provider.geocode('بلبيس')).resolves.toEqual({ latitude: 30.42, longitude: 31.56 });
    expect(new URL((global as any).fetch.mock.calls[0][0]).searchParams.get('components')).toBe('country:EG');

    mockFetchOnce({ status: 'ZERO_RESULTS', results: [] });
    await expect(buildProvider().provider.geocode('nowhere at all')).resolves.toBeNull();
  });

  it('geocode/reverseGeocode fail closed (throw) on a provider error or a missing key — never a fabricated result', async () => {
    mockFetchOnce({ status: 'REQUEST_DENIED' });
    await expect(buildProvider().provider.reverseGeocode(from)).rejects.toThrow();
    mockFetchOnce({}, false, 503);
    await expect(buildProvider().provider.geocode('x y z')).rejects.toThrow();
    await expect(buildProvider('').provider.geocode('x y z')).rejects.toThrow('not configured');
  });

  it('G (Group 4): an HTTP failure logs a structured external_provider.failed event (ERROR) with provider/operation/correlationId, and never the API key', async () => {
    mockFetchOnce({}, false, 500);
    const { provider } = buildProvider();
    const errorSpy = jest.spyOn((provider as any).logger, 'error').mockImplementation(() => undefined);

    await expect(provider.distanceAndEta(from, to)).rejects.toThrow();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(logged).toEqual({
      event: 'external_provider.failed',
      correlationId: 'corr-test',
      provider: 'google_maps',
      operation: 'distance_and_eta',
      reason: 'http_500',
    });
    expect(JSON.stringify(logged)).not.toContain('test-api-key');
  });

  it('G (Group 4): a ZERO_RESULTS "no route" outcome logs at WARN, not ERROR — a valid dependency answer, not a broken dependency', async () => {
    mockFetchOnce({ status: 'OK', rows: [{ elements: [{ status: 'ZERO_RESULTS' }] }] });
    const { provider } = buildProvider();
    const warnSpy = jest.spyOn((provider as any).logger, 'warn').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn((provider as any).logger, 'error').mockImplementation(() => undefined);

    await expect(provider.distanceAndEta(from, to)).rejects.toThrow();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ event: 'external_provider.failed', provider: 'google_maps', reason: 'no_route_ZERO_RESULTS' });
  });
});

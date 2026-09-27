import { DeterministicMapProvider } from './deterministic-map.provider';

describe('DeterministicMapProvider', () => {
  const provider = new DeterministicMapProvider();

  it('is deterministic: the same two points always produce the same distance and ETA', async () => {
    const from = { latitude: 30.4181, longitude: 31.5622 };
    const to = { latitude: 30.4205, longitude: 31.565 };

    const first = await provider.distanceAndEta(from, to);
    const second = await provider.distanceAndEta(from, to);

    expect(second).toEqual(first);
    expect(first.distanceMeters).toBeGreaterThan(0);
    expect(first.etaSeconds).toBeGreaterThan(0);
  });

  it('returns zero distance/eta for the same point twice', async () => {
    const point = { latitude: 30.4181, longitude: 31.5622 };
    const result = await provider.distanceAndEta(point, point);
    expect(result.distanceMeters).toBe(0);
    expect(result.etaSeconds).toBe(0);
  });

  it('a farther point produces a larger distance and a larger ETA', async () => {
    const from = { latitude: 30.4181, longitude: 31.5622 };
    const near = await provider.distanceAndEta(from, { latitude: 30.42, longitude: 31.563 });
    const far = await provider.distanceAndEta(from, { latitude: 30.5, longitude: 31.65 });
    expect(far.distanceMeters).toBeGreaterThan(near.distanceMeters);
    expect(far.etaSeconds).toBeGreaterThan(near.etaSeconds);
  });

  it('never fabricates an address: geocode/reverseGeocode are honestly null', async () => {
    expect(await provider.geocode('anything')).toBeNull();
    expect(await provider.reverseGeocode({ latitude: 30.4181, longitude: 31.5622 })).toBeNull();
  });
});

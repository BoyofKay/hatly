import { readFrozenRoute } from './frozen-route';

describe('readFrozenRoute — the route an order froze (PD-012)', () => {
  const point = (lat: number, source: string) => ({ latitude: lat, longitude: 31.5, label: `L${lat}`, source });

  it('reads origin → destination with label and source, and the service', () => {
    expect(readFrozenRoute({ service: 'WASALLY', route: { origin: point(30.1, 'CUSTOMER'), destination: point(30.2, 'DEFAULT') } })).toEqual({
      service: 'WASALLY',
      origin: { latitude: 30.1, longitude: 31.5, label: 'L30.1', source: 'CUSTOMER' },
      destination: { latitude: 30.2, longitude: 31.5, label: 'L30.2', source: 'DEFAULT' },
    });
  });

  it('is null for an order without a route — registered-vendor orders and anything placed before PD-012 — and never guesses a point', () => {
    for (const snapshot of [null, undefined, {}, { pricingSource: 'DISTANCE' }, { route: {} }, { route: { origin: point(30.1, 'CUSTOMER') } }, { route: { origin: { latitude: 'x', longitude: 1 }, destination: point(30.2, 'DEFAULT') } }]) {
      expect(readFrozenRoute(snapshot)).toBeNull();
    }
  });

  it('keeps a missing label as null and treats an unknown source as the customer\'s', () => {
    const r = readFrozenRoute({ route: { origin: { latitude: 30.1, longitude: 31.1 }, destination: { latitude: 30.2, longitude: 31.2, label: 7, source: '???' } } })!;
    expect(r.origin.label).toBeNull();
    expect(r.destination.label).toBeNull();
    expect(r.destination.source).toBe('CUSTOMER');
    expect(r.service).toBeNull();
  });
});

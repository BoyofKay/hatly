import { GeoController } from './geo.controller';

const build = (provider: Partial<{ geocode: any; reverseGeocode: any }>) => new GeoController({ geocode: jest.fn(), reverseGeocode: jest.fn(), ...provider } as any);

describe('GeoController — assistive suggestions that never block checkout', () => {
  it('reverse returns the provider suggestion', async () => {
    const c = build({ reverseGeocode: jest.fn(async () => 'شارع التحرير') });
    await expect(c.reverse({ latitude: 30, longitude: 31 })).resolves.toEqual({ data: { formattedAddress: 'شارع التحرير' } });
  });

  it('reverse: a provider failure is "no suggestion" (null), never an error — the customer can still type the address', async () => {
    const c = build({ reverseGeocode: jest.fn(async () => { throw new Error('maps down: secret detail'); }) });
    await expect(c.reverse({ latitude: 30, longitude: 31 })).resolves.toEqual({ data: { formattedAddress: null } });
  });

  it('search returns a point, or null for an unknown place or a provider failure', async () => {
    await expect(build({ geocode: jest.fn(async () => ({ latitude: 30.4, longitude: 31.5 })) }).search({ q: 'بلبيس' })).resolves.toEqual({ data: { latitude: 30.4, longitude: 31.5 } });
    await expect(build({ geocode: jest.fn(async () => null) }).search({ q: 'nowhere' })).resolves.toEqual({ data: null });
    await expect(build({ geocode: jest.fn(async () => { throw new Error('x'); }) }).search({ q: 'anything' })).resolves.toEqual({ data: null });
  });
});

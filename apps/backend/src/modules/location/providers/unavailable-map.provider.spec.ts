import { UnavailableMapProvider } from './unavailable-map.provider';
import { MapsUnavailableError, isMapsDisabled } from '../map-provider.interface';

describe('UnavailableMapProvider (MAPS_PROVIDER=none)', () => {
  const provider = new UnavailableMapProvider();
  const point = { latitude: 30.4, longitude: 31.5 };

  it('is flagged unavailable; providers without the flag are available', () => {
    expect(provider.available).toBe(false);
    expect(isMapsDisabled(provider)).toBe(true);
    expect(isMapsDisabled({} as any)).toBe(false);
    expect(isMapsDisabled({ available: true } as any)).toBe(false);
    expect(isMapsDisabled(undefined)).toBe(false);
  });

  it('never invents a value: every method throws MapsUnavailableError (code MAPS_DISABLED)', async () => {
    await expect(provider.geocode('Belbeis')).rejects.toBeInstanceOf(MapsUnavailableError);
    await expect(provider.reverseGeocode(point)).rejects.toBeInstanceOf(MapsUnavailableError);
    await expect(provider.distanceAndEta(point, point)).rejects.toMatchObject({ code: 'MAPS_DISABLED' });
  });
});

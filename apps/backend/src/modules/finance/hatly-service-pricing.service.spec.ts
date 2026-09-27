import { HatlyServicePricingService } from './hatly-service-pricing.service';
import { AdHocServiceType } from '../cart/ad-hoc-service-type.enum';

function buildHarness(opts: { multiplier?: number | null; distanceMeters?: number }) {
  const mapProvider = {
    distanceAndEta: jest.fn(async () => ({ distanceMeters: opts.distanceMeters ?? 1000, etaSeconds: 0 })),
  };
  const businessConfigService = {
    getHatlyServiceDistanceMultiplier: jest.fn(async () => {
      if (opts.multiplier == null) throw new Error('not configured');
      return opts.multiplier;
    }),
  };
  const service = new HatlyServicePricingService(mapProvider as any, businessConfigService as any);
  return { service, mapProvider };
}

describe('HatlyServicePricingService', () => {
  it('BUY_FROM_PLACE: computes distance FROM the resolved pickup point TO the customer', async () => {
    const { service, mapProvider } = buildHarness({ multiplier: 5, distanceMeters: 2000 });

    const charge = await service.calculateCharge({
      serviceType: AdHocServiceType.BUY_FROM_PLACE,
      resolvedPickup: { latitude: 1, longitude: 1 },
      customerLocation: { latitude: 2, longitude: 2 },
    });

    expect(mapProvider.distanceAndEta).toHaveBeenCalledWith(
      { latitude: 1, longitude: 1 },
      { latitude: 2, longitude: 2 },
    );
    expect(charge.chargeMinor).toBe(10000); // 2000m * 5
    expect(charge.distanceMeters).toBe(2000);
    expect(charge.multiplierUsed).toBe(5);
  });

  it('DELIVER_TO_PLACE: computes distance FROM the customer TO the resolved destination', async () => {
    const { service, mapProvider } = buildHarness({ multiplier: 3, distanceMeters: 1500 });

    const charge = await service.calculateCharge({
      serviceType: AdHocServiceType.DELIVER_TO_PLACE,
      resolvedDestination: { latitude: 9, longitude: 9 },
      customerLocation: { latitude: 3, longitude: 3 },
    });

    expect(mapProvider.distanceAndEta).toHaveBeenCalledWith(
      { latitude: 3, longitude: 3 },
      { latitude: 9, longitude: 9 },
    );
    expect(charge.chargeMinor).toBe(4500); // 1500 * 3
  });

  it('FAILS CLOSED: throws when no multiplier is configured — never fabricates one', async () => {
    const { service } = buildHarness({ multiplier: null });

    await expect(
      service.calculateCharge({
        serviceType: AdHocServiceType.BUY_FROM_PLACE,
        resolvedPickup: { latitude: 1, longitude: 1 },
        customerLocation: { latitude: 2, longitude: 2 },
      }),
    ).rejects.toThrow();
  });

  it('rounds to the nearest whole minor currency unit — never a fractional amount', async () => {
    const { service } = buildHarness({ multiplier: 1.5, distanceMeters: 333 });

    const charge = await service.calculateCharge({
      serviceType: AdHocServiceType.BUY_FROM_PLACE,
      resolvedPickup: { latitude: 1, longitude: 1 },
      customerLocation: { latitude: 2, longitude: 2 },
    });

    expect(Number.isInteger(charge.chargeMinor)).toBe(true);
    expect(charge.chargeMinor).toBe(Math.round(333 * 1.5));
  });

  it('REGRESSION: uses only the injected MapProvider dependency — no second distance engine', async () => {
    const { service, mapProvider } = buildHarness({ multiplier: 1 });
    await service.calculateCharge({
      serviceType: AdHocServiceType.BUY_FROM_PLACE,
      resolvedPickup: { latitude: 1, longitude: 1 },
      customerLocation: { latitude: 2, longitude: 2 },
    });
    expect(mapProvider.distanceAndEta).toHaveBeenCalledTimes(1);
  });
});

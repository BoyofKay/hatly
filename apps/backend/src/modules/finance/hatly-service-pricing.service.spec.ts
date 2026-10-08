import { HatlyServicePricingService } from './hatly-service-pricing.service';
import { AdHocServiceType } from '../cart/ad-hoc-service-type.enum';

/**
 * PD-009 (amended): Hatly Service delivery fee = the ACTIVE Delivery Zone fee × HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER.
 * The service has no map-provider / distance dependency at all — structurally, coordinates cannot influence the price.
 */
function buildHarness(multiplier: number | null = 1.5) {
  const businessConfigService = {
    getHatlyServiceDeliveryFeeMultiplier: jest.fn(async () => {
      if (multiplier == null) throw new Error('not configured');
      return multiplier;
    }),
  };
  return { service: new HatlyServicePricingService(businessConfigService as any), businessConfigService };
}

const place = { latitude: 30.415, longitude: 31.565 };
const zone = (deliveryFeeMinor: number) => ({ id: 'zone-1', deliveryFeeMinor });
const code = (e: any) => e?.response?.details?.code;

describe('HatlyServicePricingService — zone fee × multiplier (PD-009 amended)', () => {
  it.each([
    [1500, 1.5, 2250], // 15.00 × 1.5 = 22.50
    [2500, 1.5, 3750], // 25.00 × 1.5 = 37.50
    [1500, 2, 3000],
    [0, 1.5, 0], // a free-delivery zone stays free
  ])('zone fee %p × multiplier %p = %p minor units, every input frozen', async (fee, multiplier, expected) => {
    const { service } = buildHarness(multiplier);
    await expect(service.calculateCharge({ serviceType: AdHocServiceType.BUY_FROM_PLACE, resolvedPickup: place, deliveryZone: zone(fee) })).resolves.toEqual({
      chargeMinor: expected,
      pricingSource: 'DELIVERY_ZONE',
      deliveryZoneId: 'zone-1',
      zoneDeliveryFeeMinorUsed: fee,
      multiplierUsed: multiplier,
    });
  });

  it('both service types price identically from the zone (the route never matters)', async () => {
    const { service } = buildHarness(1.5);
    const buy = await service.calculateCharge({ serviceType: AdHocServiceType.BUY_FROM_PLACE, resolvedPickup: place, deliveryZone: zone(1500) });
    const deliver = await service.calculateCharge({ serviceType: AdHocServiceType.DELIVER_TO_PLACE, resolvedDestination: place, deliveryZone: zone(1500) });
    expect(buy.chargeMinor).toBe(deliver.chargeMinor);
  });

  it('a pin cannot influence the price: the API does not even accept a customer location', async () => {
    const { service } = buildHarness(1.5);
    // Defence in depth: an extra field smuggled in at runtime is simply ignored.
    const charge = await service.calculateCharge({ serviceType: AdHocServiceType.BUY_FROM_PLACE, resolvedPickup: place, deliveryZone: zone(1500), customerLocation: { latitude: 1, longitude: 1 } } as any);
    expect(charge.chargeMinor).toBe(2250);
  });

  it('the CURRENT multiplier is read for every new charge', async () => {
    const h = buildHarness(1.5);
    const first = await h.service.calculateCharge({ serviceType: AdHocServiceType.BUY_FROM_PLACE, resolvedPickup: place, deliveryZone: zone(1500) });
    h.businessConfigService.getHatlyServiceDeliveryFeeMultiplier.mockResolvedValueOnce(2);
    const second = await h.service.calculateCharge({ serviceType: AdHocServiceType.BUY_FROM_PLACE, resolvedPickup: place, deliveryZone: zone(1500) });
    expect([first.chargeMinor, second.chargeMinor, second.multiplierUsed]).toEqual([2250, 3000, 2]);
  });

  it('rounds to a whole minor unit (half up) — never a fractional amount', async () => {
    const charge = await buildHarness(1.25).service.calculateCharge({ serviceType: AdHocServiceType.BUY_FROM_PLACE, resolvedPickup: place, deliveryZone: zone(1001) });
    expect(charge.chargeMinor).toBe(1251); // 1251.25
  });

  it('no zone (or a malformed zone fee) → ADDRESS_ZONE_REQUIRED; there is NO fallback to distance pricing', async () => {
    const { service, businessConfigService } = buildHarness(1.5);
    for (const deliveryZone of [null, undefined, { id: 'z', deliveryFeeMinor: 12.5 }, { id: 'z', deliveryFeeMinor: -1 }]) {
      const error = await service.calculateCharge({ serviceType: AdHocServiceType.BUY_FROM_PLACE, resolvedPickup: place, deliveryZone }).catch((e) => e);
      expect(code(error)).toBe('ADDRESS_ZONE_REQUIRED');
    }
    expect(businessConfigService.getHatlyServiceDeliveryFeeMultiplier).not.toHaveBeenCalled();
  });

  it('FAILS CLOSED when the multiplier is not configured — never fabricates one', async () => {
    await expect(buildHarness(null).service.calculateCharge({ serviceType: AdHocServiceType.BUY_FROM_PLACE, resolvedPickup: place, deliveryZone: zone(1500) })).rejects.toThrow();
  });

  it("the customer's own place is still required by type (never a Hatly default)", async () => {
    const { service } = buildHarness(1.5);
    expect(code(await service.calculateCharge({ serviceType: AdHocServiceType.BUY_FROM_PLACE, resolvedPickup: null, deliveryZone: zone(1500) }).catch((e) => e))).toBe('BUY_FROM_PLACE_PICKUP_REQUIRED');
    expect(code(await service.calculateCharge({ serviceType: AdHocServiceType.DELIVER_TO_PLACE, resolvedDestination: undefined, deliveryZone: zone(1500) }).catch((e) => e))).toBe('DELIVER_TO_PLACE_DESTINATION_REQUIRED');
  });
});

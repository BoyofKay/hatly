import { HatlyServicePricingService, RouteEndpoint } from './hatly-service-pricing.service';
import { AdHocServiceType } from '../cart/ad-hoc-service-type.enum';
import { AddressMode } from '../addresses/address-mode';

/**
 * Hatly / Wasally delivery fee = base fee × HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER, where the base fee follows the customer's address
 * method: MANUAL (and legacy) = the active zone's fixed fee (PD-009); GPS = the road-distance base fee of the route ORIGIN → DESTINATION
 * (shared with registered vendors). The route endpoints are resolved by the planner (PD-012) and passed in.
 */
function buildHarness(multiplier: number | null = 1.5) {
  const businessConfigService = {
    getHatlyServiceDeliveryFeeMultiplier: jest.fn(async () => {
      if (multiplier == null) throw new Error('not configured');
      return multiplier;
    }),
  };
  const routeBase = {
    rawDistanceMeters: 1840,
    roundedDistanceMeters: 1800,
    pricePer100mMinorUsed: 100,
    minimumDeliveryFeeMinorUsed: 1500,
    baseFeeMinor: 2000,
  };
  const deliveryFee = {
    calculateRouteBaseFee: jest.fn(async () => {
      if (distanceError) throw distanceError;
      return routeBase;
    }),
  };
  let distanceError: any = null;
  const setDistanceError = (e: any) => (distanceError = e);
  return { service: new HatlyServicePricingService(businessConfigService as any, deliveryFee as any), businessConfigService, deliveryFee, routeBase, setDistanceError };
}

const originEnd: RouteEndpoint = { latitude: 30.415, longitude: 31.565, label: 'Start', source: 'CUSTOMER' };
const destinationEnd: RouteEndpoint = { latitude: 30.43, longitude: 31.58, label: 'Hatly default destination', source: 'DEFAULT' };
const route = { origin: originEnd, destination: destinationEnd };
const zone = (deliveryFeeMinor: number) => ({ id: 'zone-1', deliveryFeeMinor });
const code = (e: any) => e?.response?.details?.code;
const buy = (extra: object = {}) => ({ serviceType: AdHocServiceType.BUY_FROM_PLACE, ...route, deliveryZone: zone(1500), ...extra });
const deliver = (extra: object = {}) => ({ serviceType: AdHocServiceType.DELIVER_TO_PLACE, ...route, deliveryZone: zone(1500), ...extra });

describe('HatlyServicePricingService — zone fee × multiplier (PD-009 amended)', () => {
  it.each([
    [1500, 1.5, 2250], // 15.00 × 1.5 = 22.50
    [2500, 1.5, 3750], // 25.00 × 1.5 = 37.50
    [1500, 2, 3000],
    [0, 1.5, 0], // a free-delivery zone stays free
  ])('zone fee %p × multiplier %p = %p minor units, every input frozen', async (fee, multiplier, expected) => {
    const { service } = buildHarness(multiplier);
    await expect(service.calculateCharge(buy({ deliveryZone: zone(fee) }))).resolves.toEqual({
      chargeMinor: expected,
      baseFeeMinor: fee,
      addressMode: null,
      pricingSource: 'DELIVERY_ZONE',
      service: 'HATLY',
      route,
      deliveryZoneId: 'zone-1',
      zoneDeliveryFeeMinorUsed: fee,
      multiplierUsed: multiplier,
    });
  });

  it('both services price identically from the zone (the route never changes a manual fee)', async () => {
    const { service } = buildHarness(1.5);
    const hatly = await service.calculateCharge(buy());
    const wasally = await service.calculateCharge(deliver());
    expect(hatly.chargeMinor).toBe(wasally.chargeMinor);
    expect(hatly.service).toBe('HATLY');
    expect(wasally.service).toBe('WASALLY');
  });

  it('uses the multiplier current at the time (never a frozen constant)', async () => {
    const h = buildHarness(1.5);
    const first = await h.service.calculateCharge(buy());
    h.businessConfigService.getHatlyServiceDeliveryFeeMultiplier.mockResolvedValue(2);
    const second = await h.service.calculateCharge(buy());
    expect([first.chargeMinor, second.chargeMinor]).toEqual([2250, 3000]);
  });

  it('rounds a fractional multiplier result to an integer piastre', async () => {
    const charge = await buildHarness(1.25).service.calculateCharge(buy({ deliveryZone: zone(1501) }));
    expect(charge.chargeMinor).toBe(1876); // 1876.25 → 1876
    expect(Number.isInteger(charge.chargeMinor)).toBe(true);
  });

  it('refuses an unusable zone fee instead of inventing one', async () => {
    const { service } = buildHarness();
    for (const bad of [null, undefined, zone(-1), zone(10.5)]) {
      const error = await service.calculateCharge(buy({ deliveryZone: bad })).catch((e) => e);
      expect(code(error)).toBe('ADDRESS_ZONE_REQUIRED');
    }
  });

  it('fails closed when the multiplier is not configured', async () => {
    await expect(buildHarness(null).service.calculateCharge(buy())).rejects.toBeDefined();
  });

  it('requires BOTH route endpoints, each with its own code', async () => {
    const { service } = buildHarness();
    expect(code(await service.calculateCharge(buy({ origin: null })).catch((e) => e))).toBe('BUY_FROM_PLACE_PICKUP_REQUIRED');
    expect(code(await service.calculateCharge(deliver({ origin: null })).catch((e) => e))).toBe('DELIVER_TO_PLACE_ORIGIN_REQUIRED');
    expect(code(await service.calculateCharge(buy({ destination: null })).catch((e) => e))).toBe('SERVICE_DESTINATION_REQUIRED');
    expect(code(await service.calculateCharge(deliver({ destination: { ...destinationEnd, latitude: Number.NaN } })).catch((e) => e))).toBe(
      'SERVICE_DESTINATION_REQUIRED',
    );
  });
});

describe('HatlyServicePricingService — GPS method: road distance of the ORIGIN → DESTINATION route × multiplier', () => {
  it('prices the route origin → destination exactly as resolved, multiplier applied once to the base fee', async () => {
    const h = buildHarness(1.5);
    const charge = await h.service.calculateCharge(buy({ addressMode: AddressMode.GPS, deliveryZone: null }));
    expect(h.deliveryFee.calculateRouteBaseFee).toHaveBeenCalledWith(originEnd, destinationEnd);
    expect(charge).toEqual({
      chargeMinor: 3000, // 20.00 base × 1.5
      baseFeeMinor: 2000,
      multiplierUsed: 1.5,
      pricingSource: 'DISTANCE',
      addressMode: AddressMode.GPS,
      service: 'HATLY',
      route,
      rawDistanceMeters: 1840,
      roundedDistanceMeters: 1800,
      pricePer100mMinorUsed: 100,
      minimumDeliveryFeeMinorUsed: 1500,
      routeOrigin: { latitude: originEnd.latitude, longitude: originEnd.longitude },
      routeDestination: { latitude: destinationEnd.latitude, longitude: destinationEnd.longitude },
    });
  });

  it('Wasally measures customer-chosen origin → destination in that direction with the same base and multiplier', async () => {
    const h = buildHarness(1.5);
    const wasally = await h.service.calculateCharge(deliver({ addressMode: AddressMode.GPS, deliveryZone: null }));
    expect(h.deliveryFee.calculateRouteBaseFee).toHaveBeenCalledWith(originEnd, destinationEnd);
    expect(wasally.service).toBe('WASALLY');
    expect(wasally.chargeMinor).toBe(3000);
  });

  it('never multiplies the per-100 m rate (the rate used is recorded unmultiplied)', async () => {
    const h = buildHarness(3);
    const charge = await h.service.calculateCharge(buy({ addressMode: AddressMode.GPS, deliveryZone: null }));
    expect(charge.pricePer100mMinorUsed).toBe(100);
    expect(charge.chargeMinor).toBe(6000);
  });

  it('never falls back to a zone fee when road-distance pricing is unavailable', async () => {
    const h = buildHarness();
    const unavailable = Object.assign(new Error('unavailable'), { response: { details: { code: 'DISTANCE_PRICING_UNAVAILABLE' } } });
    h.setDistanceError(unavailable);
    const error = await h.service.calculateCharge(buy({ addressMode: AddressMode.GPS, deliveryZone: zone(1500) })).catch((e) => e);
    expect(code(error)).toBe('DISTANCE_PRICING_UNAVAILABLE');
  });

  it('a MANUAL address ignores the road distance entirely (zone fee × multiplier)', async () => {
    const h = buildHarness();
    const charge = await h.service.calculateCharge(buy({ addressMode: AddressMode.MANUAL }));
    expect(h.deliveryFee.calculateRouteBaseFee).not.toHaveBeenCalled();
    expect(charge.pricingSource).toBe('DELIVERY_ZONE');
    expect(charge.chargeMinor).toBe(2250);
    expect(charge.route).toEqual(route);
  });
});

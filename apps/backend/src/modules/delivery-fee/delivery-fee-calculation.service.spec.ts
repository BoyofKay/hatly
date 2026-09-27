import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import { composeDeliveryFee, DeliveryFeeCalculationService } from './delivery-fee-calculation.service';

/**
 * Keys by the actual latitude/longitude values, not by object
 * identity — the real service always reconstructs plain
 * `{ latitude, longitude }` objects before calling MapProvider (see
 * DeliveryFeeCalculationService.calculate()'s leg-distance calls), so
 * any test metadata attached to an input object would be silently
 * dropped. Matching on coordinates is what the real call sites
 * actually preserve.
 */
function buildMapProvider(distances: Record<string, number>) {
  return {
    distanceAndEta: jest.fn(async (from: any, to: any) => {
      const key = `${from.latitude},${from.longitude}->${to.latitude},${to.longitude}`;
      if (!(key in distances)) {
        throw new Error(`no fixture distance for ${key}`);
      }
      return { distanceMeters: distances[key], etaSeconds: 0 };
    }),
  };
}

function point(lat: number, lng: number) {
  return { latitude: lat, longitude: lng };
}

function buildBusinessConfigService(values: Partial<Record<string, number>>) {
  return {
    getRequired: jest.fn(async (key: string) => {
      if (!(key in values)) {
        throw new NotFoundException({ details: { code: 'BUSINESS_CONFIG_NOT_SET' } });
      }
      return values[key];
    }),
  };
}

const customer = point(0, 0);

describe('DeliveryFeeCalculationService', () => {
  it('single vendor: no additional-vendor fee, one leg (vendor->customer)', async () => {
    const branchA = { id: 'a', latitude: 1, longitude: 1 };
    const mapProvider = buildMapProvider({ '1,1->0,0': 840 });
    const businessConfig = buildBusinessConfigService({
      REGISTERED_VENDOR_PRICE_PER_100M_MINOR: 100,
      REGISTERED_VENDOR_MINIMUM_DELIVERY_FEE_MINOR: 500,
      REGISTERED_VENDOR_ADDITIONAL_VENDOR_FEE_MINOR: 300,
    });
    const service = new DeliveryFeeCalculationService(mapProvider as any, businessConfig as any);

    const result = await service.calculate([branchA], customer);

    expect(result.roundedTotalDistanceMeters).toBe(900); // 840 -> rounds up (remainder 40 > 20)
    expect(result.additionalVendorChargeMinor).toBe(0); // single vendor: (1-1)=0
    expect(result.deliveryFeeMinor).toBe(900); // 9 * 100 = 900, above the 500 minimum
  });

  it('multi-vendor: sums legs in farthest-to-nearest order and applies the additional-vendor fee per extra vendor', async () => {
    // A is farthest (700m), B is nearer (300m) — pricing route must be A -> B -> Customer.
    const branchA = { id: 'a', latitude: 1, longitude: 1 };
    const branchB = { id: 'b', latitude: 2, longitude: 2 };
    const mapProvider = buildMapProvider({
      '1,1->0,0': 700,
      '2,2->0,0': 300,
      '1,1->2,2': 400,
    });
    const businessConfig = buildBusinessConfigService({
      REGISTERED_VENDOR_PRICE_PER_100M_MINOR: 100,
      REGISTERED_VENDOR_MINIMUM_DELIVERY_FEE_MINOR: 0,
      REGISTERED_VENDOR_ADDITIONAL_VENDOR_FEE_MINOR: 300,
    });
    const service = new DeliveryFeeCalculationService(mapProvider as any, businessConfig as any);

    const result = await service.calculate([branchA, branchB], customer);

    expect(result.vendorSequence.map((s) => s.vendorBranchId)).toEqual(['a', 'b']); // farthest first
    expect(result.legDistancesMeters).toEqual([400, 300]); // a->b, then b->customer
    expect(result.rawTotalDistanceMeters).toBe(700);
    expect(result.roundedTotalDistanceMeters).toBe(700); // remainder 0
    expect(result.additionalVendorChargeMinor).toBe(300); // (2-1) * 300
    expect(result.deliveryFeeMinor).toBe(700 + 300); // distance fee + one additional-vendor charge
  });

  it('applies the configured minimum fee when the distance-based fee is lower', async () => {
    const branchA = { id: 'a', latitude: 1, longitude: 1 };
    const mapProvider = buildMapProvider({ '1,1->0,0': 100 });
    const businessConfig = buildBusinessConfigService({
      REGISTERED_VENDOR_PRICE_PER_100M_MINOR: 50, // distance fee would be 1*50=50
      REGISTERED_VENDOR_MINIMUM_DELIVERY_FEE_MINOR: 500, // minimum wins
      REGISTERED_VENDOR_ADDITIONAL_VENDOR_FEE_MINOR: 0,
    });
    const service = new DeliveryFeeCalculationService(mapProvider as any, businessConfig as any);

    const result = await service.calculate([branchA], customer);
    expect(result.deliveryFeeMinor).toBe(500);
  });

  it('fails closed (never fabricates a fee) when MapProvider throws', async () => {
    const branchA = { id: 'a', latitude: 1, longitude: 1 };
    const mapProvider = {
      distanceAndEta: jest.fn(async () => {
        throw new Error('stub not implemented');
      }),
    };
    const businessConfig = buildBusinessConfigService({
      REGISTERED_VENDOR_PRICE_PER_100M_MINOR: 100,
      REGISTERED_VENDOR_MINIMUM_DELIVERY_FEE_MINOR: 0,
      REGISTERED_VENDOR_ADDITIONAL_VENDOR_FEE_MINOR: 0,
    });
    const service = new DeliveryFeeCalculationService(mapProvider as any, businessConfig as any);

    await expect(service.calculate([branchA], customer)).rejects.toThrow(BadRequestException);
  });

  it('fails closed when a required BusinessConfig value has never been set — never defaults to 0', async () => {
    const branchA = { id: 'a', latitude: 1, longitude: 1 };
    const mapProvider = buildMapProvider({ '1,1->0,0': 500 });
    const businessConfig = buildBusinessConfigService({}); // nothing configured
    const service = new DeliveryFeeCalculationService(mapProvider as any, businessConfig as any);

    await expect(service.calculate([branchA], customer)).rejects.toThrow(NotFoundException);
  });

  it('rejects an empty vendor branch list', async () => {
    const service = new DeliveryFeeCalculationService({} as any, {} as any);
    await expect(service.calculate([], customer)).rejects.toThrow(BadRequestException);
  });

  it('breaks ties deterministically by vendorBranchId when two vendors are exactly equidistant', async () => {
    const branchZ = { id: 'z', latitude: 1, longitude: 1 };
    const branchA = { id: 'a', latitude: 2, longitude: 2 };
    const mapProvider = buildMapProvider({
      '1,1->0,0': 500,
      '2,2->0,0': 500, // exact tie
      '2,2->1,1': 100,
      '1,1->2,2': 100,
    });
    const businessConfig = buildBusinessConfigService({
      REGISTERED_VENDOR_PRICE_PER_100M_MINOR: 10,
      REGISTERED_VENDOR_MINIMUM_DELIVERY_FEE_MINOR: 0,
      REGISTERED_VENDOR_ADDITIONAL_VENDOR_FEE_MINOR: 0,
    });
    const service = new DeliveryFeeCalculationService(mapProvider as any, businessConfig as any);

    // Passed in [z, a] order — result must still be sorted [a, z] by id
    // ascending, since distance alone can't break the tie.
    const result = await service.calculate([branchZ, branchA], customer);
    expect(result.vendorSequence.map((s) => s.vendorBranchId)).toEqual(['a', 'z']);
  });
});

describe('DeliveryFeeCalculationService — partial vendor cancellation (PD-002 / PD-003)', () => {
  const service = new DeliveryFeeCalculationService({} as any, {} as any);
  // A frozen breakdown of a 3-vendor order: base 2000 (= max(minimum, distance fee)), additional fee 500 per extra vendor.
  const snapshot = (vendors: number, base = 2000, additional = 500) => ({
    deliveryFeeMinor: base + additional * (vendors - 1),
    additionalVendorChargeMinor: additional * (vendors - 1),
    additionalVendorFeeMinorUsed: additional,
  });

  it('composeDeliveryFee is the one formula: base + additionalVendorFee * (vendorCount - 1)', () => {
    expect(composeDeliveryFee({ baseFeeMinor: 2000, additionalVendorFeeMinor: 500, vendorCount: 1 }).deliveryFeeMinor).toBe(2000);
    expect(composeDeliveryFee({ baseFeeMinor: 2000, additionalVendorFeeMinor: 500, vendorCount: 3 })).toEqual({
      additionalVendorChargeMinor: 1000,
      deliveryFeeMinor: 3000,
    });
  });

  it('2 vendors → 1: removes exactly one additional-vendor fee', () => {
    expect(service.recalculateForRemainingVendors(snapshot(2), 1)).toBe(2000);
  });

  it('3 vendors → 2: removes exactly one additional-vendor fee (3000 → 2500), and → 1 removes two (2000)', () => {
    expect(service.recalculateForRemainingVendors(snapshot(3), 2)).toBe(2500);
    expect(service.recalculateForRemainingVendors(snapshot(3), 1)).toBe(2000);
  });

  it('the base fee (max(minimum, distance)) stays exactly what the customer was quoted — it is not re-measured', () => {
    // A long-distance order whose base is far above any minimum: only the additional part moves.
    expect(service.recalculateForRemainingVendors(snapshot(2, 987654, 500), 1)).toBe(987654);
  });

  it('re-deriving from the ORIGINAL frozen breakdown is stable across successive cancellations (3 → 2 → 1)', () => {
    const frozen = snapshot(3);
    expect(service.recalculateForRemainingVendors(frozen, 2)).toBe(2500);
    expect(service.recalculateForRemainingVendors(frozen, 1)).toBe(2000);
  });

  it('no vendor left → fee 0', () => {
    expect(service.recalculateForRemainingVendors(snapshot(2), 0)).toBe(0);
  });

  it('a zero additional-vendor fee changes nothing', () => {
    expect(service.recalculateForRemainingVendors(snapshot(3, 2000, 0), 1)).toBe(2000);
  });

  it.each([[null], [undefined], [{}], [{ deliveryFeeMinor: 'x' }]])(
    'fails closed (DELIVERY_FEE_SNAPSHOT_UNAVAILABLE) when the frozen breakdown is missing or malformed: %p',
    (bad) => {
      expect(() => service.recalculateForRemainingVendors(bad, 1)).toThrow(ConflictException);
      try {
        service.recalculateForRemainingVendors(bad, 1);
      } catch (e: any) {
        expect(e.getResponse().details.code).toBe('DELIVERY_FEE_SNAPSHOT_UNAVAILABLE');
      }
    },
  );
});

describe('DeliveryFeeCalculationService — travel-time estimate frozen with the fee (PD-006)', () => {
  const cfg = () => buildBusinessConfigService({ REGISTERED_VENDOR_PRICE_PER_100M_MINOR: 100, REGISTERED_VENDOR_MINIMUM_DELIVERY_FEE_MINOR: 500, REGISTERED_VENDOR_ADDITIONAL_VENDOR_FEE_MINOR: 300 });
  const etaProvider = (etas: Record<string, number>) => ({
    distanceAndEta: jest.fn(async (from: any, to: any) => {
      const key = `${from.latitude},${from.longitude}->${to.latitude},${to.longitude}`;
      return { distanceMeters: 1000, etaSeconds: etas[key] };
    }),
  });

  it('records the ETA of every leg of the SAME route the fee is measured on, and their sum', async () => {
    const a = { id: 'a', latitude: 1, longitude: 1 };
    const b = { id: 'b', latitude: 2, longitude: 2 };
    // b is farther from the customer (equal 1000 m here → tie broken by id: a first), so the route is a→b→customer
    const provider = etaProvider({ '1,1->0,0': 300, '2,2->0,0': 420, '1,1->2,2': 180, '2,2->1,1': 180 });
    const result = await new DeliveryFeeCalculationService(provider as any, cfg() as any).calculate([a, b], customer);
    expect(result.legEtaSeconds).toHaveLength(2);
    expect(result.totalEtaSeconds).toBe(result.legEtaSeconds!.reduce((x, y) => x + y, 0));
    expect(result.totalEtaSeconds).toBeGreaterThan(0);
  });

  it('a missing / zero provider ETA is UNKNOWN — the fee is unaffected and no fake ETA is recorded', async () => {
    const a = { id: 'a', latitude: 1, longitude: 1 };
    for (const eta of [0, undefined as unknown as number, NaN]) {
      const result = await new DeliveryFeeCalculationService(etaProvider({ '1,1->0,0': eta }) as any, cfg() as any).calculate([a], customer);
      expect(result.totalEtaSeconds).toBeUndefined();
      expect(result.legEtaSeconds).toBeUndefined();
      expect(result.deliveryFeeMinor).toBeGreaterThan(0);
    }
  });

  it('the ETA fields never change the fee or the additional-vendor arithmetic', async () => {
    const a = { id: 'a', latitude: 1, longitude: 1 };
    const withEta = await new DeliveryFeeCalculationService(etaProvider({ '1,1->0,0': 600 }) as any, cfg() as any).calculate([a], customer);
    const withoutEta = await new DeliveryFeeCalculationService(etaProvider({ '1,1->0,0': 0 }) as any, cfg() as any).calculate([a], customer);
    expect(withEta.deliveryFeeMinor).toBe(withoutEta.deliveryFeeMinor);
  });
});

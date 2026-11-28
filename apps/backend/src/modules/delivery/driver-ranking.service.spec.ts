import { DriverRankingService } from './driver-ranking.service';
import { CartGroupType } from '../cart/cart-group-type.enum';
import { AdHocServiceType } from '../cart/ad-hoc-service-type.enum';
import { Order } from '../orders/entities/order.entity';

function buildHarness(opts: {
  drivers?: any[];
  branches?: any[];
  distances?: Record<string, number>; // key: "lat,lng->lat,lng"
  maxBicycleDistanceMeters?: number | null;
  preferredRadiusMeters?: number;
  activeLoads?: Record<string, number>;
}) {
  const drivers = opts.drivers ?? [];
  const branches = opts.branches ?? [];
  const distances = opts.distances ?? {};

  const driversRepository = {
    // The service asks for [no-GPS drivers, drivers inside the pickup area's box] (2026-11-28); the box pre-filter is exercised by the
    // e2e suites — here only the shared base conditions are applied.
    find: jest.fn(async ({ where }: any) => {
      const w = Array.isArray(where) ? where[0] : where;
      return drivers.filter((d) => d.isOnline === w.isOnline && d.isAvailable === w.isAvailable && d.verificationStatus === w.verificationStatus);
    }),
    findOne: jest.fn(async ({ where }: any) => drivers.find((d) => d.id === where.id) ?? null),
    // activeLoad() and roundRobinOrder() both read through query(): answer the load query from opts.activeLoads, everything else empty.
    query: jest.fn(async (sql: string): Promise<any[]> =>
      /count\(\*\) AS n/.test(sql) ? Object.entries(opts.activeLoads ?? {}).map(([driver_id, n]) => ({ driver_id, n: String(n) })) : [],
    ),
  };
  const vendorBranchesRepository = {
    findOne: jest.fn(async ({ where }: any) => branches.find((b) => b.id === where.id) ?? null),
  };
  const mapProvider = {
    distanceAndEta: jest.fn(async (from: any, to: any) => {
      const key = `${from.latitude},${from.longitude}->${to.latitude},${to.longitude}`;
      if (!(key in distances)) throw new Error(`no fixture distance for ${key}`);
      return { distanceMeters: distances[key], etaSeconds: 0 };
    }),
  };
  const businessConfigService = {
    getMaxBicyclePickupDistanceMeters: jest.fn(async () => opts.maxBicycleDistanceMeters ?? null),
    getDispatchPreferredRadiusMeters: jest.fn(async () => opts.preferredRadiusMeters ?? 3000),
  };
  // Every existing fixture in this file predates ServiceArea — default
  // to "everything resolves to the same single zone" so the new
  // ServiceArea filter never changes any pre-existing test's expected
  // outcome. Tests that specifically exercise ServiceArea behavior
  // override this per-call (see the new describe block below).
  const DEFAULT_ZONE = { id: 'zone-default', isActive: true };
  const serviceAreaResolverService = {
    resolveForPoint: jest.fn(
      async (_latitude: number, _longitude: number): Promise<{ id: string; isActive: boolean } | null> =>
        DEFAULT_ZONE,
    ),
  };

  const service = new DriverRankingService(
    driversRepository as any,
    vendorBranchesRepository as any,
    mapProvider as any,
    businessConfigService as any,
    serviceAreaResolverService as any,
  );
  return { service, mapProvider, businessConfigService, serviceAreaResolverService, driversRepository };
}

function makeDriver(overrides: Partial<any> = {}) {
  return {
    id: 'driver-1',
    isOnline: true,
    isAvailable: true,
    verificationStatus: 'APPROVED',
    lastLatitude: 30.0,
    lastLongitude: 31.0,
    vehicleTypeId: null,
    vehicleType: null,
    lastSeenAt: new Date(), // the app is open (DISPATCH_APP_FRESH_MS)
    ...overrides,
  };
}

function makeCatalogOrder(overrides: Partial<any> = {}): Order {
  return {
    id: 'order-1',
    deliveryAddressSnapshot: { line1: 'x', latitude: 30.5, longitude: 31.5 },
    deliveryFeeBreakdownSnapshot: null,
    segments: [{ groupType: CartGroupType.CATALOG, vendorBranchId: 'branch-1' }],
    ...overrides,
  } as Order;
}

describe('DriverRankingService', () => {
  describe('owner decisions 2026-11-22: least-busy within the preferred radius; an app that is not open is not offered orders', () => {
    const branches = [{ id: 'branch-1', latitude: 30.1, longitude: 31.1 }];
    const near = (id: string, lat: number, extra: Partial<any> = {}) => makeDriver({ id, lastLatitude: lat, lastLongitude: 31.05, ...extra });
    const distances = {
      '30.05,31.05->30.1,31.1': 500, // busy, nearest
      '30.06,31.05->30.1,31.1': 900, // idle, a little farther
      '30.07,31.05->30.1,31.1': 2500, // one order
      '30.2,31.05->30.1,31.1': 7000, // idle but outside the radius
    };

    it('inside the radius the driver with the fewest active orders goes first, then the nearest; outside the radius come last, nearest first', async () => {
      const drivers = [near('busy-nearest', 30.05), near('idle-900m', 30.06), near('one-order-2500m', 30.07), near('idle-far', 30.2)];
      const { service } = buildHarness({ drivers, branches, distances, activeLoads: { 'busy-nearest': 4, 'one-order-2500m': 1 } });
      expect(await service.rankCandidates(makeCatalogOrder())).toEqual(['idle-900m', 'one-order-2500m', 'busy-nearest', 'idle-far']);
    });

    it('a smaller radius makes distance matter again', async () => {
      const drivers = [near('busy-nearest', 30.05), near('idle-900m', 30.06)];
      const { service } = buildHarness({ drivers, branches, distances, preferredRadiusMeters: 600, activeLoads: { 'busy-nearest': 4 } });
      expect(await service.rankCandidates(makeCatalogOrder())).toEqual(['busy-nearest', 'idle-900m']);
    });

    it('a driver switched online whose app has not checked in for over 3 minutes (or never) is not offered the order', async () => {
      const drivers = [
        near('app-closed-days-ago', 30.05, { lastSeenAt: new Date(Date.now() - 7 * 86_400_000) }),
        near('never-seen', 30.07, { lastSeenAt: null }),
        near('app-open', 30.06),
      ];
      const { service } = buildHarness({ drivers, branches, distances });
      expect(await service.rankCandidates(makeCatalogOrder())).toEqual(['app-open']);
    });
  });

  it('ranks eligible drivers nearest-first to the first pickup point', async () => {
    const branches = [{ id: 'branch-1', latitude: 30.1, longitude: 31.1 }];
    const drivers = [
      makeDriver({ id: 'driver-far', lastLatitude: 29.0, lastLongitude: 29.0 }),
      makeDriver({ id: 'driver-near', lastLatitude: 30.05, lastLongitude: 31.05 }),
    ];
    const distances = {
      '29,29->30.1,31.1': 9000,
      '30.05,31.05->30.1,31.1': 800,
    };
    const { service } = buildHarness({ drivers, branches, distances });

    const ranked = await service.rankCandidates(makeCatalogOrder());
    expect(ranked).toEqual(['driver-near', 'driver-far']);
  });

  it('excludes an offline/unavailable/unapproved driver entirely (query-level filter)', async () => {
    const branches = [{ id: 'branch-1', latitude: 30.1, longitude: 31.1 }];
    const { service } = buildHarness({ drivers: [], branches, distances: {} });
    const ranked = await service.rankCandidates(makeCatalogOrder());
    expect(ranked).toEqual([]);
  });

  // R14: GPS is never mandatory — a driver without a location is a candidate, after every driver ranked by proximity.
  it('R14: a driver with no known location is still eligible, after the drivers ranked by distance', async () => {
    const branches = [{ id: 'branch-1', latitude: 30.1, longitude: 31.1 }];
    const drivers = [makeDriver({ id: 'driver-no-loc', lastLatitude: null, lastLongitude: null }), makeDriver({ id: 'near', lastLatitude: 30.0, lastLongitude: 31.0 })];
    const { service } = buildHarness({ drivers, branches, distances: { '30,31->30.1,31.1': 500 } });
    expect(await service.rankCandidates(makeCatalogOrder())).toEqual(['near', 'driver-no-loc']);
  });

  it('R14: drivers without GPS take turns — the one assigned longest ago (or never) first', async () => {
    const branches = [{ id: 'branch-1', latitude: 30.1, longitude: 31.1 }];
    const drivers = ['b', 'a', 'c'].map((id) => makeDriver({ id, lastLatitude: null, lastLongitude: null }));
    const { service, driversRepository } = buildHarness({ drivers, branches });
    driversRepository.query.mockResolvedValue([{ driver_id: 'a', last: new Date('2026-11-07T10:00:00Z') }, { driver_id: 'b', last: new Date('2026-11-06T10:00:00Z') }]);
    expect(await service.rankCandidates(makeCatalogOrder())).toEqual(['c', 'b', 'a']);
  });

  it('R14: a driver whose distance cannot be computed is kept, in turn — never given a made-up distance', async () => {
    const branches = [{ id: 'branch-1', latitude: 30.1, longitude: 31.1 }];
    const drivers = [makeDriver({ id: 'unknown-distance', lastLatitude: 29.0, lastLongitude: 30.0 })];
    const { service } = buildHarness({ drivers, branches, distances: {} });
    expect(await service.rankCandidates(makeCatalogOrder())).toEqual(['unknown-distance']);
  });

  it('FAIL CLOSED: excludes a bicycle driver entirely when no max distance is configured, even if very close', async () => {
    const branches = [{ id: 'branch-1', latitude: 30.1, longitude: 31.1 }];
    const drivers = [
      makeDriver({
        id: 'driver-bike',
        lastLatitude: 30.099,
        lastLongitude: 31.099,
        vehicleTypeId: 'vt-1',
        vehicleType: { isBicycle: true },
      }),
    ];
    const distances = { '30.099,31.099->30.1,31.1': 50 };
    const { service } = buildHarness({ drivers, branches, distances, maxBicycleDistanceMeters: null });

    const ranked = await service.rankCandidates(makeCatalogOrder());
    expect(ranked).toEqual([]);
  });

  it('once configured, includes a bicycle driver within the limit and excludes one beyond it', async () => {
    const branches = [{ id: 'branch-1', latitude: 30.1, longitude: 31.1 }];
    const drivers = [
      makeDriver({
        id: 'driver-bike-ok',
        lastLatitude: 30.099,
        lastLongitude: 31.099,
        vehicleTypeId: 'vt-1',
        vehicleType: { isBicycle: true },
      }),
      makeDriver({
        id: 'driver-bike-far',
        lastLatitude: 29.0,
        lastLongitude: 29.0,
        vehicleTypeId: 'vt-1',
        vehicleType: { isBicycle: true },
      }),
    ];
    const distances = {
      '30.099,31.099->30.1,31.1': 500,
      '29,29->30.1,31.1': 9000,
    };
    const { service } = buildHarness({ drivers, branches, distances, maxBicycleDistanceMeters: 1000 });

    const ranked = await service.rankCandidates(makeCatalogOrder());
    expect(ranked).toEqual(['driver-bike-ok']);
  });

  it('a non-bicycle driver is never subject to the bicycle-distance limit', async () => {
    const branches = [{ id: 'branch-1', latitude: 30.1, longitude: 31.1 }];
    const drivers = [makeDriver({ id: 'driver-car', lastLatitude: 29.0, lastLongitude: 29.0 })];
    const distances = { '29,29->30.1,31.1': 9000 };
    const { service } = buildHarness({ drivers, branches, distances, maxBicycleDistanceMeters: 1000 });

    const ranked = await service.rankCandidates(makeCatalogOrder());
    expect(ranked).toEqual(['driver-car']); // 9000m fine for a non-bicycle
  });

  it('multi-vendor: uses the FIRST entry of the already-frozen pricing vendorSequence, reusing existing approved ordering, not inventing a new one', async () => {
    const branches = [
      { id: 'branch-far', latitude: 40.0, longitude: 40.0 },
      { id: 'branch-near', latitude: 30.1, longitude: 31.1 },
    ];
    const drivers = [makeDriver({ id: 'driver-1', lastLatitude: 39.9, lastLongitude: 39.9 })];
    const order = makeCatalogOrder({
      deliveryFeeBreakdownSnapshot: {
        vendorSequence: [{ vendorBranchId: 'branch-far' }, { vendorBranchId: 'branch-near' }],
      },
      segments: [
        { groupType: CartGroupType.CATALOG, vendorBranchId: 'branch-far' },
        { groupType: CartGroupType.CATALOG, vendorBranchId: 'branch-near' },
      ],
    });
    const distances = { '39.9,39.9->40,40': 300 };
    const { service, mapProvider } = buildHarness({ drivers, branches, distances });

    const ranked = await service.rankCandidates(order);
    expect(ranked).toEqual(['driver-1']);
    // Confirms it queried against the FAR branch (first in the pricing sequence), not the near one.
    expect(mapProvider.distanceAndEta).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ latitude: 40.0, longitude: 40.0 }),
    );
  });

  it('AD_HOC_SERVICE BUY_FROM_PLACE: uses the snapshotted pickup coordinate', async () => {
    const order = {
      id: 'order-2',
      deliveryAddressSnapshot: { latitude: 30.5, longitude: 31.5 },
      deliveryFeeBreakdownSnapshot: null,
      segments: [
        {
          groupType: CartGroupType.AD_HOC_SERVICE,
          // The production field is `adHocServiceTypeSnapshot` (see
          // OrderVendorSegment/OrderCreationService) — a frozen,
          // order-creation-time snapshot, never a live `adHocServiceType`
          // read off the segment. Using the wrong field name here left
          // `resolveFirstPickupPoint` unable to detect BUY_FROM_PLACE at
          // all, silently falling through to the DELIVER_TO_PLACE branch.
          adHocServiceTypeSnapshot: AdHocServiceType.BUY_FROM_PLACE,
          adHocPickupLatitudeSnapshot: 30.2,
          adHocPickupLongitudeSnapshot: 31.2,
        },
      ],
    };
    const drivers = [makeDriver({ id: 'driver-1', lastLatitude: 30.19, lastLongitude: 31.19 })];
    const distances = { '30.19,31.19->30.2,31.2': 200 };
    const { service } = buildHarness({ drivers, distances });

    const ranked = await service.rankCandidates(order as any);
    expect(ranked).toEqual(['driver-1']);
  });

  it("AD_HOC_SERVICE DELIVER_TO_PLACE: uses the customer's own delivery address as the starting point", async () => {
    const order = {
      id: 'order-3',
      deliveryAddressSnapshot: { latitude: 30.7, longitude: 31.7 },
      deliveryFeeBreakdownSnapshot: null,
      // Same real field name as above (`adHocServiceTypeSnapshot`) —
      // kept correct here too so this test genuinely exercises the
      // DELIVER_TO_PLACE branch rather than merely the "anything other
      // than BUY_FROM_PLACE" fallback, which would pass even if this
      // field were missing entirely.
      segments: [{ groupType: CartGroupType.AD_HOC_SERVICE, adHocServiceTypeSnapshot: AdHocServiceType.DELIVER_TO_PLACE }],
    };
    const drivers = [makeDriver({ id: 'driver-1', lastLatitude: 30.69, lastLongitude: 31.69 })];
    const distances = { '30.69,31.69->30.7,31.7': 150 };
    const { service, mapProvider } = buildHarness({ drivers, distances });

    const ranked = await service.rankCandidates(order as any);
    expect(ranked).toEqual(['driver-1']);
    expect(mapProvider.distanceAndEta).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ latitude: 30.7, longitude: 31.7 }),
    );
  });

  it('REGRESSION: driver location is only ever used as an INPUT to MapProvider ranking distance — the only BusinessConfig call made is the bicycle-limit lookup, never anything resembling a fee/pricing computation', async () => {
    const branches = [{ id: 'branch-1', latitude: 30.1, longitude: 31.1 }];
    const drivers = [makeDriver({ id: 'driver-1' })];
    const distances = { '30,31->30.1,31.1': 500 };
    const { service, businessConfigService } = buildHarness({ drivers, branches, distances });

    await service.rankCandidates(makeCatalogOrder());

    // getMaxBicyclePickupDistanceMeters is the ONLY BusinessConfig
    // method this service ever calls — never anything resembling a
    // pricing parameter lookup (price-per-100m, minimum fee, etc.).
    expect(businessConfigService.getMaxBicyclePickupDistanceMeters).toHaveBeenCalledTimes(1);
    // The dispatch radius (owner decision 2026-11-22) is a ranking preference, not a price.
    expect(Object.keys(businessConfigService)).toEqual(['getMaxBicyclePickupDistanceMeters', 'getDispatchPreferredRadiusMeters']);
  });

  it('isDriverEligibleForOrder returns true for a driver who appears in rankCandidates', async () => {
    const branches = [{ id: 'branch-1', latitude: 30.1, longitude: 31.1 }];
    const drivers = [makeDriver({ id: 'driver-1', lastLatitude: 30.0, lastLongitude: 31.0 })];
    const distances = { '30,31->30.1,31.1': 500 };
    const { service } = buildHarness({ drivers, branches, distances });

    expect(await service.isDriverEligibleForOrder(makeCatalogOrder(), 'driver-1')).toBe(true);
  });

  it('isDriverEligibleForOrder returns false for a driver excluded by the bicycle fail-closed rule (Phase D decision 9 support)', async () => {
    const branches = [{ id: 'branch-1', latitude: 30.1, longitude: 31.1 }];
    const drivers = [
      makeDriver({
        id: 'driver-bike',
        lastLatitude: 30.099,
        lastLongitude: 31.099,
        vehicleTypeId: 'vt-1',
        vehicleType: { isBicycle: true },
      }),
    ];
    const distances = { '30.099,31.099->30.1,31.1': 50 };
    const { service } = buildHarness({ drivers, branches, distances, maxBicycleDistanceMeters: null });

    expect(await service.isDriverEligibleForOrder(makeCatalogOrder(), 'driver-bike')).toBe(false);
  });

  it('isDriverEligibleForOrder returns false for a driver not in the eligible set at all (e.g. offline)', async () => {
    const branches = [{ id: 'branch-1', latitude: 30.1, longitude: 31.1 }];
    const { service } = buildHarness({ drivers: [], branches, distances: {} });

    expect(await service.isDriverEligibleForOrder(makeCatalogOrder(), 'driver-offline')).toBe(false);
  });
});

describe('DriverRankingService — ServiceArea boundary (Phase I-B)', () => {
  it('a driver inside the pickup ServiceArea remains eligible, ranked by the existing distance rule', async () => {
    const branches = [{ id: 'branch-1', latitude: 30.1, longitude: 31.1 }];
    const drivers = [makeDriver({ id: 'driver-in-zone', lastLatitude: 30.05, lastLongitude: 31.05 })];
    const distances = { '30.05,31.05->30.1,31.1': 500 };
    const { service, serviceAreaResolverService } = buildHarness({ drivers, branches, distances });

    serviceAreaResolverService.resolveForPoint.mockImplementation(async (lat: number, lng: number) => {
      // Pickup point and this driver are both "in zone-1" for this test.
      return { id: 'zone-1', isActive: true };
    });

    const ranked = await service.rankCandidates(makeCatalogOrder());
    expect(ranked).toEqual(['driver-in-zone']);
  });

  it('a driver outside the pickup ServiceArea is excluded, even though the existing distance rule alone would have allowed them', async () => {
    const branches = [{ id: 'branch-1', latitude: 30.1, longitude: 31.1 }];
    const drivers = [makeDriver({ id: 'driver-out-of-zone', lastLatitude: 30.05, lastLongitude: 31.05 })];
    const distances = { '30.05,31.05->30.1,31.1': 500 }; // close enough by distance alone
    const { service, serviceAreaResolverService } = buildHarness({ drivers, branches, distances });

    serviceAreaResolverService.resolveForPoint.mockImplementation(async (lat: number) => {
      // Pickup point resolves to zone-1 (lat 30.1); this driver's own
      // location (lat 30.05) resolves to a DIFFERENT zone.
      if (lat === 30.1) return { id: 'zone-1', isActive: true };
      return { id: 'zone-2', isActive: true };
    });

    const ranked = await service.rankCandidates(makeCatalogOrder());
    expect(ranked).toEqual([]);
  });

  it('existing online/available/verified rules remain fully intact alongside the new ServiceArea check', async () => {
    const branches = [{ id: 'branch-1', latitude: 30.1, longitude: 31.1 }];
    const drivers = [
      makeDriver({ id: 'driver-offline', isOnline: false, lastLatitude: 30.05, lastLongitude: 31.05 }),
      makeDriver({ id: 'driver-eligible', lastLatitude: 30.05, lastLongitude: 31.05 }),
    ];
    const distances = { '30.05,31.05->30.1,31.1': 500 };
    const { service, serviceAreaResolverService } = buildHarness({ drivers, branches, distances });
    serviceAreaResolverService.resolveForPoint.mockImplementation(async () => ({ id: 'zone-1', isActive: true }));

    const ranked = await service.rankCandidates(makeCatalogOrder());
    // The offline driver never even reaches the ServiceArea check —
    // filtered out by the existing `find({ where: { isOnline: true, ... } })`.
    expect(ranked).toEqual(['driver-eligible']);
  });

  it('when the pickup point itself resolves to no active ServiceArea, no candidates are returned (fail-closed, matching Discovery)', async () => {
    const branches = [{ id: 'branch-1', latitude: 30.1, longitude: 31.1 }];
    const drivers = [makeDriver({ id: 'driver-1', lastLatitude: 30.05, lastLongitude: 31.05 })];
    const { service, serviceAreaResolverService } = buildHarness({ drivers, branches, distances: {} });
    serviceAreaResolverService.resolveForPoint.mockImplementation(async () => null);

    const ranked = await service.rankCandidates(makeCatalogOrder());
    expect(ranked).toEqual([]);
  });
});

describe('DriverRankingService — Maps disabled (PD-009 G: straight-line ranking)', () => {
  function disabledHarness(drivers: any[], maxBicycleDistanceMeters: number | null = 5000) {
    const h = buildHarness({ drivers, branches: [{ id: 'branch-1', latitude: 30.1, longitude: 31.1 }], distances: {}, maxBicycleDistanceMeters });
    (h.mapProvider as any).available = false; // exactly what UnavailableMapProvider exposes
    return h;
  }

  it('ranks by straight-line distance to the first pickup and never calls the map provider', async () => {
    const { service, mapProvider } = disabledHarness([
      makeDriver({ id: 'far', lastLatitude: 30.2, lastLongitude: 31.2 }),
      makeDriver({ id: 'near', lastLatitude: 30.101, lastLongitude: 31.101 }),
      makeDriver({ id: 'mid', lastLatitude: 30.12, lastLongitude: 31.12 }),
    ]);
    expect(await service.rankCandidates(makeCatalogOrder())).toEqual(['near', 'mid', 'far']);
    expect(mapProvider.distanceAndEta).not.toHaveBeenCalled();
  });

  it('does not auto-rank bicycle drivers (their limit is a road distance that cannot be verified), even very close ones', async () => {
    const { service } = disabledHarness([
      makeDriver({ id: 'bike', lastLatitude: 30.1001, lastLongitude: 31.1001, vehicleTypeId: 'vt-1', vehicleType: { isBicycle: true } }),
      makeDriver({ id: 'car', lastLatitude: 30.15, lastLongitude: 31.15 }),
    ]);
    expect(await service.rankCandidates(makeCatalogOrder())).toEqual(['car']);
  });

  it('keeps every other eligibility rule: other service area, offline (a driver without GPS is kept, after the ranked ones — R14)', async () => {
    const drivers = [
      makeDriver({ id: 'no-loc', lastLatitude: null, lastLongitude: null }),
      makeDriver({ id: 'offline', isOnline: false }),
      makeDriver({ id: 'elsewhere', lastLatitude: 31.2, lastLongitude: 29.9 }),
      makeDriver({ id: 'ok', lastLatitude: 30.11, lastLongitude: 31.11 }),
    ];
    const { service, serviceAreaResolverService } = disabledHarness(drivers);
    serviceAreaResolverService.resolveForPoint.mockImplementation(async (lat: number) => (lat > 31 ? { id: 'zone-other', isActive: true } : { id: 'zone-default', isActive: true }));
    expect(await service.rankCandidates(makeCatalogOrder())).toEqual(['ok', 'no-loc']);
  });

  it('admin named-assignment eligibility follows the same straight-line ranking', async () => {
    const { service } = disabledHarness([makeDriver({ id: 'ok', lastLatitude: 30.11, lastLongitude: 31.11 })]);
    await expect(service.isDriverEligibleForOrder(makeCatalogOrder(), 'ok')).resolves.toBe(true);
    await expect(service.isDriverEligibleForOrder(makeCatalogOrder(), 'nobody')).resolves.toBe(false);
  });
});

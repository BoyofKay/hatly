import { BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AddressesService } from './addresses.service';

const ACTIVE_AREA = { id: 'area-1', isActive: true };
function zone(overrides: Partial<any> = {}) {
  return {
    id: 'zone-1',
    name: 'Abu Naseeb',
    nameAr: 'أبو نصيب',
    city: 'Belbeis',
    cityAr: 'بلبيس',
    governorate: 'Sharqia',
    governorateAr: 'الشرقية',
    deliveryFeeMinor: 1500,
    isActive: true,
    serviceAreaId: 'area-1',
    serviceArea: ACTIVE_AREA,
    ...overrides,
  };
}

function buildHarness(seed: { addresses?: any[]; zones?: any[] } = {}) {
  const addresses = new Map((seed.addresses ?? []).map((a) => [a.id, a]));
  const zones = new Map((seed.zones ?? [zone()]).map((z) => [z.id, z]));
  const zonesRepository = { findOne: async (opts: any) => zones.get(opts.where.id) ?? null, find: async () => [...zones.values()] };

  const repository = {
    create: (data: any) => ({ ...data }),
    save: async (entity: any) => {
      const withId = { id: entity.id ?? randomUUID(), ...entity };
      addresses.set(withId.id, withId);
      return withId;
    },
    find: async (opts: any) => {
      return [...addresses.values()].filter(
        (a) => a.customerId === opts.where.customerId && a.isActive === opts.where.isActive,
      );
    },
    findOne: async (opts: any) => addresses.get(opts.where.id) ?? null,
    count: async (opts: any) =>
      [...addresses.values()].filter((a) => a.customerId === opts.where.customerId && a.isActive === opts.where.isActive).length,
    update: async (where: any, set: any) => {
      for (const a of addresses.values()) {
        if (a.customerId === where.customerId && a.isDefault === where.isDefault) Object.assign(a, set);
      }
    },
  };

  const serviceAreasRepository = { count: jest.fn(async () => 1) };
  const resolver = { resolveForPoint: jest.fn(async () => ({ id: 'area-1' })) };
  const deliveryFee = { roadDistancePricingAvailable: true };
  const businessConfig = { get: jest.fn(async (_k: string, d: unknown) => (configValues.has(_k) ? configValues.get(_k) : d)) };
  const configValues = new Map<string, unknown>();
  const service = new AddressesService(
    repository as any,
    zonesRepository as any,
    serviceAreasRepository as any,
    resolver as any,
    deliveryFee as any,
    businessConfig as any,
  );
  return { service, addresses, resolver, deliveryFee, configValues, serviceAreasRepository, zonesRepository };
}

function baseDto(overrides: Partial<any> = {}) {
  return { line1: '12 Market St', deliveryZoneId: 'zone-1', latitude: 30.123456, longitude: 31.654321, ...overrides } as any;
}

describe('AddressesService.create', () => {
  it('creates an address with GPS coordinates and manual line1 persisted correctly', async () => {
    const { service } = buildHarness();
    const address = await service.create('customer-1', baseDto({ label: 'Home' }));

    expect(address.customerId).toBe('customer-1');
    expect(address.label).toBe('Home');
    expect(address.line1).toBe('12 Market St');
    expect(address.latitude).toBe(30.123456);
    expect(address.longitude).toBe(31.654321);
    expect(address.isActive).toBe(true);
  });

  it('defaults label/instructions to null when omitted', async () => {
    const { service } = buildHarness();
    const address = await service.create('customer-1', baseDto());
    expect(address.label).toBeNull();
    expect(address.instructions).toBeNull();
  });
});

describe('AddressesService.listForCustomer', () => {
  it('returns only the requesting customer\'s own addresses', async () => {
    const { service } = buildHarness({
      addresses: [
        { id: 'a1', customerId: 'customer-1', isActive: true, createdAt: new Date() },
        { id: 'a2', customerId: 'customer-2', isActive: true, createdAt: new Date() },
      ],
    });
    const result = await service.listForCustomer('customer-1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a1');
  });

  it('excludes deactivated addresses', async () => {
    const { service } = buildHarness({
      addresses: [{ id: 'a1', customerId: 'customer-1', isActive: false, createdAt: new Date() }],
    });
    const result = await service.listForCustomer('customer-1');
    expect(result).toHaveLength(0);
  });
});

describe('AddressesService — ownership enforcement on update/deactivate', () => {
  it('allows the owning customer to update their own address', async () => {
    const { service } = buildHarness({
      addresses: [{ id: 'a1', customerId: 'customer-1', line1: 'Old', latitude: 1, longitude: 1, isActive: true, deliveryZoneId: 'zone-1', deliveryZone: zone() }],
    });
    const updated = await service.update('customer-1', 'a1', { line1: 'New address text' });
    expect(updated.line1).toBe('New address text');
  });

  it('rejects update from a different customer — not found, never forbidden (no leak)', async () => {
    const { service } = buildHarness({
      addresses: [{ id: 'a1', customerId: 'customer-1', isActive: true }],
    });
    await expect(service.update('customer-2', 'a1', { line1: 'Hacked' })).rejects.toThrow(NotFoundException);
  });

  it('rejects update for a nonexistent address', async () => {
    const { service } = buildHarness();
    await expect(service.update('customer-1', 'missing', { line1: 'X' })).rejects.toThrow(NotFoundException);
  });

  it('allows the owning customer to deactivate their own address', async () => {
    const { service, addresses } = buildHarness({
      addresses: [{ id: 'a1', customerId: 'customer-1', isActive: true }],
    });
    await service.deactivate('customer-1', 'a1');
    expect(addresses.get('a1').isActive).toBe(false);
  });

  it('rejects deactivation from a different customer', async () => {
    const { service } = buildHarness({
      addresses: [{ id: 'a1', customerId: 'customer-1', isActive: true }],
    });
    await expect(service.deactivate('customer-2', 'a1')).rejects.toThrow(NotFoundException);
  });
});

describe('AddressesService — structured details and the default address (PD-006)', () => {
  it('stores the structured Egyptian details + the assistive formatted address next to the authoritative coordinates', async () => {
    const { service } = buildHarness();
    const a = await service.create('customer-1', baseDto({ governorate: 'ignored', city: 'ignored', street: 'شارع النصر', buildingNumber: '12', floor: '3', apartment: '7', landmark: 'بجوار المسجد', formattedAddress: 'assistive', label: 'Home' }));
    expect(a).toMatchObject({ governorate: 'الشرقية', city: 'بلبيس', street: 'شارع النصر', buildingNumber: '12', floor: '3', apartment: '7', landmark: 'بجوار المسجد', formattedAddress: 'assistive', latitude: 30.123456, longitude: 31.654321 });
  });

  it('the FIRST address becomes the default; later ones do not (unless asked)', async () => {
    const { service } = buildHarness();
    const first = await service.create('customer-1', baseDto());
    const second = await service.create('customer-1', baseDto({ line1: 'Second' }));
    expect([first.isDefault, second.isDefault]).toEqual([true, false]);
  });

  it('making an address the default clears the previous default — at most one at a time', async () => {
    const { service, addresses } = buildHarness();
    const first = await service.create('customer-1', baseDto());
    const second = await service.create('customer-1', baseDto({ line1: 'Second', isDefault: true }));
    expect(addresses.get(first.id).isDefault).toBe(false);
    expect(addresses.get(second.id).isDefault).toBe(true);
    await service.update('customer-1', first.id, { isDefault: true });
    expect([...addresses.values()].filter((a: any) => a.isDefault).map((a: any) => a.id)).toEqual([first.id]);
  });

  it("one customer's default never affects another customer's", async () => {
    const { service, addresses } = buildHarness();
    const mine = await service.create('customer-1', baseDto());
    await service.create('customer-2', baseDto());
    expect(addresses.get(mine.id).isDefault).toBe(true);
  });

  it('update can change the structured details; a deactivated address is no longer the default', async () => {
    const { service, addresses } = buildHarness();
    const a = await service.create('customer-1', baseDto());
    const updated = await service.update('customer-1', a.id, { landmark: 'near the school', floor: '9' });
    expect(updated).toMatchObject({ landmark: 'near the school', floor: '9' });
    await service.deactivate('customer-1', a.id);
    expect(addresses.get(a.id)).toMatchObject({ isActive: false, isDefault: false });
  });
});

describe('AddressesService — Delivery Zones (PD-009)', () => {
  it('saves an address WITHOUT a map pin when an active zone is selected; governorate/city come from the zone', async () => {
    const { service } = buildHarness();
    const a = await service.create('customer-1', { line1: 'شارع أبو نصيب جنب جامع الكردي، منزل 15', deliveryZoneId: 'zone-1' } as any);
    expect(a).toMatchObject({ latitude: null, longitude: null, deliveryZoneId: 'zone-1', governorate: 'الشرقية', city: 'بلبيس' });
    expect(service.toView(a)).toMatchObject({ zoneStatus: 'OK', deliveryZone: { nameAr: 'أبو نصيب', cityAr: 'بلبيس' } });
  });

  it.each([
    ['an inactive zone', zone({ isActive: false })],
    ['a zone of an inactive service area', zone({ serviceArea: { id: 'area-1', isActive: false } })],
    ['a soft-deleted zone', zone({ deletedAt: new Date() })],
  ])('refuses %s (DELIVERY_ZONE_UNAVAILABLE)', async (_, z) => {
    const { service } = buildHarness({ zones: [z] });
    const error = await service.create('customer-1', baseDto()).catch((e) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse().details.code).toBe('DELIVERY_ZONE_UNAVAILABLE');
  });

  it('refuses an unknown zone id', async () => {
    const { service } = buildHarness();
    const error = await service.create('customer-1', baseDto({ deliveryZoneId: 'nope' })).catch((e) => e);
    expect(error.getResponse().details.code).toBe('DELIVERY_ZONE_UNAVAILABLE');
  });

  it('refuses half a map pin — never stores one coordinate', async () => {
    const { service } = buildHarness();
    const error = await service.create('customer-1', baseDto({ longitude: undefined })).catch((e) => e);
    expect(error.getResponse().details).toMatchObject({ code: 'INVALID_DELIVERY_ADDRESS', field: 'location' });
  });

  it('update can remove the pin (both null) and re-select a zone', async () => {
    const other = zone({ id: 'zone-2', nameAr: 'منطقة أخرى' });
    const { service } = buildHarness({ zones: [zone(), other] });
    const a = await service.create('customer-1', baseDto());
    const updated = await service.update('customer-1', a.id, { latitude: null, longitude: null, deliveryZoneId: 'zone-2' });
    expect(updated).toMatchObject({ latitude: null, longitude: null, deliveryZoneId: 'zone-2' });
  });

  it('a legacy zone-less address is never guessed into a zone: MISSING, and editing its details requires choosing one', async () => {
    const legacy = { id: 'a1', customerId: 'customer-1', line1: 'Old', latitude: 30.4, longitude: 31.5, isActive: true, isDefault: false, deliveryZoneId: null };
    const { service } = buildHarness({ addresses: [legacy] });
    expect(service.toView(legacy as any).zoneStatus).toBe('MISSING');
    const error = await service.update('customer-1', 'a1', { line1: 'New' }).catch((e) => e);
    expect(error.getResponse().details.code).toBe('ADDRESS_ZONE_REQUIRED');
    // ...but it can still be made the default / relabelled, and gets a zone once the customer selects one.
    await expect(service.update('customer-1', 'a1', { isDefault: true })).resolves.toMatchObject({ isDefault: true });
    await expect(service.update('customer-1', 'a1', { deliveryZoneId: 'zone-1', line1: 'New' })).resolves.toMatchObject({ deliveryZoneId: 'zone-1' });
  });

  it('an address whose zone was later deactivated reports UNAVAILABLE and keeps its zone (no silent fallback)', async () => {
    const { service } = buildHarness();
    const a = await service.create('customer-1', baseDto());
    a.deliveryZone = zone({ isActive: false }) as any;
    expect(service.toView(a)).toMatchObject({ zoneStatus: 'UNAVAILABLE', deliveryZoneId: 'zone-1' });
  });
});

describe('AddressesService — the two alternative methods (GPS / MANUAL)', () => {
  const codeOf = (e: any) => e.getResponse().details.code;
  const gps = (overrides: Partial<any> = {}) => ({ mode: 'GPS', latitude: 30.42, longitude: 31.56, ...overrides }) as any;
  const manual = (overrides: Partial<any> = {}) => ({ mode: 'MANUAL', line1: 'شارع المنشية', deliveryZoneId: 'zone-1', ...overrides }) as any;

  it('GPS: saved from the coordinates alone — no zone, no typed text; the zone area names stay empty; the status is OK (nothing to re-select)', async () => {
    const { service } = buildHarness();
    const a = await service.create('customer-1', gps());
    expect(a).toMatchObject({ mode: 'GPS', line1: '', latitude: 30.42, longitude: 31.56, deliveryZoneId: null, governorate: null, city: null });
    expect(service.toView(a)).toMatchObject({ mode: 'GPS', zoneStatus: 'OK', deliveryZone: null });
  });

  it('GPS is rejected with a clear code outside configured coverage, and nothing is saved', async () => {
    const { service, resolver, addresses } = buildHarness();
    resolver.resolveForPoint.mockResolvedValueOnce(null as any);
    expect(codeOf(await service.create('customer-1', gps()).catch((e) => e))).toBe('ADDRESS_OUT_OF_SERVICE_AREA');
    expect(addresses.size).toBe(0);
  });

  it('GPS reports DISTANCE_PRICING_UNAVAILABLE when the road-distance provider is off — never saved, never a zone fallback', async () => {
    const { service, deliveryFee, addresses } = buildHarness();
    (deliveryFee as any).roadDistancePricingAvailable = false;
    expect(codeOf(await service.create('customer-1', gps()).catch((e) => e))).toBe('DISTANCE_PRICING_UNAVAILABLE');
    expect(addresses.size).toBe(0);
  });

  it('GPS needs both coordinates, a plausible Egyptian point, and does not accept a zone', async () => {
    const { service } = buildHarness();
    expect(codeOf(await service.create('customer-1', gps({ longitude: undefined })).catch((e) => e))).toBe('INVALID_DELIVERY_ADDRESS');
    expect(codeOf(await service.create('customer-1', gps({ latitude: 48.8, longitude: 2.3 })).catch((e) => e))).toBe('INVALID_DELIVERY_LOCATION');
    const zoneError = await service.create('customer-1', gps({ deliveryZoneId: 'zone-1' })).catch((e) => e);
    expect(zoneError.getResponse().details).toMatchObject({ code: 'INVALID_DELIVERY_ADDRESS', field: 'deliveryZoneId' });
  });

  it('MANUAL: the zone and the written address are required and NO coordinates are stored or accepted', async () => {
    const { service, resolver, addresses } = buildHarness();
    const a = await service.create('customer-1', manual());
    expect(a).toMatchObject({ mode: 'MANUAL', line1: 'شارع المنشية', latitude: null, longitude: null, deliveryZoneId: 'zone-1', city: 'بلبيس' });
    expect(resolver.resolveForPoint).not.toHaveBeenCalled(); // no coverage / location logic for the manual method
    const withPin = await service.create('customer-1', manual({ latitude: 30.4, longitude: 31.5 })).catch((e) => e);
    expect(withPin.getResponse().details).toMatchObject({ code: 'INVALID_DELIVERY_ADDRESS', field: 'location' });
    expect(addresses.size).toBe(1);
  });

  it('MANUAL with an inactive or unknown zone is refused (no fallback to GPS or another zone)', async () => {
    const { service } = buildHarness({ zones: [zone({ isActive: false })] });
    expect(codeOf(await service.create('customer-1', manual()).catch((e) => e))).toBe('DELIVERY_ZONE_UNAVAILABLE');
  });

  it('switching MANUAL → GPS is explicit and clears the zone, area names and typed text', async () => {
    const { service } = buildHarness();
    const a = await service.create('customer-1', manual({ landmark: 'جنب الجامع', floor: '3' }));
    const switched = await service.update('customer-1', a.id, gps());
    expect(switched).toMatchObject({ mode: 'GPS', latitude: 30.42, longitude: 31.56, line1: '', deliveryZoneId: null, governorate: null, city: null, landmark: null, floor: null });
  });

  it('switching GPS → MANUAL clears the coordinates and requires a zone and text (nothing is mixed)', async () => {
    const { service } = buildHarness();
    const a = await service.create('customer-1', gps());
    expect(codeOf(await service.update('customer-1', a.id, { mode: 'MANUAL', line1: 'x' } as any).catch((e) => e))).toBe('ADDRESS_ZONE_REQUIRED');
    expect(codeOf(await service.update('customer-1', a.id, { mode: 'MANUAL', deliveryZoneId: 'zone-1' } as any).catch((e) => e))).toBe('INVALID_DELIVERY_ADDRESS');
    const switched = await service.update('customer-1', a.id, { mode: 'MANUAL', deliveryZoneId: 'zone-1', line1: 'شارع جديد' } as any);
    expect(switched).toMatchObject({ mode: 'MANUAL', latitude: null, longitude: null, deliveryZoneId: 'zone-1', line1: 'شارع جديد' });
  });

  it('editing keeps the saved method: a GPS address cannot take a zone, a MANUAL address cannot take coordinates', async () => {
    const { service } = buildHarness();
    const g = await service.create('customer-1', gps());
    expect((await service.update('customer-1', g.id, { deliveryZoneId: 'zone-1' }).catch((e) => e)).getResponse().details.code).toBe('INVALID_DELIVERY_ADDRESS');
    await expect(service.update('customer-1', g.id, { latitude: 30.43, longitude: 31.57, label: 'Home' })).resolves.toMatchObject({ mode: 'GPS', latitude: 30.43, label: 'Home' });
    const m = await service.create('customer-1', manual());
    expect((await service.update('customer-1', m.id, { latitude: 30.4, longitude: 31.5 }).catch((e) => e)).getResponse().details.code).toBe('INVALID_DELIVERY_ADDRESS');
    await expect(service.update('customer-1', m.id, { line1: 'Edited' })).resolves.toMatchObject({ mode: 'MANUAL', line1: 'Edited' });
  });

  it('a legacy address (no mode) is untouched: same rules as before, mode stays null until the customer picks one', async () => {
    const { service } = buildHarness();
    const a = await service.create('customer-1', baseDto());
    expect(service.toView(a)).toMatchObject({ mode: null, zoneStatus: 'OK' });
  });

  it('capabilities: GPS is available only with Maps on, the Admin rate and minimum set, and a service area; manual needs an active zone', async () => {
    const h = buildHarness();
    expect(await h.service.capabilities()).toEqual({ manual: { available: true }, gps: { available: false, reason: 'PRICING_NOT_CONFIGURED' } });
    h.configValues.set('REGISTERED_VENDOR_PRICE_PER_100M_MINOR', 100);
    h.configValues.set('REGISTERED_VENDOR_MINIMUM_DELIVERY_FEE_MINOR', 1500);
    expect((await h.service.capabilities()).gps).toEqual({ available: true, reason: null });
    h.serviceAreasRepository.count.mockResolvedValueOnce(0);
    expect((await h.service.capabilities()).gps.reason).toBe('NO_SERVICE_AREA');
    (h.deliveryFee as any).roadDistancePricingAvailable = false;
    expect((await h.service.capabilities()).gps).toEqual({ available: false, reason: 'MAPS_DISABLED' });
  });
});

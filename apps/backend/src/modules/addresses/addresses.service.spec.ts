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
  const zonesRepository = { findOne: async (opts: any) => zones.get(opts.where.id) ?? null };

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

  const service = new AddressesService(repository as any, zonesRepository as any);
  return { service, addresses };
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

import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AddressesService } from './addresses.service';

function buildHarness(seed: { addresses?: any[] } = {}) {
  const addresses = new Map((seed.addresses ?? []).map((a) => [a.id, a]));

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

  const service = new AddressesService(repository as any);
  return { service, addresses };
}

function baseDto(overrides: Partial<any> = {}) {
  return { line1: '12 Market St', latitude: 30.123456, longitude: 31.654321, ...overrides };
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
      addresses: [{ id: 'a1', customerId: 'customer-1', line1: 'Old', latitude: 1, longitude: 1, isActive: true }],
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
    const a = await service.create('customer-1', baseDto({ governorate: 'الشرقية', city: 'بلبيس', street: 'شارع النصر', buildingNumber: '12', floor: '3', apartment: '7', landmark: 'بجوار المسجد', formattedAddress: 'assistive', label: 'Home' }));
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

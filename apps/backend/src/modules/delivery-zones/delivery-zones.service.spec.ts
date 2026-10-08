import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { randomUUID } from 'crypto';
import { DeliveryZonesService } from './delivery-zones.service';
import { AdminDeliveryZonesController } from './admin-delivery-zones.controller';
import { DeliveryZonesController } from './delivery-zones.controller';
import { REQUIRED_PERMISSIONS_KEY } from '../permissions/decorators/requires-permission.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Permission } from '../permissions/permission.enum';
import { Role } from '../../common/enums/role.enum';

function harness(seed: { zones?: any[]; areas?: any[]; uniqueViolation?: boolean } = {}) {
  const zones = new Map((seed.zones ?? []).map((z) => [z.id, z]));
  const areas = new Map((seed.areas ?? [{ id: 'area-1', isActive: true }]).map((a) => [a.id, a]));
  const zonesRepo = {
    create: (d: any) => ({ ...d }),
    save: jest.fn(async (z: any) => {
      if (seed.uniqueViolation) throw Object.assign(new QueryFailedError('INSERT', [], new Error('dup')), { code: '23505' });
      const row = { id: z.id ?? randomUUID(), ...z };
      zones.set(row.id, row);
      return row;
    }),
    findOne: async (o: any) => zones.get(o.where.id) ?? null,
    find: async () => [...zones.values()].filter((z) => z.isActive).map((z) => ({ ...z, serviceArea: areas.get(z.serviceAreaId) })),
  };
  const areasRepo = { findOne: async (o: any) => areas.get(o.where.id) ?? null };
  return { service: new DeliveryZonesService(zonesRepo as any, areasRepo as any), zones, zonesRepo };
}

const dto = (over: any = {}) => ({
  serviceAreaId: 'area-1',
  governorate: 'Sharqia',
  governorateAr: 'الشرقية',
  city: 'Belbeis',
  cityAr: 'بلبيس',
  name: ' Abu Naseeb ',
  nameAr: ' أبو نصيب ',
  deliveryFeeMinor: 1500,
  ...over,
});

describe('DeliveryZonesService', () => {
  it('creates an active zone with trimmed names and NO coordinates unless given (none are invented)', async () => {
    const z = await harness().service.create(dto());
    expect(z).toMatchObject({ name: 'Abu Naseeb', nameAr: 'أبو نصيب', isActive: true, displayOrder: 0, deliveryFeeMinor: 1500, representativeLatitude: null, representativeLongitude: null });
  });

  it('refuses an unknown service area, and half a representative point', async () => {
    await expect(harness().service.create(dto({ serviceAreaId: 'nope' }))).rejects.toMatchObject({ response: { details: { code: 'SERVICE_AREA_NOT_FOUND' } } });
    await expect(harness().service.create(dto({ representativeLatitude: 30.4 }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a duplicate name in the same service area is a 409, not a 500', async () => {
    await expect(harness({ uniqueViolation: true }).service.create(dto())).rejects.toBeInstanceOf(ConflictException);
  });

  it('update touches only provided fields; representative point can be set and removed (both null)', async () => {
    const h = harness({ zones: [{ id: 'z1', ...dto(), name: 'Abu Naseeb', displayOrder: 0, isActive: true, representativeLatitude: null, representativeLongitude: null }] });
    await h.service.update('z1', { displayOrder: 3, representativeLatitude: 30.42, representativeLongitude: 31.56 });
    expect(h.zones.get('z1')).toMatchObject({ displayOrder: 3, name: 'Abu Naseeb', representativeLatitude: 30.42, deliveryFeeMinor: 1500 });
    await h.service.update('z1', { representativeLatitude: null, representativeLongitude: null });
    expect(h.zones.get('z1')).toMatchObject({ representativeLatitude: null, representativeLongitude: null });
  });

  it('fee change and activation are separate operations; missing zone → 404', async () => {
    const h = harness({ zones: [{ id: 'z1', ...dto(), isActive: true }] });
    await h.service.updateFee('z1', 2500);
    await h.service.setActive('z1', false);
    expect(h.zones.get('z1')).toMatchObject({ deliveryFeeMinor: 2500, isActive: false });
    await expect(h.service.getOne('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('customers only ever see active zones of active service areas', async () => {
    const h = harness({
      areas: [{ id: 'area-1', isActive: true }, { id: 'area-2', isActive: false }],
      zones: [
        { id: 'a', ...dto(), isActive: true },
        { id: 'b', ...dto(), isActive: false },
        { id: 'c', ...dto({ serviceAreaId: 'area-2' }), isActive: true },
      ],
    });
    expect((await h.service.listActive()).map((z) => z.id)).toEqual(['a']);
  });
});

describe('Delivery Zone authorization metadata', () => {
  const perms = (handler: any) => Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler);
  const admin = AdminDeliveryZonesController.prototype;

  it('every admin route requires MANAGE_SERVICE_AREAS; anything that sets a PRICE also requires the delivery-pricing permission', () => {
    for (const h of [admin.list, admin.getOne, admin.update, admin.activate, admin.deactivate]) {
      expect(perms(h)).toEqual([Permission.MANAGE_SERVICE_AREAS]);
    }
    for (const h of [admin.create, admin.updateFee]) {
      expect(perms(h)).toEqual([Permission.MANAGE_SERVICE_AREAS, Permission.MANAGE_DELIVERY_FEE_MULTIPLIER]);
    }
  });

  it('the customer endpoint is read-only (GET only) and customer-role scoped — customers have no mutation route', () => {
    expect(Reflect.getMetadata(ROLES_KEY, DeliveryZonesController)).toEqual([Role.CUSTOMER]);
    const methods = Object.getOwnPropertyNames(DeliveryZonesController.prototype).filter((m) => m !== 'constructor');
    expect(methods).toEqual(['list']);
  });
});

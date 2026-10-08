import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AddressValidationService } from './address-validation.service';

const zoneRow = (over: any = {}) => ({
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
  serviceArea: { id: 'area-1', isActive: true },
  ...over,
});
const build = (opts: { area?: any; saved?: any; zones?: any[] } = {}) => {
  const repo = { findOne: jest.fn(async () => opts.saved ?? null) };
  const zones = new Map((opts.zones ?? [zoneRow()]).map((z) => [z.id, z]));
  const zoneRepo = { findOne: jest.fn(async (o: any) => zones.get(o.where.id) ?? null) };
  const resolver = { resolveForPoint: jest.fn(async () => ('area' in opts ? opts.area : { id: 'area-1' })) };
  return { service: new AddressValidationService(repo as any, zoneRepo as any, resolver as any), resolver };
};
const branch = (over: any = {}) => ({ id: 'b1', deliveryEnabled: true, serviceAreaId: 'area-1', ...over });
const inCairo = { line1: 'Street', latitude: 30.05, longitude: 31.24 };

describe('AddressValidationService.normalize', () => {
  it('trims, drops empty optional fields, and keeps the coordinates and every typed detail', () => {
    const { service } = build();
    expect(
      service.normalize({ ...inCairo, line1: '  12 Tahrir St  ', label: ' Home ', governorate: 'القاهرة', city: '', street: '  ', buildingNumber: '12', formattedAddress: 'assistive' }),
    ).toEqual({ line1: '12 Tahrir St', latitude: 30.05, longitude: 31.24, label: 'Home', governorate: 'القاهرة', buildingNumber: '12', formattedAddress: 'assistive' });
  });

  it.each([[''], ['   '], [undefined]])('rejects a missing / blank line1 (%p) with INVALID_DELIVERY_ADDRESS', (line1) => {
    expect(() => build().service.normalize({ ...inCairo, line1: line1 as never })).toThrow(BadRequestException);
  });

  it.each([[undefined, 31], [30, undefined], [NaN, 31]])('rejects half / NaN coordinates (%p, %p)', (latitude, longitude) => {
    expect(() => build().service.normalize({ line1: 'x', latitude: latitude as never, longitude: longitude as never })).toThrow(BadRequestException);
  });
});

describe('AddressValidationService.checkEligibility', () => {
  it('no address yet → ADDRESS_REQUIRED (nothing is invented)', async () => {
    const r = await build().service.checkEligibility(null, [branch()] as any);
    expect(r).toMatchObject({ serviceable: false, code: 'ADDRESS_REQUIRED' });
  });

  it('coordinates outside Egypt → INVALID_DELIVERY_LOCATION, without even asking the service-area resolver', async () => {
    const { service, resolver } = build();
    const r = await service.checkEligibility({ line1: 'x', latitude: 48.8, longitude: 2.3 }, [branch()] as any);
    expect(r.code).toBe('INVALID_DELIVERY_LOCATION');
    expect(resolver.resolveForPoint).not.toHaveBeenCalled();
  });

  it('outside every active service area → ADDRESS_OUT_OF_SERVICE_AREA for every vendor', async () => {
    const r = await build({ area: null }).service.checkEligibility(inCairo, [branch(), branch({ id: 'b2' })] as any);
    expect(r).toMatchObject({ serviceable: false, code: 'ADDRESS_OUT_OF_SERVICE_AREA' });
    expect(r.vendors.every((v) => !v.deliverable)).toBe(true);
  });

  it('serviceable when every vendor delivers and belongs to the point\'s area (or has no area configured)', async () => {
    const r = await build().service.checkEligibility(inCairo, [branch(), branch({ id: 'b2', serviceAreaId: null }), branch({ id: 'b3', deliveryEnabled: undefined })] as any);
    expect(r).toMatchObject({ serviceable: true, serviceAreaId: 'area-1' });
    expect(r.vendors.every((v) => v.deliverable)).toBe(true);
  });

  it('one vendor with delivery disabled, or in another area, blocks the whole address and says which', async () => {
    const off = await build().service.checkEligibility(inCairo, [branch(), branch({ id: 'b2', deliveryEnabled: false })] as any);
    expect(off).toMatchObject({ serviceable: false, code: 'VENDOR_DOES_NOT_DELIVER' });
    expect(off.vendors.find((v) => v.vendorBranchId === 'b2')).toMatchObject({ deliverable: false });
    expect(off.vendors.find((v) => v.vendorBranchId === 'b1')).toMatchObject({ deliverable: true });

    const other = await build().service.checkEligibility(inCairo, [branch({ serviceAreaId: 'area-9' })] as any);
    expect(other).toMatchObject({ serviceable: false, code: 'VENDOR_OUTSIDE_DELIVERY_AREA' });
  });
});

describe('AddressValidationService.resolveSavedAddress', () => {
  const saved = { id: 'a1', customerId: 'cust-1', isActive: true, line1: 'Saved 1', latitude: 30.05, longitude: 31.24, label: 'Home', governorate: 'الشرقية', floor: null };

  it("returns the caller's own active address as an order-ready snapshot (nulls dropped)", async () => {
    const r = await build({ saved }).service.resolveSavedAddress('cust-1', 'a1');
    expect(r).toEqual({ line1: 'Saved 1', latitude: 30.05, longitude: 31.24, label: 'Home', governorate: 'الشرقية' });
  });

  it("someone else's, a deactivated, or a missing address is ADDRESS_NOT_FOUND (404) — indistinguishable", async () => {
    for (const s of [{ ...saved, customerId: 'other' }, { ...saved, isActive: false }, null]) {
      await expect(build({ saved: s }).service.resolveSavedAddress('cust-1', 'a1')).rejects.toBeInstanceOf(NotFoundException);
    }
  });
});

describe('AddressValidationService — Delivery Zones (PD-009)', () => {
  const zoneOnly = { line1: 'شارع أبو نصيب جنب جامع الكردي، منزل 15', deliveryZoneId: 'zone-1' };

  it('normalize accepts an address with NO map pin (the zone locates it) and keeps the zone id', () => {
    expect(build().service.normalize(zoneOnly)).toEqual(zoneOnly);
  });

  it('no pin + an ACTIVE zone → serviceable through the zone, priced by the zone; the radius resolver is never asked', async () => {
    const { service, resolver } = build();
    const r = await service.checkEligibility(zoneOnly, [branch()] as any);
    expect(r).toMatchObject({ serviceable: true, pricingSource: 'DELIVERY_ZONE', serviceAreaId: 'area-1', deliveryZone: { id: 'zone-1', nameAr: 'أبو نصيب', deliveryFeeMinor: 1500 } });
    expect(resolver.resolveForPoint).not.toHaveBeenCalled();
  });

  it('no pin and no zone → ADDRESS_ZONE_REQUIRED (a legacy address is never guessed into a zone)', async () => {
    const r = await build().service.checkEligibility({ line1: 'x' }, [branch()] as any);
    expect(r).toMatchObject({ serviceable: false, code: 'ADDRESS_ZONE_REQUIRED', pricingSource: null });
  });

  it.each([
    ['inactive', zoneRow({ isActive: false })],
    ['in an inactive service area', zoneRow({ serviceArea: { id: 'area-1', isActive: false } })],
  ])('a zone that is %s → DELIVERY_ZONE_UNAVAILABLE, even when the address has a pin (no fallback)', async (_, z) => {
    for (const address of [zoneOnly, { ...inCairo, deliveryZoneId: 'zone-1' }]) {
      const r = await build({ zones: [z] }).service.checkEligibility(address, [branch()] as any);
      expect(r).toMatchObject({ serviceable: false, code: 'DELIVERY_ZONE_UNAVAILABLE' });
    }
  });

  it('an unknown zone id → DELIVERY_ZONE_UNAVAILABLE', async () => {
    const r = await build({ zones: [] }).service.checkEligibility(zoneOnly, [] as any);
    expect(r.code).toBe('DELIVERY_ZONE_UNAVAILABLE');
  });

  it('WITH a pin, the existing radius rule and distance pricing stay authoritative (zone only adds names)', async () => {
    const outside = await build({ area: null }).service.checkEligibility({ ...inCairo, deliveryZoneId: 'zone-1' }, [branch()] as any);
    expect(outside.code).toBe('ADDRESS_OUT_OF_SERVICE_AREA');
    const inside = await build().service.checkEligibility({ ...inCairo, deliveryZoneId: 'zone-1' }, [branch()] as any);
    expect(inside).toMatchObject({ serviceable: true, pricingSource: 'DISTANCE', deliveryZone: { id: 'zone-1' } });
  });

  it("a zone's service area restricts branches exactly like a pin's area does", async () => {
    const r = await build().service.checkEligibility(zoneOnly, [branch({ serviceAreaId: 'area-9' })] as any);
    expect(r).toMatchObject({ serviceable: false, code: 'VENDOR_OUTSIDE_DELIVERY_AREA' });
  });

  it('a Hatly Service address (no branches) uses the same rules', async () => {
    await expect(build().service.checkEligibility(zoneOnly, [])).resolves.toMatchObject({ serviceable: true, pricingSource: 'DELIVERY_ZONE' });
  });

  it('resolveSavedAddress carries the zone and omits a missing pin', async () => {
    const saved = { id: 'a1', customerId: 'cust-1', isActive: true, line1: 'Saved', latitude: null, longitude: null, deliveryZoneId: 'zone-1' };
    await expect(build({ saved }).service.resolveSavedAddress('cust-1', 'a1')).resolves.toEqual({ line1: 'Saved', deliveryZoneId: 'zone-1' });
  });
});

describe('AddressValidationService — zone-authoritative (Hatly Service, PD-009 amended)', () => {
  const zoneOnly = { line1: 'شارع أبو نصيب', deliveryZoneId: 'zone-1' };
  const opts = { zoneAuthoritative: true };

  it('pin + active zone → serviceable by the ZONE; the radius resolver is never consulted (even if the pin is outside every area)', async () => {
    const { service, resolver } = build({ area: null });
    const r = await service.checkEligibility({ ...inCairo, deliveryZoneId: 'zone-1' }, [], opts);
    expect(r).toMatchObject({ serviceable: true, pricingSource: 'DELIVERY_ZONE', serviceAreaId: 'area-1', deliveryZone: { id: 'zone-1' } });
    expect(resolver.resolveForPoint).not.toHaveBeenCalled();
  });

  it('pin-less + active zone → identical result to the pinned address', async () => {
    const pinned = await build().service.checkEligibility({ ...inCairo, deliveryZoneId: 'zone-1' }, [], opts);
    const pinless = await build().service.checkEligibility(zoneOnly, [], opts);
    expect(pinless).toEqual(pinned);
  });

  it('a pinned address WITHOUT a zone is not serviceable (ADDRESS_ZONE_REQUIRED) — no radius fallback', async () => {
    const { service, resolver } = build();
    expect(await service.checkEligibility(inCairo, [], opts)).toMatchObject({ serviceable: false, code: 'ADDRESS_ZONE_REQUIRED' });
    expect(resolver.resolveForPoint).not.toHaveBeenCalled();
  });

  it('an inactive zone → DELIVERY_ZONE_UNAVAILABLE; a nonsense pin is still refused as invalid', async () => {
    expect((await build({ zones: [zoneRow({ isActive: false })] }).service.checkEligibility(zoneOnly, [], opts)).code).toBe('DELIVERY_ZONE_UNAVAILABLE');
    expect((await build().service.checkEligibility({ line1: 'x', latitude: 48.8, longitude: 2.3, deliveryZoneId: 'zone-1' }, [], opts)).code).toBe('INVALID_DELIVERY_LOCATION');
  });
});

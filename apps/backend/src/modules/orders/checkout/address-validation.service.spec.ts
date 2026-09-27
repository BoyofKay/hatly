import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AddressValidationService } from './address-validation.service';

const build = (opts: { area?: any; saved?: any } = {}) => {
  const repo = { findOne: jest.fn(async () => opts.saved ?? null) };
  const resolver = { resolveForPoint: jest.fn(async () => ('area' in opts ? opts.area : { id: 'area-1' })) };
  return { service: new AddressValidationService(repo as any, resolver as any), resolver };
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

  it.each([[undefined, 31], [30, undefined], [NaN, 31]])('rejects missing / NaN coordinates (%p, %p)', (latitude, longitude) => {
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

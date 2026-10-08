import { DeliveryZone } from '../modules/delivery-zones/entities/delivery-zone.entity';
import { ServiceArea } from '../modules/service-areas/entities/service-area.entity';
import { BusinessConfig } from '../modules/business-config/entities/business-config.entity';
import { DEFAULT_BELBEIS_OPTIONS, DEFAULT_BELBEIS_ZONES, parseZoneDefinitions, seedDeliveryZones } from './delivery-zones-seed';

function fakeManager(opts: { area?: boolean; minimumFee?: unknown } = {}) {
  const zones: any[] = [];
  const repos = new Map<any, any>([
    [ServiceArea, { findOne: async () => (opts.area === false ? null : { id: 'area-1', name: 'Belbeis' }) }],
    [BusinessConfig, { findOne: async () => ('minimumFee' in opts ? (opts.minimumFee === undefined ? null : { value: opts.minimumFee }) : { value: 1500 }) }],
    [
      DeliveryZone,
      {
        findOne: async ({ where }: any) => zones.find((z) => z.serviceAreaId === where.serviceAreaId && z.nameAr === where.nameAr) ?? null,
        create: (d: any) => ({ ...d }),
        save: async (z: any) => (zones.push(z), z),
      },
    ],
  ]);
  return { manager: { getRepository: (e: any) => repos.get(e) } as any, zones };
}

describe('dev Delivery Zones seed', () => {
  it('seeds Abu Naseeb / أبو نصيب in Belbeis with the CONFIGURED minimum fee and no coordinates', async () => {
    const { manager, zones } = fakeManager();
    const r = await seedDeliveryZones(manager, DEFAULT_BELBEIS_ZONES, DEFAULT_BELBEIS_OPTIONS);
    expect(r).toEqual({ created: ['أبو نصيب'], existing: [] });
    expect(zones[0]).toMatchObject({ name: 'Abu Naseeb', nameAr: 'أبو نصيب', cityAr: 'بلبيس', governorateAr: 'الشرقية', deliveryFeeMinor: 1500, representativeLatitude: null, representativeLongitude: null, isActive: true });
  });

  it('is idempotent: a second run creates nothing and leaves the existing zone untouched', async () => {
    const { manager, zones } = fakeManager();
    await seedDeliveryZones(manager, DEFAULT_BELBEIS_ZONES, DEFAULT_BELBEIS_OPTIONS);
    zones[0].deliveryFeeMinor = 2222; // e.g. an admin changed it
    const second = await seedDeliveryZones(manager, DEFAULT_BELBEIS_ZONES, DEFAULT_BELBEIS_OPTIONS);
    expect(second).toEqual({ created: [], existing: ['أبو نصيب'] });
    expect(zones).toHaveLength(1);
    expect(zones[0].deliveryFeeMinor).toBe(2222);
  });

  it('refuses to invent a fee (no override and no configured minimum) and refuses without the service area', async () => {
    await expect(seedDeliveryZones(fakeManager({ minimumFee: undefined }).manager, DEFAULT_BELBEIS_ZONES, DEFAULT_BELBEIS_OPTIONS)).rejects.toThrow(/No fee is invented/);
    await expect(seedDeliveryZones(fakeManager({ area: false }).manager, DEFAULT_BELBEIS_ZONES, DEFAULT_BELBEIS_OPTIONS)).rejects.toThrow(/seed:dev-marketplace/);
  });

  it('an explicit fee override wins; definitions with coordinates or bad values are rejected', async () => {
    const { manager, zones } = fakeManager();
    await seedDeliveryZones(manager, DEFAULT_BELBEIS_ZONES, { ...DEFAULT_BELBEIS_OPTIONS, defaultFeeMinor: 2000 });
    expect(zones[0].deliveryFeeMinor).toBe(2000);
    expect(() => parseZoneDefinitions([{ name: 'X', nameAr: 'س', latitude: 30 }])).toThrow(/never seeds coordinates/);
    expect(() => parseZoneDefinitions([{ name: 'X' }])).toThrow();
    expect(() => parseZoneDefinitions([])).toThrow();
    expect(parseZoneDefinitions([{ name: ' X ', nameAr: ' س ', deliveryFeeMinor: 0 }])).toEqual([{ name: 'X', nameAr: 'س', deliveryFeeMinor: 0, displayOrder: undefined }]);
  });
});

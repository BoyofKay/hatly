import { EntityManager } from 'typeorm';
import { DeliveryZone } from '../modules/delivery-zones/entities/delivery-zone.entity';
import { ServiceArea } from '../modules/service-areas/entities/service-area.entity';
import { BusinessConfig } from '../modules/business-config/entities/business-config.entity';
import { BusinessConfigKey } from '../modules/business-config/business-config-key.enum';

/**
 * One zone to seed. Names only — NO coordinates are ever seeded (a representative point is optional metadata an admin may add
 * once it is known; inventing one would look authoritative). `deliveryFeeMinor` is optional: without it the configured
 * REGISTERED_VENDOR_MINIMUM_DELIVERY_FEE_MINOR is used — an existing business value, not a number invented here.
 */
export interface DeliveryZoneSeedDefinition {
  name: string;
  nameAr: string;
  displayOrder?: number;
  deliveryFeeMinor?: number;
}

export interface DeliveryZoneSeedOptions {
  serviceAreaName: string;
  governorate: string;
  governorateAr: string;
  city: string;
  cityAr: string;
  /** Overrides the configured minimum for every definition that does not carry its own fee. */
  defaultFeeMinor?: number;
}

/**
 * The only Belbeis area name that is verified for this project (provided explicitly by the product owner). Further areas are
 * added through the Admin Dashboard or a DEV_DELIVERY_ZONES_FILE — names are never guessed here.
 */
export const DEFAULT_BELBEIS_ZONES: DeliveryZoneSeedDefinition[] = [{ name: 'Abu Naseeb', nameAr: 'أبو نصيب', displayOrder: 1 }];

export const DEFAULT_BELBEIS_OPTIONS: DeliveryZoneSeedOptions = {
  serviceAreaName: 'Belbeis',
  governorate: 'Sharqia',
  governorateAr: 'الشرقية',
  city: 'Belbeis',
  cityAr: 'بلبيس',
};

export function parseZoneDefinitions(raw: unknown): DeliveryZoneSeedDefinition[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('Zone definitions must be a non-empty JSON array.');
  return raw.map((d, i) => {
    const ok =
      d &&
      typeof d.name === 'string' && d.name.trim() &&
      typeof d.nameAr === 'string' && d.nameAr.trim() &&
      (d.displayOrder === undefined || (Number.isInteger(d.displayOrder) && d.displayOrder >= 0)) &&
      (d.deliveryFeeMinor === undefined || (Number.isInteger(d.deliveryFeeMinor) && d.deliveryFeeMinor >= 0));
    if (!ok) throw new Error(`Zone definition #${i + 1} is invalid (needs name, nameAr; optional integer displayOrder/deliveryFeeMinor ≥ 0).`);
    if ('latitude' in d || 'longitude' in d || 'representativeLatitude' in d) {
      throw new Error(`Zone definition #${i + 1} carries coordinates — the dev seed never seeds coordinates.`);
    }
    return { name: d.name.trim(), nameAr: d.nameAr.trim(), displayOrder: d.displayOrder, deliveryFeeMinor: d.deliveryFeeMinor };
  });
}

/**
 * Idempotent: a zone is found by (service area, Arabic name) before being created; an existing zone is left EXACTLY as it is
 * (an admin may have changed its fee/name/state since). Never deletes or deactivates anything.
 */
export async function seedDeliveryZones(
  manager: EntityManager,
  definitions: DeliveryZoneSeedDefinition[],
  options: DeliveryZoneSeedOptions,
): Promise<{ created: string[]; existing: string[] }> {
  const area = await manager.getRepository(ServiceArea).findOne({ where: { name: options.serviceAreaName } });
  if (!area) {
    throw new Error(`Service area "${options.serviceAreaName}" not found — run "npm run seed:dev-marketplace" first (it creates it).`);
  }

  let fallbackFee = options.defaultFeeMinor;
  if (fallbackFee === undefined && definitions.some((d) => d.deliveryFeeMinor === undefined)) {
    const row = await manager.getRepository(BusinessConfig).findOne({ where: { key: BusinessConfigKey.REGISTERED_VENDOR_MINIMUM_DELIVERY_FEE_MINOR } });
    if (!row || !Number.isInteger(row.value) || (row.value as number) < 0) {
      throw new Error(
        'No zone fee given and REGISTERED_VENDOR_MINIMUM_DELIVERY_FEE_MINOR is not configured — set DEV_DELIVERY_ZONE_FEE_MINOR, ' +
          'a deliveryFeeMinor per zone, or configure the minimum delivery fee first. No fee is invented.',
      );
    }
    fallbackFee = row.value as number;
  }

  const repo = manager.getRepository(DeliveryZone);
  const created: string[] = [];
  const existing: string[] = [];
  for (const def of definitions) {
    const found = await repo.findOne({ where: { serviceAreaId: area.id, nameAr: def.nameAr } });
    if (found) {
      existing.push(def.nameAr);
      continue;
    }
    await repo.save(
      repo.create({
        serviceAreaId: area.id,
        governorate: options.governorate,
        governorateAr: options.governorateAr,
        city: options.city,
        cityAr: options.cityAr,
        name: def.name,
        nameAr: def.nameAr,
        deliveryFeeMinor: def.deliveryFeeMinor ?? fallbackFee!,
        displayOrder: def.displayOrder ?? 0,
        isActive: true,
        representativeLatitude: null,
        representativeLongitude: null,
      }),
    );
    created.push(def.nameAr);
  }
  return { created, existing };
}

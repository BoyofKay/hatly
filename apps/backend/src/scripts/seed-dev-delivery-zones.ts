import { readFileSync } from 'fs';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../database/data-source';
import { DEFAULT_BELBEIS_OPTIONS, DEFAULT_BELBEIS_ZONES, parseZoneDefinitions, seedDeliveryZones } from './delivery-zones-seed';

/**
 * DEVELOPMENT-ONLY Delivery Zones seed (PD-009). Run via: `npm run seed:dev-delivery-zones`
 *
 * SAFETY: refuses to run against anything but a database literally named `hatly_dev` (checked on the live connection, same
 * convention as seed-dev-marketplace.ts). Idempotent and additive — see `seedDeliveryZones`.
 *
 * Configuration (all optional):
 *   DEV_DELIVERY_ZONES_FILE      JSON array of { name, nameAr, displayOrder?, deliveryFeeMinor? } (default: Abu Naseeb / أبو نصيب)
 *   DEV_DELIVERY_ZONE_FEE_MINOR  fee for zones without their own (default: the configured REGISTERED_VENDOR_MINIMUM_DELIVERY_FEE_MINOR)
 */
async function assertDevDatabase(dataSource: DataSource): Promise<void> {
  const rows: Array<{ current_database: string }> = await dataSource.query('SELECT current_database()');
  const name = rows[0]?.current_database;
  if (name !== 'hatly_dev') {
    throw new Error(`Refusing to seed: connected database is "${name}", not "hatly_dev". This script must only ever run against the development database.`);
  }
  console.log(`Connected database verified: "${name}" (development only).`);
}

async function main(): Promise<void> {
  const file = process.env.DEV_DELIVERY_ZONES_FILE;
  const definitions = file ? parseZoneDefinitions(JSON.parse(readFileSync(file, 'utf8'))) : DEFAULT_BELBEIS_ZONES;
  const feeEnv = process.env.DEV_DELIVERY_ZONE_FEE_MINOR;
  const defaultFeeMinor = feeEnv === undefined || feeEnv === '' ? undefined : Number(feeEnv);
  if (defaultFeeMinor !== undefined && (!Number.isInteger(defaultFeeMinor) || defaultFeeMinor < 0)) {
    throw new Error('DEV_DELIVERY_ZONE_FEE_MINOR must be a non-negative integer (minor units).');
  }

  await AppDataSource.initialize();
  try {
    await assertDevDatabase(AppDataSource);
    const result = await AppDataSource.transaction((manager) =>
      seedDeliveryZones(manager, definitions, { ...DEFAULT_BELBEIS_OPTIONS, defaultFeeMinor }),
    );
    console.log(`Delivery zones created: ${result.created.length ? result.created.join(', ') : '(none)'}`);
    console.log(`Already present (left unchanged): ${result.existing.length ? result.existing.join(', ') : '(none)'}`);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error('Dev delivery-zones seed failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

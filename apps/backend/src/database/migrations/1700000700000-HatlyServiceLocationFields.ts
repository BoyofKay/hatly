import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hatly Service default-location feature. Adds the service-type +
 * optional customer-supplied coordinate fields to `cart_vendor_groups`
 * and their frozen snapshot counterparts to `order_vendor_segments`.
 *
 * Deliberately does NOT seed HATLY_SERVICE_DEFAULT_PICKUP_LOCATION or
 * HATLY_SERVICE_DEFAULT_DESTINATION_LOCATION in `business_config` —
 * the real office/default coordinates were never supplied and must
 * not be invented (same discipline as the registered-vendor pricing
 * parameters, migration 1700000600000). Both keys simply don't exist
 * until an authorized Admin/Super Admin sets them; until then,
 * OrderCreationService.resolveAdHocLocations() fails closed via
 * BusinessConfigService.getRequired() whenever a default is actually
 * needed.
 */
export class HatlyServiceLocationFields1700000700000 implements MigrationInterface {
  name = 'HatlyServiceLocationFields1700000700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "cart_vendor_groups" ADD COLUMN "ad_hoc_service_type" varchar(20);
      ALTER TABLE "cart_vendor_groups" ADD COLUMN "ad_hoc_pickup_latitude" double precision;
      ALTER TABLE "cart_vendor_groups" ADD COLUMN "ad_hoc_pickup_longitude" double precision;
      ALTER TABLE "cart_vendor_groups" ADD COLUMN "ad_hoc_destination_latitude" double precision;
      ALTER TABLE "cart_vendor_groups" ADD COLUMN "ad_hoc_destination_longitude" double precision;
    `);

    await queryRunner.query(`
      ALTER TABLE "order_vendor_segments" ADD COLUMN "ad_hoc_service_type_snapshot" varchar(20);
      ALTER TABLE "order_vendor_segments" ADD COLUMN "ad_hoc_pickup_latitude_snapshot" double precision;
      ALTER TABLE "order_vendor_segments" ADD COLUMN "ad_hoc_pickup_longitude_snapshot" double precision;
      ALTER TABLE "order_vendor_segments" ADD COLUMN "ad_hoc_destination_latitude_snapshot" double precision;
      ALTER TABLE "order_vendor_segments" ADD COLUMN "ad_hoc_destination_longitude_snapshot" double precision;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_vendor_segments" DROP COLUMN IF EXISTS "ad_hoc_destination_longitude_snapshot";
      ALTER TABLE "order_vendor_segments" DROP COLUMN IF EXISTS "ad_hoc_destination_latitude_snapshot";
      ALTER TABLE "order_vendor_segments" DROP COLUMN IF EXISTS "ad_hoc_pickup_longitude_snapshot";
      ALTER TABLE "order_vendor_segments" DROP COLUMN IF EXISTS "ad_hoc_pickup_latitude_snapshot";
      ALTER TABLE "order_vendor_segments" DROP COLUMN IF EXISTS "ad_hoc_service_type_snapshot";
    `);

    await queryRunner.query(`
      ALTER TABLE "cart_vendor_groups" DROP COLUMN IF EXISTS "ad_hoc_destination_longitude";
      ALTER TABLE "cart_vendor_groups" DROP COLUMN IF EXISTS "ad_hoc_destination_latitude";
      ALTER TABLE "cart_vendor_groups" DROP COLUMN IF EXISTS "ad_hoc_pickup_longitude";
      ALTER TABLE "cart_vendor_groups" DROP COLUMN IF EXISTS "ad_hoc_pickup_latitude";
      ALTER TABLE "cart_vendor_groups" DROP COLUMN IF EXISTS "ad_hoc_service_type";
    `);
  }
}

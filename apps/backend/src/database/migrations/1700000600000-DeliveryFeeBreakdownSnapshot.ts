import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 3 delivery-fee feature: adds the frozen pricing-route
 * breakdown snapshot column to `orders`. Deliberately does NOT seed
 * any BusinessConfig rows for the three new pricing keys
 * (REGISTERED_VENDOR_PRICE_PER_100M_MINOR,
 * REGISTERED_VENDOR_MINIMUM_DELIVERY_FEE_MINOR,
 * REGISTERED_VENDOR_ADDITIONAL_VENDOR_FEE_MINOR) — unlike
 * AUTOMATIC_DISPATCH_ENABLED/MULTI_VENDOR_ORDERS_ENABLED (Steps 2/4),
 * which had reasonable operational defaults, there is no non-invented
 * default for a raw money parameter. These three keys simply do not
 * exist until an authorized Admin/Super Admin sets them via the
 * existing BusinessConfig endpoints; until then,
 * DeliveryFeeCalculationService fails closed via
 * BusinessConfigService.getRequired().
 */
export class DeliveryFeeBreakdownSnapshot1700000600000 implements MigrationInterface {
  name = 'DeliveryFeeBreakdownSnapshot1700000600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders" ADD COLUMN "delivery_fee_breakdown_snapshot" jsonb;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders" DROP COLUMN IF EXISTS "delivery_fee_breakdown_snapshot";
    `);
  }
}

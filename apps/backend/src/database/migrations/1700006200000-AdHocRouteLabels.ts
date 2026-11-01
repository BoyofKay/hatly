import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hatly / Wasally route endpoints (PD-012): a customer-chosen origin or destination now carries a short display label (what the
 * customer sees on the review and checkout screens). ADDITIVE and reversible — two NULLABLE columns; every existing cart group keeps
 * NULL labels and every order is untouched (the order keeps its own frozen route snapshot).
 */
export class AdHocRouteLabels1700006200000 implements MigrationInterface {
  name = 'AdHocRouteLabels1700006200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "cart_vendor_groups"
        ADD COLUMN "ad_hoc_pickup_label" varchar(120),
        ADD COLUMN "ad_hoc_destination_label" varchar(120);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "cart_vendor_groups"
        DROP COLUMN IF EXISTS "ad_hoc_destination_label",
        DROP COLUMN IF EXISTS "ad_hoc_pickup_label";
    `);
  }
}

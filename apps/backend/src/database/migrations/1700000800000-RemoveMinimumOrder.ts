import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CONFIRMED BUSINESS DECISION: Hatly has no minimum-order requirement.
 * Removes `vendor_branches.minimum_order_minor` entirely — not a
 * validation relaxation, the column itself is gone. Does NOT modify
 * the original `1700000000000-InitialSchema` migration that created
 * this column — past migrations are never edited, only reversed by a
 * new one, per project convention.
 *
 * No other column/table is touched by this migration. Multi-Vendor
 * schema (cart_vendor_groups, order_vendor_segments, the 3-group cap,
 * MULTI_VENDOR_ORDERS_ENABLED, etc.) is entirely unaffected — this
 * migration's only concern is the minimum-order column.
 */
export class RemoveMinimumOrder1700000800000 implements MigrationInterface {
  name = 'RemoveMinimumOrder1700000800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "vendor_branches" DROP COLUMN IF EXISTS "minimum_order_minor";
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restores the column shape only (default 0, matching its original
    // definition) — no data to restore, since dropping it destroys any
    // prior values. Consistent with every other migration's down() in
    // this project: structural reversibility, not data preservation.
    await queryRunner.query(`
      ALTER TABLE "vendor_branches" ADD COLUMN "minimum_order_minor" bigint NOT NULL DEFAULT 0;
    `);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase G — Customer Order History & Order Details, decision B.
 * CONFIRMED: OrderItem must preserve the historical product image at
 * order-creation time, following the exact same principle already
 * applied to `product_name_snapshot`/`unit_price_minor` — a later
 * catalog image change, or the Product being soft-deleted, must never
 * retroactively change what a historical order shows. Nullable, same
 * as `product_name_snapshot`: null for an AD_HOC_SERVICE item (no
 * catalog Product at all) and for any historical PIECE/WEIGHT catalog
 * item whose source Product simply had no image set at order time —
 * never a fabricated placeholder.
 */
export class OrderItemImageSnapshot1700001600000 implements MigrationInterface {
  name = 'OrderItemImageSnapshot1700001600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_items" ADD COLUMN "product_image_url_snapshot" varchar;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_items" DROP COLUMN IF EXISTS "product_image_url_snapshot";
    `);
  }
}

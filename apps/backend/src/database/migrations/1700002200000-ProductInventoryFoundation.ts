import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chunk 12A — Inventory Foundation. CONFIRMED business decisions (do
 * not reopen): every existing row becomes `inventory_mode = 'OPEN'`,
 * `quantity = NULL` — preserving every existing product's current
 * behavior exactly (no product becomes unavailable, no quantity is
 * fabricated). Purely additive: two new nullable-or-defaulted
 * columns, no existing column touched, no destructive change.
 */
export class ProductInventoryFoundation1700002200000 implements MigrationInterface {
  name = 'ProductInventoryFoundation1700002200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
        ADD COLUMN "inventory_mode" varchar(10) NOT NULL DEFAULT 'OPEN',
        ADD COLUMN "quantity" integer;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
        DROP COLUMN IF EXISTS "quantity",
        DROP COLUMN IF EXISTS "inventory_mode";
    `);
  }
}

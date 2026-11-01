import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Explicit minimum / maximum selections for a product option group (e.g. "choose 2 to 4 toppings"). ADDITIVE and reversible.
 *
 * `min_selections` NOT NULL DEFAULT 0 and `max_selections` NULL (no cap): every existing group keeps EXACTLY its old behaviour, because
 * the effective rule is derived from the old flags too —
 *   effective min = max(min_selections, is_required ? 1 : 0)
 *   effective max = allows_multiple ? max_selections (null = no cap) : 1
 * so `is_required` / `allows_multiple` stay authoritative for every row written before this migration.
 */
export class ProductOptionSelectionLimits1700005600000 implements MigrationInterface {
  name = 'ProductOptionSelectionLimits1700005600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "product_options"
        ADD COLUMN "min_selections" integer NOT NULL DEFAULT 0,
        ADD COLUMN "max_selections" integer,
        ADD CONSTRAINT "chk_product_options_selection_limits" CHECK (
          "min_selections" >= 0 AND ("max_selections" IS NULL OR "max_selections" >= GREATEST("min_selections", 1))
        );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "product_options"
        DROP CONSTRAINT "chk_product_options_selection_limits",
        DROP COLUMN "max_selections",
        DROP COLUMN "min_selections";
    `);
  }
}

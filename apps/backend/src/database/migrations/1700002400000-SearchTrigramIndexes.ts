import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Customer Search — OPTIONAL performance migration. Confirmed by
 * inspection: no pg_trgm/text-search index exists anywhere in this
 * schema before this. Not required to launch (ILIKE alone is
 * sufficient at Belbeis scale, per the approved design) — recommended
 * because Search is genuinely cross-sector/cross-branch, unlike the
 * existing narrowly-scoped ILIKE queries this reuses. Purely additive:
 * an extension + four indexes, no existing column/table touched.
 */
export class SearchTrigramIndexes1700002400000 implements MigrationInterface {
  name = 'SearchTrigramIndexes1700002400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_vendors_name_trgm" ON "vendors" USING GIN ("name" gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS "idx_vendors_name_ar_trgm" ON "vendors" USING GIN ("name_ar" gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS "idx_products_name_trgm" ON "products" USING GIN ("name" gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS "idx_products_name_ar_trgm" ON "products" USING GIN ("name_ar" gin_trgm_ops);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_products_name_ar_trgm";
      DROP INDEX IF EXISTS "idx_products_name_trgm";
      DROP INDEX IF EXISTS "idx_vendors_name_ar_trgm";
      DROP INDEX IF EXISTS "idx_vendors_name_trgm";
    `);
  }
}

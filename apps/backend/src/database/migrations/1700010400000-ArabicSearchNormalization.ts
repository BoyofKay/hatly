import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Owner decision 2026-11-28: search matches Arabic spelling variants — أ إ آ ٱ → ا, ى → ي, ة → ه, ؤ → و, ئ → ي, diacritics and tatweel
 * removed, Arabic-Indic digits → 0-9, lower-cased. One IMMUTABLE function used by the queries and by trigram indexes on it, so the
 * normalized search stays index-backed under load. Additive (the existing trigram indexes stay for other searches).
 */
export class ArabicSearchNormalization1700010400000 implements MigrationInterface {
  name = 'ArabicSearchNormalization1700010400000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await q.query(`
      CREATE OR REPLACE FUNCTION hatly_norm(t text) RETURNS text
      LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
        SELECT translate(
          regexp_replace(lower(coalesce(t, '')), '[\\u064B-\\u0652\\u0670\\u0640]', '', 'g'),
          'أإآٱىةؤئ٠١٢٣٤٥٦٧٨٩',
          'اااايهوي0123456789'
        )
      $fn$`);
    for (const [table, col] of [['vendors', 'name'], ['vendors', 'name_ar'], ['products', 'name'], ['products', 'name_ar'], ['catalog_products', 'name'], ['catalog_products', 'name_ar']]) {
      await q.query(`CREATE INDEX IF NOT EXISTS "idx_${table}_${col}_norm_trgm" ON "${table}" USING GIN (hatly_norm("${col}") gin_trgm_ops)`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const [table, col] of [['vendors', 'name'], ['vendors', 'name_ar'], ['products', 'name'], ['products', 'name_ar'], ['catalog_products', 'name'], ['catalog_products', 'name_ar']]) {
      await q.query(`DROP INDEX IF EXISTS "idx_${table}_${col}_norm_trgm"`);
    }
    await q.query(`DROP FUNCTION IF EXISTS hatly_norm(text)`);
  }
}

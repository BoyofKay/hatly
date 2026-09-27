import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Offers Final System — Flash Sale cancellation reversal (FINAL
 * approved rule). Additive to `offer_consumptions` — no existing
 * column touched, no existing row destroyed, no historical record
 * ever deleted. `isReversed`/`reversedAt` are the explicit reversal
 * mechanism: a cancelled Order's FLASH_SALE consumption rows are
 * FLAGGED, never removed, preserving the full audit trail exactly as
 * required. Default `false` for every existing row — CONFIRMED safe,
 * no real rows exist in this environment to backfill in practice, and
 * `false` is the only correct default regardless ("not reversed unless
 * explicitly reversed").
 */
export class OfferConsumptionReversal1700002700000 implements MigrationInterface {
  name = 'OfferConsumptionReversal1700002700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "offer_consumptions" ADD COLUMN "is_reversed" boolean NOT NULL DEFAULT false;
      ALTER TABLE "offer_consumptions" ADD COLUMN "reversed_at" timestamptz;

      CREATE INDEX "idx_offer_consumptions_is_reversed" ON "offer_consumptions" ("is_reversed");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_offer_consumptions_is_reversed";
      ALTER TABLE "offer_consumptions" DROP COLUMN IF EXISTS "reversed_at";
      ALTER TABLE "offer_consumptions" DROP COLUMN IF EXISTS "is_reversed";
    `);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Owner decision 2026-11-13: a delivery photo is OPTIONAL. A driver may mark an order delivered without one.
 * Every delivery still records its proof-of-delivery row (driver, time, optional recipient name) — only the photo may be absent.
 * Additive and backward compatible: existing rows keep their photo; old apps that always send a photo keep working.
 * Rollback: `down` restores NOT NULL and fails safely (does nothing destructive) if photo-less rows already exist.
 */
export class OptionalProofPhoto1700008000000 implements MigrationInterface {
  name = 'OptionalProofPhoto1700008000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "proof_of_deliveries" ALTER COLUMN "photo_url" DROP NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Refuses (NOT NULL violation) rather than inventing a placeholder if photo-less deliveries exist — they are real evidence.
    await queryRunner.query(`ALTER TABLE "proof_of_deliveries" ALTER COLUMN "photo_url" SET NOT NULL`);
  }
}

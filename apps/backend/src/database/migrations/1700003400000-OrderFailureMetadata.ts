import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Failed Delivery Metadata (Chunk 1). Additive to `orders` only — no
 * other table touched, no existing column modified. Both columns are
 * nullable and stay null for every order that never reaches
 * FAILED_DELIVERY. Mirrors the existing `cancellation_reason`/
 * `cancelled_by_role` columns' own shape exactly.
 */
export class OrderFailureMetadata1700003400000 implements MigrationInterface {
  name = 'OrderFailureMetadata1700003400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders" ADD COLUMN "failure_reason" varchar;
      ALTER TABLE "orders" ADD COLUMN "failed_at" timestamptz;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders" DROP COLUMN IF EXISTS "failed_at";
      ALTER TABLE "orders" DROP COLUMN IF EXISTS "failure_reason";
    `);
  }
}

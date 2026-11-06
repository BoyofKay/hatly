import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * R16 (decision register 2026-11-06): drivers acknowledge an assignment (manual or automatic) instead of accepting/rejecting it.
 * `deliveries.acknowledged_at` records when the CURRENT driver acknowledged (null = not yet; reset on every (re)assignment).
 * `accept_deadline_at` keeps its column and index and now means "acknowledge by" (default 5 minutes after assignment). An
 * overdue acknowledgement only raises an Operations alert — nothing is released or reassigned automatically any more.
 * Additive and nullable: existing rows keep every value; the previous backend ignores the new column.
 */
export class DeliveryAcknowledgement1700007300000 implements MigrationInterface {
  name = 'DeliveryAcknowledgement1700007300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "deliveries" ADD COLUMN IF NOT EXISTS "acknowledged_at" timestamptz NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "deliveries" DROP COLUMN IF EXISTS "acknowledged_at"`);
  }
}

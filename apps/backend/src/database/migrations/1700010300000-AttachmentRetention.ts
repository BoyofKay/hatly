import { MigrationInterface, QueryRunner } from 'typeorm';

/** Owner decision 2026-11-28: order attachments are removed 90 days after the order ends; the order remembers when. Additive. */
export class AttachmentRetention1700010300000 implements MigrationInterface {
  name = 'AttachmentRetention1700010300000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "attachments_purged_at" timestamptz NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "attachments_purged_at"`);
  }
}

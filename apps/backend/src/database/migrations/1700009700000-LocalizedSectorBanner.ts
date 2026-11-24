import { MigrationInterface, QueryRunner } from 'typeorm';

export class LocalizedSectorBanner1700009700000 implements MigrationInterface {
  name = 'LocalizedSectorBanner1700009700000';
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "marketplace_sectors" ADD COLUMN IF NOT EXISTS "banner_url_ar" varchar(500)');
  }
  async down(q: QueryRunner): Promise<void> {
    const rows = await q.query('SELECT count(*)::int AS n FROM marketplace_sectors WHERE banner_url_ar IS NOT NULL');
    if (Number(rows[0]?.n ?? 0)) throw new Error('Cannot discard configured Arabic sector artwork.');
    await q.query('ALTER TABLE "marketplace_sectors" DROP COLUMN IF EXISTS "banner_url_ar"');
  }
}

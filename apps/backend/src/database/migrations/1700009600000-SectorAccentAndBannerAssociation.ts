import { MigrationInterface, QueryRunner } from 'typeorm';

export class SectorAccentAndBannerAssociation1700009600000 implements MigrationInterface {
  name = 'SectorAccentAndBannerAssociation1700009600000';
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "marketplace_sectors" ADD COLUMN IF NOT EXISTS "accent_color" varchar(7)');
    await q.query('ALTER TABLE "home_banners" ADD COLUMN IF NOT EXISTS "sector_id" uuid');
    await q.query("UPDATE home_banners SET sector_id = action_target_id WHERE action_type = 'SECTOR' AND sector_id IS NULL");
    await q.query(`ALTER TABLE "home_banners"
      ADD CONSTRAINT "FK_home_banners_sector_id"
      FOREIGN KEY ("sector_id") REFERENCES "marketplace_sectors"("id") ON DELETE SET NULL`);
  }
  async down(q: QueryRunner): Promise<void> {
    const linked = await q.query('SELECT count(*)::int AS n FROM home_banners WHERE sector_id IS NOT NULL');
    const colored = await q.query('SELECT count(*)::int AS n FROM marketplace_sectors WHERE accent_color IS NOT NULL');
    if (Number(linked[0]?.n ?? 0) || Number(colored[0]?.n ?? 0)) throw new Error('Cannot discard configured promotional sector associations or colors.');
    await q.query('ALTER TABLE "home_banners" DROP CONSTRAINT IF EXISTS "FK_home_banners_sector_id"');
    await q.query('ALTER TABLE "home_banners" DROP COLUMN IF EXISTS "sector_id"');
    await q.query('ALTER TABLE "marketplace_sectors" DROP COLUMN IF EXISTS "accent_color"');
  }
}

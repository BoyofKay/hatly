import { MigrationInterface, QueryRunner } from 'typeorm';
/** A wide sector banner is independent of the existing sector tile image. */
export class SectorHeroBanner1700009500000 implements MigrationInterface {
  name = 'SectorHeroBanner1700009500000';
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "marketplace_sectors" ADD COLUMN IF NOT EXISTS "banner_url" varchar(500)');
  }
  async down(q: QueryRunner): Promise<void> {
    const rows = await q.query('SELECT count(*)::int AS count FROM "marketplace_sectors" WHERE "banner_url" IS NOT NULL');
    if (Number(rows[0]?.count ?? 0) > 0) throw new Error('Refusing to drop a sector banner that has been configured.');
    await q.query('ALTER TABLE "marketplace_sectors" DROP COLUMN IF EXISTS "banner_url"');
  }
}

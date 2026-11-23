import { MigrationInterface, QueryRunner } from 'typeorm';

/** Presentation-only sector hero, independent from existing sector tile image. */
export class SectorHeroBanner1700008300000 implements MigrationInterface {
  name = 'SectorHeroBanner1700008300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "marketplace_sectors" ADD COLUMN IF NOT EXISTS "banner_url" varchar(500)');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rows = await queryRunner.query('SELECT count(*)::int AS count FROM "marketplace_sectors" WHERE "banner_url" IS NOT NULL');
    if (Number(rows[0]?.count ?? 0) > 0) throw new Error('Cannot roll back: sector banner assets are configured. Export and clear them first.');
    await queryRunner.query('ALTER TABLE "marketplace_sectors" DROP COLUMN IF EXISTS "banner_url"');
  }
}

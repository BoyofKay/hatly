import { MigrationInterface, QueryRunner } from 'typeorm';
export class LocalizedPromotionArtwork1700009800000 implements MigrationInterface {
  name = 'LocalizedPromotionArtwork1700009800000';
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE home_banners ADD COLUMN IF NOT EXISTS image_url_ar varchar(500)');
  }
  async down(q: QueryRunner): Promise<void> {
    const [r] = await q.query('SELECT count(*)::int AS n FROM home_banners WHERE image_url_ar IS NOT NULL');
    if (Number(r?.n)) throw new Error('Cannot discard configured Arabic promotion artwork.');
    await q.query('ALTER TABLE home_banners DROP COLUMN IF EXISTS image_url_ar');
  }
}

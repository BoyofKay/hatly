import { MigrationInterface, QueryRunner } from 'typeorm';

/** A store's wide banner (cover) image shown at the top of its page in the customer app. Optional; the logo stays separate. Additive. */
export class VendorCoverImage1700008400000 implements MigrationInterface {
  name = 'VendorCoverImage1700008400000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "vendors" ADD COLUMN "cover_image_url" varchar NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "vendors" DROP COLUMN "cover_image_url"`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bilingual names (2026-11-21, owner: "the app is Ar | En — every field needs both values"). Branches and offers were the only
 * customer-facing records with a single name. Additive, nullable (existing rows keep working and show the existing name until an
 * admin fills the Arabic one); `down` drops the two columns.
 */
export class BranchAndOfferArabicNames1700008300000 implements MigrationInterface {
  name = 'BranchAndOfferArabicNames1700008300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "vendor_branches" ADD COLUMN "name_ar" varchar(150)`);
    await queryRunner.query(`ALTER TABLE "offers" ADD COLUMN "name_ar" varchar(150)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "offers" DROP COLUMN IF EXISTS "name_ar"`);
    await queryRunner.query(`ALTER TABLE "vendor_branches" DROP COLUMN IF EXISTS "name_ar"`);
  }
}

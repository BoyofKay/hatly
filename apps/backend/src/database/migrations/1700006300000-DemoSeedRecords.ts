import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Traceability for the DEMONSTRATION marketplace (`npm run demo:marketplace`). One row per record the demo importer created, keyed by a
 * stable `demo_key` (e.g. `vendor:abu-aly-grills`). It lets the importer be idempotent even if an admin later renames a demo vendor, and
 * lets the owner list — and, with an explicit flag, deactivate — exactly the demo records at commercial launch without touching a real
 * merchant. ADDITIVE and reversible; nothing reads this table at runtime, and the application never writes it.
 */
export class DemoSeedRecords1700006300000 implements MigrationInterface {
  name = 'DemoSeedRecords1700006300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "demo_seed_records" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "demo_key" varchar(200) NOT NULL,
        "entity_type" varchar(40) NOT NULL,
        "entity_id" uuid NOT NULL,
        "batch" varchar(60) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_demo_seed_records" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_demo_seed_records_key" UNIQUE ("demo_key"),
        CONSTRAINT "chk_demo_seed_records_type" CHECK ("entity_type" IN ('SECTOR','VENDOR','BRANCH','PRODUCT_CATEGORY','PRODUCT','PRODUCT_OPTION','PRODUCT_OPTION_VALUE','HOME_BANNER'))
      );
      CREATE INDEX "IDX_demo_seed_records_entity" ON "demo_seed_records" ("entity_type", "entity_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "demo_seed_records";`);
  }
}

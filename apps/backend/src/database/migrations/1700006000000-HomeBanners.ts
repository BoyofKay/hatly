import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Admin-managed Home banners. ADDITIVE and reversible: one new table, nothing existing is touched, so it is safe to apply with the
 * old backend still serving (it simply never reads the table). The database itself enforces the rules the service also checks:
 * an action other than NONE needs a target (and NONE has none), the schedule must run forward, and an ACTIVE banner always has an image.
 */
export class HomeBanners1700006000000 implements MigrationInterface {
  name = 'HomeBanners1700006000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "home_banners" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        "title" varchar(120) NOT NULL,
        "title_ar" varchar(120),
        "image_url" varchar(500),
        "action_type" varchar(10) NOT NULL DEFAULT 'NONE',
        "action_target_id" uuid,
        "sort_order" integer NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT false,
        "starts_at" timestamptz,
        "ends_at" timestamptz,
        CONSTRAINT "PK_home_banners_id" PRIMARY KEY ("id"),
        CONSTRAINT "chk_home_banners_action_type" CHECK ("action_type" IN ('NONE', 'PRODUCT', 'VENDOR', 'SECTOR')),
        CONSTRAINT "chk_home_banners_action_target" CHECK (
          ("action_type" = 'NONE' AND "action_target_id" IS NULL) OR ("action_type" <> 'NONE' AND "action_target_id" IS NOT NULL)
        ),
        CONSTRAINT "chk_home_banners_schedule" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at"),
        CONSTRAINT "chk_home_banners_active_has_image" CHECK ("is_active" = false OR "image_url" IS NOT NULL)
      );
      CREATE INDEX "IDX_home_banners_active_sort" ON "home_banners" ("is_active", "sort_order");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "home_banners"`);
  }
}

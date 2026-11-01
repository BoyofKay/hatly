import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Media platform (B4). ADDITIVE and reversible. Binaries live in storage (local disk / S3-compatible); the database holds metadata only.
 *  - media_assets: one row per processed image (purpose, size, dimensions, sha-256 for de-duplication, alt text, soft-delete state).
 *  - media_variants: DISPLAY (WebP, max 1600 px) and THUMB (WebP, max 320 px) objects of an asset — storage key + size.
 *  - product_media: a product's primary + additional images (the legacy products.image_url keeps carrying the PRIMARY image's URL).
 *  - nullable *_media_asset_id columns (ON DELETE RESTRICT) on every image-bearing entity: a referenced asset can never be removed out from
 *    under an active record. The existing *_url columns stay and keep serving the same URLs (backward compatible).
 *  - legacy_source_url: assets registered from pre-existing uploads; the original object is never moved, rewritten or deleted.
 */
export class MediaPlatform1700006600000 implements MigrationInterface {
  name = 'MediaPlatform1700006600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "media_assets" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "purpose" varchar(30) NOT NULL,
        "status" varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE','DELETED','PURGED')),
        "original_name" varchar(255),
        "mime_type" varchar(40) NOT NULL,
        "bytes" integer NOT NULL,
        "width" integer NOT NULL,
        "height" integer NOT NULL,
        "sha256" char(64) NOT NULL,
        "alt_en" varchar(200),
        "alt_ar" varchar(200),
        "tags" text[] NOT NULL DEFAULT '{}',
        "uploaded_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "deleted_at" timestamptz,
        "deleted_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "purge_after" timestamptz,
        "purged_at" timestamptz,
        "legacy_source_url" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_media_assets" PRIMARY KEY ("id")
      );
      CREATE UNIQUE INDEX "UQ_media_assets_sha_active" ON "media_assets" ("sha256") WHERE "status" = 'ACTIVE' AND "legacy_source_url" IS NULL;
      CREATE UNIQUE INDEX "UQ_media_assets_legacy_url" ON "media_assets" ("legacy_source_url") WHERE "legacy_source_url" IS NOT NULL;
      CREATE INDEX "IDX_media_assets_library" ON "media_assets" ("status", "purpose", "created_at" DESC);
      CREATE INDEX "IDX_media_assets_uploader" ON "media_assets" ("uploaded_by_user_id", "created_at");

      CREATE TABLE "media_variants" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "asset_id" uuid NOT NULL REFERENCES "media_assets"("id") ON DELETE CASCADE,
        "name" varchar(10) NOT NULL CHECK ("name" IN ('DISPLAY','THUMB','ORIGINAL')),
        "storage_key" varchar(300) NOT NULL,
        "url" text NOT NULL,
        "width" integer NOT NULL,
        "height" integer NOT NULL,
        "bytes" integer NOT NULL,
        "mime_type" varchar(40) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_media_variants" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_media_variants_asset_name" UNIQUE ("asset_id", "name")
      );
      CREATE UNIQUE INDEX "UQ_media_variants_key" ON "media_variants" ("storage_key");

      CREATE TABLE "product_media" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
        "media_asset_id" uuid NOT NULL REFERENCES "media_assets"("id") ON DELETE RESTRICT,
        "sort_order" smallint NOT NULL,
        "is_primary" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_product_media" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_product_media_asset" UNIQUE ("product_id", "media_asset_id")
      );
      CREATE UNIQUE INDEX "UQ_product_media_primary" ON "product_media" ("product_id") WHERE "is_primary";
      CREATE INDEX "IDX_product_media_product" ON "product_media" ("product_id", "sort_order");
      CREATE INDEX "IDX_product_media_asset" ON "product_media" ("media_asset_id");

      ALTER TABLE "vendors" ADD COLUMN "logo_media_asset_id" uuid REFERENCES "media_assets"("id") ON DELETE RESTRICT;
      ALTER TABLE "vendor_branches" ADD COLUMN "cover_media_asset_id" uuid REFERENCES "media_assets"("id") ON DELETE RESTRICT;
      ALTER TABLE "marketplace_sectors" ADD COLUMN "media_asset_id" uuid REFERENCES "media_assets"("id") ON DELETE RESTRICT;
      ALTER TABLE "marketplace_subcategories" ADD COLUMN "media_asset_id" uuid REFERENCES "media_assets"("id") ON DELETE RESTRICT;
      ALTER TABLE "home_banners" ADD COLUMN "media_asset_id" uuid REFERENCES "media_assets"("id") ON DELETE RESTRICT;
      ALTER TABLE "products" ADD COLUMN "media_asset_id" uuid REFERENCES "media_assets"("id") ON DELETE RESTRICT;
      ALTER TABLE "catalog_products" ADD COLUMN "media_asset_id" uuid REFERENCES "media_assets"("id") ON DELETE RESTRICT;
      CREATE INDEX "IDX_vendors_logo_media" ON "vendors" ("logo_media_asset_id") WHERE "logo_media_asset_id" IS NOT NULL;
      CREATE INDEX "IDX_vendor_branches_cover_media" ON "vendor_branches" ("cover_media_asset_id") WHERE "cover_media_asset_id" IS NOT NULL;
      CREATE INDEX "IDX_sectors_media" ON "marketplace_sectors" ("media_asset_id") WHERE "media_asset_id" IS NOT NULL;
      CREATE INDEX "IDX_subcategories_media" ON "marketplace_subcategories" ("media_asset_id") WHERE "media_asset_id" IS NOT NULL;
      CREATE INDEX "IDX_home_banners_media" ON "home_banners" ("media_asset_id") WHERE "media_asset_id" IS NOT NULL;
      CREATE INDEX "IDX_products_media" ON "products" ("media_asset_id") WHERE "media_asset_id" IS NOT NULL;
      CREATE INDEX "IDX_catalog_products_media" ON "catalog_products" ("media_asset_id") WHERE "media_asset_id" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "catalog_products" DROP COLUMN "media_asset_id";
      ALTER TABLE "products" DROP COLUMN "media_asset_id";
      ALTER TABLE "home_banners" DROP COLUMN "media_asset_id";
      ALTER TABLE "marketplace_subcategories" DROP COLUMN "media_asset_id";
      ALTER TABLE "marketplace_sectors" DROP COLUMN "media_asset_id";
      ALTER TABLE "vendor_branches" DROP COLUMN "cover_media_asset_id";
      ALTER TABLE "vendors" DROP COLUMN "logo_media_asset_id";
      DROP TABLE "product_media";
      DROP TABLE "media_variants";
      DROP TABLE "media_assets";
    `);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2D: catalog (ProductCategory, Product, ProductOption,
 * ProductOptionValue) and cart (Cart, CartItem, CartItemOptionValue)
 * tables. Hand-written for the same reason the initial migration was
 * (see 1700000000000-InitialSchema.ts's own note) — no live Postgres
 * in this environment to run `migration:generate` against. Regenerate
 * with the TypeORM CLI against a real empty DB before trusting this as
 * the final word on the schema.
 */
export class CatalogAndCart1700000100000 implements MigrationInterface {
  name = 'CatalogAndCart1700000100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- Catalog ----

    await queryRunner.query(`
      CREATE TABLE "product_categories" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "vendor_branch_id" uuid NOT NULL REFERENCES "vendor_branches"("id") ON DELETE CASCADE,
        "name" varchar(100) NOT NULL,
        "name_ar" varchar(100),
        "sort_order" int NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE INDEX "idx_product_categories_branch" ON "product_categories" ("vendor_branch_id");
    `);

    await queryRunner.query(`
      CREATE TABLE "products" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "vendor_branch_id" uuid NOT NULL REFERENCES "vendor_branches"("id") ON DELETE CASCADE,
        "category_id" uuid NOT NULL REFERENCES "product_categories"("id"),
        "name" varchar(150) NOT NULL,
        "name_ar" varchar(150),
        "description" text,
        "description_ar" text,
        "image_url" varchar,
        "price_minor" bigint NOT NULL,
        "is_available" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE INDEX "idx_products_branch" ON "products" ("vendor_branch_id");
      CREATE INDEX "idx_products_category" ON "products" ("category_id");
    `);

    await queryRunner.query(`
      CREATE TABLE "product_options" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
        "name" varchar(100) NOT NULL,
        "name_ar" varchar(100),
        "is_required" boolean NOT NULL DEFAULT false,
        "allows_multiple" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE INDEX "idx_product_options_product" ON "product_options" ("product_id");
    `);

    await queryRunner.query(`
      CREATE TABLE "product_option_values" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "option_id" uuid NOT NULL REFERENCES "product_options"("id") ON DELETE CASCADE,
        "name" varchar(100) NOT NULL,
        "name_ar" varchar(100),
        "price_delta_minor" bigint NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE INDEX "idx_product_option_values_option" ON "product_option_values" ("option_id");
    `);

    // ---- Cart ----

    await queryRunner.query(`CREATE TYPE "carts_status_enum" AS ENUM ('ACTIVE', 'ORDERED');`);

    await queryRunner.query(`
      CREATE TABLE "carts" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "customer_id" uuid NOT NULL REFERENCES "users"("id"),
        "vendor_branch_id" uuid REFERENCES "vendor_branches"("id"),
        "status" "carts_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE INDEX "idx_carts_customer" ON "carts" ("customer_id");
      -- The actual enforcement of "one cart per customer" (business
      -- rule #1): a partial unique index so a customer can have many
      -- historical (non-ACTIVE) cart rows over time, but never more
      -- than one ACTIVE one at once. A plain UNIQUE(customer_id)
      -- column constraint couldn't express the "only while active"
      -- part.
      CREATE UNIQUE INDEX "idx_carts_customer_active" ON "carts" ("customer_id") WHERE "status" = 'ACTIVE';
    `);

    await queryRunner.query(`
      CREATE TABLE "cart_items" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "cart_id" uuid NOT NULL REFERENCES "carts"("id") ON DELETE CASCADE,
        "product_id" uuid NOT NULL REFERENCES "products"("id"),
        "quantity" int NOT NULL,
        "notes" varchar,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE INDEX "idx_cart_items_cart" ON "cart_items" ("cart_id");
    `);

    await queryRunner.query(`
      CREATE TABLE "cart_item_option_values" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "cart_item_id" uuid NOT NULL REFERENCES "cart_items"("id") ON DELETE CASCADE,
        "product_option_value_id" uuid NOT NULL REFERENCES "product_option_values"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE INDEX "idx_cart_item_option_values_item" ON "cart_item_option_values" ("cart_item_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "cart_item_option_values"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cart_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "carts"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "carts_status_enum"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "product_option_values"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "product_options"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "products"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "product_categories"`);
  }
}

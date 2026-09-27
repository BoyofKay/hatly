import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema for Phase 1: users, vendors/branches, orders/items,
 * drivers/deliveries. Product/cart/payment/promotion tables are added
 * in later migrations as Phase 2/5 build them out — see the roadmap
 * in the Phase 0 analysis doc.
 *
 * NOTE: this migration was authored by hand (no live Postgres/network
 * access in this environment to run `migration:generate` against a
 * real DB). Review the SQL before running it against a real database,
 * and prefer regenerating it with the TypeORM CLI once entities are
 * finalized, so it's guaranteed to match the entity definitions exactly.
 */
export class InitialSchema1700000000000 implements MigrationInterface {
  name = 'InitialSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TYPE "users_role_enum" AS ENUM (
        'CUSTOMER','DRIVER','VENDOR','VENDOR_MANAGER','ADMIN','SUPER_ADMIN'
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "phone" varchar(20) NOT NULL,
        "full_name" varchar(150) NOT NULL,
        "email" varchar(255),
        "password_hash" varchar,
        "role" "users_role_enum" NOT NULL DEFAULT 'CUSTOMER',
        "is_phone_verified" boolean NOT NULL DEFAULT false,
        "is_active" boolean NOT NULL DEFAULT true,
        "preferred_language" varchar(5) NOT NULL DEFAULT 'ar',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE UNIQUE INDEX "idx_users_phone" ON "users" ("phone");
    `);

    await queryRunner.query(`
      CREATE TABLE "vendors" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "name" varchar(150) NOT NULL,
        "name_ar" varchar(150),
        "category" varchar(50) NOT NULL,
        "logo_url" varchar,
        "commission_percent" numeric(5,2) NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "vendor_branches" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "vendor_id" uuid NOT NULL REFERENCES "vendors"("id") ON DELETE CASCADE,
        "name" varchar(150) NOT NULL,
        "address" varchar(255) NOT NULL,
        "service_area_id" uuid,
        "latitude" double precision NOT NULL,
        "longitude" double precision NOT NULL,
        "opening_hours" jsonb NOT NULL DEFAULT '{}',
        "is_open" boolean NOT NULL DEFAULT false,
        "is_active" boolean NOT NULL DEFAULT true,
        "minimum_order_minor" bigint NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE INDEX "idx_vendor_branches_service_area" ON "vendor_branches" ("service_area_id");
    `);

    await queryRunner.query(`
      CREATE TYPE "orders_status_enum" AS ENUM (
        'PENDING','CONFIRMED','PREPARING','READY_FOR_PICKUP',
        'ASSIGNED_TO_DRIVER','PICKED_UP','ON_THE_WAY','DELIVERED','CANCELLED'
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "orders" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "customer_id" uuid NOT NULL REFERENCES "users"("id"),
        "vendor_branch_id" uuid NOT NULL REFERENCES "vendor_branches"("id"),
        "status" "orders_status_enum" NOT NULL DEFAULT 'PENDING',
        "delivery_address_snapshot" jsonb NOT NULL,
        "subtotal_minor" bigint NOT NULL,
        "delivery_fee_minor" bigint NOT NULL,
        "discount_minor" bigint NOT NULL DEFAULT 0,
        "total_minor" bigint NOT NULL,
        "payment_method" varchar(20) NOT NULL DEFAULT 'COD',
        "cancellation_reason" varchar,
        "cancelled_by_role" varchar,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE INDEX "idx_orders_status" ON "orders" ("status");
      CREATE INDEX "idx_orders_customer" ON "orders" ("customer_id");
      -- Vendor order-management screens list "incoming orders for my
      -- branch" constantly (spec section 10) — index the FK it filters on.
      CREATE INDEX "idx_orders_vendor_branch" ON "orders" ("vendor_branch_id");
    `);

    await queryRunner.query(`
      CREATE TABLE "order_items" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
        "product_id" uuid NOT NULL,
        "product_name_snapshot" varchar(200) NOT NULL,
        "quantity" int NOT NULL,
        "unit_price_minor" bigint NOT NULL,
        "options_snapshot" jsonb NOT NULL DEFAULT '[]',
        "notes" varchar,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "drivers" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL REFERENCES "users"("id"),
        "is_online" boolean NOT NULL DEFAULT false,
        "is_available" boolean NOT NULL DEFAULT false,
        "verification_status" varchar(20) NOT NULL DEFAULT 'PENDING',
        "last_latitude" double precision,
        "last_longitude" double precision,
        "last_location_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE UNIQUE INDEX "idx_drivers_user" ON "drivers" ("user_id");
    `);

    await queryRunner.query(`
      CREATE TABLE "deliveries" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "order_id" uuid NOT NULL REFERENCES "orders"("id"),
        "driver_id" uuid REFERENCES "drivers"("id"),
        "assigned_at" timestamptz,
        "accept_deadline_at" timestamptz,
        "picked_up_at" timestamptz,
        "delivered_at" timestamptz,
        "reassignment_count" int NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE UNIQUE INDEX "idx_deliveries_order" ON "deliveries" ("order_id");
      -- Driver app's "my active/completed deliveries" list filters on this FK.
      CREATE INDEX "idx_deliveries_driver" ON "deliveries" ("driver_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "deliveries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "drivers"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "orders"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "orders_status_enum"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "vendor_branches"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "vendors"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "users_role_enum"`);
  }
}

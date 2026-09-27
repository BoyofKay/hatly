import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Favorites (Chunk 1) — Vendor-based only. A new, standalone table;
 * no existing table (vendors, users, vendor_branches) is touched.
 *
 * The composite UNIQUE constraint on (customer_id, vendor_id) is the
 * actual duplicate-prevention mechanism — FavoritesService relies on
 * this, not an application-level pre-check, per the approved design.
 *
 * No `is_active`/availability snapshot column, no branch_id, no
 * product_id, no history table — none of these are part of the V1
 * product decision. `deleted_at` exists only because every entity
 * extends the shared BaseEntity; FavoritesService never calls
 * TypeORM's soft-delete methods on this entity, so this column stays
 * inert here (HARD DELETE is used for unfavorite instead).
 */
export class Favorites1700003600000 implements MigrationInterface {
  name = 'Favorites1700003600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "favorites" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        "customer_id" uuid NOT NULL,
        "vendor_id" uuid NOT NULL,
        CONSTRAINT "PK_favorites_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_favorites_customer_vendor" UNIQUE ("customer_id", "vendor_id"),
        CONSTRAINT "FK_favorites_customer" FOREIGN KEY ("customer_id") REFERENCES "users"("id"),
        CONSTRAINT "FK_favorites_vendor" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id")
      );
      CREATE INDEX "IDX_favorites_customer_id" ON "favorites" ("customer_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "favorites";`);
  }
}

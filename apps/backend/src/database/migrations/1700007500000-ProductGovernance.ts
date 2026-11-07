import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * R7 (decision register 2026-11-06): price reductions by a vendor apply directly; price increases, new products and product-detail
 * changes need Hatly's approval, and the approved version stays live until then. Excel and bulk paths follow the same rule per change.
 *
 * - `products.approval_status`: APPROVED (live-able) / PENDING (a vendor's new product waiting for Hatly) / REJECTED. Every existing
 *   product is APPROVED, so nothing changes for the live catalog. A product that is not APPROVED cannot be made available by a vendor.
 * - `product_change_requests`: one row per request. NEW_PRODUCT (review of a vendor's new product), UPDATE (gated fields of a live
 *   product, merged while pending), OPTIONS (one option/value change of a live product). At most one PENDING NEW_PRODUCT and one PENDING
 *   UPDATE per product. The decision records who, when and a note.
 * Additive: the previous backend ignores both.
 */
export class ProductGovernance1700007500000 implements MigrationInterface {
  name = 'ProductGovernance1700007500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products" ADD COLUMN "approval_status" varchar(10) NOT NULL DEFAULT 'APPROVED'
        CONSTRAINT "CHK_products_approval_status" CHECK ("approval_status" IN ('APPROVED','PENDING','REJECTED'));
      CREATE TABLE "product_change_requests" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
        "vendor_branch_id" uuid NOT NULL REFERENCES "vendor_branches"("id"),
        "kind" varchar(12) NOT NULL CHECK ("kind" IN ('NEW_PRODUCT','UPDATE','OPTIONS')),
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "source" varchar(10) NOT NULL DEFAULT 'DASHBOARD' CHECK ("source" IN ('DASHBOARD','EXCEL')),
        "status" varchar(10) NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','APPROVED','REJECTED','WITHDRAWN')),
        "requested_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
        "decided_by_user_id" uuid REFERENCES "users"("id"),
        "decided_at" timestamptz,
        "decision_note" varchar(300),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_product_change_decided" CHECK (("status" IN ('APPROVED','REJECTED')) = ("decided_at" IS NOT NULL))
      );
      CREATE UNIQUE INDEX "UQ_product_change_one_pending" ON "product_change_requests" ("product_id", "kind") WHERE "status" = 'PENDING' AND "kind" IN ('NEW_PRODUCT','UPDATE');
      CREATE INDEX "IDX_product_change_status_created" ON "product_change_requests" ("status", "created_at");
      CREATE INDEX "IDX_product_change_branch" ON "product_change_requests" ("vendor_branch_id", "created_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "product_change_requests"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "approval_status"`);
  }
}

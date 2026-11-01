import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Vendor operations — branch closures, the stock-movement ledger and stocktakes, per-vendor settlement terms. ADDITIVE and reversible; no existing row,
 * column meaning or applied migration is changed, and the previous release keeps working against this schema (it simply does not know these tables).
 *
 *  - vendor_branch_closures: a scheduled or temporary closure (kind TEMPORARY or HOLIDAY) of ONE branch with an explicit reason and an explicit end.
 *    It is an OVERLAY: it never rewrites `vendor_branches.is_open` (the manual switch), so when the closure ends the branch simply goes back to
 *    whatever the manual switch says. There is deliberately no holiday calendar and no open-ended closure — a person decides each closure.
 *  - stock_movements: an append-only ledger of every change of a TRACKED product's quantity, written by a trigger on `products` so that no code path
 *    (order placement, cancellation, vendor edit, admin edit, Excel import, stocktake) can change stock without leaving a row. A writer that knows
 *    why and who sets the transaction-local setting `hatly.stock_ctx` (JSON); a change made without it is still recorded, honestly marked
 *    `source_captured = false` / reason UNATTRIBUTED. Nothing before this migration is reconstructed or invented: `stock_ledger_info.started_at`
 *    says from when the history is complete.
 *  - stocktakes / stocktake_lines: a physical count of a branch's tracked products against the quantity expected when the count started.
 *  - vendor_settlement_terms: the contractual settlement frequency of ONE vendor (WEEKLY or MONTHLY — the only values the platform supports).
 *    No row = "not configured"; there is no global default.
 */
export class VendorOperationsFoundations1700007200000 implements MigrationInterface {
  name = 'VendorOperationsFoundations1700007200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "vendor_branch_closures" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "vendor_branch_id" uuid NOT NULL REFERENCES "vendor_branches"("id"),
        "kind" varchar(12) NOT NULL CHECK ("kind" IN ('TEMPORARY','HOLIDAY')),
        "starts_at" timestamptz NOT NULL,
        "ends_at" timestamptz NOT NULL,
        "reason" varchar(300) NOT NULL,
        "created_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "cancelled_at" timestamptz,
        "cancelled_by_user_id" uuid REFERENCES "users"("id"),
        CONSTRAINT "CHK_vendor_branch_closures_range" CHECK ("ends_at" > "starts_at")
      );
      CREATE INDEX "IDX_vendor_branch_closures_branch_range" ON "vendor_branch_closures" ("vendor_branch_id", "starts_at", "ends_at") WHERE "cancelled_at" IS NULL;

      CREATE TABLE "stock_ledger_info" (
        "id" smallint PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
        "started_at" timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO "stock_ledger_info" ("id") VALUES (1);

      CREATE TABLE "stock_movements" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "product_id" uuid NOT NULL REFERENCES "products"("id"),
        "vendor_branch_id" uuid NOT NULL REFERENCES "vendor_branches"("id"),
        "occurred_at" timestamptz NOT NULL DEFAULT now(),
        "before_quantity" integer,
        "after_quantity" integer,
        "delta" integer NOT NULL,
        "reason" varchar(30) NOT NULL,
        "reference_type" varchar(30),
        "reference_id" uuid,
        "actor_user_id" uuid REFERENCES "users"("id"),
        "actor_role" varchar(30),
        "note" varchar(300),
        "source_captured" boolean NOT NULL DEFAULT true
      );
      CREATE INDEX "IDX_stock_movements_product_time" ON "stock_movements" ("product_id", "occurred_at" DESC);
      CREATE INDEX "IDX_stock_movements_branch_time" ON "stock_movements" ("vendor_branch_id", "occurred_at" DESC);
      CREATE INDEX "IDX_stock_movements_reference" ON "stock_movements" ("reference_type", "reference_id") WHERE "reference_id" IS NOT NULL;

      CREATE FUNCTION hatly_record_stock_movement() RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE
        ctx jsonb;
        before_q integer;
        after_q integer;
      BEGIN
        BEGIN
          ctx := nullif(current_setting('hatly.stock_ctx', true), '')::jsonb;
        EXCEPTION WHEN others THEN
          ctx := NULL;
        END;
        IF TG_OP = 'INSERT' THEN
          IF NEW.inventory_mode <> 'TRACKED' OR NEW.quantity IS NULL THEN RETURN NEW; END IF;
          before_q := NULL;
          after_q := NEW.quantity;
        ELSE
          IF NEW.quantity IS NOT DISTINCT FROM OLD.quantity THEN RETURN NEW; END IF;
          IF NEW.inventory_mode <> 'TRACKED' AND OLD.inventory_mode <> 'TRACKED' THEN RETURN NEW; END IF;
          before_q := OLD.quantity;
          after_q := NEW.quantity;
        END IF;
        INSERT INTO stock_movements (product_id, vendor_branch_id, before_quantity, after_quantity, delta, reason, reference_type, reference_id, actor_user_id, actor_role, note, source_captured)
        VALUES (
          NEW.id, NEW.vendor_branch_id, before_q, after_q, coalesce(after_q, 0) - coalesce(before_q, 0),
          coalesce(ctx->>'reason', CASE WHEN TG_OP = 'INSERT' THEN 'INITIAL_STOCK' ELSE 'UNATTRIBUTED' END),
          ctx->>'referenceType',
          nullif(ctx->>'referenceId', '')::uuid,
          nullif(ctx->>'actorUserId', '')::uuid,
          ctx->>'actorRole',
          left(ctx->>'note', 300),
          -- a product created with a quantity IS its initial stock (the reason is inherent); any other change needs the writer's context to count as captured
          (TG_OP = 'INSERT' OR (ctx IS NOT NULL AND ctx ? 'reason'))
        );
        RETURN NEW;
      END
      $fn$;
      CREATE TRIGGER trg_stock_movement_ins AFTER INSERT ON "products" FOR EACH ROW EXECUTE FUNCTION hatly_record_stock_movement();
      CREATE TRIGGER trg_stock_movement_upd AFTER UPDATE OF "quantity", "inventory_mode" ON "products" FOR EACH ROW EXECUTE FUNCTION hatly_record_stock_movement();

      CREATE TABLE "stocktakes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "vendor_branch_id" uuid NOT NULL REFERENCES "vendor_branches"("id"),
        "status" varchar(10) NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN','APPLIED','CANCELLED')),
        "note" varchar(300),
        "created_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "applied_at" timestamptz,
        "applied_by_user_id" uuid REFERENCES "users"("id"),
        "cancelled_at" timestamptz
      );
      CREATE UNIQUE INDEX "UQ_stocktakes_one_open_per_branch" ON "stocktakes" ("vendor_branch_id") WHERE "status" = 'OPEN';
      CREATE TABLE "stocktake_lines" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "stocktake_id" uuid NOT NULL REFERENCES "stocktakes"("id") ON DELETE CASCADE,
        "product_id" uuid NOT NULL REFERENCES "products"("id"),
        "expected_quantity" integer NOT NULL,
        "counted_quantity" integer CHECK ("counted_quantity" IS NULL OR "counted_quantity" >= 0),
        "counted_by_user_id" uuid REFERENCES "users"("id"),
        "counted_at" timestamptz,
        CONSTRAINT "UQ_stocktake_lines_product" UNIQUE ("stocktake_id", "product_id")
      );

      CREATE TABLE "vendor_settlement_terms" (
        "vendor_id" uuid PRIMARY KEY REFERENCES "vendors"("id"),
        "frequency" varchar(10) NOT NULL CHECK ("frequency" IN ('WEEKLY','MONTHLY')),
        "updated_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The tables only hold what this feature recorded (closures, the movement ledger, counts, terms); dropping them loses that history, nothing else.
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS trg_stock_movement_upd ON "products";
      DROP TRIGGER IF EXISTS trg_stock_movement_ins ON "products";
      DROP FUNCTION IF EXISTS hatly_record_stock_movement();
      DROP TABLE IF EXISTS "vendor_settlement_terms";
      DROP TABLE IF EXISTS "stocktake_lines";
      DROP TABLE IF EXISTS "stocktakes";
      DROP TABLE IF EXISTS "stock_movements";
      DROP TABLE IF EXISTS "stock_ledger_info";
      DROP TABLE IF EXISTS "vendor_branch_closures";
    `);
  }
}

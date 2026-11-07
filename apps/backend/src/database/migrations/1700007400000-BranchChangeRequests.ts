import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * R8 / R44 (decision register 2026-11-06): vendors may not pause/close a store, change its weekly hours or working days, or schedule a
 * temporary closure on their own — they REQUEST it and Hatly Admin approves or rejects. One row per request; the decision is recorded
 * (who, when, note) and an approved request is applied by the existing Admin paths. At most one PENDING request per (branch, kind).
 * Additive: the previous backend never reads this table.
 */
export class BranchChangeRequests1700007400000 implements MigrationInterface {
  name = 'BranchChangeRequests1700007400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "vendor_branch_change_requests" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "vendor_branch_id" uuid NOT NULL REFERENCES "vendor_branches"("id"),
        "kind" varchar(20) NOT NULL CHECK ("kind" IN ('PAUSE','REOPEN','HOURS','CLOSURE','CLOSURE_CANCEL')),
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "reason" varchar(300),
        "status" varchar(10) NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','APPROVED','REJECTED','WITHDRAWN')),
        "requested_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
        "decided_by_user_id" uuid REFERENCES "users"("id"),
        "decided_at" timestamptz,
        "decision_note" varchar(300),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_branch_change_decided" CHECK (("status" IN ('APPROVED','REJECTED')) = ("decided_at" IS NOT NULL))
      );
      CREATE UNIQUE INDEX "UQ_branch_change_one_pending" ON "vendor_branch_change_requests" ("vendor_branch_id", "kind") WHERE "status" = 'PENDING';
      CREATE INDEX "IDX_branch_change_status_created" ON "vendor_branch_change_requests" ("status", "created_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "vendor_branch_change_requests"`);
  }
}

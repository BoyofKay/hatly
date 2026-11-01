import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Durable, APPEND-ONLY audit trail of privileged security-sensitive actions. ADDITIVE and reversible (one new table, one function, one
 * trigger). The trigger raises on every UPDATE and DELETE (row level), so recorded history cannot be altered through the application or a
 * casual SQL session; TRUNCATE is deliberately not blocked (test/dev resets), and dropping the table in `down` removes the trigger with it.
 */
export class AdminAuditLogs1700005700000 implements MigrationInterface {
  name = 'AdminAuditLogs1700005700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "admin_audit_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        "actor_user_id" uuid,
        "actor_role" varchar(30),
        "action" varchar(60) NOT NULL,
        "target_type" varchar(40),
        "target_id" varchar(120),
        "outcome" varchar(10) NOT NULL DEFAULT 'SUCCESS',
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "ip_address" varchar(64),
        CONSTRAINT "PK_admin_audit_logs_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_admin_audit_logs_actor" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id"),
        CONSTRAINT "chk_admin_audit_logs_outcome" CHECK ("outcome" IN ('SUCCESS', 'FAILURE'))
      );
      CREATE INDEX "IDX_admin_audit_logs_actor_created" ON "admin_audit_logs" ("actor_user_id", "created_at");
      CREATE INDEX "IDX_admin_audit_logs_action_created" ON "admin_audit_logs" ("action", "created_at");

      CREATE FUNCTION admin_audit_logs_immutable() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'admin_audit_logs is append-only (% refused)', TG_OP USING ERRCODE = 'integrity_constraint_violation';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER admin_audit_logs_no_update_delete
        BEFORE UPDATE OR DELETE ON "admin_audit_logs"
        FOR EACH ROW EXECUTE FUNCTION admin_audit_logs_immutable();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "admin_audit_logs"; DROP FUNCTION IF EXISTS admin_audit_logs_immutable();`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PD-004 — Manual Transfer pending refund entitlement. PURELY ADDITIVE: three columns on `payments`, every existing row
 * gets the neutral default (`NONE`, 0, no resolution time) and behaves exactly as before. Reversible.
 *
 * - `pending_refund_minor`     what the customer would be owed back if the (still unverified) transfer is verified PAID
 * - `pending_refund_status`    NONE | PENDING | CONVERTED | VOIDED (explicit state, guarded by a CHECK)
 * - `pending_refund_resolved_at` when it became CONVERTED / VOIDED
 */
export class PaymentPendingRefund1700004100000 implements MigrationInterface {
  name = 'PaymentPendingRefund1700004100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payments"
        ADD COLUMN "pending_refund_minor" bigint NOT NULL DEFAULT 0,
        ADD COLUMN "pending_refund_status" varchar(12) NOT NULL DEFAULT 'NONE',
        ADD COLUMN "pending_refund_resolved_at" timestamptz;
      ALTER TABLE "payments"
        ADD CONSTRAINT "chk_payments_pending_refund_status"
          CHECK ("pending_refund_status" IN ('NONE', 'PENDING', 'CONVERTED', 'VOIDED')),
        ADD CONSTRAINT "chk_payments_pending_refund_minor" CHECK ("pending_refund_minor" >= 0);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payments"
        DROP CONSTRAINT IF EXISTS "chk_payments_pending_refund_minor",
        DROP CONSTRAINT IF EXISTS "chk_payments_pending_refund_status",
        DROP COLUMN IF EXISTS "pending_refund_resolved_at",
        DROP COLUMN IF EXISTS "pending_refund_status",
        DROP COLUMN IF EXISTS "pending_refund_minor";
    `);
  }
}

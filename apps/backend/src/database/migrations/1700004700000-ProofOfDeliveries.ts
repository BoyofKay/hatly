import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M4 — Proof of Delivery. New, dedicated table, mirroring
 * `driver_cash_remainders`' own shape exactly (see
 * 1700003200000-DriverCashRemainders.ts): no FK constraints on
 * order_id/delivery_id/driver_id (matches this schema's existing
 * convention for financial/operational-adjacent join columns), an
 * index on driver_id (a driver's own submission history), and the
 * real protection — a UNIQUE index on delivery_id, so a delivery can
 * only ever have exactly one Proof of Delivery row, ever (append-only,
 * never overwritten).
 */
export class ProofOfDeliveries1700004700000 implements MigrationInterface {
  name = 'ProofOfDeliveries1700004700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "proof_of_deliveries" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "order_id" uuid NOT NULL,
        "delivery_id" uuid NOT NULL,
        "driver_id" uuid NOT NULL,
        "photo_url" varchar NOT NULL,
        "recipient_name" varchar,
        "submitted_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );

      CREATE INDEX "idx_proof_of_deliveries_order" ON "proof_of_deliveries" ("order_id");
      CREATE INDEX "idx_proof_of_deliveries_driver" ON "proof_of_deliveries" ("driver_id");
      -- At most one Proof of Delivery per Delivery, ever — CONFIRMED the real DB-level
      -- protection against a duplicate/conflicting submission (retried request or a
      -- second, different photo), not only an application-level check.
      CREATE UNIQUE INDEX "idx_proof_of_deliveries_delivery_unique" ON "proof_of_deliveries" ("delivery_id");

      ALTER TABLE "proof_of_deliveries" ADD CONSTRAINT "chk_proof_of_delivery_photo_url_present" CHECK (length("photo_url") > 0);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "proof_of_deliveries";
    `);
  }
}

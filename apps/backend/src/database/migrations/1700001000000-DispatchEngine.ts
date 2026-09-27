import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase D (Dispatch Engine). Adds:
 *   - `vehicle_types.is_bicycle` — necessary plumbing for the
 *     confirmed bicycle-max-pickup-distance rule (no prior link
 *     existed between Driver and VehicleType at all).
 *   - `drivers.vehicle_type_id` — same reason.
 *   - `dispatch_alerts` — the buildable form of "Admin notified/
 *     alerted" (no notification infrastructure exists in this
 *     codebase — see DispatchAlert's own doc comment).
 *   - Seeds `VENDOR_SEGMENT_AUTO_ACCEPT_ENABLED = false` — preserves
 *     Phase B's existing manual-acceptance behavior exactly unless an
 *     Admin deliberately changes it. Deliberately does NOT seed
 *     `MAX_BICYCLE_PICKUP_DISTANCE_METERS` — "do not invent the
 *     maximum bicycle distance value," same discipline as every other
 *     unset numeric safety parameter in this project.
 */
export class DispatchEngine1700001000000 implements MigrationInterface {
  name = 'DispatchEngine1700001000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "vehicle_types" ADD COLUMN "is_bicycle" boolean NOT NULL DEFAULT false;
    `);

    await queryRunner.query(`
      ALTER TABLE "drivers" ADD COLUMN "vehicle_type_id" uuid REFERENCES "vehicle_types"("id");
    `);

    await queryRunner.query(`
      CREATE TABLE "dispatch_alerts" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "order_id" uuid NOT NULL REFERENCES "orders"("id"),
        "reason" varchar(50) NOT NULL,
        "resolved_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE INDEX "idx_dispatch_alerts_order" ON "dispatch_alerts" ("order_id");
    `);

    await queryRunner.query(`
      INSERT INTO "business_config" ("key", "value", "description") VALUES
      (
        'VENDOR_SEGMENT_AUTO_ACCEPT_ENABLED',
        'false'::jsonb,
        'true = new OrderVendorSegments start CONFIRMED automatically (no vendor action needed). false = segments start PENDING and require the vendor to accept manually, matching Phase B''s original behavior.'
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "business_config" WHERE "key" = 'VENDOR_SEGMENT_AUTO_ACCEPT_ENABLED';
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS "dispatch_alerts"`);

    await queryRunner.query(`
      ALTER TABLE "drivers" DROP COLUMN IF EXISTS "vehicle_type_id";
    `);

    await queryRunner.query(`
      ALTER TABLE "vehicle_types" DROP COLUMN IF EXISTS "is_bicycle";
    `);
  }
}

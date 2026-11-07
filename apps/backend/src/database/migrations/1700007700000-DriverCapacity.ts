import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * R18 (decision register 2026-11-06): a driver may carry several active orders up to their vehicle capacity
 * (`vehicle_types.max_active_deliveries`, which already exists). An Admin may override one driver's capacity; every override records the
 * reason, the approver, the time and the before/after (`driver_capacity_overrides`). `drivers.is_available` keeps its column and its
 * readers, but now means "has spare capacity" — recomputed from the driver's active deliveries whenever they change.
 * Additive; with every capacity at 1 nothing changes. The previous release ignores both.
 */
export class DriverCapacity1700007700000 implements MigrationInterface {
  name = 'DriverCapacity1700007700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "drivers" ADD COLUMN "capacity_override" int
        CONSTRAINT "CHK_drivers_capacity_override" CHECK ("capacity_override" IS NULL OR ("capacity_override" BETWEEN 1 AND 20));
      CREATE TABLE "driver_capacity_overrides" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "driver_id" uuid NOT NULL REFERENCES "drivers"("id"),
        "before_override" int,
        "after_override" int,
        "effective_before" int NOT NULL,
        "effective_after" int NOT NULL,
        "reason" varchar(300) NOT NULL,
        "approved_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX "IDX_driver_capacity_overrides_driver" ON "driver_capacity_overrides" ("driver_id", "created_at");
    `);
    // Derive is_available under the new meaning (active < capacity) for every driver — pure derivation from deliveries and capacities.
    await queryRunner.query(`
      UPDATE drivers d SET is_available = (
        (SELECT count(*) FROM deliveries x JOIN orders o ON o.id = x.order_id
          WHERE x.driver_id = d.id AND x.deleted_at IS NULL AND o.status::text IN ('ASSIGNED_TO_DRIVER','PICKED_UP','ON_THE_WAY'))
        < GREATEST(1, COALESCE(d.capacity_override, (SELECT v.max_active_deliveries FROM vehicle_types v WHERE v.id = d.vehicle_type_id), 1)))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "driver_capacity_overrides"`);
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "capacity_override"`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/** Owner decision 2026-11-28 (scale): dispatch reads only online, available, approved drivers near the pickup — a small partial index. */
export class DispatchDriverIndex1700010500000 implements MigrationInterface {
  name = 'DispatchDriverIndex1700010500000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE INDEX IF NOT EXISTS "idx_drivers_dispatch_location" ON "drivers" ("last_latitude", "last_longitude")
        WHERE "is_online" = true AND "is_available" = true AND "verification_status" = 'APPROVED'`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "idx_drivers_dispatch_location"`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Driver presence (2026-11-13) — what Operations needs to tell "assigned and reachable" from "assigned but the app is gone":
 *  - `last_seen_at`: the last time the driver's app called the API (it polls its deliveries every ~25 s while open). A real
 *    connectivity fact, independent of GPS (R14: GPS is never mandatory). Written at most every 30 s per driver.
 *  - `online_changed_at`: when the driver last switched their own online/offline toggle (marks one "went offline" incident).
 * Nothing here decides anything: the alert threshold for a silent app is the optional setting DRIVER_PRESENCE_STALE_MINUTES (unset = off),
 * and an explicit offline switch is the driver's own statement. Additive, nullable, backward compatible; `down` drops the two columns.
 */
export class DriverPresence1700008100000 implements MigrationInterface {
  name = 'DriverPresence1700008100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "drivers" ADD COLUMN "last_seen_at" timestamptz, ADD COLUMN "online_changed_at" timestamptz`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "online_changed_at", DROP COLUMN IF EXISTS "last_seen_at"`);
  }
}

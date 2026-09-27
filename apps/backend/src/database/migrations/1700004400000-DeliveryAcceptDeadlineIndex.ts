import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Dispatch Hardening milestone. `AutomaticDispatchService.reassignTimedOutDeliveries()` runs on a
 * fixed interval (every ~10s, forever, for the life of the process) and its core query filters
 * `deliveries.accept_deadline_at < NOW() AND accept_deadline_at IS NOT NULL`. Without an index this
 * is a full sequential scan of the ENTIRE `deliveries` table on every single tick — `deliveries` has
 * one row per order that has EVER been dispatched (not just currently-active ones, since the row is
 * reused/updated across reassignments rather than reinserted — see `DeliveryAssignmentService`'s own
 * comment on `deliveries.order_id` being unique), so this only gets worse as order volume grows.
 *
 * A PARTIAL index (`WHERE accept_deadline_at IS NOT NULL`) rather than a plain one: the column is
 * null for the large majority of historical rows once a delivery is long since delivered/failed
 * (nothing ever clears it back to null today, so in practice most rows still have SOME timestamp
 * here — the partial predicate is kept anyway because it exactly matches the query's own `IS NOT
 * NULL` clause and costs nothing when it doesn't help, per Postgres's normal partial-index
 * semantics) — minimal, targeted, additive, fully reversible.
 */
export class DeliveryAcceptDeadlineIndex1700004400000 implements MigrationInterface {
  name = 'DeliveryAcceptDeadlineIndex1700004400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_deliveries_accept_deadline_at"
        ON "deliveries" ("accept_deadline_at")
        WHERE "accept_deadline_at" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_deliveries_accept_deadline_at";`);
  }
}

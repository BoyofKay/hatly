import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M2 (Launch-Readiness Gap Audit, G-13) — settlement-period close
 * concurrency hardening.
 *
 * `SettlementService.closeVendorPeriod`/`closeDriverPeriod` compute
 * `periodStart` deterministically as the previous CLOSED period's own
 * `periodEnd` for that same vendor branch / driver (see that service's
 * own top comment on why periods are always contiguous, non-
 * overlapping ranges). Two concurrent close requests for the SAME
 * vendor branch / driver therefore both read the SAME `previous` row
 * before either has committed, and would both compute the SAME
 * `periodStart` — the exact overlap the audit flagged, since each
 * would still stamp its own (slightly different) `periodEnd`.
 *
 * A unique index on (vendor_branch_id, period_start) / (driver_id,
 * period_start) makes this impossible at the database level: only the
 * first of the two concurrent INSERTs can succeed. Mirrors this
 * codebase's own established convention exactly —
 * `idx_driver_cash_remainders_order_unique` (a real UNIQUE index in
 * the migration, while the entity's own `@Index()` decorator stays a
 * plain, non-unique index — synchronize is false, migrations are the
 * schema's actual source of truth) — with `SettlementService` catching
 * Postgres `23505` and returning the already-closed period instead of
 * a raw DB error or a duplicate/overlapping row, same as
 * `DriverCashRemainderService.submit`.
 *
 * A legitimate SEQUENTIAL close is never affected: its `periodStart`
 * is the previous period's `periodEnd`, a different timestamp from any
 * period already stored for that vendor branch / driver.
 */
export class SettlementPeriodConcurrencyIndex1700004500000 implements MigrationInterface {
  name = 'SettlementPeriodConcurrencyIndex1700004500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_vendor_settlement_periods_branch_start_unique"
        ON "vendor_settlement_periods" ("vendor_branch_id", "period_start");
      CREATE UNIQUE INDEX "idx_driver_settlement_periods_driver_start_unique"
        ON "driver_settlement_periods" ("driver_id", "period_start");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_driver_settlement_periods_driver_start_unique";
      DROP INDEX IF EXISTS "idx_vendor_settlement_periods_branch_start_unique";
    `);
  }
}

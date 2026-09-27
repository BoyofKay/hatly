import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Group 7A — referential-integrity hardening. Adds real foreign keys to
 * 29 uuid reference columns in the finance/ledger/operational tables
 * that were created without them.
 *
 * WHY: the earlier migration headers justified the omissions by citing
 * `offer_consumptions.order_id` and `uploads.uploaded_by_user_id` as
 * unconstrained precedents — both of those columns in fact HAVE foreign
 * keys, and `employee_loans.employee_user_id` (same table as the
 * unconstrained `issued_by_user_id`) has one too. The project's own
 * stated principle (see the Ratings migration) is that FKs are safe
 * because "this codebase never hard-deletes" these rows — users, orders,
 * deliveries, drivers, payments, branches are only ever deactivated or
 * soft-deleted; no code path deletes them. A foreign key therefore adds
 * integrity (no ledger/settlement/remainder row can point at a
 * nonexistent order, user, delivery, driver, ...) without changing any
 * runtime behaviour.
 *
 * ON DELETE: every constraint is NO ACTION — deleting a referenced row
 * while ledger history points at it is REFUSED, never cascaded and never
 * nulled. Financial history can therefore never disappear (or lose its
 * reference) because another entity was deleted. The single exception is
 * `device_tokens.user_id` → ON DELETE CASCADE: a device token is a
 * delivery address owned by exactly one user, re-parented by
 * re-registration, retired via `is_active`, with no audit or financial
 * value; keeping it after its user is gone would leave a live push
 * address for a removed account. (It can only ever fire for a user who
 * has no ledger history, since those FKs block deleting anyone else.)
 *
 * DELIBERATELY NOT ADDED (historical snapshot pointers that must stay
 * readable after the product/offer is later changed or removed, as
 * documented on the entities): `order_items.product_id`,
 * `order_items.applied_offer_id`, `order_vendor_segments.applied_offer_id`,
 * `product_ratings.product_id`.
 *
 * SAFETY: all-or-nothing (this migration runs in one transaction).
 * Before touching the schema every constraint is pre-checked for
 * existing orphan rows; if any exist the migration REFUSES with a
 * message naming each column and count — it never deletes, nulls or
 * rewrites data to make a constraint pass. On success each constraint
 * is created fully VALIDATED (plain ADD CONSTRAINT scans the table;
 * tables are small pre-launch, so the brief lock is acceptable and a
 * NOT VALID/VALIDATE split inside one transaction would give no benefit).
 */
interface ForeignKey {
  table: string;
  column: string;
  references: string;
  onDelete: 'NO ACTION' | 'CASCADE';
}

const FOREIGN_KEYS: ForeignKey[] = [
  // Wallet ledger
  { table: 'wallet_transactions', column: 'customer_id', references: 'users', onDelete: 'NO ACTION' },
  { table: 'wallet_transactions', column: 'order_id', references: 'orders', onDelete: 'NO ACTION' },
  { table: 'wallet_transactions', column: 'created_by_user_id', references: 'users', onDelete: 'NO ACTION' },
  // Loyalty ledger
  { table: 'loyalty_points_transactions', column: 'customer_id', references: 'users', onDelete: 'NO ACTION' },
  { table: 'loyalty_points_transactions', column: 'order_id', references: 'orders', onDelete: 'NO ACTION' },
  { table: 'loyalty_points_transactions', column: 'created_by_user_id', references: 'users', onDelete: 'NO ACTION' },
  // Driver cash remainder
  { table: 'driver_cash_remainders', column: 'order_id', references: 'orders', onDelete: 'NO ACTION' },
  { table: 'driver_cash_remainders', column: 'delivery_id', references: 'deliveries', onDelete: 'NO ACTION' },
  { table: 'driver_cash_remainders', column: 'driver_id', references: 'drivers', onDelete: 'NO ACTION' },
  { table: 'driver_cash_remainders', column: 'customer_id', references: 'users', onDelete: 'NO ACTION' },
  { table: 'driver_cash_remainders', column: 'reviewed_by_user_id', references: 'users', onDelete: 'NO ACTION' },
  // Failed-delivery resolution
  { table: 'failed_delivery_resolutions', column: 'order_id', references: 'orders', onDelete: 'NO ACTION' },
  { table: 'failed_delivery_resolutions', column: 'resolved_by_user_id', references: 'users', onDelete: 'NO ACTION' },
  // Financial event ledger
  { table: 'financial_events', column: 'order_id', references: 'orders', onDelete: 'NO ACTION' },
  { table: 'financial_events', column: 'order_vendor_segment_id', references: 'order_vendor_segments', onDelete: 'NO ACTION' },
  { table: 'financial_events', column: 'delivery_id', references: 'deliveries', onDelete: 'NO ACTION' },
  { table: 'financial_events', column: 'payment_id', references: 'payments', onDelete: 'NO ACTION' },
  { table: 'financial_events', column: 'vendor_branch_id', references: 'vendor_branches', onDelete: 'NO ACTION' },
  { table: 'financial_events', column: 'driver_id', references: 'drivers', onDelete: 'NO ACTION' },
  { table: 'financial_events', column: 'related_event_id', references: 'financial_events', onDelete: 'NO ACTION' },
  { table: 'financial_events', column: 'actor_user_id', references: 'users', onDelete: 'NO ACTION' },
  // Settlement periods
  { table: 'vendor_settlement_periods', column: 'vendor_branch_id', references: 'vendor_branches', onDelete: 'NO ACTION' },
  { table: 'vendor_settlement_periods', column: 'closed_by_user_id', references: 'users', onDelete: 'NO ACTION' },
  { table: 'driver_settlement_periods', column: 'driver_id', references: 'drivers', onDelete: 'NO ACTION' },
  { table: 'driver_settlement_periods', column: 'closed_by_user_id', references: 'users', onDelete: 'NO ACTION' },
  // Employee loans (employee_user_id / employee_loan_id already have FKs)
  { table: 'employee_loans', column: 'issued_by_user_id', references: 'users', onDelete: 'NO ACTION' },
  { table: 'employee_loan_repayments', column: 'recorded_by_user_id', references: 'users', onDelete: 'NO ACTION' },
  // Ad-hoc purchase records (recorded_by_driver_id / order_item_id already have FKs)
  { table: 'ad_hoc_purchase_records', column: 'recorded_by_user_id', references: 'users', onDelete: 'NO ACTION' },
  // Operational: device tokens are owned by, and meaningless without, their user
  { table: 'device_tokens', column: 'user_id', references: 'users', onDelete: 'CASCADE' },
];

const constraintName = (fk: ForeignKey): string => `fk_${fk.table}_${fk.column}`;

export class LedgerReferentialIntegrity1700003800000 implements MigrationInterface {
  name = 'LedgerReferentialIntegrity1700003800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const orphaned: string[] = [];
    for (const fk of FOREIGN_KEYS) {
      const [{ n }] = await queryRunner.query(
        `SELECT count(*)::int AS n FROM "${fk.table}" t
         WHERE t."${fk.column}" IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM "${fk.references}" p WHERE p."id" = t."${fk.column}")`,
      );
      if (n > 0) orphaned.push(`${fk.table}.${fk.column} -> ${fk.references}: ${n} orphan row(s)`);
    }
    if (orphaned.length > 0) {
      throw new Error(
        `Refusing to add foreign keys — existing rows reference records that do not exist. ` +
          `No data was changed; remediate these deliberately, then re-run: ${orphaned.join('; ')}`,
      );
    }

    for (const fk of FOREIGN_KEYS) {
      await queryRunner.query(
        `ALTER TABLE "${fk.table}" ADD CONSTRAINT "${constraintName(fk)}" ` +
          `FOREIGN KEY ("${fk.column}") REFERENCES "${fk.references}" ("id") ON DELETE ${fk.onDelete}`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const fk of [...FOREIGN_KEYS].reverse()) {
      await queryRunner.query(`ALTER TABLE "${fk.table}" DROP CONSTRAINT IF EXISTS "${constraintName(fk)}"`);
    }
  }
}

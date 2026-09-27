/**
 * The reviewed, expected foreign-key policy for the reference columns that were
 * originally created without one (Group 7A). This list is DELIBERATELY
 * independent of the migration's own list: the integration tests compare the
 * real PostgreSQL schema against it, so a migration mistake cannot go unnoticed.
 */
export interface ExpectedForeignKey {
  table: string;
  column: string;
  references: string;
  onDelete: 'NO ACTION' | 'CASCADE';
  nullable: boolean;
  /** Ledger / audit data whose rows must never disappear or lose their reference. */
  financialHistory: boolean;
}

const ledger = (table: string, column: string, references: string, nullable: boolean): ExpectedForeignKey => ({
  table, column, references, nullable, onDelete: 'NO ACTION', financialHistory: true,
});

export const ADDED_FOREIGN_KEYS: ExpectedForeignKey[] = [
  ledger('wallet_transactions', 'customer_id', 'users', false),
  ledger('wallet_transactions', 'order_id', 'orders', true),
  ledger('wallet_transactions', 'created_by_user_id', 'users', true),
  ledger('loyalty_points_transactions', 'customer_id', 'users', false),
  ledger('loyalty_points_transactions', 'order_id', 'orders', true),
  ledger('loyalty_points_transactions', 'created_by_user_id', 'users', true),
  ledger('driver_cash_remainders', 'order_id', 'orders', false),
  ledger('driver_cash_remainders', 'delivery_id', 'deliveries', false),
  ledger('driver_cash_remainders', 'driver_id', 'drivers', false),
  ledger('driver_cash_remainders', 'customer_id', 'users', false),
  ledger('driver_cash_remainders', 'reviewed_by_user_id', 'users', true),
  ledger('failed_delivery_resolutions', 'order_id', 'orders', false),
  ledger('failed_delivery_resolutions', 'resolved_by_user_id', 'users', false),
  ledger('financial_events', 'order_id', 'orders', true),
  ledger('financial_events', 'order_vendor_segment_id', 'order_vendor_segments', true),
  ledger('financial_events', 'delivery_id', 'deliveries', true),
  ledger('financial_events', 'payment_id', 'payments', true),
  ledger('financial_events', 'vendor_branch_id', 'vendor_branches', true),
  ledger('financial_events', 'driver_id', 'drivers', true),
  ledger('financial_events', 'related_event_id', 'financial_events', true),
  ledger('financial_events', 'actor_user_id', 'users', true),
  ledger('vendor_settlement_periods', 'vendor_branch_id', 'vendor_branches', false),
  ledger('vendor_settlement_periods', 'closed_by_user_id', 'users', true),
  ledger('driver_settlement_periods', 'driver_id', 'drivers', false),
  ledger('driver_settlement_periods', 'closed_by_user_id', 'users', true),
  ledger('employee_loans', 'issued_by_user_id', 'users', false),
  ledger('employee_loan_repayments', 'recorded_by_user_id', 'users', false),
  ledger('ad_hoc_purchase_records', 'recorded_by_user_id', 'users', true),
  // Operational data, not a ledger — see the migration header for the CASCADE rationale.
  { table: 'device_tokens', column: 'user_id', references: 'users', onDelete: 'CASCADE', nullable: false, financialHistory: false },
];

/**
 * uuid `*_id` columns that intentionally have NO foreign key. Each needs a reason; the
 * schema test fails if a column is FK-less and missing from this list, or listed here
 * but actually constrained — so an omission is always a reviewed decision.
 */
export const INTENTIONALLY_UNCONSTRAINED: Array<{ ref: string; reason: string }> = [
  {
    ref: 'order_items.product_id',
    reason:
      'Historical snapshot pointer: the order line stores product_name_snapshot/unit_price_minor and must stay readable if the catalog row is later changed or removed (order-item.entity.ts, InitialSchema). Set only from the loaded Product in the order-creation transaction.',
  },
  {
    ref: 'order_items.applied_offer_id',
    reason:
      'Read-optimization cache of the winning offer; the authoritative record is offer_consumptions, which DOES have an FK to offers (order-item.entity.ts documents this as deliberate).',
  },
  {
    ref: 'order_vendor_segments.applied_offer_id',
    reason: 'Same snapshot convention as order_items.applied_offer_id (order-vendor-segment.entity.ts).',
  },
  {
    ref: 'product_ratings.product_id',
    reason:
      'Rating must stay historically understandable independent of the live Product row; mirrors order_items.product_id (Ratings migration header).',
  },
];

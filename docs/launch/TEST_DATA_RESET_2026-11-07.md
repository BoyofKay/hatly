# Production test-data reset — 2026-11-07

Authorised by the owner ("Hatly has not started real commercial operations"). Executed 2026-11-07 ~21:01 UTC in one transaction.

## Classification evidence
- All 33 orders: HT-100001…HT-100033, created 2026-10-28 → 2026-11-07, i.e. pre-launch. The Customer App is only in Play closed testing.
- All 5 payments were MANUAL_TRANSFER; the 4 verified ones were verified by the single owner admin account. No card or gateway payments existed.
- No kept table holds a foreign key into the deleted set (checked against `information_schema`). The only kept references are 58 rows in `admin_audit_logs`, which are append-only.

## Rows removed (table: count)
- orders: 33
- order_items: 56
- order_item_weight_records: 0
- order_notes: 0
- order_status_events: 114
- order_vendor_segments: 36
- order_vendor_segment_events: 57
- order_exceptions: 0
- order_exception_items: 0
- order_exception_events: 0
- deliveries: 7
- dispatch_alerts: 22
- dispatch_attempts: 34774
- alert_acknowledgements: 0
- proof_of_deliveries: 3
- failed_delivery_resolutions: 0
- payments: 5
- refund_payouts: 0
- financial_events: 6
- ad_hoc_purchase_records: 2
- wallet_transactions: 0
- wallet_adjustments: 0
- loyalty_points_transactions: 2
- offer_consumptions: 2
- driver_cash_remainders: 0
- driver_settlement_periods: 0
- vendor_settlement_periods: 0
- settlement_payments: 0
- driver_ratings: 0
- vendor_ratings: 0
- product_ratings: 0
- customer_notifications: 72
- staff_notifications: 14
- notification_outbox: 0
- change_events: 130
- report_exports: 1
- uploads(proof photos): 3
- products.delivered_quantity/weight counters reset: 5 products
- drivers.is_available set true: 1

## Kept (after-counts)
- users: 16
- vendors: 34
- vendor_branches: 33
- products: 226
- product_categories: 63
- drivers: 1
- business_config: 17
- admin_audit_logs: 202
- uploads: 4
- offers: 1
- addresses: 10
- carts: 47
- Also untouched: config, delivery zones, service areas, vehicle types, permissions, campaigns, banners, integration checks, system HTTP metrics (infrastructure telemetry, not business statistics), Redis sessions.

## Safety
- Backup `hatly-prod-20261107T210039Z.dump` (sha256 53fc10436bbd…). Restore drill OK. Off-host copy in `~/Downloads/hatly-backups/prod/`.
- Uploads tarball `hatly-prod-uploads-20261107T210040Z.tar.gz` copied off-host.
- Dry run with ROLLBACK first. The live run used guards that abort on any unexpected order or payment.
- To restore: `prod.sh restore <dump>` per RUNBOOK. This would also restore the test orders.

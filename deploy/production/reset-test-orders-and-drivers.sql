-- =====================================================================================================================================
-- Hatly — remove TEST orders and TEST drivers from production, keep customers (owner request 2026-11-21).
--
-- KEEPS: every customer account and profile (users with role CUSTOMER, their addresses, favourites and carts), all stores, branches,
--        menus, categories, offers (their usage counters are reset), zones, service areas, staff accounts, settings, audit log.
-- REMOVES: every order created at or before :cutoff and everything that only exists because of those orders (items, store segments,
--        status history, deliveries, dispatch attempts/alerts, payments, proofs of delivery, exceptions, notes, ratings, money events,
--        settlement periods/lines/payments, wallet and loyalty movements made BY those orders, notifications/alerts about them);
--        every driver (driver profile, capacity overrides, settlements) — their sign-in accounts are switched off and their phone numbers
--        freed (rows kept as deleted, so nothing that still points at them breaks).
-- RESETS: product sales counters and ratings, branch ratings, offer usage counters (they only counted the test orders).
-- DOES NOT CHANGE: tracked stock quantities (do a stock count in the dashboard after this), wallet / loyalty movements that are NOT tied
--        to an order (e.g. manual adjustments — listed at the end so you can decide), employee loans, uploaded files on disk.
--
-- SAFETY
--   * One transaction. DRY RUN by default: it prints what it would do, then ROLLS BACK. Nothing changes unless you pass -v apply=yes.
--   * Refuses to run if ANY order is newer than :cutoff (a real order placed after launch is never deleted by mistake).
--   * Take a backup first (prod.sh backup) and keep it off the server.
--
-- HOW TO RUN (on the production host, in the release's deploy/production folder):
--   1) ./prod.sh backup                                                     (and copy the dump off the server)
--   2) ./reset-test-orders-and-drivers.sh "2026-11-21 23:59:59+02"          DRY RUN: read the BEFORE / AFTER numbers
--   3) ./reset-test-orders-and-drivers.sh "2026-11-21 23:59:59+02" apply    asks you to type DELETE, then commits
--   Tested end to end: apps/backend/test/e2e/147-reset-test-orders-script.e2e-spec.ts
-- =====================================================================================================================================
\set ON_ERROR_STOP on
\if :{?cutoff}
\else
  \echo 'ERROR: pass the cutoff, e.g. -v cutoff=''2026-11-21 23:59:59+02'' (every order up to this moment is treated as a test order).'
  \quit
\endif
\if :{?apply}
\else
  \set apply no
\endif

BEGIN;
SELECT set_config('hatly.reset_cutoff', (:'cutoff')::timestamptz::text, true) AS cutoff_used;

-- ---------------------------------------------------------------------------------------------------------------- guards
DO $$
DECLARE newer int; total int;
BEGIN
  SELECT count(*) INTO total FROM orders;
  SELECT count(*) INTO newer FROM orders WHERE created_at > current_setting('hatly.reset_cutoff')::timestamptz;
  RAISE NOTICE 'Orders in database: %, newer than the cutoff: %', total, newer;
  IF newer > 0 THEN
    RAISE EXCEPTION 'STOP: % order(s) were created after the cutoff. They may be real. Nothing was changed. Check them first.', newer;
  END IF;
END $$;

CREATE TEMP TABLE t_orders ON COMMIT DROP AS SELECT id FROM orders WHERE created_at <= :'cutoff'::timestamptz;
CREATE TEMP TABLE t_drivers ON COMMIT DROP AS SELECT id, user_id FROM drivers;
CREATE TEMP TABLE t_segments ON COMMIT DROP AS SELECT id FROM order_vendor_segments WHERE order_id IN (SELECT id FROM t_orders);
CREATE TEMP TABLE t_items ON COMMIT DROP AS SELECT id FROM order_items WHERE order_vendor_segment_id IN (SELECT id FROM t_segments);
CREATE TEMP TABLE t_deliveries ON COMMIT DROP AS SELECT id FROM deliveries WHERE order_id IN (SELECT id FROM t_orders) OR driver_id IN (SELECT id FROM t_drivers);
CREATE TEMP TABLE t_events ON COMMIT DROP AS
  SELECT id FROM financial_events
   WHERE order_id IN (SELECT id FROM t_orders) OR driver_id IN (SELECT id FROM t_drivers) OR delivery_id IN (SELECT id FROM t_deliveries)
      OR order_vendor_segment_id IN (SELECT id FROM t_segments) OR payment_id IN (SELECT id FROM payments WHERE order_id IN (SELECT id FROM t_orders));
CREATE TEMP TABLE t_wallet_tx ON COMMIT DROP AS SELECT id FROM wallet_transactions WHERE order_id IN (SELECT id FROM t_orders);

\echo '== BEFORE =='
SELECT 'orders' AS what, count(*) FROM t_orders
UNION ALL SELECT 'drivers', count(*) FROM t_drivers
UNION ALL SELECT 'customers (kept)', count(*) FROM users WHERE role = 'CUSTOMER' AND deleted_at IS NULL
UNION ALL SELECT 'financial events (to remove)', count(*) FROM t_events
UNION ALL SELECT 'financial events (all)', count(*) FROM financial_events
UNION ALL SELECT 'vendor settlement periods', count(*) FROM vendor_settlement_periods
UNION ALL SELECT 'driver settlement periods', count(*) FROM driver_settlement_periods
UNION ALL SELECT 'wallet movements from orders', count(*) FROM t_wallet_tx
UNION ALL SELECT 'loyalty movements from orders', count(*) FROM loyalty_points_transactions WHERE order_id IN (SELECT id FROM t_orders);

-- ---------------------------------------------------------------------------------------------------------------- settlements
-- All settlement periods are built only from orders/deliveries; with every order gone they describe nothing.
DELETE FROM settlement_payments;
DELETE FROM vendor_settlement_period_lines;
DELETE FROM vendor_settlement_periods;
DELETE FROM driver_settlement_period_orders;
DELETE FROM driver_settlement_periods;

-- ---------------------------------------------------------------------------------------------------------------- money tied to the orders
DELETE FROM refund_payouts WHERE financial_event_id IN (SELECT id FROM t_events);
UPDATE financial_events SET related_event_id = NULL WHERE related_event_id IN (SELECT id FROM t_events);
DELETE FROM financial_events WHERE id IN (SELECT id FROM t_events);
DELETE FROM wallet_adjustments WHERE wallet_transaction_id IN (SELECT id FROM t_wallet_tx);
DELETE FROM wallet_transactions WHERE id IN (SELECT id FROM t_wallet_tx);
DELETE FROM loyalty_points_transactions WHERE order_id IN (SELECT id FROM t_orders);
DELETE FROM offer_consumptions WHERE order_id IN (SELECT id FROM t_orders);

-- ---------------------------------------------------------------------------------------------------------------- order detail
DELETE FROM product_ratings WHERE order_item_id IN (SELECT id FROM t_items);
DELETE FROM vendor_ratings WHERE order_vendor_segment_id IN (SELECT id FROM t_segments);
DELETE FROM driver_ratings WHERE delivery_id IN (SELECT id FROM t_deliveries) OR driver_id IN (SELECT id FROM t_drivers);
DELETE FROM proof_of_deliveries WHERE order_id IN (SELECT id FROM t_orders) OR driver_id IN (SELECT id FROM t_drivers);
DELETE FROM driver_cash_remainders WHERE order_id IN (SELECT id FROM t_orders) OR driver_id IN (SELECT id FROM t_drivers);
DELETE FROM failed_delivery_resolutions WHERE order_id IN (SELECT id FROM t_orders);
DELETE FROM ad_hoc_purchase_records WHERE order_item_id IN (SELECT id FROM t_items) OR recorded_by_driver_id IN (SELECT id FROM t_drivers);
DELETE FROM order_item_weight_records WHERE order_item_id IN (SELECT id FROM t_items) OR recorded_by_driver_id IN (SELECT id FROM t_drivers);
UPDATE order_items SET removal_exception_id = NULL WHERE id IN (SELECT id FROM t_items) AND removal_exception_id IS NOT NULL;
DELETE FROM order_exception_items WHERE order_item_id IN (SELECT id FROM t_items);
DELETE FROM order_exceptions WHERE order_id IN (SELECT id FROM t_orders); -- its events, items and staff notifications go with it (ON DELETE CASCADE)
DELETE FROM dispatch_attempts WHERE order_id IN (SELECT id FROM t_orders) OR driver_id IN (SELECT id FROM t_drivers);
DELETE FROM dispatch_alerts WHERE order_id IN (SELECT id FROM t_orders); -- ops alerts / push deliveries cascade
DELETE FROM deliveries WHERE id IN (SELECT id FROM t_deliveries);
DELETE FROM payments WHERE order_id IN (SELECT id FROM t_orders);
DELETE FROM order_notes WHERE order_id IN (SELECT id FROM t_orders);
DELETE FROM order_vendor_segment_events WHERE order_id IN (SELECT id FROM t_orders);
DELETE FROM orders WHERE id IN (SELECT id FROM t_orders); -- segments, items, status events, change feed, customer/staff notifications, ops alerts cascade

-- ---------------------------------------------------------------------------------------------------------------- drivers
DELETE FROM driver_capacity_overrides WHERE driver_id IN (SELECT id FROM t_drivers);
DELETE FROM drivers WHERE id IN (SELECT id FROM t_drivers);
DELETE FROM device_tokens WHERE user_id IN (SELECT user_id FROM t_drivers);
UPDATE users SET is_active = false, deleted_at = coalesce(deleted_at, now()), phone = 'del-' || left(replace(id::text, '-', ''), 16), updated_at = now()
 WHERE id IN (SELECT user_id FROM t_drivers) AND role = 'DRIVER';

-- ---------------------------------------------------------------------------------------------------------------- counters that only counted test orders
UPDATE products SET delivered_quantity_count = 0, delivered_weight_grams_count = 0, rating_count = 0, rating_sum_stars = 0
 WHERE delivered_quantity_count <> 0 OR delivered_weight_grams_count <> 0 OR rating_count <> 0 OR rating_sum_stars <> 0;
UPDATE vendor_branches SET rating_count = 0, rating_sum_stars = 0 WHERE rating_count <> 0 OR rating_sum_stars <> 0;
UPDATE offers SET consumed_units_count = 0, consumed_discount_minor = 0 WHERE consumed_units_count <> 0 OR consumed_discount_minor <> 0;

\echo '== AFTER =='
SELECT 'orders' AS what, count(*) FROM orders
UNION ALL SELECT 'drivers', count(*) FROM drivers
UNION ALL SELECT 'customers (kept)', count(*) FROM users WHERE role = 'CUSTOMER' AND deleted_at IS NULL
UNION ALL SELECT 'stores (kept)', count(*) FROM vendors WHERE deleted_at IS NULL
UNION ALL SELECT 'products (kept)', count(*) FROM products WHERE deleted_at IS NULL
UNION ALL SELECT 'financial events left (not order/driver related)', count(*) FROM financial_events
UNION ALL SELECT 'wallet movements left (not from orders — decide yourself)', count(*) FROM wallet_transactions
UNION ALL SELECT 'loyalty movements left (not from orders — decide yourself)', count(*) FROM loyalty_points_transactions
UNION ALL SELECT 'employee loans (kept)', count(*) FROM employee_loans;

\if :apply
  \echo '== APPLYING: COMMIT =='
  COMMIT;
\else
  \echo '== DRY RUN ONLY: ROLLBACK (nothing changed). Re-run with -v apply=yes to apply. =='
  ROLLBACK;
\endif

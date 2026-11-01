# Order operations milestone — release notes and deployment checklist (2026-10-30)

**Status: implemented and tested LOCALLY. NOT deployed. The migration was applied only to the local `hatly_dev` / disposable test databases. Nothing was changed in Production
(no deploy, no migration, no configuration, no database record, no DNS/Caddy/Cloudflare/MFA/payment/Maps change, nothing uploaded to Google Play). Nothing was committed or pushed.**
Decision record: `docs/PRODUCT_DECISIONS.md` **PD-013**.

## 1. What changed

| Area | Change |
|---|---|
| Partial rejection | A vendor part is rejected with a **required reason**; only that part is cancelled. Money rules are unchanged (PD-002/003/004): base delivery fee fixed, one additional-vendor fee less per rejected vendor, last active part ⇒ whole order cancelled + refunded, a repeated/concurrent rejection never refunds twice. |
| History | New `order_vendor_segment_events` (actor user, role, previous/new state, time, reason, on-behalf flag) written in the same transaction as every segment transition (incl. order creation and automatic acceptance). |
| On-behalf handling | `PATCH admin/orders/segments/:id/status`, permission **`MANAGE_ORDER_FULFILMENT`** (new; SUPER_ADMIN always). Same transition code as the vendor endpoint. Dashboard: vendor-parts card on the order detail (accept / start preparing / mark ready / reject-with-reason, history with "on behalf of the vendor"). |
| Acceptance mode | Per branch (`auto_accept_enabled`, default manual): automatic = **accepted only**, never preparing/ready. Control on the branch page. The dead global "Vendor Segment Auto-Accept" setting is removed from the Dashboard and the backend reader. |
| Dispatch | Never silent: one open alert per (order, reason) for `AUTO_ASSIGN_DISABLED`, `NO_ELIGIBLE_DRIVER`, `ASSIGNMENT_ERROR`, `DRIVER_NOT_RESPONDING` (3 unanswered attempts); `dispatch_attempts` log; an assignment resolves the alerts; a dispatch error never fails a committed vendor transition. |
| Hatly / Wasally | No vendor: the segment becomes READY_FOR_PICKUP by itself once the payment gate passes (Manual Transfer only after approval), through the same state machine. |
| Refunds | Manual Transfer refund = ledger obligation; `refund_payouts` records "actually sent" (`VERIFY_MANUAL_PAYMENTS`). Dashboard: "Refunds to send" on the Manual Transfer page; refund summary on the order detail. |
| Operations visibility | Control Tower `operations` facts (5-minute pending-acceptance threshold, `expectedReadyAt` overdue, alerts by reason, refunds to send, partially rejected orders); navigation counter + persistent banner (20 s polling, pauses when the tab is hidden). |
| Vendor Dashboard | Order list auto-refreshes every 20 s, NEW indicator + awaiting-acceptance badge + tab title count, optional sound (off by default, remembered), required rejection reason, history with the "Hatly operations, on your behalf" label. |
| Customer app | Order details: "part of your order was cancelled" card, rejection reason on the rejected vendor, honest refund lines (wallet / transfer pending / transfer sent / pending review); notification text `ORDER_PART_CANCELLED` in Arabic + English; vendor listing for a **manual address** is filtered by its delivery zone (`GET /vendors?deliveryZoneId=`). |

## 2. The single migration

`apps/backend/src/database/migrations/1700006400000-OrderOperations.ts` (65th). Additive and reversible (`down` verified): tables `order_vendor_segment_events`, `dispatch_attempts`, `refund_payouts`;
columns `deliveries.consecutive_unanswered`, `dispatch_alerts.detail`, `dispatch_alerts.resolved_by_user_id`; a partial unique index `UQ_dispatch_alerts_open` (one open alert per order and reason) — older duplicate open alerts are **resolved, never deleted**.
Backward compatibility: the old backend keeps working on the new schema (nothing it reads was removed). The new API fields are additive (older Customer/Driver/Dashboard builds ignore them). The Customer app's `deliveryZoneId` query parameter is ignored by an older backend.

## 3. Deployment checklist (a person or an explicitly authorised task — not done)

1. Re-check Production health, `prod.sh plan` must list **exactly one** pending migration: `OrderOperations1700006400000` (65 total).
2. Upload + extract the new release; build the images under the new tag.
3. **Fresh verified backup** (`prod.sh backup`) and the restore drill on that dump.
4. `CONFIRM_MIGRATE=hatly_prod prod.sh migrate`.
5. `prod.sh apps` (backend then dashboard); verify `/api/v1/health/ready`, `GET /admin/control-tower/summary` (has `operations`), the Dashboard order detail, the branch page.
6. Smoke: place a COD order with two demo vendors → reject one with a reason (Vendor Dashboard) → the Customer app shows the cancelled-part card; the Control Tower counter/banner follow.
7. Grant `MANAGE_ORDER_FULFILMENT` to the operations staff who may act for vendors (Dashboard → Users). It is **not** granted to anyone automatically.
8. Customer AAB (versionCode > 4) only after the above; upload by the owner.
9. Rollback: previous release + `prod.sh apps`; the migration is additive; restore the verified dump into a NEW database if data must go back.

## 4. Owner actions still required

* **`REGISTERED_VENDOR_ADDITIONAL_VENDOR_FEE_MINOR`**: Production still has no value; the owner must enter **`500`** (EGP 5 per extra vendor) in Dashboard → Settings. This work did not touch it. Until then checkout for registered vendors in Production is blocked.
* ~~Customer cancellation of Hatly/Wasally orders~~ and ~~coupon / discount restoration~~: decided and implemented — see PD-014 and §5 below.
* Grant the new permission; set `AUTOMATIC_DISPATCH_ENABLED` as intended (if off, every ready order raises an `AUTO_ASSIGN_DISABLED` alert — by design).

## 5. Addendum (2026-10-30) — PD-014: customer cancellation of Hatly/Wasally orders and discount/coupon restoration

Local only; **no new migration** (it reuses `offer_consumptions.is_reversed/reversed_at`, which already exist). Customer: a Hatly/Wasally order is cancellable until a driver is assigned (wallet refund / COD adjustment / Manual Transfer obligation unchanged), safely against a concurrent assignment. Offers: a rejected vendor part, or a cancelled order, gives back its subtotal-discount/coupon entitlement exactly once (usage limit, budget cap, per-customer limit), with no extra refund. Full rules, formula and worked example: `docs/PRODUCT_DECISIONS.md` PD-014. Deployment impact: backend only (no Dashboard or app change is required; the order-details `customerCanCancel` flag already drives the Customer app's Cancel button). Operational note: after this release a previously consumed coupon use returns when its part is rejected — expect `consumed_units_count` to move down on rejection.

## 6. Addendum (2026-10-30) — PD-015 compensating financial event; Customer Home banner/loading

**PD-015 (backend, no migration):** every reversed discount consumption appends `HATLY_FUNDED_OFFER_DISCOUNT_RESTORED` (linked to the original and the segment, idempotent, same transaction); net = recorded − restored; admin order detail + Dashboard show it. Orders cancelled before this release are not backfilled. **Customer app:** Home no longer waits for the product composition before showing the banner and categories (see LAUNCH_PROGRESS §3w); requires a new Customer build, no backend change.

# Enterprise Admin Panel — implementation addendum

This addendum records what was built and **supersedes** earlier wording in the five FINAL_* documents where they differ.

## Superseded wording (approved corrections B1–B5)

| Earlier text | Now |
|---|---|
| Decision Register **D-26**, API plan lines on `net_payable_minor`, Master Spec §8: “vendor payable = gross sales − commission”. | **Wrong and withdrawn (B1).** Gross sales are **not** owed by Hatly to the vendor (the customer pays the vendor directly or through the order flow). The vendor ledger is **Hatly's receivable commission from the vendor**. Amount due for a vendor period = `total_commission_owed_minor`, direction `COLLECTION` (Hatly collects). |
| Driver payable | Amount due = \|`net_payable_minor`\|; direction `PAYOUT` when ≥ 0, `COLLECTION` when negative (the driver owes Hatly). |
| “Provisional accounting policy” banner (U-01) | Not shown: the policy is the approved B1/B5 model above. Nothing is estimated. |
| Driver Accept / Reject | Does not exist (B3). Drivers are assigned automatically or manually by an admin. |

Settlement status is derived, never stored: `NOTHING_DUE`, `UNPAID`, `PARTIAL`, `PAID`, `OVERPAID`. Payments are rows in `settlement_payments` (idempotent through the `Idempotency-Key` header), are voided only by a reversing row, and an overpayment needs the `APPROVE_SETTLEMENT_OVERPAYMENT` permission plus a reason.

## Migrations (additive, forward-compatible, verified up → down → up on a scratch database)

| # | Name | Adds |
|---|---|---|
| 66 | `EnterpriseAdminCore1700006500000` | permission templates, saved views, alert acknowledgements, order notes, customer notes, wallet adjustments, settlement payments, report exports, `hidden_*` columns on rating tables, `products.low_stock_threshold` |
| 67 | `MediaPlatform1700006600000` | `media_assets`, `media_variants`, `product_media`, nullable `*_media_asset_id` foreign keys (RESTRICT) |
| 68 | `MarketingCampaigns1700006700000` | audiences, notification broadcasts + recipients, customer inbox messages, campaigns + items + events, `offers.audience_id` / `created_by_user_id`. (`coupon_grants` is created but unused — no coupon-grant feature ships.) |
| 69 | `MonitoringAndReportIndexes1700006800000` | `system_metric_buckets`, `integration_checks`, date indexes |

No existing column is dropped or retyped. Down migrations are for non-production only.

## Backend modules (`apps/backend/src/modules/admin-platform`)

Executive (KPIs, time series, alerts + acknowledgement, SLA, global search) · permission templates · finance (ledger, revenue, vendor receivables, discounts, liabilities, reconciliation R2/R3/R3D/R4/R5/R6, payments, refunds, settlements and statements, record / void payments) · order extras (admin cancel through the state machine, notes, timeline, capabilities) · customers (summary, wallet, loyalty, addresses, ratings, coupons, notes, block/unblock, audited PII reveal, wallet adjustments with a four-eyes threshold, rating hide/unhide) · reports (23 definitions, CSV / XLSX / PDF, Cairo time zone, asynchronous queue) · media (sharp pipeline, lifecycle) · marketing (audiences, broadcasts, inbox, offer edit / clone / performance, campaigns, growth) · directory (branches, products, inventory, bulk actions, drivers, live fleet) · system (probes, metrics, jobs, client telemetry, configuration overview, automatic-dispatch switch).

## Rules enforced in code

- Money is integer minor units. Dates are Africa/Cairo calendar days, converted in PostgreSQL.
- Every new route carries a permission (single or any-of). Customer PII, financial figures and exports are gated separately; SUPER_ADMIN bypasses.
- Every state-changing admin route writes an audit row (global interceptor, or an explicit entry for the reviewed list enforced by e2e test 94).
- Media: byte-based type detection, 40 MP limit, EXIF stripped, WebP display (≤ 1600) and thumbnail (≤ 320), de-duplication by SHA-256, soft delete, purge refuses any asset still referenced (including by order snapshots). Existing URLs are never rewritten.
- Campaigns never compute a discount; they switch existing offers / banners and broadcasts on a schedule. Broadcasts and campaigns need a second administrator's approval; broadcasts respect quiet hours and one message per customer per day.
- Wallet adjustments above the threshold need another administrator; a debit cannot overdraw the wallet.

## Known limits (stated, not hidden)

- Production has no Firebase / SMS configuration, so those probes show “Not configured”; broadcasts reach the in-app inbox only until push is configured. The **customer-app inbox screen is not built**, so inbox messages are stored and counted but not yet visible to customers.
- No broadcast “send test”, no coupon grants, no replace-everywhere media action, no bulk resend / assign for orders.
- Branch cover images are stored but the customer app does not read them yet.
- Performance figures are server-side and lab measurements; no device-level Lighthouse run. Arabic copy has not had a native-speaker review.
- New permissions must be granted to existing ADMIN users (templates make this one step); until then they see masked or limited data. SUPER_ADMIN is unaffected.
- Open owner decision carried over from the order-operations work: `REGISTERED_VENDOR_ADDITIONAL_VENDOR_FEE_MINOR` (proposed 500).

## Program scope after the owner decisions of 2026-10-31

Decisions: `PRODUCT_DECISIONS.md` **PD-016** and `FINAL_DECISION_REGISTER.md` **D-76…D-79**. Effects on the Marketplace Transformation plan:

| Item | Before | Now |
|---|---|---|
| Actual-weight price difference | Customer must approve before the order continues | **C4 as defined — no approval step**; settled in cash portion / wallet credit |
| Product substitution (suggest / choose / approve) | Planned (Phase 5, scenarios 9–11) | **Removed entirely** |
| Unavailable product after ordering | Replacement workflow | Customer continues without the item(s) or cancels the entire order; Operations records the decision when the customer does not respond |
| Phase 5 (Customer + Driver integration) | Substitution, weight approval, notifications | One two-option response screen, the unavailable-item notification, the Operations queue entry; driver actual-weight behaviour unchanged |
| Acceptance scenarios | 9, 10, 11, 14, 15 | Withdrawn. 12 → "no response → Operations records the decision". 13 → "actual weight changes the price and is settled per C4". New: continue-without and cancel-entire-order |

No code needs removing: the repository contains no substitution or weight-approval feature (verified 2026-10-31). Open design defaults taken inside PD-016 (listed there as item 6): the in-app "cancel" choice is queued for Operations execution rather than creating a new customer cancellation permission.

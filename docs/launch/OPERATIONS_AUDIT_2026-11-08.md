# Hatly — Operations, Real-Time Alerts, Payments, Settlement & Reporting Audit

**Date:** 2026-11-08 · **Baseline:** production release `20261107T223459Z-7b9dd3cbe3b3` (code `eeaedb6`, docs `71a36b6`) · **Scope:** audit and design only — nothing in code, schema, data, configuration or production was changed.

**How evidence was gathered:** source code on `feature/register-release-1` (= master); read-only SQL against production (`SET default_transaction_read_only = on`); container environment *variable names only* (no values read); existing automated tests; provider documentation on the web. **Not done:** no real-device testing (I have no Android phone or Windows PC to drive; see §5.6 — this remains release-blocking), no gateway sandbox accounts, no provider sales quotes.

Legend: **[EXISTS]** verified in code/production · **[PROPOSED]** design, not built · **[DECISION]** needs an owner decision before it can be built · **[UNKNOWN]** evidence missing.

---

## 1. Executive summary

1. **Why new orders don't alert Admin (confirmed, four independent causes):**
   - (a) the backend has **no Operations "new order" alert type at all** — a new order alerts only the store's staff;
   - (b) **no store has any staff account** in production (`vendor_staff` = 0 rows), so even that alert has no recipient — your test order **HT-100035 (8 Nov 03:10) produced zero notifications of any kind**;
   - (c) the Admin dashboard has **no sound, no browser notification, no service worker, no PWA manifest and no Web Push** — nothing in it can make a noise or appear outside the tab;
   - (d) the "push" channel that does exist is Firebase (FCM) for the **mobile apps only**, sends only CRITICAL alerts, and **is not configured in production** (`ALLOW_MISSING_PUSH_PROVIDER` is set and no Firebase variables exist), so no push reaches anyone today — drivers and customers included.
2. **Fix (P0):** add Operations alert categories for new orders and the other operational events; give the Admin dashboard a service worker, Web Push (VAPID — no paid service needed), an in-tab alarm with sound/vibration that repeats until acknowledged, and a Notification Setup & Diagnostics screen. Background/locked-screen delivery on Android depends on Chrome and OS settings and **must be proven on real phones** before it is called done.
3. **Money: what exists is better than the screens suggest, but it does not match the operating model you now describe.** There is an append-only financial-event ledger, settlement periods with payment recording, void with reason, derived paid/partial/overpaid status, and a 21-report catalogue with CSV/Excel/PDF. Missing: driver **cash custody** (the system records what is due at the door, never what the driver holds or hands in), **shifts**, collection breakdown by method, a vendor statement with refunds/discounts, and database-level immutability of the ledger.
4. **Four requests in this brief conflict with approved rules** and need an explicit register amendment before design can be finalised (§4.3): manual transfers not blocking orders (vs **R2/R21**), InstaPay paid to the courier (vs **R20**, which retired unverified electronic-at-door payment), a "net payable to vendor" statement (vs **R25/R26/R32**, under which Hatly normally owes vendors nothing — the driver pays the vendor at pickup and the vendor owes Hatly commission), and a two-step vendor workflow (today three vendor actions; changing it is a workflow rule).
5. **Priority:** P0 = new-order alerting on Admin + push provider; P0 = rule decisions on payments (they gate all finance design); P1 = cash custody + shift closure, ledger immutability, operations queue screen; P2 = gateway, vendor statements, reports extensions.

---

## 2. Existing capabilities inventory

Classification: **1** implemented & verified · **2** implemented, not fully verified · **3** partial · **4** schema only · **5** missing · **6** unsafe/unreliable.

| Capability | Class | Evidence |
|---|---|---|
| Staff inbox (bell, Notification Center `/inbox`, read/unread, preferences, CRITICAL can't be muted) | 1 | `notifications/staff-alerts.service.ts`, `components/shell/StaffAlertsBell.tsx`, e2e `126`, `132`; Playwright `staff-alerts-and-live-updates` |
| Operations alert on **new order** | **5** | No category in `STAFF_ALERT_META` (`staff-alerts.service.ts:16-40`); `vendor-new-order-alerts.ts` alerts Ops only for branches in HATLY acceptance mode (0 of 33 in prod) |
| Vendor alert on new order | 2 (no recipients in prod) | `VENDOR_NEW_ORDER`; prod `vendor_staff` = 0 rows, `users` has no VENDOR role |
| Ops alerts: dispatch needed, transfer to verify, failed delivery, cancelled after assignment, exceptions, branch/product requests | 1 | categories in `staff-alerts.service.ts`; emitters `automatic-dispatch.service.ts:398`, `manual-transfer.service.ts:107`, `order-state-machine.service.ts:572` |
| Ops alerts: store not accepting, preparation late, driver not acknowledging, delivery late | 3 | computed as counts/`dispatch_alerts` (Control Tower, Action Center) but **no staff notification row and no sound**; prod shows HT-100034 `ACKNOWLEDGEMENT_OVERDUE` open, no inbox row for it |
| Live screen refresh (change feed) | 1 | `lib/changes/change-feed.ts` polls 8 s **only while the tab is visible**; 20 s legacy fallback; 120 s safety reload |
| Dashboard sound | 3 | Vendor board only, opt-in beep via Web Audio (`lib/vendor/orders-feed.tsx:41`); **none in Admin**; one beep, no repeat |
| Browser notifications / service worker / PWA manifest / Web Push | **5** | none in `apps/dashboard` (no `serviceWorker`, `Notification`, `PushManager`, manifest) |
| Mobile push outbox (FCM) with honest states, retry, back-off, lease, dead-letter, stats | 2 (code) / **6 in prod** | `notifications/outbox/notification-outbox.service.ts` (QUEUED→SENDING→SENT/FAILED/DEAD/SKIPPED); prod: Firebase not configured, `notification_outbox` empty, `device_tokens` empty |
| Staff device registration | **5** | `device-tokens.controller.ts` is `@Roles(DRIVER)`, customer controller `@Roles(CUSTOMER)`; no staff/admin endpoint |
| Notification acknowledgement (separate from read) / escalation / repeat | **5** | only `read_at`; no ack, no escalation rules |
| Control Tower, Action Center, Operations banner, order views, dispatch alerts | 1 | `admin-control-tower.service.ts`, `ActionCenter.tsx`, release UX-1 tests |
| Vendor board (accept/reject, preparing, ready, waiting time) | 1 | `app/(vendor)/orders`, segment state machine `PENDING→CONFIRMED→PREPARING→READY_FOR_PICKUP` |
| Acceptance mode AUTO/VENDOR/HATLY per branch | 1 | R12, e2e `136`; prod: 32 VENDOR, 1 AUTO |
| Financial-event ledger (typed events, idempotency key, related event, rate snapshot, actor) | 2 | `finance/financial-event.service.ts`, `financial_events` table; **append-only in code only** — table has `updated_at`/`deleted_at` and **no trigger** (only `admin_audit_logs` has one) |
| Vendor & driver settlement periods (contiguous, no overlap, unique index on period start) | 2 | `finance/settlement.service.ts`; prod 0 periods |
| Settlement payments (direction, method, reference, paid_on, void with reason, idempotency key, authorised overpayment) | 2 | `settlement_payments` columns; `admin-finance.controller.ts:125,149`; `settlement-status.ts` |
| Driver cash collection at the door | 3 | `cash_collection_sheet.dart` shows *amount due* and change; `driver_cash_remainders` puts change into the customer wallet; **no record of cash held / remitted** (`driver-earnings.service.ts:17` states this explicitly) |
| Driver shifts | **5** | no table, no code |
| Courier cash custody / remittance / shortage | **5** | none |
| Manual transfer verify / reject / refund recording | 1 | `admin-manual-transfer.*`, e2e `137` |
| Gateway payments | **5** (interface only) | `payments/payment-provider.interface.ts`, `providers/`; no live provider |
| Wallet ledger | 2 | `wallet/wallet.service.ts`; R23/R24 gaps listed in register |
| Reports catalogue (21 reports, one definition for screen/CSV/Excel/PDF, Cairo date ranges, permission-filtered) | 2 | `admin-platform/reports/report-registry.ts` (S01–S25), e2e `122` (14 tests), `/reports`, `/exports` |
| Finance screens: ledger, revenue, receivables, liabilities, reconciliation, settlements | 2 | `app/(admin)/finance/*`, `settlements`, `settlement` |
| Courier statement by custom range / shift | 3 | driver periods only (close "since last close"); no arbitrary range statement |
| Vendor statement incl. refunds, discounts, adjustments | 3 | period has only `gross_sales_minor`, `total_commission_owed_minor` |
| Monitoring of notification failures | 3 | outbox stats exist; no alert when push fails, no dashboard tile |
| SMS | **5 in prod** | `ALLOW_MISSING_SMS_PROVIDER` set |

---

## 3. Confirmed notification failure diagnosis

**Reproduced from production data, read-only:**

| Order | Created (UTC) | Notifications created |
|---|---|---|
| HT-100034 | 11-07 21:36 | 1 × `OPS_DISPATCH_NEEDED` (21:42, *after* the store stage) — **no new-order alert** |
| HT-100035 (your test) | 11-08 03:10 | **none** |

Root-cause chain, each step independently sufficient to cause silence:

1. **No event.** `notifyVendorsOfNewOrder()` (`orders/vendor-new-order-alerts.ts`) writes `VENDOR_NEW_ORDER` to store staff, and `OPS_ACCEPT_FOR_VENDOR` to Operations only when the branch is in HATLY mode. No branch is. Operations are never told an order arrived.
2. **No recipient.** Production has 0 `vendor_staff` rows; the store alert goes to nobody. (Hatly is in practice operating every store from Admin, which makes cause 1 decisive.)
3. **No attention mechanism in the Admin web app.** The bell is a number that refreshes every 30 s *only while the tab is visible* (`StaffAlertsBell.tsx:45`); the change feed also stops polling when hidden (`change-feed.ts:98`). No `Audio`, no `Notification`, no service worker. In Android Chrome a backgrounded tab is throttled and then frozen, so even polling stops.
4. **No push path to staff browsers, and no push in production at all.** Push is FCM to mobile device tokens, registration only for DRIVER/CUSTOMER, only CRITICAL categories, and the provider is not configured in production.

**Correction (design):** §5.

---

## 4. Missing and incomplete functionality

### 4.1 Operations
Ops alert categories for: new order, store not accepted (escalating), preparation late, ready for pickup, courier not acknowledged, courier delay, customer cancellation, payment issue, collection discrepancy, unsettled funds, shift closure overdue, vendor settlement overdue, system failure. Acknowledgement separate from read. Escalation/repeat. One-click actions from the alert.

### 4.2 Finance
Cash custody ledger for couriers; shifts; collections by method; remittance and shortage/excess; vendor statement with refunds/discounts/adjustments; custom-range statements; DB-enforced immutability; reconciliation of expected vs actual collections; gateway.

### 4.3 Rule conflicts that must be decided first [DECISION]

| # | Brief asks | Current approved rule | What must be decided |
|---|---|---|---|
| D1 | Manual transfers proceed like Pay on Delivery, no verification hold | **R2**: not shown to vendor, no dispatch until verified. **R21**: unverified transfers auto-cancel. Code: `vendor-order-visibility.ts`, `order-payment-gate.service.ts` | Amend R2/R21: the transfer becomes a *payment claim* that reduces "to collect" **only once verified**; until then the courier collects in full (or the order waits). Who carries the risk if a claimed transfer never arrives? |
| D2 | InstaPay paid to the courier | **R20**: `PAY_AT_DELIVERY` (electronic at door, unverified) not approved; no new orders | Re-approve it as a method with mandatory reference + Ops verification, or keep it out |
| D3 | Vendor statement "net payable to vendor", "amounts collected on vendor's behalf" | **R25/R26**: driver pays vendor for goods at pickup; **R32**: vendor receivables and commission separate, no netting | Does Hatly ever hold vendor money (gateway/transfer orders)? If the driver still pays the vendor at pickup, the vendor statement is "commission owed to Hatly + subscription", and "payable to vendor" is only refunds/compensation (R34) |
| D4 | Vendor does only Accept/Reject + Ready | Three vendor actions (Accept → Start preparing → Ready); `PREPARING` gates manual-transfer orders (PD-006) | Approve "Accept = start preparing" (auto-advance CONFIRMED→PREPARING) |
| D5 | Courier shift with incentives and deductions | **R45**: no deduction from the driver in any case; R28 commission only on delivery compensation; no incentive rule exists | Define incentives (if any) and confirm "deductions" means only recorded shortages the driver accepts — never automatic |
| D6 | Daily shift closure "reviewed and approved" by several people | **R29**: one Operations employee creates the settlement; no driver approval | Confirm maker/checker (prepared → reviewed → approved) is wanted |

---

## 5. Notification architecture and real-device test plan

### 5.1 Event model [PROPOSED]
- **`operational_alerts`** (one row per *condition*, e.g. "HT-100036 not accepted"): `key` (unique, dedup), `category`, `priority` P1–P4, `order_id`, `opened_at`, `acknowledged_at/by`, `resolved_at/by`, `escalation_level`, `next_escalation_at`. Resolution is automatic when the condition clears (state machine hook, like the dispatch-alert fix already shipped); acknowledgement only stops repeats.
- **`staff_notifications`** (existing) stays the per-person inbox, one row per alert per recipient per escalation level.
- **`notification_deliveries`** (extends the existing outbox): per device and channel — QUEUED → PROVIDER_ACCEPTED → (DEVICE_RECEIVED, reported by the service worker's `push` handler) → DISPLAYED (`showNotification` resolved) → CLICKED/ACKNOWLEDGED | FAILED | EXPIRED (410 Gone → subscription deactivated). "Delivered" is never claimed from QUEUED or PROVIDER_ACCEPTED alone.
- Created **in the same DB transaction** as the business change (the pattern already used), dispatched by the existing outbox worker (lease, retry with back-off, dead-letter).

### 5.2 Priorities [PROPOSED; repeat intervals configurable in business config]

| Priority | Events | In-tab | Push | Repeat until ack |
|---|---|---|---|---|
| P1 Critical | New order (store not accepting yet), no eligible courier, assignment failure, failed delivery, cancellation after assignment, system/integration failure | Full-screen banner, loud alarm tone, vibrate pattern | Yes, `requireInteraction`, renotify | Every 60 s, escalate to all Ops + Super Admin after N min, cap N repeats |
| P2 High | Store not accepted after X min, courier not acknowledged, preparation late, courier delay, payment issue, collection discrepancy | Banner + distinct tone | Yes | Every 3 min, cap |
| P3 Normal | Ready for pickup, transfer to verify, customer cancellation before assignment, product/store requests | Toast + soft chime | Optional per user | No |
| P4 Info | Settlement overdue, shift closure overdue, unsettled funds | Badge only | Daily digest | No |

Dedup by `key`; one open alert per condition; repeats update the same OS notification (`tag`) instead of stacking; global cap per user per minute.

### 5.3 Admin dashboard channels [PROPOSED]
1. **Service worker** (`/sw.js`) at the dashboard origin, plus a web app manifest (installable PWA on Android and desktop Chrome/Edge).
2. **Web Push with VAPID** (standard, no paid service; backend `web-push` library). New endpoint `POST /staff/push-subscriptions` (any staff role), multiple devices per user, expiry handling.
3. **Foreground alarm:** a shared alert listener in `AdminShell` driven by the change feed; plays a pre-unlocked `AudioContext` tone (unlocked by the "Enable sound" click), loops for P1 until acknowledged, `navigator.vibrate` on Android, flashes the tab title.
4. **Background:** push → service worker → `showNotification` (system sound/vibration of the Chrome notification channel; a web page **cannot** play custom looping audio in the background — repeats come from the server re-sending).
5. **Recovery:** on reconnect or tab focus, the client fetches open alerts since its last cursor; nothing is lost because the inbox row is the source of truth.
6. **Fallback channel [DECISION, paid]:** for P1 alerts not acknowledged in N minutes, an SMS/WhatsApp/phone call to the on-duty manager. No provider is configured; it would incur cost.

### 5.4 Platform reality (to be proven by tests, not assumed)
- Android Chrome, tab foreground: sound + vibration work after a user gesture.
- Android Chrome, backgrounded / other app / screen locked: Web Push normally shows a system notification if Chrome notifications are allowed and Chrome is not battery-restricted; in-page sound does not play.
- Tab closed, Chrome still installed: push still arrives via the service worker; if the user force-stops Chrome, it does not.
- Desktop Chrome/Edge/Firefox: push arrives while the browser process runs (Chrome can run in background on Windows/Linux); with the browser fully quit, no.
- Safari macOS supports Web Push; iOS only for an installed home-screen web app.
- **A dedicated Android device on the counter with the installed PWA, charger, "don't optimise battery" and notification sound set to an alarm channel is the most reliable operating setup** — this is a procedure, not a code feature.

### 5.5 Notification Setup & Diagnostics screen (`/settings/notifications`) [PROPOSED]
Shows: permission (granted/denied/default), service worker state, push subscription (endpoint host, created, last success), sound unlocked (yes/no, last test), vibration support, device name, last test sent/received/displayed, last failure with reason, last acknowledgement, PWA installed. Buttons: **Enable notifications**, **Enable sound** (plays a tone — the user gesture), **Send test notification** (server → push → device, timings shown per stage), **Test sound**. Denied permission → step-by-step instructions for Chrome Android/desktop. P1 categories cannot be turned off; only quiet hours for P3/P4.

### 5.6 Real-device acceptance tests (release-blocking, **not executed in this audit**)
Run each Android and desktop case listed in the brief (A1–A10, D1–D5). Record per case: device model, OS, browser version, PWA installed y/n, permission, battery mode, expected, actual, stage timings from the delivery table, pass/fail, limitation. Minimum matrix: one mid-range Android (Samsung or Xiaomi — aggressive battery management), one Pixel/stock Android, Windows 11 Chrome, macOS Chrome + Safari. Template: §19.

---

## 6. Operations Control Center design [PROPOSED]

One screen `/operations` (becomes the Admin home for operators), with the Action Center already shipped as its header:

- **Columns/queues:** New · Accepted/Preparing · Ready for pickup · Unassigned · Assigned, not acknowledged · Picked up/on the way · Delayed · Needs intervention · Failed · Payment issues · Unsettled collections.
- **Card:** HT number, status, elapsed time (red past threshold), store, courier, payment state (the shipped `PaymentPill`), next action as a button.
- **One-click safe actions:** Accept for store, Call store/courier (tel link), Assign/reassign driver (picker inline), Verify transfer, Acknowledge alert, Open order. Irreversible actions (cancel, refund) keep a confirmation dialog.
- **Alert → order:** every notification deep-links `/operations?order=<id>` which opens the order drawer in place.
- **Targets (to be measured after build, not claims):** new order visible ≤ 10 s with sound; alert → order 1 click; accept-for-store 2 clicks; assign driver 2–3 clicks; zero page changes for routine actions.

Today (measured on the current UI): new order → Admin knows only if they look; open from bell 2 clicks; assign driver from Home ≈ 3–4 clicks across 2 screens.

---

## 7. Vendor workflow design [PROPOSED; D4]

| Step | Today | Proposed |
|---|---|---|
| Learn of order | Board badge + optional single beep (only if a vendor account exists) | Push + repeating alarm until accepted |
| Accept | 1 click | 1 click = accepted **and** preparing (D4) |
| Start preparing | 1 click | removed (automatic) |
| Ready for pickup | 1 click | 1 click |
| Courier arrival / handover | not shown to vendor | "Courier on the way / arrived / collected" read-only line |
| **Total vendor actions** | 3 | **2** |

Safe to automate: CONFIRMED→PREPARING on accept; PICKED_UP is recorded by the courier, not the store. Requires explicit human: accept/reject (unless AUTO mode), ready, rejection reason. Because no vendor uses the dashboard today, **HATLY acceptance mode (Hatly accepts on the store's behalf by phone) is the realistic interim**; the new Ops new-order alert covers it.

---

## 8. Courier shift closure design [PROPOSED; D5, D6]

**New tables:** `courier_shifts` (driver, opened_at/by, closed_at, status OPEN → SUBMITTED → REVIEWED → CLOSED), `cash_custody_entries` (append-only: COLLECTED_FROM_CUSTOMER by method CASH / INSTAPAY_TO_COURIER, PAID_TO_VENDOR at pickup (R25), REMITTED_TO_HATLY, SHORTAGE_RECORDED, EXCESS_RECORDED, CORRECTION — each with order, amount, actor, idempotency key, reason for corrections).

**Shift screen (Admin):** orders assigned/acknowledged/delivered/cancelled/failed; for each delivered order: amount due, paid to Hatly before arrival, collected by courier (by method), paid to vendor; totals; courier compensation and Hatly % (existing `DRIVER_COMMISSION_RECOGNIZED`); reimbursements (R26); **expected cash to hand in** vs **counted cash**; difference recorded as shortage/excess with reason; prepared by / reviewed by / closed by.

Closing a shift freezes its figures; it does **not** mark money settled — settlement payments (existing table) settle the balance, partially or fully.

---

## 9. Courier statements (daily, weekly, monthly, custom range) [PROPOSED]

A statement is a *query*, not a stored row: any date range over shifts, custody entries and financial events, with opening balance, movements, closing balance, and each figure linked to its rows. Monthly "closure" = a stored, frozen settlement period (existing `driver_settlement_periods`, extended with collections by method and custody balance). R29 "late settlement never blocks new orders" stays.

---

## 10. Vendor settlement design [PROPOSED; D3]

Under current rules the vendor statement is: completed segments (sales value, informational), cancelled segments, Hatly commission owed (R35 timing for pickup), Hatly-funded discount share (R37), compensations owed to the vendor (R34, separate entry), subscription charges (R6/R33a — model not built), previous payments, outstanding balance by direction. Settlement workflow uses the existing `settlement_payments` (method, reference, paid_on, recorded by, void with reason, idempotency) plus an approval step [D6]. Duplicate settlement already prevented by the unique period-start index; extend with a check that a payment cannot exceed due without authorised overpayment (exists).

**Existing defect to fix:** vendor `grossSalesMinor` counts segments by `created_at` while commission counts events by recognition time (`settlement.service.ts`) — a segment created before and picked up after a close is split across periods. Informational only (commission is correct), but statements would not reconcile.

---

## 11. Payment lifecycle architecture [PROPOSED; D1, D2]

Four independent lifecycles linked by IDs, never by overwriting each other:
- **Order** (existing state machine).
- **Delivery** (existing).
- **Payment intents per order:** `amount_due`, then *payment events*: WALLET_APPLIED, TRANSFER_CLAIMED (customer says), TRANSFER_VERIFIED (Ops, against bank statement), GATEWAY_CAPTURED (webhook), COURIER_COLLECTED_CASH, COURIER_COLLECTED_INSTAPAY, REFUNDED.
- **Settlement** (custody, periods, payments).

**Courier sees:** `remaining_to_collect = amount_due − wallet − verified transfers − captured gateway`, recomputed server-side at every view and frozen at "delivered". A *claimed but unverified* transfer is shown as "customer says they paid X — not yet confirmed; call Operations" and **does not reduce** the amount (D1 decides whether the courier collects or waits). Double collection is prevented by: the courier app cannot submit more than remaining; a late verification after courier collection creates an `OVERPAID` case → refund workflow (R22), never silent.

---

## 12. Gateway provider comparison

**No provider publishes an Egypt fee schedule; every figure must be obtained as a written quote. No fees are stated here.**

| Provider | Methods (per provider docs) | Integration | Reconciliation | Notes / limits found |
|---|---|---|---|---|
| Paymob | Cards, Apple/Google Pay, local wallets (Vodafone Cash, Orange, WE Pay), BNPL (ValU, Sympl, Souhoola, Halan); InstaPay listed as a rail, merchant availability unconfirmed | Hosted checkout / API; HMAC-signed callbacks | Merchant dashboard; methods enabled per account | Fees "custom", via account manager |
| Kashier | Cards, wallets | REST API, webhook management API, fee-calculator endpoint | Settlement-window and settled-transaction APIs (good for matching bank deposits) | Test mode produces no settlement, so settlement behaviour can only be verified live |
| Fawry (FawryPay) | Fawry reference (cash at outlets), cards, wallets | Merchant code + security key; signature | Merchant portal | Pricing negotiated per channel/volume |
| Geidea | Cards, wallets; hosted page or server-to-server | HPP or Direct API | Merchant portal | Pricing "enterprise"/quote |
| PaySky | Gateway (white-label), QR, operates national payment gateway with CBE | API | — | No public pricing |

**Evaluation still required (evidence missing):** written MDR per method, setup/monthly fees, settlement T+n, refund fees (R22: Hatly bears non-refundable fees), chargeback process, CBE licensing/KYB timeline, webhook retry policy, sandbox access. Recommendation: shortlist Paymob and Kashier (widest methods; Kashier strongest reconciliation APIs), request quotes, run both sandboxes against the provider-agnostic interface that already exists.

**Integration architecture [PROPOSED]:** `payment_attempts` (provider, merchant reference = idempotency key, amount, status) → redirect/iframe → **webhook only is truth** (verify signature/HMAC, recompute amount and currency, dedup on provider transaction id, accept out-of-order/late callbacks, ignore client redirect status) → payment event → order released (R2). Abandoned: expire attempt after N min, release stock (R21). Refunds: partial/full via provider API, recorded as events, status from webhook. Daily reconciliation job: provider settlement report vs `GATEWAY_CAPTURED` events → mismatches to an exceptions queue.

---

## 13. Financial data model assessment

Strengths **[EXISTS]:** typed events with direction, idempotency key, related-event links, rate snapshots, actor; settlement payments with void-not-delete; contiguous periods with DB unique index; concurrency handled via 23505 race fallback; integer minor units throughout.

Weaknesses:
1. `financial_events` is append-only **by convention only** — has `updated_at`, `deleted_at`, no trigger (prod: only `admin_audit_logs` is protected). → add a no-update/no-delete trigger as on the audit log.
2. No custody/cash ledger (§8).
3. Vendor period mixes time bases (§10).
4. Driver `net_payable` ignores cash held, so a driver who collected cash looks owed money (`driver-earnings.service.ts:17` acknowledges this).
5. Register gaps already listed: R28/R40 Hatly Service split, R43 missing-rate flag, R32 netting in statement, R24 loyalty→wallet.
6. Settlement close takes "now" as period end — no arbitrary period end, no preview-then-confirm with a frozen snapshot hash.

---

## 14. Reports and analytics specification

**Existing [EXISTS]:** S01–S25 (21 reports): executive, orders, order lines, sales by period, vendor performance, customers, products, driver performance, ledger, revenue & commissions, driver settlements, Hatly-funded discounts, liabilities & receivables, vendor settlements, payments & refunds, offers, cancellations, audit log, wallet, ratings, permission matrix. Screen, CSV, Excel and PDF share one definition; Cairo time; permission-filtered; async export jobs.

**To add [PROPOSED]:** courier shift closures, courier statement (custom range), cash custody & remittances, collections by payment method, outstanding courier balances, vendor statement, delayed orders, vendor acceptance performance, delivery exceptions, notification delivery & acknowledgement times. Each: filters (date, courier, vendor, branch, method, HT number), totals reconciled to ledger rows, drill-down to order and event. A "Reports" section grouped by Courier / Vendor / Finance / Operations already matches the existing catalogue families.

---

## 15. Security and financial integrity assessment

- **Good:** permission per action (`@RequiresPermission`), immutable audit log by trigger, MFA, idempotency keys, transactional writes, outbox in-transaction.
- **Risks:** ledger mutable at DB level; no maker/checker on settlement payments; single Super Admin holds every permission (prod: 1 admin) — no separation of duties possible yet; no alert when the push/SMS provider is missing in production (boot allows it silently); push subscription endpoints will be personal data → store per user, delete on logout/revocation.
- **Concurrency:** settlement closes are race-safe; settlement payments carry idempotency keys; manual-transfer approval should be checked for a double-approve race (not verified in this audit) [UNKNOWN].

---

## 16. API and database changes proposed

| Area | Change | Migration |
|---|---|---|
| Alerts | `operational_alerts` table; new categories; ack endpoint `POST /staff/alerts/:id/acknowledge`; escalation worker | Yes (additive) |
| Push | `staff_push_subscriptions` (user, endpoint, keys, ua, created, last_success, expired_at); `POST/DELETE /staff/push-subscriptions`; `POST /staff/notifications/test`; VAPID keys as new secrets | Yes (additive) + new secrets |
| Delivery tracking | outbox columns `channel=WEBPUSH`, `received_at`, `displayed_at`, `acknowledged_at`; `POST /staff/notifications/:id/receipt` from service worker | Yes |
| Custody & shifts | `courier_shifts`, `cash_custody_entries`; shift endpoints; driver app collection by method | Yes; driver app release |
| Ledger hardening | trigger forbidding UPDATE/DELETE on `financial_events`, `cash_custody_entries`, `settlement_payments` (void stays an insert-style status? → move void to a separate `settlement_payment_voids` row) | Yes; check existing code paths that update these rows first |
| Payments | `payment_events`, `payment_attempts`; webhook controller per provider | Yes |
| Vendor | auto-advance on accept (D4); courier status in vendor feed | No schema |
| Reports | new definitions in `report-registry.ts` | No |

No historical row is rewritten by any of these; new structures start empty and apply to new activity only (R43 principle).

---

## 17. UI/UX screen inventory

Admin, new: Operations Control Center; Notification Setup & Diagnostics; Alert overlay (global); Courier shifts list + shift review/close; Courier statement; Cash custody overview; Vendor statement; Payment events on order detail; Gateway reconciliation exceptions. Admin, changed: Inbox (acknowledge, priority filter), Settlements (approval step), Reports (new entries). Vendor: board (2 actions, courier status), notification setup. Driver app: collection screen showing paid-to-Hatly / remaining / method; shift start/end.

---

## 18. Dependencies and migration considerations

- Rule decisions D1–D6 gate §8–§11; the P0 alerting work depends on none of them.
- Web Push needs HTTPS (admin.hatly.dev has it via Cloudflare) and a service worker served from the dashboard origin; Cloudflare must not cache `/sw.js`.
- Firebase for mobile push needs a Firebase project and service-account credentials (owner action).
- Driver app changes need a new APK and your distribution approval; the customer app stays in closed testing.
- Training: operators (alert handling, acknowledgement), office staff (shift closure, cash count), vendors (if they get accounts).
- Data migration: none for history; opening balances for couriers at go-live of custody must be entered as explicit, approved opening entries.

---

## 19. Testing and acceptance criteria

**P0 alerting accepted only when:**
1. Automated: a new order creates exactly one Ops alert per recipient (e2e), repeats on schedule, stops on ack, resolves on accept; dedup under concurrent placement; outbox states truthful.
2. Real devices (each row filled in):

| Case | Device / OS / Browser | PWA | Permission | Battery | Expected | Actual | Stage times (queued→accepted→received→displayed) | Result | Limitation |
|---|---|---|---|---|---|---|---|---|---|
| A1 foreground | | | | | alarm + banner ≤ 10 s | | | | |
| A2 background | | | | | system notification ≤ 30 s | | | | |
| A3 minimised · A4 other app · A5 locked · A6 closed | | | | | notification per platform | | | | |
| A7 denied · A8 sound blocked | | | | | diagnostics explain | | | | |
| A9 offline → online | | | | | missed alerts recovered once | | | | |
| A10 two devices | | | | | both notified, one ack clears both, no duplicate action | | | | |
| D1–D5 desktop | | | | | as brief | | | | |

**Finance accepted when:** every statement total equals the sum of its listed source rows (automated property test); concurrent double-submit of collection/settlement creates one entry; UPDATE/DELETE on ledger tables fails at DB level; a shift with a counted shortage shows it as an open difference, not a deduction.

---

## 20. Prioritised implementation roadmap

| # | Initiative | Priority | Business impact | Risk reduced | Complexity | Depends on | Migration / external |
|---|---|---|---|---|---|---|---|
| 1 | Ops new-order + operational alert categories; Admin in-tab alarm (sound, vibrate, repeat, ack) | **P0** | Orders stop being missed | High | Medium | — | Additive migration |
| 2 | Service worker, PWA, Web Push (VAPID), diagnostics screen, real-device tests | **P0** | Alerts with tab in background/locked | High | Medium | 1 | Migration + VAPID secret |
| 3 | Owner decisions D1–D6 | **P0** | Unblocks all finance | — | — | — | — |
| 4 | Configure Firebase for driver/customer push; boot warning when providers missing | P1 | Drivers get assignment push | Medium | Low | owner credentials | External |
| 5 | Ledger immutability triggers | P1 | Audit integrity | High | Low | review of update paths | Migration |
| 6 | Cash custody + courier shift closure + driver app collection by method | P1 | Know where cash is | Very high | High | 3 | Migration, driver APK, training |
| 7 | Operations Control Center screen | P1 | Fewer clicks | Medium | Medium | 1 | — |
| 8 | Vendor 2-action workflow + courier status | P2 | Less store work | Low | Low | D4 | — |
| 9 | Vendor statement + settlement approval; fix period time base | P2 | Correct statements | Medium | Medium | D3, D6 | Migration |
| 10 | Courier/vendor/collections reports, custom ranges | P2 | Visibility | Medium | Medium | 6, 9 | — |
| 11 | Gateway (quotes, sandbox, integration, reconciliation) | P2 | Electronic payment | Medium | High | quotes, KYB, D1 | External, contract |
| 12 | Escalation to SMS/WhatsApp/phone | P3 | Last-resort alert | Medium | Medium | provider choice | Paid service |
| 13 | Scheduled orders R5, remaining register P2 items | P3 | Product | — | High | — | — |

**Phasing (no dates or costs claimed):**
- **Immediate:** 1, 2, 3; interim operating procedure — keep the Admin tab in the foreground on a dedicated charged device with the vendor board sound enabled, and set branches you accept by phone to HATLY mode so the existing `OPS_ACCEPT_FOR_VENDOR` alert fires.
- **First 30 days:** 4, 5, 7; start 6.
- **First 90 days:** 6 complete with driver APK; 8, 9, 10.
- **Six months:** 11 live with one provider after sandbox and reconciliation proof; 12 if needed.
- **Twelve months:** multi-city readiness (service areas exist; per-city operations queues and per-city reports), 13.

**Independently deliverable:** 1/2 (no finance dependency), 4, 5, 7, 8. **Dependent:** 6, 9, 10, 11 on decisions D1–D6.

---

## Answers to the twelve questions

1. **Why no alert?** No Ops new-order event exists; no vendor staff exist to receive the vendor event; the Admin web app has no sound/notification/push; mobile push is unconfigured in production. (§3)
2. **How it will alert:** in-transaction Ops alert → in-tab alarm with sound/vibration repeating until acknowledged + Web Push through a service worker to every registered device. (§5)
3. **Background/locked:** Web Push shows a system notification with the phone's notification sound if Chrome notifications are allowed and Chrome isn't battery-restricted; in-page sound cannot play; to be proven per device (§5.4, §19).
4. **Repeat/escalate:** per-priority interval and cap, escalation to wider audience, stop on ack, close on resolution, dedup per condition. (§5.2)
5. **One screen:** Operations Control Center with queue columns and inline actions. (§6)
6. **Restaurants with two actions:** Accept (auto-starts preparing) and Ready — needs D4. (§7)
7. **Daily shift closure:** custody entries per order → expected vs counted cash → difference recorded → prepared/reviewed/closed; settlement separate. (§8)
8. **Monthly/custom:** range queries over shifts and ledger; monthly frozen periods (existing, extended). (§9)
9. **Vendor statements:** commission/subscription/compensation statement with payments and balance; exact content depends on D3. (§10)
10. **No double collection:** server computes remaining-to-collect from verified payments only; app can't exceed it; late verification → overpaid case → refund. (§11)
11. **Reports:** existing Reports + Exports, extended with courier/vendor/collections/notification reports; CSV/Excel/PDF already supported. (§14)
12. **Traceability:** every figure is a sum of immutable rows (DB-enforced), each linked to order, actor and idempotency key; statements list their rows. (§13, §16)

## Sources (gateway research)
- Paymob developer docs — https://developers.paymob.com/paymob-docs ; https://paymob.com/llms.txt
- Kashier developer docs — https://developers.kashier.io/docs/api-reference ; https://developers.kashier.io/docs/get-started
- Fawry (integrator notes, no official rates) — https://akurateco.com/payment-methods/fawry
- Geidea Egypt — https://www.geidea.net/egy/en/about-us
- PaySky — https://en.wikipedia.org/wiki/Paysky

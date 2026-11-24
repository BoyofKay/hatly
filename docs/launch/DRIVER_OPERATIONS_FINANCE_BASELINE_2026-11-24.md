# Driver operations and finance — approved functional baseline
Date: 2026-11-24. Status: approved requirements; implementation and verification tracked separately.

## 1. Operational shifts (SH)
- SH-01: Explicit start creates one open shift; concurrent starts must not create duplicates. Timer measures server-authoritative elapsed time from start to explicit end (driver, office, supervisor); persist actor, reason and timestamps.
- SH-02: Financial closing alone never ends a shift or changes availability. Office may explicitly end shift or explicitly choose combined closing/end action. Preserve existing financial formulas and closing/payment procedures except their automatic effect on shift lifecycle.
- SH-03: Stop accepting orders does not end shift. Logout/app termination does not end shift. Normal shift end requires no active responsibility (complete or properly hand over orders). Supervisor action audited.
- SH-04: Outstanding orders requiring financial resolution, allowance, loan, or unpaid closing do not prevent ending or starting a shift. Cash cap can restrict assignments independently.
- SH-05: Synchronize authoritative shift state on app resume, periodic refresh and after actions. No artificial reset or automatic timeout. Existing backend long-shift detection at 14h must be visible on card and header; proposed defaults amber >=14h, red >=18h, configurable thresholds and deduplicated Operations alerts. Never auto-end based on elapsed time.

## 2. Orders and History (OP)
- OP-01: Orders is the entire currently open operational shift, including concluded orders; no shift shows Start shift and empty state. Delivered orders / طلبات تم توصيلها replaces Delivered today; no calendar-day reset.
- OP-02: Seven clickable quick filters in two rows (4+3): All / الكل (distinct orders assigned in shift), Needs acknowledgment / بانتظار التأكيد, Ready / جاهزة للاستلام, On the way / في الطريق, Delivered orders / طلبات تم توصيلها, Cancelled / ملغاة, Failed / فشل التوصيل. Independent predicates may overlap; All includes acknowledged/preparing and reassigned orders. Counts use same population as lists, independent of selected chip.
- OP-03 SMART SORT: actionable and active assignments above concluded orders, including when All selected. Prioritize pending acknowledgement (deadline), ready for pickup, on the way and other active assignments; concluded delivered/cancelled/failed/reassigned records below, newest conclusion first. Stable deterministic ordering (timestamp then ID); no terminal order can displace active work. Filtering retains consistent ordering; server-side pagination must honor sorting.
- OP-04: Permanent shift-to-assignment records, immutable attribution at assignment; preserve original driver's history after reassignment, redact customer private details and disable actions for former assignee. Distinct order count per shift, no inference from latest driver_id alone. Historical records of uncertain provenance must be flagged, not fabricated.
- OP-05: History contains ended shifts only, regardless of financial closing; remove Current/Previous subtabs, retain dates and search, chips Delivered/Cancelled/Failed. Exclude open shift from all totals. No Returned status/workflow changes. Remove Ignored and acceptance percentage from UI; defer acceptance-rate enhancement, preserve existing dispatch audit events.

## 3. Financial balances and reporting (FIN)
- FIN-01: Earnings Current shift renamed Current balance / الرصيد الحالي. Includes eligible unclosed financial activity across shifts, separate unresolved orders and ready-to-close orders; preserve existing cash, commission, reimbursement, allowance and loan formulas. Loans separate.
- FIN-02: Show current unclosed net, previous closed unpaid/partially paid net, total net financial position, preserving gross payables/receivables and underlying references. Positive means Hatly owes driver. Closing is not payment.
- FIN-03: Previous earnings revenue and distinct order counts by actual delivery date from frozen closing lines; working hours by actual reconciled shift intervals (Africa/Cairo calendar, split crossing midnight); closing date and payment status separately. Date, search and status semantics explicit. No retroactive recalculation.
- FIN-04: Audited zero-financial-value working-time reconciliation even with no deliveries, no artificial money entries. At closing cutoff reconcile only unreconciled portion of each shift, including open shifts through cutoff; later time remains unclosed. No duplicate/overlapping intervals; atomic, idempotent transactions.
- FIN-05: Existing financial calculation and payment rules retained. Outstanding liabilities survive shift changes. No duplicate closing or fabricated settlement payment. Corrections append reversal/adjustment records (original reference, amount, reason, evidence, actor, time); only Admin/Super Admin with dedicated financial adjustment authority, enforced server-side. No silent edits/deletes of finalized records.

## 4. Risk and onboarding (RISK)
- RISK-01: Cannot activate a registered driver until an explicit valid commission is defined; 0% is valid, null is not. Enforce all activation paths at API and UI. Freeze order-specific rate snapshots; existing missing-rate data handled explicitly.
- RISK-02: Configurable cash warning and hard cap; warning <= cap. Alert Operations; at cap block manual and automatic new assignments, not active delivery completion, shift start/end or reconciliation. Exposure includes unclosed and closed-uncollected cash, not merely closing status; consider reserved expected COD for already assigned orders to prevent overshoot; concurrency-safe guard. Restore eligibility below cap. No arbitrary production thresholds; expose validated settings.
- RISK-03: Maximum outstanding daily allowance; block additional issuance if outstanding + request exceeds configured maximum; do not reset at shift start/end, no automatic top-up. Return only through documented actual return/reconciliation. Concurrent issuance must be atomic.
- RISK-04: Audited warnings and financial adjustments; role/permission enforcement; preserve loans and cash/payment ledger.

## 5. Customer and admin artwork (UI)
- UI-01: Store-name translucent label in bottom trailing corner (right EN, left AR), clear of logo.
- UI-02: Explore displays all active sectors in horizontal grid of max three rows; two full columns plus partial third as scroll cue, RTL mirrored. Remove See all/less in Explore; Home See all remains shortcut.
- UI-03: Promotion Assets modal with independent EN and AR artwork, same destination/schedule/order/publication; locale selects respective image, fallback other image if missing, no flipping; existing image retained EN/legacy. Neither image means cannot publish. All upload routes accept advisory aspect ratios; 1080x1080, top 35% safe zone. Keep earlier sector/store/item/logo specs (1280x720 sector/store banner; 1000x1000 item; 512x512 sector photo/store logo).

## 6. One-time test-data remediation (DATA)
- Identify exactly eight specified delivered test orders belonging to test driver and missing rate events; verify production records, existing snapshots/fees/cash/closing status. Approved 0% commission on applicable delivery fee, preserving separate Hatly service premium unless separately authorized. Reconstruct only missing financial events with audit; preview then normal closing; no invented payment, no future driver rate change or unrelated data changes. Verify long-open test shift; do not fabricate end timestamp.
- This remediation is not a schema migration or broad backfill.

## 7. Release gates and acceptance
- Additive migration, preserve legacy API compatibility and existing records. Inspect deployment and migration backups, test rollback compatibility.
- Tests: repeated/concurrent shift start/end, explicit vs financial close, pending orders/handover, stale shift sync and 14/18h thresholds; assignment reassignment privacy and smart sorting across pages; overlapping quick filters and shift boundaries; no-order and partial-interval closing; across-midnight Cairo date attribution; immutable money snapshots and unpaid balances; cap warning/block and concurrency for manual/auto dispatch; allowance caps, mandatory commission across activation paths, permission negatives and audit; bilingual asset fallback and horizontal grid RTL.
- Release only verified compatible backend/dashboard and both APKs. Use existing Production ops, Customer app build and Driver app build workflows, avoid duplicate CI. Record exact runs, artifacts and remaining blockers. Device smoke testing required.
- Deferred: acceptance-rate redesign, ignored KPI, physical return workflow. Do not introduce these in this milestone.

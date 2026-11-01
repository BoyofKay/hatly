# Hatly Enterprise Management — Final Implementation Roadmap

**Authority:** subordinate to `FINAL_MASTER_IMPLEMENTATION_SPECIFICATION.md` (MS); decisions in `FINAL_DECISION_REGISTER.md`; contracts in `FINAL_API_AND_DATA_MODEL_PLAN.md` (API); criteria in `FINAL_ACCEPTANCE_MATRIX.md` (AM). **Documentation only** — nothing is implemented, migrated, deployed, committed or pushed by producing this roadmap. Date: 2026-10-30.

**This roadmap contains no dates and no effort estimates.** Order is expressed only through **dependencies and gates**. Nothing is deferred: every module, the design system, Media, reporting, finance correctness, RBAC, marketing, monitoring, Home aggregation closure and Performance Engineering are in scope, and every workstream below has a Definition of Done that must be met before it is called complete.

---

## 1. Workstream index

| WS | Name | Delivers (MS refs) | Hard dependencies | Migrations |
|---|---|---|---|---|
| **WS-0** | Home Aggregation closure | §12 | — | none |
| **WS-1** | Backend platform foundations | §3, §9.2–9.4, §11 foundation | WS-0 gate G0 | M-66, M-67, M-68, M-69, M-76 |
| **WS-2** | Admin design system & shell | §4 | WS-1 (T-1.4 permission registry, T-1.5 navigation payload) | none |
| **WS-3** | Media platform | §6, Module 13 | WS-1, P0-2 (image fixtures), WS-2 for UI | M-70 |
| **WS-4** | Reporting & export platform | §7, Module 12 | WS-1, WS-2 for UI | M-71 |
| **WS-5** | Finance, payments, refunds, settlements | §8, Modules 8–9 | WS-1, WS-4 (platform), WS-2 | M-72 |
| **WS-6** | Orders & Executive Control Tower | Modules 1–2 | WS-1, WS-2, WS-4, WS-5 (money block, KPIs) | M-73 (order notes, alert acks) |
| **WS-7** | Marketplace, vendors, catalogue, inventory | Modules 3–5 | WS-2, WS-3, WS-4; P1-2 caches for epochs | M-74 |
| **WS-8** | Delivery & Fleet | Module 6 | WS-2, WS-4, WS-5 (earnings) | none |
| **WS-9** | Customers, marketing, coupons, campaigns, notifications | Modules 7, 10, 11 + Customer-app inbox | WS-1, WS-2, WS-3, WS-4, WS-5 | M-73 (adjustments, notes, ratings), M-75 |
| **WS-10** | Access UI, system monitoring, platform configuration | Modules 14–16 | WS-1, WS-2, P0-3 | none |
| **WS-11** | Hardening, cutover, handover | all | all of the above | none |
| **WS-P** | Performance Engineering (P0…P7) | §13 | see §3 | M-77 (from P1) |

(WS-6 and WS-9 share M-73; the migration is split by owner only if the two workstreams are not scheduled together — each part is independently additive.)

## 2. Dependency graph and waves (no dates)

```
WS-0 ─► G0
G0 ─► WS-1 ─┬─► WS-2 ─┬─► WS-3 ─────────────┬─► WS-7
            │         ├─► WS-4 ─► WS-5 ─┬──┬┴─► WS-6
            │         │                 ├──────► WS-8
            │         │                 └──────► WS-9 (also needs WS-3)
            │         └─► WS-10
G0 ─► WS-P0 (parallel with WS-1) ─► WS-P1 ─► WS-P3 (needs WS-3) ─► WS-P2 ─► WS-P5 / WS-P6 (needs WS-2) ─► WS-P7 (needs WS-10)
all ─► WS-11
```
Waves (parallelism is allowed inside a wave when files do not collide; the order between waves is the contract): **A** WS-0 · **B** WS-1 ‖ WS-P0 · **C** WS-2 ‖ WS-P1 · **D** WS-3 ‖ WS-4 · **E** WS-5 ‖ WS-P3 · **F** WS-6 ‖ WS-7 ‖ WS-8 ‖ WS-9 ‖ WS-10 ‖ WS-P2 ‖ WS-P5 ‖ WS-P6 · **G** WS-P7 → WS-11.
**Critical path:** WS-0 → WS-1 → WS-2 → WS-4 → WS-5 → WS-6 (KPIs) → WS-11; and WS-1 → WS-3 → WS-P3 → WS-P2 (image adoption in the Customer app).

## 3. Gates (checked at the end of every workstream)

**RG — Regression gate (identical for all workstreams).** (1) Backend: `tsc`, unit, e2e, integration suites — all green and the count of passing tests ≥ the recorded baseline; (2) Dashboard: typecheck, unit tests, production build, Playwright suites — green; (3) Flutter: `flutter analyze` clean and `flutter test` green for the affected apps (Customer always, Driver when touched); (4) route-authorization inventory (e2e 99) and admin-mutation audit (e2e 94) include every new route; (5) migrations: `up`/`down` on a disposable database and old-code-on-new-schema check; (6) **no test weakened, skipped or deleted** to pass; (7) performance budgets of touched endpoints (query count, payload) in `budgets.json`; (8) the commands and baselines are those documented in the project's test-infrastructure notes.

**CDoD — Common Definition of Done (every workstream).** (a) All tasks implemented as specified or changed through a change request; (b) tests of every applicable category in MS §15.2 present; (c) RG passed with evidence recorded in the workstream report; (d) acceptance criteria listed for the workstream in AM pass, each with its evidence link; (e) documentation updated (`PRODUCT_DECISIONS.md` entries, release-notes fragment, API docs, runbooks); (f) feature flags default **off** until the owner enables them; (g) AR/EN catalogue parity, RTL screenshots, axe scan for every new page; (h) no secrets or PII in logs/audit/exports; (i) nothing deployed — a deployment note (migrations, flags, grants, order of rollout, rollback) is written; (j) workstream report committed under `docs/admin-revamp/reports/WS-x.md` stating what was verified, what was not, and any lab-only evidence labelled as such.

## 4. Workstream specifications

### WS-0 — Home Aggregation closure
**Scope.** MS §12. **Backend:** verification, Redis-outage e2e rerun with the real shared client, stock/delivered-count invalidation decision (0.3), contract freeze v1. **Frontend (Customer app):** zone passing per D-50, tests; See-all unchanged. **Dependencies:** none. **Migrations:** none. **Tests:** full backend unit/e2e (incl. 116)/integration; `flutter analyze` + `flutter test`; dashboard checks. **Regression gates:** RG. **Deliverables:** PD entry, release-notes with deployment order, LAUNCH_PROGRESS section, evidence log. **DoD:** CDoD + AM G-30…G-36 pass; local perf numbers labelled lab-only. **Output gate G0:** clean regression baseline recorded for all subsequent workstreams.

### WS-1 — Backend platform foundations
**Tasks.** T-1.1 `ReportingClock` + time-zone database check (U-04) + tests (§3.1). T-1.2 `JobsModule` (worker, claim/heartbeat/retry/cancel, purge; M-66). T-1.3 `IdempotencyService` + interceptor helper. T-1.4 `PermissionRegistry`, 28 new permissions, `@RequiresAnyPermission`, read-implies-manage rule, route-inventory test extension, feature-flag settings (§9.2, §3.9). T-1.5 `permission_templates` + system templates + apply/copy semantics + IAM-11…15 (M-68). T-1.6 audit extensions: explicit-event helper, entity-history query, audit indexes, target-column verification/addition (M-76) + masking utilities (§9.5). T-1.7 config schema registry and validators for all new settings/env (§14.3). T-1.8 reporting indexes with EXPLAIN justification on the acceptance dataset (M-67, non-transactional) — depends on P0-2. T-1.9 metrics foundation: `MetricsModule`, flush/rollup, `system_metric_buckets`/`integration_checks` (M-69), telemetry ingestion `POST /telemetry/client-metrics`, `GET /config/client`, abuse limits. T-1.10 navigation payload (CT-09) and saved-views API (CT-10…13). **Frontend:** none. **Dependencies:** G0. **Migrations:** M-66…M-69 and M-76. **Tests:** U for clock/jobs/idempotency/registry; I for migrations, job claim races (two workers), crash recovery; E for permission matrix of IAM-11…15, route inventory; abuse tests for ingestion. **Gates:** RG. **Deliverables:** modules, migrations, docs, runbook for jobs. **DoD:** CDoD + AM G-01…G-08, G-18, M14-01…M14-06 (backend), P-26 (headers N/A here), time-zone tests S-TZ.

### WS-2 — Admin design system & shell
**Tasks.** T-2.1 tokens (light/dark, RTL logical properties) + lint rules (physical-property ban, hard-coded string ban). T-2.2 primitives (§4.2) with unit, a11y and RTL tests. T-2.3 shell: sidebar, topbar, breadcrumbs, environment badge, permission-aware navigation (CT-09), locale/theme toggles. T-2.4 DataTable, FilterBar, Pagination, SavedViews, column chooser, mobile card mode. T-2.5 forms kit (RHF+zod, MoneyInput, DateRangePicker). T-2.6 feedback kit (toasts, confirm dialogs, drawers, skeleton/empty/error). T-2.7 charts frame (Recharts, theme-aware, data-table alternative, code-split). T-2.8 command palette + global search UI (CT-04 backend implemented in WS-6). T-2.9 i18n kit: all existing pages migrated to catalogues (24 pages), plural helper, formatting helpers (Cairo, EGP). T-2.10 strangler migration plan: new shell wraps existing pages; route redirect map (`order-search`→`orders`, etc.) kept until WS-11; existing 30 Playwright specs kept green (selectors updated, intent preserved). T-2.11 a11y/RTL/responsive Playwright harness (axe, RTL screenshots, 3 viewports). T-2.12 bundle budget CI check (P6-1 foundation). **Backend:** none (consumes T-1.4/1.10). **Dependencies:** WS-1. **Migrations:** none. **Tests:** D unit for each primitive; PW for shell/nav filtering by permission; X axe on a primitives gallery page (dev-only route, excluded from production build). **Gates:** RG + bundle budget. **Deliverables:** `ui/*`, gallery, migration guide, ADR for rules. **DoD:** CDoD + AM G-13…G-17, A-01…A-05, P-35 (bundle) baseline.

### WS-3 — Media platform
**Tasks.** T-3.1 sharp pipeline + policies + error codes (§6.2–6.4); T-3.2 `media_*` tables + FK columns (M-70); T-3.3 MED-01…12 endpoints + purpose authorization + audit; T-3.4 legacy endpoints re-implemented on the pipeline (compat tests); T-3.5 entity assignment support (`mediaAssetId`) in the owning DTOs/services (vendors, branches, sectors, subcategories, banners, products, catalog products) incl. `product_media` + CAT-11; T-3.6 backfill job B-1 + `MEDIA_PURGE`, orphan sweeper; T-3.7 Customer API additive `thumbnailUrl`/`images[]` (P3-1, PERF-08) and immutable cache headers (P3-3); T-3.8 MediaPicker, Library, Asset detail, Cleanup pages; T-3.9 pilot integration into existing banners page and vendor product image; T-3.10 provider contract tests extended (local + S3 fake). **Dependencies:** WS-1; WS-2 for UI; P0-2 fixtures. **Migrations:** M-70. **Tests:** MS §6.12 in full. **Gates:** RG + sharp install-time checks (MS §14.2) recorded; storage configuration untouched. **Deliverables:** media module, UI, runbook (backfill, purge), policy file. **DoD:** CDoD + AM M13-01…M13-16, P-42.

### WS-4 — Reporting & export platform
**Tasks.** T-4.1 report registry, runner, parameter schemas, masking, totals, reconciliation hook (§7.1); T-4.2 `report_exports`/`saved_reports`/`report_schedules` (M-71), export jobs (CSV streaming, XLSX with cap, parameters/definitions sheets), secure download, expiry, audit (§7.4–7.5); T-4.3 **S-PDF gate**: Arabic/English statement prototype; decision recorded (puppeteer-core adopted or pdfmake fallback); T-4.4 non-finance report definitions S01–S08, S14, S17 (definition only until WS-9 supplies S17 inputs), S19–S21, S24–S26; T-4.5 index verification against report catalogue (with T-1.8); T-4.6 UI: catalogue, runner, exports, saved reports, schedules, analytics dashboards shell; T-4.7 load test: exports do not degrade API (P-04); T-4.8 report-reconciliation test harness (independent SQL, manifest-based). **Dependencies:** WS-1, WS-2; finance report definitions arrive with WS-5. **Migrations:** M-71. **Gates:** RG + S-PDF decision recorded. **Deliverables:** reporting module, UI, catalogue doc. **DoD:** CDoD + AM M12-01…M12-14, P-03, P-04, S-PDF.

### WS-5 — Finance, payments, refunds, settlements
**Tasks.** T-5.1 `FinanceDefinitions` + financial-event type classification registry with unit test enumerating the enum (§8.1); T-5.2 ledger endpoints FIN-01…06, 12, 13; T-5.3 reconciliation R1…R6 (FIN-05, S18); T-5.4 `settlement_payments` + derived status SQL function + PAY-10…20 + approval threshold (M-72); T-5.5 statements (S11, S15) as report definitions + PDF/XLSX via WS-4; T-5.6 refunds ledger and payments list (PAY-07…09), extended filters on existing endpoints; T-5.7 finance report definitions S09, S10, S12, S13, S16, S18, S22, S23; T-5.8 UI pages PG-FIN-1…7, PG-PAY-1…6 incl. guided close dialog (`dryRun`); T-5.9 "provisional accounting policy" banner and U-01 handling; T-5.10 money regression pack: re-run e2e 60–67, 113–115 plus new property-style tests on the generated dataset. **Dependencies:** WS-1, WS-4, WS-2. **Migrations:** M-72. **Gates:** RG + money regression pack + zero `UNEXPLAINED` reconciliation. **Deliverables:** finance module, UI, accounting-policy note for the owner. **DoD:** CDoD + AM M08-01…M08-11, M09-01…M09-14, G-05.

### WS-6 — Orders & Executive Control Tower
**Tasks.** T-6.1 ORD-01/02 extensions + indexes use; T-6.2 timeline ORD-06, notes ORD-07/08, resend ORD-09, Hatly queue ORD-10, admin cancel ORD-05 (reusing the customer-cancel use case with admin actor, PD-014/015), bulk ORD-12/13 (M-73); T-6.3 KPIs CT-05/06, alerts CT-07 (+ack), SLA CT-08, search CT-04, summary caching CT-01; T-6.4 UI: Orders list/detail (7 tabs), Hatly queue, failed deliveries migrated, Control Tower pages PG-CT-1…3, command palette wiring; T-6.5 Playwright migration of existing order/control-tower specs + new flows. **Dependencies:** WS-1, WS-2, WS-4 (registry), WS-5 (money block, outstanding refunds). **Gates:** RG + cancel concurrency suite (PD-014 regression). **Deliverables:** modules, UI, KPI definitions doc. **DoD:** CDoD + AM M01-01…M01-10, M02-01…M02-14, P-05.

### WS-7 — Marketplace, vendors, catalogue, inventory
**Tasks.** T-7.1 marketplace pages (sectors, subcategories, banners, home preview MKT-23/24) with MediaPicker; T-7.2 vendor/branch tabs (VND-12…15, 20, 21; commission UI VND-10; staff; onboarding checklist); T-7.3 cross-vendor products (CAT-01), editor with additional images (CAT-11), bulk (CAT-12), inventory board (CAT-13), catalog products/listings UI, categories UI, import/export migration; T-7.4 low-stock threshold (M-74); T-7.5 cache epoch hooks for all mutated entities (P1-2 pattern); T-7.6 vendor-role isolation regression pack. **Dependencies:** WS-2, WS-3, WS-4; P1-2. **Gates:** RG + compatibility snapshots of Customer vendor/product responses. **Deliverables:** modules, UI. **DoD:** CDoD + AM M03-01…M03-09, M04-01…M04-11, M05-01…M05-13.

### WS-8 — Delivery & Fleet
**Tasks.** T-8.1 dispatch board (PG-FLT-1) on existing dispatch endpoints + FLT-22 live; T-8.2 driver detail/earnings/performance (FLT-09…12), list extensions; T-8.3 commission UI (FLT-13), verification with reason (FLT-06), online-status endpoint verification/creation (FLT-14); T-8.4 vehicle types, cash remainders UI migration; T-8.5 delivery performance (FLT-23, S08, S14). **Dependencies:** WS-2, WS-4, WS-5. **Gates:** RG + dispatch regression (e2e 70, 83–86). **DoD:** CDoD + AM M06-01…M06-11.

### WS-9 — Customers, marketing, coupons, campaigns, notifications
**Tasks.** T-9.1 customer 360 endpoints CUS-01…09, 19, 20 + masking; T-9.2 block/unblock with session revocation (CUS-10/11); T-9.3 wallet adjustments + approval (CUS-12…14) via wallet service; T-9.4 ratings moderation + counter recompute (CUS-15…17); T-9.5 offer edit/clone/performance/consumptions/grants (CPN-01…11); T-9.6 audiences + broadcasts + sending engine + recipients + stats (MKG-05…18, §10); T-9.7 campaigns + lifecycle + scheduler (CPN-12…22); T-9.8 growth/retention/loyalty overview (MKG-01…03); T-9.9 **Customer app inbox** (screen, unread badge, deep links, 404-tolerant) + Flutter tests; T-9.10 UI pages PG-CUS-*, PG-MKG-*, PG-CPN-*; T-9.11 ratings/offers/campaign report definitions (S06, S17, S19, S24 inputs). **Dependencies:** WS-1, WS-2, WS-3, WS-4, WS-5. **Migrations:** M-73 (customer part), M-75. **Gates:** RG + Flutter suites + crash-restart safety test of sending. **Deliverables:** modules, UI, app update (separate build, not published). **DoD:** CDoD + AM M07-01…M07-12, M10-01…M10-09, M11-01…M11-12.

### WS-10 — Access UI, system monitoring, platform configuration
**Tasks.** T-10.1 admin users/permissions/templates/sessions UI + IAM-19…21; verification of existing admin-user creation path (IAM-02); T-10.2 audit viewer (filters, entity history tab on every detail page, export via S21); T-10.3 MFA reset UI; T-10.4 integration probes (job `INTEGRATION_PROBE`), SYS-01…13 endpoints and pages; T-10.5 configuration console: schema registry, grouped settings UI, history, retired-key cleanup, surfacing the 4 keys; T-10.6 alert rules and board integration (CT-07 system alerts). **Dependencies:** WS-1, WS-2, P0-3. **Migrations:** none. **Gates:** RG + route inventory = 100% of admin routes. **DoD:** CDoD + AM M14-01…M14-13, M15-01…M15-10, M16-01…M16-10.

### WS-11 — Hardening, cutover, handover
**Tasks.** T-11.1 full authorization sweep (every admin route × every role template, generated from the registry); T-11.2 accessibility audit (axe over all pages, manual screen-reader pass recorded) and Arabic linguistic review by a native-speaking reviewer (a resource requirement, not a scope decision); T-11.3 security review (upload fuzz corpus, export abuse, CSRF/session regression, dependency audit of all new packages); T-11.4 navigation cutover: remove legacy header navigation and old routes after redirects are proven unused (usage from audit/telemetry); T-11.5 data-volume rehearsal on the 100% acceptance dataset (reports, exports, media, dashboards); T-11.6 documentation and training material (per-role guides AR/EN), runbooks (jobs, exports, media backfill, rollbacks); T-11.7 deployment package: migration list in order, flags, grants, rollback, smoke test list — **a package, not a deployment**; T-11.8 final regression and the all-criteria acceptance run (AM full). **Dependencies:** all. **DoD:** CDoD + every AM family green; open exceptions listed with owner approval.

### WS-P — Performance Engineering
Cross-cutting; owns §13 of the MS. Phases are separate workstream parts with their own gates.

**P0 — Baseline and instrumentation.** Tasks P0-1…P0-7 (MS §13.6). Backend: `Server-Timing`, query counter, slow-query log, pool/event-loop metrics (feature-flag/setting guarded); client: `PerfProbe` + web-vitals reporter. Tools: dataset generator (P0-2, also consumed by WS-1/3/4), device lab runbook, scenario scripts, server load scripts. **Deps:** G0 (P0-2/3 can start immediately); devices (U-08) for P0-5/6/7. **Migrations:** none. **Tests:** U/E for headers & counters; script smoke tests. **Gate:** committed baseline report with hypothesis verdicts. **Deliverables:** `docs/performance/` tree, baseline report, verdict table. **DoD:** AM P-01, P-02, P-40; if devices are unavailable, the Release-mode portion is recorded as **blocked on U-08** and every later P-criterion for apps stays *not accepted* (never replaced with lab data).

**P1 — Backend, database and caching.** P1-1 HTTP cache headers + ETag (D-63); P1-2 per-domain Redis caches/epochs (D-69); P1-3 query/index fixes for confirmed H8 (M-77); P1-4 payload slimming; P1-5 pool/timeouts/compression decisions; P1-6 operations-facts cache; P1-7 throttling review. **Deps:** P0-3, P0-7 verdicts (for P1-3/4/5). P1-1/P1-2 are pre-decided and may start with WS-1. **Tests:** invalidation matrix, stampede, outage, header contract, 304, budgets. **Gate:** RG + P-22…P-29, P-43, P-44.

**P3 — Images (with WS-3).** P3-1…P3-4. **Deps:** WS-3. **Gate:** P-16, P-17, P-42 groundwork.

**P2 — Customer app.** P2-1…P2-13 (MS §13.6). **Deps:** P0-7, P1-1 (for conditional caching), P3-1 (thumbnails), WS-0. **Tests:** Flutter unit/widget/provider tests; Release-mode lab run vs baseline. **Gate:** RG (Flutter) + **Release-mode device-lab run on DV-L/DV-M/DV-I** satisfying P-06…P-21, P-39, P-41.

**P5 — Vendor & Driver.** P5-1…P5-4. **Deps:** P1-1, P3-1 (thumbs). **Gate:** P-30…P-33.

**P6 — Admin Dashboard.** P6-1…P6-4. **Deps:** WS-2. **Gate:** P-34…P-36.

**P7 — Monitoring and regression gates.** P7-1…P7-5. **Deps:** T-1.9, WS-10 pages. **Gate:** P-37, P-38 (proved by a deliberately regressing branch), alert tests.

**WS-P DoD.** CDoD + every P-criterion passes **on Release builds on the reference devices** with evidence under `docs/performance/baselines/`; every refuted hypothesis documented; budgets file final; no lab-only number is cited as acceptance.

## 5. Owner-controlled inputs and when they become necessary
| Item | Needed before | If unavailable |
|---|---|---|
| U-08 devices | P0-5…7, then all app P-criteria | work proceeds; app P-criteria remain unaccepted |
| U-02 production storage | production enablement of Media (not development) | local driver remains |
| U-01 accounting policy | removal of the "provisional" banner (WS-5 DoD) | derivation D-26 with banner |
| U-04 tz database check | WS-1 gate (automated check fails visibly) | fix is infrastructure-side |
| U-05 Chromium in worker | PDF adoption (S-PDF) | CSV/XLSX unaffected; fallback library gate |
| U-03 SMS | only if SMS broadcast is wanted | excluded |
| U-06 probe credentials | staging probes for SMS/FCM/Maps | DISABLED shown |
| U-07 CDN rules | optional edge caching | client/API caching delivers gain |
| U-09 DB observability | production slow-query evidence | in-house telemetry + staging evidence |

## 6. Rollout sequencing (for a later, separately authorised deployment — not performed here)
1. Backend release with all additive migrations (in M-order), feature flags **off**, new permissions present but ungranted. 2. Grant `VIEW_FINANCIALS`, report/export permissions, templates to the right people **before** enabling pages (otherwise previously unused permissions would hide data). 3. Enable Dashboard shell + modules per flag, module by module, observing monitoring. 4. Run media backfill job; enable Media library. 5. Customer app release containing inbox/thumbnail/performance changes (older builds keep working). 6. Remove legacy routes (WS-11) after usage evidence. Rollback for each step: previous release + flags off; migrations are additive so rollback does not require schema reversal.

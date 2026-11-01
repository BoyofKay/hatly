# Hatly Enterprise Management — Final Acceptance Matrix

**Authority:** subordinate to `FINAL_MASTER_IMPLEMENTATION_SPECIFICATION.md` (MS). Workstreams: `FINAL_IMPLEMENTATION_ROADMAP.md`. Contracts: `FINAL_API_AND_DATA_MODEL_PLAN.md`. Decisions: `FINAL_DECISION_REGISTER.md`. **Documentation only** — no criterion below has been executed; none is claimed as passing. Date: 2026-10-30.

## 0. How to use this matrix

* A criterion is **measurable and binary**: it passes only when its *Proof* has been produced and its *Pass rule* holds. "Mostly" does not exist.
* **Proof codes:** **U** backend unit · **I** backend integration (real DB) · **E** backend e2e · **D** dashboard unit · **PW** Playwright · **X** axe/RTL/visual · **B** budget/benchmark script · **F** Flutter unit/widget · **L** lab-only measurement (diagnostic, **never** satisfies an app-performance criterion) · **R** **Release-mode measurement on physical reference devices** (D-61) · **O** owner/human review recorded.
* Families: **G** global/cross-cutting · **A** accessibility/i18n/responsive · **S** special gates · **M01–M16** module acceptance · **P** performance.
* Each row names its workstream (WS). A workstream is complete only when all of its rows pass (CDoD (d), Roadmap §3).
* Evidence is stored in the workstream report (`docs/admin-revamp/reports/WS-x.md`) and, for performance, `docs/performance/baselines/`.
* Any exception requires an owner-approved entry in the Decision Register; exceptions never edit this matrix silently.

---

## 1. Global criteria (G)

| ID | Criterion | Proof | WS | Pass rule |
|---|---|---|---|---|
| G-01 | Every admin route has an explicit permission/role guard, and every new route is registered in the route-authorization inventory | E (inventory 99 extended) | all | inventory test lists 100% of `/admin/*` routes; build fails on an unguarded route |
| G-02 | Every admin mutation is audited (interceptor) and every event in MS §9.4 is emitted with its metadata | E (94 extended) | all | assertion per mutation route; zero secrets/PII in metadata |
| G-03 | Every list endpoint is server-paginated with whitelisted sort/filter; none returns unbounded rows | E | all | request with `pageSize=100000` is clamped; unknown filter → 400 |
| G-04 | Time-zone correctness: Cairo day boundaries and a DST transition | U + I (S-TZ) | WS-1, WS-4 | fixtures at 23:59/00:00 and DST day match expected buckets |
| G-05 | Money integrity: integer minor units end-to-end; totals equal independent SQL; no float in storage/API/exports | U + I | WS-4, WS-5 | zero mismatches on the acceptance dataset |
| G-06 | Retryable writes honour `Idempotency-Key` (replay identical; changed body → 409) | E (I) | all | per-endpoint test for each write marked I in the API plan |
| G-07 | Migrations are additive and reversible; old code runs on the new schema | I | all | `up`/`down` pass; previous-release e2e subset passes on new schema |
| G-08 | No existing endpoint, response field, enum value or column is removed; unchanged contracts are snapshot-tested | E | all | snapshot suite green |
| G-09 | No Admin form contains an external-URL image input; images enter only via MediaPicker | PW + D lint | WS-3, WS-7 | scan of all forms finds zero image-URL inputs |
| G-10 | PII masked by default and unmasked only with `VIEW_CUSTOMER_PII`; financial fields only with `VIEW_FINANCIALS` | E (M) | WS-1, WS-9 | matrix test over every endpoint exposing such fields |
| G-11 | Bulk actions: cap 50, confirm count, same use case per item, per-item result and audit; destructive bulk absent | E | WS-6, WS-7 | tests incl. partial failure; no bulk cancel/void/delete routes exist |
| G-12 | Export permission checked at request **and** at download; revoked permission blocks an existing file | E | WS-4 | test: grant → export → revoke → download = 403 |
| G-13 | Every new page implements loading, empty, empty-filtered, error and success states | PW | all UI | Playwright state coverage per page (mocked responses) |
| G-14 | AR/EN catalogue key parity compile-checked; no hard-coded user-visible string | D (lint/test) | WS-2 on | lint passes on `features/*`, `app/(admin)/*` |
| G-15 | RTL screenshot test per new page; no physical left/right CSS | X + lint | all UI | visual diff within tolerance; lint zero |
| G-16 | Pages usable at 390×844, 820×1180, 1440×900 (no horizontal page scroll; touch targets ≥ 44 px on touch) | PW viewport | all UI | per-page viewport suite |
| G-17 | Navigation hides unpermitted items AND the backend still rejects direct calls | PW + E | WS-2, WS-10 | user with template X sees only X; direct API call → 403 |
| G-18 | Regression gate RG passes at or above the recorded baseline; no test weakened/skipped/deleted | all suites | all | RG evidence attached |
| G-19 | Dashboard production build succeeds; per-route first-load JS within budget (D-74) | CI | WS-2 on | ≤ 180 kB gzip per route |
| G-20 | No secrets or unauthorized PII in logs, audit rows, exports or telemetry | E + I (scrub tests) | all | canary-string tests pass |
| G-30 | WS-0: backend `tsc`, unit, e2e (incl. 116), integration; Flutter `analyze` + `test`; dashboard checks all green after final edits | all suites | WS-0 | no new failures vs baselines |
| G-31 | WS-0: Redis outage test with the real shared client | E | WS-0 | first request ≤ 1 s degraded; subsequent ≤ 50 ms; correct data |
| G-32 | WS-0: invalidation completeness (price/activate/vendor/offer; stock/delivered-count behaviour documented and tested) | E | WS-0 | matrix green |
| G-33 | WS-0: `deliveryZoneId` sent only for a valid active zone | F + E | WS-0 | tests: zone present/absent/inactive |
| G-34 | WS-0: See-all lists unchanged | F | WS-0 | existing tests green; diff review |
| G-35 | WS-0: PD entry, release notes with deployment order, LAUNCH_PROGRESS section written | O | WS-0 | documents exist and reviewed |
| G-36 | WS-0 performance numbers are labelled lab-only; Release-mode numbers come only from WS-P | O | WS-0 | doc review |

## 2. Accessibility, i18n, responsive (A)

| ID | Criterion | Proof | WS | Pass rule |
|---|---|---|---|---|
| A-01 | axe scan on every new page, both locales, both themes | X | all UI | zero serious/critical violations |
| A-02 | Full keyboard operation of primary flows (no traps; roving tabindex; dialogs trap and restore focus) | PW | all UI | scripted keyboard journeys pass |
| A-03 | Contrast ≥ 4.5:1 (text) / 3:1 (UI) in both themes for all token pairs | D | WS-2 | automated token-pair test |
| A-04 | Arabic plural forms and Cairo/EGP formatting verified; native-reviewer sign-off on AR copy | D + O | WS-2, WS-11 | tests + recorded review |
| A-05 | Screen-reader smoke test (VoiceOver, TalkBack) of one primary flow per module recorded | O | WS-11 | checklist per module |

## 3. Special gates (S)

| ID | Criterion | Proof | WS | Pass rule |
|---|---|---|---|---|
| S-PDF | Arabic+English settlement statement PDF renders correct shaping, RTL order, digits, page numbers, totals; sample set reviewed | O + automated text extraction check | WS-4 | sample accepted by reviewer; extraction shows correct logical order; else fallback library re-run on same sample |
| S-TZ | Time-zone database for Africa/Cairo verified current on the DB/OS (automated check) | U + infra check | WS-1 | check passes or fails visibly with the documented remediation |
| S-MIG | All migrations M-66…M-77 verified up/down on disposable DBs; `CONCURRENTLY` index migrations leave no INVALID index | I | WS-1…P1 | script report |
| S-SEC | Security review: authorization sweep (route × template), upload fuzz corpus, export abuse, CSRF/session regression, dependency audit of all new packages | E + O | WS-11 | report with zero open high/critical |
| S-DATA | Synthetic dataset generator deterministic; manifest of expected aggregates reproduced | U + I | P0 | two runs produce identical manifests |
| S-RECON | Reconciliation checks R1…R6 produce zero UNEXPLAINED on the acceptance dataset and after the money regression pack | I | WS-5 | S18 report clean |

---

## 4. Module acceptance (M01–M16)

### 4.1 M01 — Executive Control Tower (WS-6)
| ID | Criterion | Proof | Pass rule |
|---|---|---|---|
| M01-01 | Every KPI equals an independent SQL on the dataset to the minor unit / exact count | I | zero mismatch for all KPIs in MS §5.1 |
| M01-02 | Each KPI returns `null` (shown "No data") when no source data exists — never 0 | U + PW | tests for empty period |
| M01-03 | Period comparison (previous period, same weekday last week) correct incl. month/DST edges | U | fixtures pass |
| M01-04 | Every KPI tile drills into a list with identical filters; list totals equal the tile | PW + E | for each tile |
| M01-05 | Counters agree with existing operations facts for the same instant | E | equal values |
| M01-06 | Money KPIs absent without `VIEW_FINANCIALS` | E (M) | payload lacks fields; UI hides tiles |
| M01-07 | A failing KPI/section shows its own error with retry; the page remains usable | PW | fault-injected endpoint |
| M01-08 | Live panels refresh every ≤ 20 s visible, pause when hidden, back off after errors | D + PW | timer tests |
| M01-09 | Alerts board: filter/sort/keyset paging; acknowledgement audited; unified sources present | E + PW | one alert per source type in fixture |
| M01-10 | Global search returns only groups the caller may read; PII masked; P95 ≤ 300 ms (see P-05) | E + B | matrix + budget |

### 4.2 M02 — Order Management (WS-6)
| ID | Criterion | Proof | Pass rule |
|---|---|---|---|
| M02-01 | All filters of MS §5.2 work, combine, and are URL-addressable | E + PW | filter matrix |
| M02-02 | Keyset pagination stable under concurrent inserts (no duplicates/skips) | I | race test |
| M02-03 | Summary totals equal independent SQL for the filtered set | I | zero mismatch |
| M02-04 | Order detail totals come from the backend and equal stored order amounts | E | equality incl. discounts/fees/refunds |
| M02-05 | Timeline merges all event sources in correct chronological order with actors | I | fixture with every event type |
| M02-06 | Admin cancel: reason required; permission; state-machine path; refund destination correct; discount restored exactly once | E + I | PD-014/015 scenarios |
| M02-07 | Admin cancel is idempotent and safe against concurrent driver assignment | I (C) | race test |
| M02-08 | Cancel impossible for DELIVERED/CANCELLED orders (409) | E | |
| M02-09 | Notes are append-only and staff-only | E | no update/delete route; customer API never exposes |
| M02-10 | Resend notification rate-limited (3/h/order) and audited | E | |
| M02-11 | Bulk resend/assign: ≤ 50, confirm count, per-item result, per-item audit; no bulk cancel exists | E | |
| M02-12 | Hatly/Wasally queue lists exactly the pending-price/awaiting states | E | |
| M02-13 | PII masked without `VIEW_CUSTOMER_PII`; export of orders uses same masking | E (M) | |
| M02-14 | Orders list P95 ≤ 400 ms and ≤ 5 queries on the 500k-order dataset | B | budget passes |

### 4.3 M03 — Marketplace (WS-7)
| ID | Criterion | Proof | Pass rule |
|---|---|---|---|
| M03-01 | Sector/subcategory/banner create/edit with MediaPicker only; purpose rules enforced | PW + E | wrong purpose → 400 |
| M03-02 | Activate/deactivate effective in the app immediately (epoch) | E | read-after-write |
| M03-03 | Deactivating a sector with active vendors requires confirmation and lists dependents | E + PW | 409 without confirm |
| M03-04 | Bilingual names required; uniqueness per parent | E | |
| M03-05 | Banner schedule (start/end) honoured; end > start validated | E | |
| M03-06 | Banner link target validated (exists & active) | E | |
| M03-07 | Reordering persists and is reflected in public lists | E | |
| M03-08 | Home preview equals the public composition for the chosen zone | E | JSON equality |
| M03-09 | Legacy `imageUrl` clients/endpoints keep working | E (G-08) | |

### 4.4 M04 — Vendor & Branch (WS-7)
| ID | Criterion | Proof | Pass rule |
|---|---|---|---|
| M04-01 | Vendor/branch tabs cover profile, hours, zones, commission, acceptance, products, performance | PW | all tabs functional |
| M04-02 | Commission change requires reason, is audited, applies prospectively only | E + I | order accepted before keeps old rate |
| M04-03 | Commission history shows each change with actor and time | E | |
| M04-04 | Vendor deactivation blocked while open orders exist, listing blockers | E | |
| M04-05 | Onboarding checklist derived correctly for each missing prerequisite | U + E | |
| M04-06 | Vendor performance metrics reconcile with S05/S02 | I | equality |
| M04-07 | Staff create/activate/deactivate; deactivation revokes sessions | E | |
| M04-08 | Hours validation (overlaps, overnight) | U + E | |
| M04-09 | Cover/logo via MediaPicker; Customer `coverImageUrl` populated | E + F | |
| M04-10 | Vendor-role isolation unchanged (no cross-vendor access) | E (X) | existing + new routes |
| M04-11 | Branch list/detail P95 ≤ 400 ms | B | |

### 4.5 M05 — Product & Inventory (WS-7)
| ID | Criterion | Proof | Pass rule |
|---|---|---|---|
| M05-01 | Cross-vendor product search/filter/sort with keyset paging | E | |
| M05-02 | Primary + additional images (≤ 8) with reorder; one primary invariant | I + PW | DB constraint holds |
| M05-03 | Customer API gains `images[]`/`thumbnailUrl` additively; `imageUrl` = primary display URL | E | |
| M05-04 | Bulk activate/deactivate/set-stock/price-percent: preview, confirm, per-item result/audit | E | |
| M05-05 | Price-percent bounds (±90%, result ≥ 0) | U + E | |
| M05-06 | Inventory board: low-stock threshold (global/per-product) honoured; counts equal SQL | I | |
| M05-07 | Concurrent stock decrement behaviour unchanged (e2e 50) | E | green |
| M05-08 | Master catalog + listings fully operable from UI (8 routes) | PW | |
| M05-09 | Category CRUD from UI | PW | |
| M05-10 | Import: validate → apply idempotent; export file is re-importable | E | round-trip lossless |
| M05-11 | Option groups/values unchanged and have no image fields | E | |
| M05-12 | Vendor isolation for vendor product routes unchanged | E (X) | |
| M05-13 | Product list P95 ≤ 400 ms on 4,000+ products | B | |

### 4.6 M06 — Delivery & Fleet (WS-8)
| ID | Criterion | Proof | Pass rule |
|---|---|---|---|
| M06-01 | Dispatch board data equals Control Tower facts at the same instant | E | |
| M06-02 | Assign/reassign rules (verified/online, reason, override permission) enforced | E | |
| M06-03 | Assignment vs concurrent cancel remains safe (PD-014) | I (C) | |
| M06-04 | Driver detail: deliveries, earnings, performance load with correct figures | I | earnings equal events/period totals |
| M06-05 | Driver earnings reconcile with settlement period | I | zero diff |
| M06-06 | Commission change: reason, audit, prospective | E | |
| M06-07 | Driver verification with reason | E | |
| M06-08 | Online-status endpoint exists/verified with permission `CHANGE_DRIVER_ONLINE_STATUS` | E | |
| M06-09 | Live fleet: stale (> 120 s) flagged; map absence shown as DISABLED not error | PW | |
| M06-10 | Cash remainders approve/reject idempotent | E | |
| M06-11 | Delivery performance P50/P90 equal independent SQL | I | |

### 4.7 M07 — Customer Management (WS-9)
| ID | Criterion | Proof | Pass rule |
|---|---|---|---|
| M07-01 | Directory search/filter/sort with masking | E | |
| M07-02 | Customer 360 tabs complete and consistent | PW | |
| M07-03 | Wallet balance equals ledger sum (displayed and API) | I | |
| M07-04 | Block sets `is_active=false` and revokes sessions; blocked customer cannot log in | E | |
| M07-05 | Unblock restores access | E | |
| M07-06 | Wallet adjustment: reason, idempotency, threshold approval, creator ≠ approver, no overdraw | E + I | |
| M07-07 | Adjustment creates exactly one `ADJUSTMENT` ledger row | I (C) | double-approve race |
| M07-08 | Rating hide/unhide recomputes counters transactionally | I | counters equal SQL |
| M07-09 | PII reveal audited, auto re-masks | E + PW | |
| M07-10 | Customer notes append-only | E | |
| M07-11 | Deletion requests flow unchanged | E | |
| M07-12 | Customer export masked per permission | E | |

### 4.8 M08 — Finance & Accounting (WS-5)
| ID | Criterion | Proof | Pass rule |
|---|---|---|---|
| M08-01 | Every `financial_events.type` is classified in the registry (unit enumerates the enum) | U | fails on unclassified |
| M08-02 | Ledger totals equal Σ of events for any filter | I | |
| M08-03 | Gross sales ≠ Hatly revenue: components shown, revenue = defined sum | I | |
| M08-04 | Commission recognized vs collected vs outstanding per MS §8.1/§8.4 | I | |
| M08-05 | Hatly-funded discount net = recorded − restored on the dataset | I | |
| M08-06 | Refunds outstanding = recorded − sent, never negative | I | |
| M08-07 | Reconciliation R1…R6 correct with injected discrepancies (each detected) | I | seeded defects found |
| M08-08 | Liabilities page values equal SQL (wallet, loyalty at rate, refunds, unpaid settlements) | I | |
| M08-09 | Ledger requires range or order id; range ≤ 366 d | E | |
| M08-10 | Financial events cannot be edited/deleted from any endpoint | E | no such route |
| M08-11 | Ledger P95 ≤ 400 ms / first page, summaries ≤ 2.5 s (P-03) | B | |

### 4.9 M09 — Payments, Refunds, Settlements (WS-5)
| ID | Criterion | Proof | Pass rule |
|---|---|---|---|
| M09-01 | Refund "Sent" appears only after mark-sent; "Recorded" never shown as sent | E + PW | |
| M09-02 | Mark-sent idempotent; concurrent calls produce one record | I (C) | |
| M09-03 | Settlement close shows proposed period via `dryRun`; contiguity preserved | E | |
| M09-04 | Closed period immutable | I | update attempts rejected |
| M09-05 | Closed ≠ Paid: derived status UNPAID/PARTIAL/PAID/OVERPAID matches matrix | U + I | all combinations |
| M09-06 | Payment record: only on CLOSED; amount bounds; not future-dated | E | |
| M09-07 | Payment idempotency and concurrent sum safety | I (C) | |
| M09-08 | Void exactly once; voided excluded from status; listed in statement | I | |
| M09-09 | Approval threshold enforced (creator ≠ approver) | E | |
| M09-10 | Statement lists every contributing line; exceptions list empty on dataset | I | |
| M09-11 | Statement PDF/XLSX export (PDF per S-PDF) with correct totals | I + O | |
| M09-12 | Payments list/detail across methods with filters | E | |
| M09-13 | Previously unused permissions (`VIEW_VENDOR_FINANCIAL_REPORTS`, `VIEW_DRIVER_SETTLEMENTS`) are enforced; documented | E | |
| M09-14 | Provisional accounting banner shown until U-01 confirmed | PW | |

### 4.10 M10 — Marketing & Growth (WS-9)
| ID | Criterion | Proof | Pass rule |
|---|---|---|---|
| M10-01 | Growth metrics are real (equal SQL) and null when absent | I | |
| M10-02 | Audience rule compiler correct; preview count hides < 20 | U + E | |
| M10-03 | Broadcast four-eyes; no send without approval | E | |
| M10-04 | Quiet hours and frequency cap enforced | I | |
| M10-05 | Recipient expansion and sending idempotent; worker kill mid-batch causes no duplicate inbox rows | I (C) | |
| M10-06 | Customer inbox isolation (A cannot read B) | E (X) | |
| M10-07 | Customer app inbox screen, unread badge, deep links; 404-tolerant with older backend | F + E | |
| M10-08 | Test send goes only to author's device | E | |
| M10-09 | Kill switch `FEATURE_BROADCASTS=false` stops sending | E | |

### 4.11 M11 — Coupons, Promotions, Campaigns (WS-9)
| ID | Criterion | Proof | Pass rule |
|---|---|---|---|
| M11-01 | Offer edit rules enforced; locked fields → 409 after consumptions | E | |
| M11-02 | Clone resets counters, copies rules | E | |
| M11-03 | Offer performance equals consumptions (consumed − reversed) | I | |
| M11-04 | Budget/limit caps hold under concurrency | I (C) | e2e 114/115 green |
| M11-05 | Coupon code uniqueness (case-insensitive) | E | |
| M11-06 | Coupon grants: grant/redeem/revoke; expired not redeemable | E | |
| M11-07 | Campaign lifecycle transitions valid only per MS §10.2; timeline recorded | U + E | |
| M11-08 | Campaign four-eyes; edit after approval invalidates approval | E | |
| M11-09 | Scheduled start/stop exactly-once (offers/banners activate/deactivate) | I | |
| M11-10 | Campaign cancel deactivates started items | I | |
| M11-11 | Hatly-funded net shown with both sides | E | |
| M11-12 | Performance pages show only real data; no unsupported ROI | PW | |

### 4.12 M12 — Reports & Analytics (WS-4)
| ID | Criterion | Proof | Pass rule |
|---|---|---|---|
| M12-01 | All 26 report definitions exist with parameters, columns, totals, permissions | E | catalogue test |
| M12-02 | Each report's totals equal an independent SQL on the dataset | I | zero mismatch |
| M12-03 | Cross-report identities hold (S04 Σ=S02; S10 components; S12↔S17; S13 wallet↔ledger) | I | |
| M12-04 | Preview paginated ≤ 200 rows with totals; P95 per P-03 | B | |
| M12-05 | CSV: UTF-8 BOM, RFC-4180 quoting, formula-injection guard | U | corpus passes |
| M12-06 | XLSX: types, frozen header, Parameters & Definitions sheets, ≤ 100k rows/50 MB else CSV only | I | |
| M12-07 | PDF per S-PDF for S01/S11/S15 | O | |
| M12-08 | Export job lifecycle: progress, cancel, crash recovery, retry, failure code | I | |
| M12-09 | Download: private storage, signed/stream, `attachment`/`nosniff`/`no-store`, audit each download | E | |
| M12-10 | Expiry: expired → 410; files purged; metadata retained | I | |
| M12-11 | Masking identical in preview and file | E (M) | |
| M12-12 | Cairo date ranges in exports (Parameters sheet shows resolved UTC) | U | |
| M12-13 | Saved reports and schedules work; schedule pauses when owner loses permission | E | |
| M12-14 | Concurrent exports do not degrade API (P-04) | B | |

### 4.13 M13 — Media Management (WS-3)
| ID | Criterion | Proof | Pass rule |
|---|---|---|---|
| M13-01 | Direct upload, drag/drop, multi-file with per-file progress, cancel, retry | PW | |
| M13-02 | Type detected from bytes: JPEG/PNG/WebP accepted; GIF/SVG/HEIC/PDF/polyglot/wrong-extension rejected | I | corpus |
| M13-03 | Limits enforced: 5 MB (streamed abort), 40 MP, purpose min/max dimensions & aspect | I | each code returned |
| M13-04 | Corrupt/truncated files rejected, no partial outputs | I | |
| M13-05 | EXIF/GPS/ICC removed from every stored variant; orientation applied first | I | read-back shows none; orientation correct |
| M13-06 | WebP `display` ≤ 1600 px and `thumb` ≤ 320 px; no upscaling | I | |
| M13-07 | No image bytes in PostgreSQL | I | schema scan: no bytea/large object |
| M13-08 | Crop/aspect editor outputs exact purpose aspect | PW + I | |
| M13-09 | Primary + additional images with reorder/replace/remove | PW | |
| M13-10 | Library search/filter/sort; reuse an asset on another entity | PW + E | |
| M13-11 | Usage tracking lists every reference; snapshot references counted | I | |
| M13-12 | Delete refused while referenced (API and DB FK race) | I (C) | |
| M13-13 | Replace-everywhere transactional; snapshots untouched | I | |
| M13-14 | Purpose authorization matrix; vendor cannot access another vendor's asset | E (X) | |
| M13-15 | Storage-failure compensation leaves no orphan and no row | I (fault injection) | |
| M13-16 | Existing URLs unchanged; legacy endpoints and DTOs still work; backfill idempotent/resumable | E + I | |

### 4.14 M14 — Admin Users, RBAC, Audit (WS-1, WS-10)
| ID | Criterion | Proof | Pass rule |
|---|---|---|---|
| M14-01 | All 28 new permissions registered; labels AR/EN; groups | U | registry test |
| M14-02 | Read routes accept `X_VIEW` or `MANAGE_X` (no existing grant loses access) | E | |
| M14-03 | System templates grant exactly their sets (copy semantics, no live link) | E | |
| M14-04 | Approver and dangerous permissions absent from every system template | U | |
| M14-05 | Template apply ADD/REPLACE audited with diff | E | |
| M14-06 | Permission change effective ≤ 30 s | I | |
| M14-07 | Navigation reflects grants; direct call 403 (G-17) | PW + E | |
| M14-08 | Last-SUPER_ADMIN / self-demotion guards | E (C) | |
| M14-09 | MFA reset: reason, typed confirm, token revocation, forced re-enrolment, audit | E | |
| M14-10 | Sessions list/revoke/force-logout | E | |
| M14-11 | Audit viewer filters + keyset paging; entity history tab on each detail page | PW + E | |
| M14-12 | Audit export (S21) permission-gated and itself audited | E | |
| M14-13 | Permission matrix report (S25) SUPER_ADMIN only | E | |

### 4.15 M15 — System Monitoring (WS-10)
| ID | Criterion | Proof | Pass rule |
|---|---|---|---|
| M15-01 | Overview shows DB, Redis, storage, SMS, Maps, FCM, jobs, exports, cache with last-check time | PW | |
| M15-02 | Unconfigured integrations shown DISABLED with enabling key; never "healthy" | E + PW | |
| M15-03 | Probe results persisted; stale > 3× interval → UNKNOWN | I | |
| M15-04 | Probes never send paid messages or expose credentials | E | |
| M15-05 | Request metrics: counts/error/latency histograms by route pattern; no ids/payloads | I | |
| M15-06 | Multi-instance flush sums correctly; flush on shutdown | I | |
| M15-07 | Job monitor: queue depth, oldest, failures; retry/cancel permissions | E | |
| M15-08 | Alert rules fire and appear on the alerts board | I | threshold fixtures |
| M15-09 | Client performance page shows Release-tagged telemetry only by default; "no data" below min sample | E + PW | |
| M15-10 | No fabricated/demo values anywhere | O (review) + E | seeded-empty system shows "no data" |

### 4.16 M16 — Platform Configuration (WS-10)
| ID | Criterion | Proof | Pass rule |
|---|---|---|---|
| M16-01 | Every business-config key (incl. the 4 previously hidden) appears with type, unit, range, help | E + PW | schema coverage test = enum |
| M16-02 | Validation by schema; cross-field rules; unknown keys rejected | U + E | |
| M16-03 | Financial-key changes require reason; impact sentence shown | E + PW | |
| M16-04 | History from audit with before/after; sensitive values masked | E (M) | |
| M16-05 | Reset-to-default works and is audited | E | |
| M16-06 | Retired `VENDOR_SEGMENT_AUTO_ACCEPT_ENABLED` removed from enum/UI; stored row untouched | E | |
| M16-07 | No secrets stored in business config | E + review | scan |
| M16-08 | Delivery zones/service areas/Hatly service config pages operate on existing endpoints incl. activate/deactivate | PW | |
| M16-09 | "Requires restart" shown only where true | O | |
| M16-10 | Feature flags manageable, audited, read by backend authoritatively | E | |

---
## 5. Performance acceptance (P) — Release-mode, physical-device, realistic-network

**Evidence rule (D-61, repeated because it is the point of this section):** every criterion marked **R** passes only on **Release builds on physical reference devices** (classes DV-L, DV-M, DV-I; MS §13.3) over the stated network profile (N1–N5), against the staging environment loaded with the synthetic dataset, using the statistics rule of MS §13.3 (≥ 20 cold-start runs / ≥ 15 flow runs; **P90** unless stated). Debug, simulator/emulator, `localhost` and profile-mode results are **L** (lab-only) and can never mark an **R** criterion as passed. "Baseline" values are produced by P-01; numbers below are **budgets** (D-62) — if the baseline already beats a budget the budget still applies (no relaxing), and if the baseline misses it the criterion is the budget (a miss is a defect or an owner-approved exception recorded in the Decision Register).

### 5.1 Baseline, budgets and instrumentation
| ID | Criterion | Proof | Phase | Pass rule |
|---|---|---|---|---|
| P-01 | A Release-mode baseline report exists for all scenarios SC1–SC15 (customer), DC1–DC3 (driver), VW1–VW3, AW1–AW8, on DV-L/DV-M/DV-I × N1–N5 where applicable, plus server baselines, with a verdict (confirmed/refuted/inconclusive) for H1–H18 | R + B | P0 | report committed with raw run tables; every H has a verdict |
| P-02 | `docs/performance/budgets.json` exists, schema-validated, and contains every budget of MS §13.4 | U | P0 | schema test; CI reads it |
| P-40 | Probe effect: the same scenarios with `PerfProbe` off (platform measurements only) differ from probe-on P90 by ≤ 5% | R | P0 | comparison table in the baseline report |
| P-37 | Production-like telemetry: server metrics and client samples arrive, are Release-tagged, debug-tagged samples excluded from every dashboard/budget view, no identifiers stored | E + I | P7 | tests incl. a debug-tagged sample not appearing |
| P-38 | Regression gates (query-count/payload/header/bundle) fail the build on a deliberate regression and pass otherwise | CI | P7 | evidence from a regressing branch run |

### 5.2 Customer app (reference DV-M on N2; second tier DV-L on N3 unless noted)
| ID | Criterion | Proof | Phase | Pass rule (P90) |
|---|---|---|---|---|
| P-08 | Cold start to first frame | R | P2 | DV-M ≤ 2.0 s · DV-L ≤ 3.5 s · DV-I ≤ 2.0 s |
| P-06 | TTFMC: banners + categories visible with images, cold, valid session | R | P2 | DV-M/N2 ≤ 2.5 s · DV-L/N3 ≤ 5.0 s |
| P-07 | Home complete (all sections ready or in explicit error state) | R | P2 | DV-M/N2 ≤ 4.0 s · DV-L/N3 ≤ 7.0 s |
| P-09 | Warm start (resume) | R | P2 | DV-M ≤ 1.0 s · DV-L ≤ 1.8 s |
| P-10 | Sector → vendor list rendered | R | P2 | ≤ 1.5 s · ≤ 3.0 s |
| P-11 | Vendor → first products page rendered | R | P2 | ≤ 1.5 s · ≤ 3.0 s |
| P-12 | Search: last keystroke → results (after the 400 ms debounce) | R | P2 | ≤ 1.2 s · ≤ 2.5 s |
| P-13 | Scroll smoothness in a 30-s Home/vendor-list scroll: janky frames and worst frame | R | P2 | janky ≤ 5% (DV-L ≤ 10%); worst frame ≤ 100 ms (DV-L ≤ 200 ms) |
| P-14 | API requests until Home complete (cold) | R (proxy log + probe) | P2 | ≤ 6 (target 4) |
| P-15 | JSON bytes (gzip) on cold Home | R | P1/P2 | ≤ 150 kB |
| P-16 | Image bytes above the fold | R | P3/P2 | ≤ 400 kB |
| P-17 | No full-size decode in lists: decoded bitmap ≤ 2× layout size × DPR for every list image; zero `Image`/cached image without size hints in list/card widgets | F + R (memory trace) | P2 | widget/lint test + memory evidence |
| P-41 | Peak memory after scrolling 200 images | R | P2 | DV-M ≤ 300 MB · DV-L ≤ 220 MB (PSS/footprint) |
| P-18 | Navigation state: returning to a visited tab/screen within 60 s causes zero blocking loads and ≤ 1 background conditional revalidation per data source; scroll position and loaded pages preserved | F + R (request count) | P2 | SC12 shows 0 reloads; back-stack scroll restored |
| P-19 | Pagination & lazy loading: every list > 30 items paginated (page 20, prefetch 5); no static `ListView(children:)` over unbounded data; 1,000-item fixtures load ≤ 2 pages initially | F (+ analyzer test) | P2 | analyzer allow-list test + fixtures |
| P-20 | Partial failures: with one endpoint failing or slow under N4, Home shows successful sections and a per-section retry; no blank screen/crash; spinner never > 10 s without a message | F + R (chaos switches) | P2 | SC13 + per-endpoint fault injection pass |
| P-21 | Offline cold start (N5): clear offline state or cached sectors/banners (only if D-65 shipped) within 2 s; no infinite spinner | R | P2 | SC14 pass |
| P-39 | App size: Release AAB/IPA not larger than the P0 baseline (+2% tolerance); documented reduction target after size analysis | CI + R (artifact) | P2 | size report per release candidate |

### 5.3 Image delivery
| ID | Criterion | Proof | Phase | Pass rule |
|---|---|---|---|---|
| P-42 | Content-addressed media served `public, max-age=31536000, immutable`; list/card API fields carry `thumbnailUrl`; revisit of unchanged images transfers 0 bytes; legacy images fall back to original with sized decode | E + R (second-launch bytes) | P3 | header e2e + device revisit test (SC1 second run image bytes = 0) |

### 5.4 API, database, Redis (server-side; measured with `Server-Timing` on staging at 20 VUs, dataset loaded)
| ID | Criterion | Proof | Phase | Pass rule |
|---|---|---|---|---|
| P-22 | Public catalog endpoints, cache miss | B | P1 | server `total` P95 ≤ 250 ms, P99 ≤ 600 ms (`/home/product-sections` miss ≤ 350 ms) |
| P-23 | Public catalog endpoints, cache hit | B | P1 | P95 ≤ 80 ms, P99 ≤ 200 ms |
| P-24 | Query-count and payload budgets of MS §13.4 for each hot endpoint, enforced in e2e | E (B) | P1 | e2e budgets pass; list: `/sectors`, `/home-banners`, `/home/product-sections`, `/vendors`, `/vendor-branches/:id/products`, orders list/detail, wallet, cart, admin lists |
| P-25 | Slow-query log: 0 queries > 200 ms for catalog endpoints on the dataset; exceptions documented with plans | B + I | P1 | log scan on a 5-minute run |
| P-26 | Cache-header contract (D-63): public non-personalized endpoints send `Cache-Control: public, max-age=…, stale-while-revalidate=…` + `ETag`; authenticated/personalized endpoints stay `no-store`/`private` | E | P1 | header test over the endpoint registry |
| P-27 | Conditional requests: repeated GET with `If-None-Match` returns 304 with no body; the Customer app uses it (request log shows 304 on revisit) | E + R | P1/P2 | e2e + device trace |
| P-28 | Redis invalidation matrix: after every admin/vendor mutation affecting a cached view, the next read reflects it; stampede test 100 concurrent misses → 1 DB execution | E | P1 | matrix green |
| P-29 | Redis down: endpoints correct; P95 ≤ 2× the uncached budget; no request > 1 s extra from retries (circuit) | E + B | P1 | outage test with the real shared client |
| P-43 | A single device's legitimate cold launch + Home never receives 429; the per-IP policy tolerates ≥ 40 distinct devices behind one NAT launching within 60 s | B | P1 | load test at 40 clients/IP |
| P-44 | DB pool: pool wait P95 ≤ 20 ms at 20 VUs; no exhaustion events; statement timeout protects public endpoints | B | P1 | metrics from the run |
| P-03 | Report performance: preview first page + totals, 31-day range P95 ≤ 2.5 s; 12-month ≤ 8 s; CSV 100k rows ≤ 90 s with ≤ 256 MB RSS growth. If missed after index tuning → documented rollup table, reconciled to live query | B | WS-4 | acceptance dataset at 100% |
| P-04 | Export isolation: while 2 concurrent 100k-row exports run, public-catalog P95 and admin-list P95 degrade ≤ 10% vs idle | B | WS-4 | A/B load test |
| P-05 | Global search P95 ≤ 300 ms | B | WS-6 | 20 VUs, mixed queries |

### 5.5 Vendor (web) and Driver (app)
| ID | Criterion | Proof | Phase | Pass rule |
|---|---|---|---|---|
| P-30 | Vendor orders feed: change-detection polling; idle poll ≤ 1 kB (304 or empty change set); new-order visible ≤ 25 s P95 after placement; paused when tab hidden; backoff on error; orders list API P95 ≤ 300 ms | E + PW + B | P5 | tests + timing run |
| P-31 | Driver idle online: ≤ 70 requests/hour and ≤ 150 kB/hour (push-triggered refresh + adaptive polling + conditional GET); active-delivery location cadence ≤ 20 s retained; dispatch sees location freshness ≤ 90 s for online drivers | R + E | P5 | 1-h run DV-L & DV-M on N2 |
| P-32 | Driver battery over 1 h idle online reduced ≥ 30% vs P0 baseline (platform energy tools), no loss of assignment latency (offer received ≤ 5 s after dispatch in push path) | R | P5 | energy report + latency log |
| P-33 | Driver cold start → deliveries visible | R | P5 | DV-M ≤ 2.5 s · DV-L ≤ 4.0 s |

### 5.6 Admin Dashboard
| ID | Criterion | Proof | Phase | Pass rule |
|---|---|---|---|---|
| P-34 | Web vitals on list/detail pages (reference desktop & tablet; broadband and Fast-3G stress): LCP, INP, CLS | Lighthouse CI (lab) + field web-vitals | P6 | LCP ≤ 2.5 s (≤ 4.0 s stress), INP ≤ 200 ms, CLS ≤ 0.1 |
| P-35 | First-load JS per route ≤ 180 kB gzip; charts/cmdk/crop/PDF preview lazy-loaded | CI | P6/WS-2 | `next build` report |
| P-36 | Route transitions: skeleton ≤ 300 ms P90, data ≤ 1.0 s on LAN; one shared poller per data source; no duplicate polling | PW traces | P6 | traces on AW8 |

---

## 6. Coverage map — requirement → criteria (traceability)

| Requirement (brief) | Where satisfied |
|---|---|
| All 16 modules with template items | MS §5.1–5.16 · AM M01–M16 |
| Enterprise design system (tokens, shell, KPI, tables, saved views, forms, drawers, charts, states, responsive, a11y, RTL, Cairo formatting) | MS §4 · AM G-13…G-17, A-01…A-05, G-19 |
| Media platform (sharp, direct upload, crop, primary+additional, variants, EXIF strip, byte validation, authorization, audit, reference-aware delete, no binaries in DB, providers, preserve URLs) | MS §6 · D-10…D-16 · AM M13-01…M13-16, G-09 |
| Reporting/export platform | MS §7 · AM M12-01…M12-14, P-03, P-04, S-PDF, G-12 |
| Finance correctness | MS §8 · AM M08, M09, S-RECON, G-05 |
| RBAC | MS §9 · AM M14, G-01, G-10, G-11, G-17 |
| Marketing/campaign/notification | MS §10 · AM M10, M11 |
| System monitoring with real telemetry | MS §11 · AM M15, P-37 |
| Home Aggregation as formal workstream | MS §12 · AM G-30…G-36 |
| **Performance Engineering** (startup/TTFMC, Home sections, API latency/requests/payload, backend/DB, images, Redis, navigation state, pagination, network resilience, Vendor/Driver, Admin, monitoring, regression tests; Release-mode device evidence) | MS §13 · D-60…D-75 · Roadmap WS-P · AM P-01…P-44 |
| API and data-model specification | API plan (endpoints, entities, indexes, migrations, backfills) |
| Dependency register, job-queue evaluation, charting/PDF/image decisions | MS §14 · D-04, D-07, D-22, D-23 |
| Dependency-aware roadmap without dates/estimates | Roadmap |
| Measurable global acceptance | this matrix (G, A, S, M, P) |

## 7. Counts (for the final report)
G: 20 + 7 (WS-0) = 27 · A: 5 · S: 6 · M01–M16: 189 · P: 44 (P-01…P-44) → **271 criteria**. Each is binary, assigned to a workstream and has a named proof.

## 8. Sign-off record (to be completed during execution — empty by design)
| Family | Evidence link | Passed on (date) | By | Exceptions (owner-approved, Decision Register ref) |
|---|---|---|---|---|
| G | | | | |
| A | | | | |
| S | | | | |
| M01 … M16 | | | | |
| P (R-criteria on devices) | | | | |

---
*End of Final Acceptance Matrix.*

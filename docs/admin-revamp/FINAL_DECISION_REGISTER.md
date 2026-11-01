# Hatly Enterprise Management — Final Decision Register

**Authority:** subordinate to `FINAL_MASTER_IMPLEMENTATION_SPECIFICATION.md` (the single source of truth). This register lists every technical/product decision once, with its status. No decision appears twice; where an earlier document (`ENTERPRISE_ADMIN_BLUEPRINT.md`) differs, **this register wins** (corrections are listed in §I).
**Date:** 2026-10-30. **Scope of this task:** documentation only; nothing in the product, tests, dependencies, databases or configuration was changed.

**Status legend:** **DECIDED** = recommended direction adopted by this specification (technically justified, reversible only through a documented change request) · **GATE** = decided, but implementation of the named item must first pass a stated verification (prototype / measurement) · **OWNER** = genuinely owner-controlled (credentials, paid services, production infrastructure, accounting policy) — nothing is blocked *by design*; each has a safe default so that work proceeds.

---

## A. Platform and architecture

| ID | Decision | Status | Rationale / evidence |
|---|---|---|---|
| D-01 | The Admin stays in `apps/dashboard` (Next.js 15 App Router, React 18, Tailwind 3). The old header navigation is replaced by a sidebar shell; existing URLs keep working through redirects until WS-11. | DECIDED | Stack already runs and is tested (30 Playwright specs). No framework change is justified. |
| D-02 | **Do not rewrite** `lib/api/client.ts`, `lib/auth/*`, cookie session, CSRF, refresh, MFA redirect. New code calls them. | DECIDED | They work and are covered by e2e 92/100 and Playwright `dashboard-session`/`admin-mfa`. |
| D-03 | Data fetching uses **SWR** (already a dependency) behind typed hooks per module; no second data-fetching library. | DECIDED | Avoids a redundant dependency; SWR covers caching, revalidation, optimistic updates. |
| D-04 | Design system = in-repo primitives (`apps/dashboard/ui/*`) built on Tailwind with CSS-variable tokens; accessible behaviour from **Radix UI primitives** (dialog, popover, dropdown-menu, tabs, tooltip, select, checkbox, switch, toast-region helpers); command palette via **cmdk**; tables via **@tanstack/react-table** (headless); forms via **react-hook-form + zod**; charts via **Recharts**. | DECIDED (dependency register, Master Spec §14) | Headless/accessible pieces are the lowest-risk way to reach WCAG targets and RTL parity without writing focus-trap/menu logic. Every dependency is recorded in the Master Spec §14 with purpose, security and compatibility checks that run at install time. |
| D-05 | Server state is authoritative; **the Dashboard never computes money, totals, KPIs or statuses** — it renders backend-provided values (`*Minor` integers formatted by `lib/money.ts`). | DECIDED | Matches the owner's rule and existing practice (e.g. refund summary, net Hatly-funded). |
| D-06 | **One time-zone policy:** instants stored as `timestamptz` (unchanged); report/filter dates are Africa/Cairo calendar dates converted in the backend (`AT TIME ZONE 'Africa/Cairo'`); the Dashboard formats with `Intl.DateTimeFormat(..., {timeZone:'Africa/Cairo'})`. The zone is a platform setting `REPORTING_TIMEZONE` (default `Africa/Cairo`). | DECIDED | Repository evidence: **no time-zone handling exists anywhere in the backend today** — it is new, centralized work (WS-1). Egypt's DST rules must be current in the PostgreSQL/Node tz database — checked in WS-1 (see U-04). |
| D-07 | Background work uses a **database-backed job table** (`background_jobs`) with a polling worker (`FOR UPDATE SKIP LOCKED`), not BullMQ. | DECIDED | Jobs must survive Redis loss (Redis is optional-by-design, e2e 98); no new infrastructure; transactional enqueue with the business write; sufficient for admin-scale volume. BullMQ stays a documented alternative only if measured throughput requires it (trigger: queue wait p95 > 60 s at expected load). |
| D-08 | Redis remains optional everywhere: caches (Home sections, report result cache), locks, rate limits — never the source of truth for jobs, exports, media or audit. | DECIDED | Existing guarantees + the cache circuit breaker built for Home. |
| D-09 | Additive, backward-compatible migrations only; every migration verified `up`/`down` on local disposable databases; index creation on large tables uses `CREATE INDEX CONCURRENTLY` in a non-transactional migration. | DECIDED | Existing migration discipline (e.g. `OrderOperations` up/down integration test). |

## B. Media

| ID | Decision | Status |
|---|---|---|
| D-10 | New **Media module**; binaries only in storage (existing providers: local filesystem, S3-compatible); metadata in `media_assets` / `media_variants`; **no image bytes in PostgreSQL**. | DECIDED |
| D-11 | Image processing with **sharp**: decode with pixel limit and `failOn: 'error'`, auto-orient then strip all metadata (EXIF/GPS/ICC), generate WebP `display` (max edge 1600 px) and `thumb` (max edge 320 px); originals are **not** retained by default (privacy + storage); configurable `MEDIA_KEEP_ORIGINAL` (default false). | DECIDED |
| D-12 | Accepted inputs stay JPEG/PNG/WebP detected **from bytes** (existing `detectImageType`); GIF/SVG/HEIC/PDF rejected with a clear message. Limits: 5 MB file, 40 MP decoded pixels, purpose-specific min/max dimensions and aspect ratios (Master Spec §6.3). | DECIDED |
| D-13 | Reference tracking is **database-enforced**: image-bearing entities get a nullable `*_media_asset_id` FK (`ON DELETE RESTRICT`); deletion is soft (`status=DELETED`) and refused while referenced; binaries are purged by a job after retention (30 days). The existing `*_url` columns remain and are **written from the asset's display URL**, so Customer/Driver/Vendor apps and all snapshots are unaffected. | DECIDED |
| D-14 | Image-bearing entities (verified from entity scan): **existing:** vendor logo, sector, subcategory, product, catalog product, home banner. **New, with an evidenced business purpose:** product *additional* images (`product_media`; owner requirement; Customer API gains an additive `images[]`), vendor-branch cover image (the Customer app's `Vendor.coverImageUrl` placeholder is already wired and renders a placeholder). **No image added** to: option values/"variants" (price-delta values only), vendor menu categories (`ProductCategoryInfo` has no image), offers/campaigns (a campaign visual **is** a Home banner — reused), order/cart snapshots, custom-request photos and proof-of-delivery (customer/driver-owned uploads stay in `uploads`, untouched). | DECIDED |
| D-15 | Storage access stays `STORAGE_ACCESS=private` in production with the existing private-media redirect/signed-URL mechanism; admin previews use thumbs through the same mechanism. **No storage provider/configuration change is made by this specification.** | DECIDED / OWNER for which provider production uses (U-02) |
| D-16 | Admin forms contain **no external-URL image input**. Legacy `*_url` DTO fields remain accepted by the API for existing clients and imports (marked deprecated) but the Admin UI never shows them. | DECIDED |

## C. Reporting, export, finance

| ID | Decision | Status |
|---|---|---|
| D-20 | **Reports are defined once, in the backend** (report registry: id, permission, parameter schema, SQL, columns, totals, reconciliation check). Dashboard, CSV/XLSX/PDF and scheduled exports all call the same definition. | DECIDED |
| D-21 | Queries run on the primary database with additive date indexes; no data warehouse, no materialized views initially. A rollup table is introduced only for a report whose measured p95 exceeds its target (rule in Acceptance Matrix P-03). | DECIDED |
| D-22 | Exports: CSV streamed; XLSX via **SheetJS** (already a dependency, installed from the SheetJS CDN tarball) up to 100,000 rows / 50 MB, above which only CSV is offered (message shown); PDF only for document-type outputs (settlement statements, invoices-style summaries, executive summary) ≤ 5,000 rows. | DECIDED |
| D-23 | PDF renderer: **headless Chromium rendering of server-side HTML templates** (`puppeteer-core`) in the export worker, because Arabic shaping/RTL correctness is mandatory and text-layout libraries cannot be verified here. | **GATE** — an Arabic/English statement prototype must pass the acceptance sample (S-PDF in the Acceptance Matrix) before the dependency is adopted; the Chromium binary requires production infrastructure (U-05). Fallback only if the gate fails: `pdfmake` with embedded Arabic font **and** pre-shaping, re-validated against the same sample. |
| D-24 | Money semantics (authoritative, backend): **Refund Recorded ≠ Refund Sent**; **Settlement Closed ≠ Settlement Paid**; **Commission Recognized ≠ Commission Collected**; **Gross Sales ≠ Hatly Revenue**; **Hatly-funded discount net = recorded − restored.** Exact formulas: Master Spec §8. | DECIDED |
| D-25 | New finance write: `settlement_payments` (payout/collection against a **closed** period; idempotent; partial payments allowed; status derived `UNPAID/PARTIAL/PAID/OVERPAID`). Closed periods stay immutable. | DECIDED |
| D-26 | **SUPERSEDED by approved corrections B1/B5 — see IMPLEMENTATION_ADDENDUM.md (vendor ledger = Hatly's receivable commission; gross sales are not owed to the vendor).** Original text: Vendor payable for a period is **presented** as `gross sales − commission recognized` (both already stored on the closed period) and stored additively as `net_payable_minor` on vendor periods at close. | DECIDED as a derivation of stored fields; **OWNER confirmation of the accounting policy** requested once (U-01). Work proceeds on the derivation; a different policy changes one backend formula and the statement label only. |
| D-27 | Customer wallet adjustments (admin) are ledger rows (`ADJUSTMENT`) with mandatory reason, idempotency key, audit, and a second-approver rule above a configurable threshold. | DECIDED |

## D. RBAC, audit, security

| ID | Decision | Status |
|---|---|---|
| D-30 | **Existing permission names are kept** (stored in `user_permissions`; no data migration). New permissions follow the same `UPPER_SNAKE` style and add the missing dimensions: `*_VIEW`, `*_EXPORT`, `*_DELETE`, `*_APPROVE`, plus `VIEW_FINANCIALS` (sensitive financial access) and `VIEW_CUSTOMER_PII`. Legacy `MANAGE_*` keep meaning "create/update in that domain" and are documented as such. | DECIDED |
| D-31 | **Role templates are presets** (`permission_templates`): applying one **copies** its permissions to a user (individual grants stay editable); it is never a live link and never bypasses `PermissionsGuard`. System templates: Finance, Operations, Support, Catalog, Marketing, Read-only; custom templates allowed (SUPER_ADMIN). | DECIDED |
| D-32 | Navigation visibility is a UX filter built from `/admin/me/permissions`; **every** route stays `@RequiresPermission`; the route-authorization inventory test (e2e 99) is extended to every new route (CI gate). | DECIDED |
| D-33 | Every admin mutation is audited by the existing global interceptor; new sensitive actions (export request/download, wallet adjustment, settlement payment, MFA reset, template apply, bulk action, media delete) add **explicit** audit events with structured metadata. Entity history is a filtered view of the same table (`targetType`/`targetId`). | DECIDED |
| D-34 | Sensitive data masking by default (phone, address, email/wallet balances where applicable) unless `VIEW_CUSTOMER_PII` / `VIEW_FINANCIALS`; exports mask identically and additionally require the export permission. | DECIDED |
| D-35 | Bulk actions: cap 50 items per request, typed confirmation of the count, mandatory reason where the single action requires one, each item executed through the **same use case** as the single action (no parallel logic), per-item result report, per-item audit. | DECIDED |
| D-36 | Customer "block" reuses `users.is_active` (already enforced at login) plus revocation of the customer's refresh tokens/sessions; ratings moderation hides a rating and **transactionally recomputes** the denormalized counters. | DECIDED |

## E. Marketing, notifications, monitoring

| ID | Decision | Status |
|---|---|---|
| D-40 | Coupons/offers keep the existing model (`offers`, `offer_consumptions`, PD-014/015 restoration). Added: edit rules, clone, performance read model, **coupon grants** (targeted coupons) and offer audience restriction. | DECIDED |
| D-41 | New campaign model (`campaigns`, `campaign_items`, `audiences`) with lifecycle `DRAFT → PENDING_APPROVAL → APPROVED → SCHEDULED → RUNNING → COMPLETED / CANCELLED / FAILED`, four-eyes approval (creator ≠ approver), DB-backed scheduling, idempotent recipient expansion. | DECIDED |
| D-42 | Notifications: `customer_notifications` is **order-bound** (verified: `order_id` FK, unique `(order_id,type)`), so broadcast/campaign messages use a **new** `customer_inbox_messages` + `notification_broadcasts` / `broadcast_recipients`; push through the existing Firebase provider; the Customer app gets an additive inbox endpoint and screen. **SMS broadcast is excluded by default** (paid service); enabling it is an owner decision (U-03). | DECIDED / OWNER for SMS |
| D-43 | System monitoring is **in-house**: request metrics (count, errors, latency histogram buckets) aggregated in memory per instance and flushed per minute to `system_metric_buckets`; integration probes write `integration_checks`; job/exports health from `background_jobs`. **No monitoring SDK is required.** An OpenTelemetry/exporter hook is a documented optional extension, not part of the scope. | DECIDED |
| D-44 | Probes never fabricate: an unconfigured integration is shown **DISABLED** (e.g. `MAPS_PROVIDER=none`, `STORAGE_DRIVER=local`), never "healthy"; unmeasured values are shown as "no data". | DECIDED |

## F. Home Aggregation (formal workstream WS-0)

| ID | Decision | Status |
|---|---|---|
| D-50 | The Customer app passes `deliveryZoneId` to `GET /home/product-sections` **only when the selected address has a valid, active delivery zone**; otherwise it sends no parameter (marketplace-wide, today's behaviour). The cache key already includes the zone. | DECIDED |
| D-51 | "See all" lists keep the existing multi-request path until their exact requirements (page size, ordering, zone scope) are specified; no change is made to them in WS-0. | DECIDED |
| D-52 | Before closing WS-0 nothing is deployed; deployment order (backend, then app) and the 404 fallback are documented. | DECIDED |

## G. Owner-controlled items (the only open owner decisions)

| ID | Item | Safe default used meanwhile |
|---|---|---|
| U-01 | Confirm the accounting policy behind vendor payable / commission collection (D-26) and whether settlement payments may be partial. | Derivation in D-26; partial payments allowed; label "provisional" until confirmed. |
| U-02 | Production storage: stay on local filesystem or provide an S3-compatible bucket and credentials (no paid provider is introduced by this plan). | Local driver (existing). |
| U-03 | Paid channels (SMS broadcast), if wanted. | Excluded. |
| U-04 | Confirm the production PostgreSQL/OS time-zone database is current for Africa/Cairo (infrastructure access). | WS-1 includes an automated check that fails visibly. |
| U-05 | Allow a Chromium binary in the export-worker runtime (PDF, D-23). | PDF delivered only after the gate; CSV/XLSX unaffected. |
| U-06 | Credentials/accounts for external health probes (Unifonic, Firebase, Maps) in staging. | Probes report DISABLED/"not configured" until provided. |
| U-07 | Cloudflare/edge configuration for caching public catalog JSON (cache rules, cache-key including `Accept-Language`/zone query) and any paid edge feature (e.g. Argo). | The API sends correct `Cache-Control`/`ETag`; client-side caching and conditional requests deliver the gain without any edge change. |
| U-08 | Access to representative physical test devices (at least: one low-end Android, one mid-range Android, one older iPhone) and a test customer/vendor/driver account in the measured environment. | Lab numbers from emulators/simulators are labelled **lab-only** and can never satisfy a Release-mode acceptance criterion. |
| U-09 | Production-database observability access: enabling `pg_stat_statements` and a slow-query log threshold, and read access to Cloudflare analytics. | Slow-query evidence is gathered on a seeded local/staging database; production baselines use the in-house telemetry (D-43/D-70) only. |

## H. Performance engineering (workstream WS-P) — added requirement

Performance is part of the complete scope and is delivered **alongside** the 16 modules, not after them. Nothing in the Home Aggregation work is assumed to solve application performance generally; the first WS-P task is to measure.

| ID | Decision | Status |
|---|---|---|
| D-60 | **Measure before changing.** WS-P starts with a baseline phase (P0): instrumentation, a representative dataset, a device/network matrix, and a committed baseline report. No remediation task is accepted without a before/after measurement taken the same way. | DECIDED |
| D-61 | **Release-mode, physical-device, realistic-network measurement is the only evidence that satisfies a Customer/Vendor/Driver app performance criterion.** Debug-mode, simulator/emulator and localhost numbers are labelled *lab-only* (useful for diagnosis and regression detection, never for acceptance). Device matrix and network profiles are fixed in Master Spec §13.3. | DECIDED (devices: OWNER item U-08) |
| D-62 | Targets are defined as **absolute budgets** (Master Spec §13.4) with a rule: if the committed baseline is worse than a budget, the acceptance target is the budget; budgets are never relaxed to match a result — a miss is a defect or a documented, owner-approved exception. | DECIDED |
| D-63 | Public, non-personalized catalog endpoints (`/sectors`, `/home-banners`, `/home/product-sections`, `/vendors`, `/vendor-branches/:id`, `/vendor-branches/:id/products`, `/catalog/*`, subcategories) stop returning `Cache-Control: no-store` and return `Cache-Control: public, max-age=<short>, stale-while-revalidate=<longer>` with strong/weak `ETag`; authenticated and personalized endpoints keep `no-store`. Values are platform settings (`PUBLIC_CATALOG_CACHE_SECONDS`, default 30; `PUBLIC_CATALOG_SWR_SECONDS`, default 300). Evidence: every probed public endpoint currently answers `cache-control: no-store`. | DECIDED |
| D-64 | The Customer app adds a **conditional-request HTTP cache layer** (ETag / `If-None-Match`, honouring `Cache-Control`) for the public catalog GETs, plus an **in-flight GET de-duplication** and **cancellation on screen exit**. | DECIDED |
| D-65 | The Customer app persists **only low-volatility catalog data** (sectors, home banners) in a small on-disk cache to paint instantly on cold start and always revalidates in the background; product rows, prices, stock, offers and anything transactional are **never** painted from disk. Stale data is shown only as real data (no placeholder content) and is replaced when the revalidation returns. This is the single justified exception to "no disk cache" and is measured by P-metrics before it ships. | DECIDED / GATE (ships only if it improves TTFMC on the baseline devices) |
| D-66 | Hidden tabs are **built lazily on first visit and then kept alive** (state preserved) instead of constructing every tab at startup (`IndexedStack` currently builds all children eagerly). Navigation state preservation and "no redundant reload" are acceptance criteria. | DECIDED (confirmed/refuted by the P0 trace first) |
| D-67 | Images: Media variants (Decision D-11) are the primary lever — list/cards request `thumb` (320 px WebP), detail screens `display` (1600 px); the app decodes at layout size (`memCacheWidth/Height`, DPR-aware); media keys are content-addressed and served `Cache-Control: public, max-age=31536000, immutable`; legacy images are backfilled with variants by a background job. The Customer API gains additive `thumbnailUrl` fields; existing `imageUrl` stays valid. | DECIDED |
| D-68 | Backend latency work is **evidence-driven**: add `Server-Timing` (auth, guards, DB, Redis, serialize) to every response, per-request query counting, slow-query logging (`maxQueryExecutionTime`, default 200 ms), connection-pool wait metrics; fix what the traces show (candidate causes are listed in Master Spec §13.5 as hypotheses, not conclusions). | DECIDED |
| D-69 | Redis caching generalizes the Home section pattern (versioned keys, epoch invalidation on admin/vendor mutations, single-flight, per-command timeout + circuit breaker) to the other hot public reads (sectors, banners, vendor lists per sector/zone, vendor details, first product pages) under **per-domain epochs** — never a Redis flush, never a hard dependency. | DECIDED |
| D-70 | **Production-like monitoring is in-house** and extends D-43: server request metrics with latency histograms, DB query-count/slow-query counters, cache hit ratios, and **client performance telemetry** (Customer/Vendor/Driver apps and the Dashboard report startup time, time-to-first-meaningful-content, API latency/failures and image-load failures in sampled, privacy-safe, aggregated buckets via `POST /telemetry/client-metrics`). No third-party performance SDK is required (an optional Firebase Performance integration is possible later and is not part of this scope). | DECIDED |
| D-71 | Network resilience policy (apps): connect timeout 5 s, receive timeout 15 s for GETs (30 s kept for uploads), **one jittered retry for idempotent GETs only**, no automatic retry of writes, explicit partial-failure UI per section (as built for Home), offline/slow-connection indicator, request cancellation on screen exit. | DECIDED |
| D-72 | Vendor and Driver polling is replaced by **cheap change detection**: `GET /vendor/orders/changes?since=` (counts/ids, ETag/304) for the Vendor Dashboard; for the Driver app, push-triggered refresh (FCM already integrated) with adaptive intervals (idle vs active delivery) and batched location updates; Admin operations facts get a 10 s server-side cache with single-flight. | DECIDED |
| D-73 | Performance regression protection is part of CI/nightly: query-count and payload-size budgets in e2e (every PR), latency budgets on a seeded dataset (nightly, not per-PR, because of noise), Flutter profile/Release startup traces on the device lab (per release candidate), Lighthouse/Web-Vitals budgets for the Dashboard (per PR for bundle size, nightly for timing). Budgets live in a versioned file (`docs/performance/budgets.json`, created in WS-P0). | DECIDED |
| D-74 | The Dashboard budget: first-load JS ≤ 180 kB gzip per route (today 139–142 kB for the heaviest measured pages), charts/editors/PDF preview code-split, LCP ≤ 2.5 s and INP ≤ 200 ms on the reference desktop and tablet profiles. | DECIDED |
| D-75 | App size is tracked (Customer AAB is ≈58 MB today): release builds use shrinking/resource shrinking and tree-shaken icons/fonts, with a size budget enforced per release candidate. | DECIDED (settings verified in WS-P2; no build configuration is changed by this specification) |

## I. Corrections to the earlier blueprint (this register wins)

1. "Collections" (Marketplace) was a proposal without repository evidence → **removed**; Home layout = banners (+ sector/subcategory ordering).
2. "Product variants / options / categories images" → **no image** (D-14); only product additional images and vendor-branch cover are new.
3. Blueprint said the `uploads` table could be "extended"; the decision is a **new** media module, with `uploads` left intact for customer/driver-owned files.
4. Blueprint listed "Notification broadcast" as a decision; it is now **decided** (D-42) with a new inbox model because `customer_notifications` is order-bound.
5. Blueprint named `VIEW_REPORTS` as the reporting permission; it exists but is unused — it is **kept** as the generic report-view permission and complemented by per-family permissions (Master Spec §7.3).
6. Blueprint estimated the Home completion at "half a day"; no effort estimates are given in this specification.
7. Blueprint treated performance only as Home aggregation; performance is now a full workstream (WS-P, §H) covering all apps, backend, database, images, caching and monitoring.
8. The "no disk caching" stance used for the Home task is amended by D-65 (sectors/banners only), because startup performance is now an explicit requirement.

---

## J. Owner decisions of 2026-10-31 (final — they win over every earlier text in this register and the master prompt)

| ID | Decision |
|---|---|
| D-76 | **C4 is approved exactly as defined** (PRODUCT_DECISIONS C4 / PD-016 A): the actual-weight difference is settled in the cash portion (increase) or credited to the wallet (decrease). **No customer-approval step** for a weight price difference exists or will be built. |
| D-77 | **Product substitution is removed.** No replacement suggestion, selection or approval; nothing in the roadmap, data model, APIs, UI, notifications or acceptance tests. |
| D-78 | **Unavailable product after ordering** (PD-016 C): the customer either continues without the item(s) or cancels the entire order; no response → Operations contacts the customer and records the decision; silence is never consent; money and state follow the existing approved rules and state machine. |
| D-79 | Consequences for the program: the "customer must approve the final-weight difference" requirement and acceptance scenarios 9–11 and 14–15 of the master prompt are withdrawn; scenario 12 becomes the no-response path of D-78; a new scenario covers "continue without" and "cancel entire order". The Customer app needs one screen for the two-option response (Phase 5). |

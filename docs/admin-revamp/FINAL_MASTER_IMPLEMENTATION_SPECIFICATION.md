# Hatly Enterprise Management — Final Master Implementation Specification

**Status:** FINAL specification — **documentation only**. Nothing in the product, tests, dependencies, databases, environment/storage configuration or Production was changed to produce it; nothing was deployed, committed or pushed.
**Date:** 2026-10-30 · **Authority:** this document is the **single source of truth**. The other four deliverables derive from it and must agree with it:

| Deliverable | Role |
|---|---|
| `FINAL_MASTER_IMPLEMENTATION_SPECIFICATION.md` (this file) | What is built, how it behaves, the rules, the acceptance intent |
| `FINAL_DECISION_REGISTER.md` | Every decision once (D-xx), owner items (U-xx), corrections to the earlier blueprint |
| `FINAL_API_AND_DATA_MODEL_PLAN.md` | Endpoint-by-endpoint and entity-by-entity contracts, indexes, migrations, backfills |
| `FINAL_IMPLEMENTATION_ROADMAP.md` | Dependency-ordered workstreams WS-0…WS-11 and WS-P with gates and Definition of Done |
| `FINAL_ACCEPTANCE_MATRIX.md` | Measurable, testable acceptance criteria (G-, M-, P-, S- families) and the test that proves each |

`ENTERPRISE_ADMIN_BLUEPRINT.md` (earlier audit) is reference material only; where it differs, the Decision Register §I lists the correction.

---

## 1. Purpose, scope and rules

### 1.1 Purpose
Transform the Hatly Admin Dashboard from a set of operational forms into an **Enterprise Management platform** covering sixteen modules, a production-grade design system, a Media platform, a reporting/export platform, strict finance correctness, enterprise RBAC and audit, marketing/campaign/notification capability, real system monitoring, the formal closure of the Home Aggregation work, and — as a first-class, cross-cutting workstream — **measured performance engineering of the whole platform** (Customer, Vendor, Driver and Admin surfaces, backend, database, images, caching, monitoring).

### 1.2 The sixteen modules (scope is complete; nothing is deferred)
1 Executive Control Tower · 2 Order Management · 3 Marketplace · 4 Vendor & Branch · 5 Product & Inventory · 6 Delivery & Fleet · 7 Customer Management · 8 Finance & Accounting · 9 Payments, Refunds & Settlements · 10 Marketing & Growth · 11 Coupons, Promotions & Campaigns · 12 Reports & Analytics · 13 Media Management · 14 Admin Users, RBAC & Audit · 15 System Monitoring & Integration Health · 16 Platform Configuration.
Cross-cutting workstreams: WS-0 Home Aggregation closure, **WS-P Performance Engineering**.

### 1.3 Rules that govern every part of the specification
1. **Reuse before build.** Existing services (financial-event + idempotency services, refund/wallet services, settlement close, audit interceptor, `PermissionsGuard`, storage providers, `lib/api/client.ts`, MFA/CSRF/session) are reused, never re-derived.
2. **Server-authoritative.** The Dashboard never computes money, totals, KPIs, statuses or permissions (D-05, D-32).
3. **Additive and backward-compatible.** Migrations are additive and reversible; existing endpoints, URLs, enum names and snapshots stay valid; new response fields are additive (older apps ignore them).
4. **No invented requirements.** No image fields, statuses, metrics or entities are added without a verified business purpose recorded in the Decision Register.
5. **No fabricated data.** Unmeasured values are shown as "no data"; unconfigured integrations as DISABLED (D-44). No placeholder metrics, no demo data in Production code paths.
6. **Measure before optimizing; Release-mode device evidence is the only acceptance evidence for app performance** (D-60, D-61).
7. **Nothing is deployed by this specification.** Every workstream ends in a local/staging-verifiable state; deployment is a separate, explicitly authorised step.
8. **No effort estimates and no calendar dates** are given; sequencing is expressed only through dependencies and gates.
9. **Owner decisions are limited to owner-controlled items** (credentials, paid services, production infrastructure, accounting policy) — Decision Register §G. Each has a safe default so work is never blocked.

### 1.4 How to read the module specifications
Each of the 16 module specifications in §5 uses the same template (§5.0). Universal behaviours that apply to every page (loading/empty/error/success patterns, list behaviour, AR/EN and RTL, responsive layouts, accessibility) are defined once in §4 and §5.0; each module lists only what is specific to it. IDs: `PG-xx` pages, `EP` endpoint IDs from the API plan (prefix per module), `AC` acceptance IDs from the Acceptance Matrix.

---

## 2. Verified repository baseline (evidence) and what could not be verified

### 2.1 Facts verified from the repository (this session)
| Area | Verified fact |
|---|---|
| Backend | NestJS 10, TypeORM, PostgreSQL, Redis (ioredis, shared `REDIS_CLIENT`); ≈253 routes; 62 entities; 65 migrations (last: `OrderOperations1700006400000`); 159 unit / 69 e2e / 25 integration spec files |
| Permissions | 33 permission enum names (kept): `MANAGE_VENDOR_COMMISSION, MANAGE_DELIVERY_FEE_MULTIPLIER, MANAGE_DRIVER_COMMISSION, CLOSE_VENDOR_SETTLEMENTS, VIEW_VENDOR_FINANCIAL_REPORTS, VIEW_DRIVER_SETTLEMENTS, CLOSE_DRIVER_SETTLEMENTS, ASSIGN_REASSIGN_ORDERS, OVERRIDE_DISPATCH, CHANGE_DRIVER_ONLINE_STATUS, OPEN_CLOSE_VENDOR_BRANCHES, MANAGE_BUSINESS_CONFIG, MANAGE_VEHICLE_TYPES, MANAGE_LOYALTY_CONFIG, MANAGE_DRIVER_VENDOR_PREFERENCES, MANAGE_HATLY_SERVICE_PRICING, VIEW_REPORTS, MANAGE_VENDOR_STAFF, MANAGE_DRIVERS, VERIFY_MANUAL_PAYMENTS, MANAGE_EMPLOYEE_LOANS, MANAGE_OFFERS, MANAGE_HOME_BANNERS, MANAGE_MARKETPLACE_SECTORS, MANAGE_VENDORS, MANAGE_CATALOG, MANAGE_SERVICE_AREAS, MANAGE_CUSTOMER_WALLET, VIEW_ORDERS, MANAGE_ORDER_ISSUES, VIEW_CUSTOMERS, VIEW_AUDIT_LOG, MANAGE_ORDER_FULFILMENT` (`VIEW_REPORTS` and `VIEW_VENDOR_FINANCIAL_REPORTS` are referenced by no endpoint) |
| Absent today | `sharp`; any job queue; any monitoring SDK; any time-zone handling in backend code; any CSV/XLSX/PDF *output* (only product-import xlsx input and an import template); list endpoints for financial events, settlement periods, payments, wallet ledger (admin), offer consumptions, ratings, uploads |
| Indexes | `orders`: status, customer, vendor_branch, unique order number — **no `created_at`**; `financial_events`: `order_id`, `type` — **no date index** |
| Settlements | Vendor period: `gross_sales_minor`, `total_commission_owed_minor`, status OPEN/CLOSED. Driver period: `total_earnings_minor`, `total_commission_owed_minor`, `total_reimbursements_owed_minor`, `net_payable_minor`. **No "paid" state exists.** Periods are contiguous, closed on demand (no scheduler) |
| Wallet / payments | Wallet transaction types: LOYALTY_REDEMPTION, ADMIN_CREDIT, DRIVER_CASH_REMAINDER, ORDER_PAYMENT, ORDER_REFUND, ADJUSTMENT, EXPIRATION. Payment statuses: PENDING, CUSTOMER_CLAIMED_TRANSFER, UNDER_REVIEW, PAID, REJECTED |
| Notifications | `customer_notifications` is order-bound (`order_id` FK, unique `(order_id,type)`) |
| Users | `users.is_active` is honoured at login |
| Storage | Local-filesystem and S3-compatible (hand-written SigV4) providers; byte-based JPEG/PNG/WebP detection; `POST /uploads` base64 JSON (5 MB); four multipart endpoints (vendor logo, vendor product image, home-banner image, Excel import); `uploads` table stores url + uploader only |
| Images (entities) | Vendor.logoUrl, MarketplaceSector.imageUrl, MarketplaceSubcategory.imageUrl, Product.imageUrl, CatalogProduct.imageUrl, HomeBanner.imageUrl; snapshots/cart/proof-of-delivery use `uploads`. No image on option values, menu categories, branches (cover), offers |
| Dashboard | Next.js 15.5, React 18, Tailwind 3, axios, swr; 28 admin pages + 3 vendor pages (`control-tower, order-search, customers, vendors, branches, vendor-staff, drivers, dispatch (redirect), failed-deliveries, manual-transfer, cash-remainders, settlement, employee-loans, vehicle-types, sectors, service-areas, delivery-zones, offers, banners, settings, users, security, audit-log, account-deletion-requests` + `login`; vendor: `orders, products`); ≈15k lines; 11 domain components, **no primitives/table/chart libraries**; flat 24-link header navigation (not permission-aware); 4 pages bilingual; 30 Playwright specs; 141 distinct endpoint calls; ≈128 of 253 routes have a Dashboard caller (44 admin/vendor routes uncalled) |
| Home aggregation (local, uncommitted) | `GET /home/product-sections` (contract v1; sections OFFERS/MOST_ORDERED/NEW; `deliveryZoneId`, `sections=`; header `X-Home-Cache`), `HomeSectionsCache` (epoch key, per-section keys, TTL 60 s, single-flight + NX lock, 250 ms per-command timeout, 15 s circuit), `HomeCacheEpochInterceptor`, Flutter `HomeProductSectionsApi`, `homeSnapshotProvider`, `HomeSectionError` |
| Performance evidence | See §13.2 (Production header/TTFB probes, repo greps). **No Release-mode, physical-device measurement exists anywhere.** |

### 2.2 Things this specification could not verify (carried to the final report)
1. **Release-mode device baselines** do not exist (devices are owner item U-08) — §13 defines how they are produced; until then every app-performance number in this document is either evidence from a probe (labelled with its conditions) or a *budget*, never a claimed result.
2. **Production database behaviour** (query plans on production-sized data, `pg_stat_statements`) — not accessible (U-09). Plans are verified on a seeded local database and re-checked in staging.
3. **Currency of the time-zone database** for Africa/Cairo on the production host (U-04).
4. **Accounting policy** behind vendor payable and partial settlement payments (U-01).
5. **Dependency maintenance/security status and exact compatible versions** of every new library in §14 — checked at install time (no network audit was performed for this document); the SheetJS CDN tarball provenance is noted.
6. **Arabic PDF shaping** with headless Chromium (gate S-PDF, D-23) — prototype required.
7. **Whether an admin-user creation path/invite flow exists** beyond `admin/users` (the route parser did not list the users controller routes individually); WS-10 begins by reading it. Specified behaviour does not depend on the answer.
8. Route paths in the API plan marked REUSE come from a heuristic route parser (±a few); each is re-confirmed by reading the controller at the start of the owning workstream.
9. Exact Production edge behaviour for new `Cache-Control` headers (Cloudflare cache-key handling) — owner item U-07; correctness does not depend on edge caching.

---

## 3. Cross-cutting contracts (apply to every module)

### 3.1 Time and dates
* Instants are `timestamptz` (unchanged). A **report/filter date** is an Africa/Cairo calendar date; a range `[from, to]` means `[from 00:00:00, to+1d 00:00:00)` in Africa/Cairo converted in the backend (`AT TIME ZONE`). The zone is the platform setting `REPORTING_TIMEZONE` (default `Africa/Cairo`). Day/week/month bucketing uses the same zone. Week starts on Saturday (Egypt convention) as a setting `REPORTING_WEEK_START` (default `saturday`).
* One helper (`ReportingClock`, WS-1) exposes `rangeToUtc(from,to)`, `bucketSql(granularity)`, `todayLocal()`. No other code converts time zones.
* The Dashboard displays instants with `Intl.DateTimeFormat(locale, { timeZone: 'Africa/Cairo' })`; AR uses Arabic month/day names and **Western (Latin) digits** by default for operational tables (consistency with exports), with a user preference for Eastern Arabic digits applied to prose only.
* Test fixtures cover 23:59/00:00 boundaries and a DST transition.

### 3.2 Money
* Integer minor units (`*Minor`, EGP, 2 decimals) everywhere; no floats in storage, API or exports. Exports write numbers as numeric cells in major units with two decimals **and** an optional `*_minor` column for reconciliation.
* The Dashboard renders with `lib/money.ts`; it never sums or derives money. Negative values (refunds, restorations) are shown with a sign and colour *and* text/icon (never colour alone).
* Rounding rules are those of the existing financial services; no new rounding path is introduced.

### 3.3 Lists: pagination, sorting, filtering
* **Server-side, always.** Offset pagination `page` (1-based) + `pageSize` (default 25, max 100) for bounded tables; **keyset (cursor)** pagination `cursor` + `limit` (default 50, max 200) for append-only/high-volume tables (financial events, audit log, wallet transactions, orders list > 50k rows, notification recipients).
* Response envelope: `{ items: T[], page, pageSize, total, totalExact: boolean, nextCursor? , summary? }`. `total` is exact for filtered counts under 100,000 rows and otherwise an estimate flagged `totalExact:false` (UI shows "about N"). Optional `summary` carries server-computed totals for the *whole filtered set* (never the page).
* Sorting: `sort=field:asc|desc`, whitelisted per endpoint (default documented per endpoint); stable tie-break by primary key.
* Filters: explicit, typed query parameters per endpoint; unknown parameters rejected with 400 (`UNKNOWN_FILTER`); text search via `q` with minimum 2 characters; date filters as Africa/Cairo calendar dates (§3.1).
* The Dashboard mirrors filters/sort/page in the URL query string (shareable, refresh-safe) and supports **saved views** (§4.7).

### 3.4 Errors
Existing Nest error shape is preserved. New endpoints return `{ statusCode, error, message, code, details? }` where `code` is a stable machine code (`VALIDATION_FAILED, NOT_FOUND, FORBIDDEN, CONFLICT, IDEMPOTENCY_CONFLICT, STATE_CONFLICT, RATE_LIMITED, EXPORT_TOO_LARGE, MEDIA_*` …); `message` is a human sentence (Arabic/English chosen by `Accept-Language`, English default). The Dashboard maps `code` → localized copy and never displays raw server text for 5xx.

### 3.5 Idempotency
Every money- or state-changing **write that can be retried** accepts `Idempotency-Key` (header, 8–128 chars). Semantics: same key + same body → original result (replay marked `Idempotent-Replay: true`); same key + different body → `409 IDEMPOTENCY_CONFLICT`. Keys are stored with the business row (unique index) or in the financial-event idempotency store — the **existing** mechanism is reused for money (financial events) and a new generic `idempotency_keys` table (scope, key, request hash, response ref, expires) serves non-financial writes (campaign send, bulk action, export request). Dashboard generates a UUID per user intent and reuses it on retry.

### 3.6 Audit
* Existing global interceptor audits admin mutations (actor, route, target, outcome). New explicit events (structured `metadata`) are listed in §9.4. Audit rows are append-only; never edited; retention ≥ 24 months (platform setting); the audit viewer supports entity-history (`targetType`,`targetId`) and export (itself audited).
* Reads of sensitive data are audited only for **exports/downloads and PII reveals** (not every page view).

### 3.7 Permissions model (summary; catalogue in §9)
Every route is `@RequiresPermission`; the route-authorization inventory test (e2e 99) is extended to every new route and fails the build if a route lacks a guard. Permission-aware navigation is a UX filter only (D-32). Object-level authorization (a vendor sees only its own data) is unchanged and tested per new vendor-facing route.

### 3.8 Background jobs (D-07)
Table `background_jobs`: `id, type, status (QUEUED|RUNNING|SUCCEEDED|FAILED|CANCELLED|EXPIRED), payload jsonb, result jsonb, progress int, attempts, max_attempts, run_after, locked_by, locked_at, heartbeat_at, requested_by_user_id, created_at, finished_at, expires_at, error_code, error_message`. Worker loop (in the backend process, enable/disable per instance by `JOBS_WORKER_ENABLED`) claims with `SELECT … FOR UPDATE SKIP LOCKED`, heartbeats every 10 s, requeues a job whose heartbeat is older than 60 s (visibility timeout), retries with exponential back-off up to `max_attempts` (default 3) for idempotent job types only, supports cancellation (cooperative flag checked between batches). Job types: `REPORT_EXPORT, MEDIA_VARIANT_BACKFILL, MEDIA_PURGE, SETTLEMENT_STATEMENT_PDF, CAMPAIGN_EXPAND_AUDIENCE, CAMPAIGN_SEND_BATCH, BROADCAST_SEND, EXPORT_FILE_PURGE, METRIC_ROLLUP, INTEGRATION_PROBE, CACHE_WARM`. Concurrency per type is capped (`JOBS_CONCURRENCY_<TYPE>`). Job health (queue depth, oldest queued age, failure rate) feeds §11.

### 3.9 Feature flags
Server-side platform settings gate every new module's *visibility and risky behaviour* during rollout (e.g. `FEATURE_REPORTS`, `FEATURE_MEDIA_LIBRARY`, `FEATURE_CAMPAIGNS`, `FEATURE_BROADCASTS`, `FEATURE_PUBLIC_HTTP_CACHE`). Flags are read by the backend (authoritative) and mirrored in `/admin/me/permissions` for navigation; a flag never replaces a permission.

---
## 4. Enterprise design system (WS-2)

Location: `apps/dashboard/ui/*` (primitives), `apps/dashboard/features/<module>/*` (module code), `apps/dashboard/app/(admin)/*` (routes). Existing `components/*` domain widgets are migrated onto primitives page by page; no big-bang replacement (D-01).

### 4.1 Design tokens (CSS variables; Tailwind reads them)
| Group | Tokens |
|---|---|
| Colour | `--color-brand` (Hatly orange, current `hatly.orange`), `--color-brand-fg`; neutral scale `--gray-0…950`; semantic `--success/--warning/--danger/--info` each with `-bg`, `-fg`, `-border`; `--surface-0/1/2`, `--text-1/2/3`, `--border`, `--focus-ring`. Light and dark themes; `prefers-color-scheme` default with explicit user override stored per admin (localStorage). Contrast: text ≥ 4.5:1, large text/UI components ≥ 3:1 in **both** themes — verified by an automated contrast test over the token pairs. |
| Typography | Latin: system UI stack. Arabic: a self-hosted Arabic-capable face (asset served by the Dashboard, no third-party font CDN at runtime). Scale (rem): 12, 13, 14 (body), 16, 18, 20, 24, 30; line-height 1.5 body / 1.25 headings; tabular numerals for money and counts (`font-variant-numeric: tabular-nums`). |
| Spacing | 4-px base: 0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64. Page gutter 16 (mobile) / 24 (tablet) / 32 (desktop). |
| Radius / elevation | radius 4/8/12/full; elevation 0–3 (border + shadow; dark mode relies on border/lighter surface, not shadow). |
| Motion | 120/200/300 ms, easing standard; `prefers-reduced-motion` disables non-essential motion (skeleton shimmer becomes static). |
| Z-index | base 0, sticky 10, dropdown 20, drawer 30, modal 40, toast 50, command palette 60. |
| Breakpoints | `sm 640`, `md 768`, `lg 1024`, `xl 1280`, `2xl 1536`. Reference viewports for tests: 390×844 (phone), 820×1180 (tablet), 1440×900 (desktop). |
| Direction | Logical properties only (`margin-inline-start`, `padding-inline`, `inset-inline`); Tailwind logical utilities (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`). Physical `left/right/ml/mr/pl/pr/text-left/text-right` are forbidden by a lint rule (custom ESLint rule, CI gate). |

### 4.2 Primitives (all in `ui/`, each with unit tests + a11y test + RTL snapshot)
Button (variants primary/secondary/ghost/danger; loading state keeps width), IconButton (mandatory accessible name), Input, Textarea, NumberInput (minor-unit aware), MoneyInput (major-unit entry → minor-unit value, validation), Select/Combobox (Radix Select / cmdk, async options), MultiSelect, Checkbox, RadioGroup, Switch, DateInput + DateRangePicker (Africa/Cairo, presets: today, yesterday, last 7/30 days, this/last month; keyboard accessible; Arabic calendar labels, Gregorian dates), FileDropzone, Badge/StatusPill (status colour + text + icon), Avatar, Tooltip, Popover, DropdownMenu, Tabs, Accordion, Breadcrumbs, Pagination, Stepper, Progress, Skeleton, Spinner, EmptyState, ErrorState, Banner/Alert, Toast, Dialog (modal), ConfirmDialog (typed-confirm option), Drawer (side panel; slides from the logical *end* edge), Card, KpiCard, DataTable, FilterBar, SavedViews, ChartFrame, MediaPicker (§6), CopyButton, KeyValueList, Timeline, DiffView (before/after for audit and config history), PermissionGate.

### 4.3 App shell
* **Sidebar** (collapsible; persistent on ≥ lg; off-canvas drawer on < lg), grouped by the 14 navigation groups of the blueprint §8 (Control Tower, Orders, Marketplace, Vendors, Catalog, Fleet, Customers, Finance, Marketing, Reports, Media, Access, System, Settings). Each item has: icon, label (AR/EN), required permission(s), optional live counter (operations counters already exist), feature flag. Items the admin has no permission for are **not rendered**; groups with no visible item are hidden. Active item and group are indicated (`aria-current="page"`). Collapsed state remembered per admin.
* **Topbar**: page title area, global search trigger (⌘/Ctrl-K and `/`), notification/operations indicator, locale toggle (AR/EN with `dir` switch), theme toggle, user menu (profile, security/MFA, sign out). Environment badge (LOCAL/STAGING/PRODUCTION) shown when not production-like to prevent mistaken actions.
* **Breadcrumbs**: derived from the route registry (`features/<module>/routes.ts` declares `{path, titleKey, parent}`); the last crumb is the current page and not a link. Long entity names are truncated with full text in a tooltip.
* **Global search / command palette (cmdk)**: one input, grouped results with keyboard navigation: *Navigate* (pages the admin may open), *Orders* (by number — exact match via `/admin/orders/by-number`, or last digits), *Customers* (phone/name — masked when no PII permission), *Vendors/Branches*, *Products*, *Drivers*, *Actions* (e.g. "Create offer", "Open Settlement"). Backed by one endpoint `GET /admin/search?q=&types=` (EP `CT-04`) that executes only the entity searches the caller has permission for, returns ≤ 5 results per group, p95 ≤ 300 ms (acceptance P-05). Recent items remembered locally.
* **Session/MFA/CSRF**: `lib/api/client.ts` and `lib/auth/*` are used unchanged (D-02); the shell calls `/auth/dashboard/me` and `/admin/me/permissions` once per session start and revalidates on focus.

### 4.4 KPI cards
Props: label, value (formatted by caller from backend value), unit, delta vs previous period (backend-provided, with direction and "good/bad" semantics provided by the metric definition, not guessed in UI), sparkline (≤ 30 points), definition tooltip (what exactly is counted), as-of timestamp, status (loading/ready/no-data/error), drill-through link carrying the same filters. A KPI whose backend value is `null` shows "No data" — never 0.

### 4.5 DataTable (server-paginated; `@tanstack/react-table` headless)
* Columns: typed definitions (accessor, header key, align via logical alignment, `numeric` → end-aligned + tabular numerals, `sortable`, `hideBelow: 'md'|'lg'`, `pin: 'start'`), column chooser (persisted per table id), density (comfortable/compact).
* Server contract §3.3 only; client never sorts/filters data it does not hold fully. Row selection (page-scoped; "select all N matching" requires the server `selectionToken` and the bulk-action safeguards of D-35), sticky header, optional footer **totals row rendered from `summary`**.
* Row actions in a menu (≥ 2 actions) or inline (1 action); destructive actions confirm.
* **Responsive**: ≥ lg full table; md horizontal scroll with pinned first column; < md the table renders as a **card list** (each row a card with the designated primary/secondary fields and an expandable "details" section) — defined per table by `mobileCard` config.
* States: loading = skeleton rows (same row count as page size, max 10); empty (no data ever) vs empty-filtered ("No results — clear filters"); error with retry; stale-while-revalidate indicator (thin progress bar) during refetch; never blank.

### 4.6 FilterBar, search, pagination
Filter chips with an "Add filter" menu; each filter has type (enum, multi-enum, entity picker, date range, number range, boolean, text); applied filters are visible and removable; "Clear all"; filter state ↔ URL; debounce 300 ms for text; request cancellation of superseded requests (SWR key change + AbortController). Pagination shows range ("26–50 of 1,284" / "about 12,000"), page-size selector (25/50/100), keyboard accessible; keyset lists use Next/Previous only.

### 4.7 Saved views
Per admin and optionally shared (`saved_views`: `id, owner_user_id, scope (PRIVATE|SHARED), table_id, name, filters jsonb, sort, columns jsonb, created_at, updated_at`; max 30 per admin per table). Applying a view sets URL state; a view whose filter references a permission-gated field is hidden for users without that permission. Shared views are created by users with the module's update permission. Endpoints `CT-10…`/generic `GET/POST/PATCH/DELETE /admin/saved-views`.

### 4.8 Forms
`react-hook-form` + `zod` schemas that **mirror** backend DTO validation (the backend remains authoritative; server `details` are mapped to fields). Rules: label above input, required marker + `aria-required`, help text, inline error text linked by `aria-describedby`, error summary at top on submit failure with focus moved to it, disabled state never used to hide a reason (a tooltip explains), unsaved-changes guard (route change/refresh), autosave only for drafts that exist server-side (campaigns), optimistic updates only for toggles with rollback. Money inputs take major units and convert to minor units in one function; phone inputs normalise to E.164 with Egyptian default.

### 4.9 Drawers, modals, toasts, confirmations
* Drawer: detail/edit of a row without losing list context; focus trap, `Esc` closes, returns focus to the trigger; URL-addressable (`?drawer=entity:id`).
* Modal: only for short decisions; `ConfirmDialog` states consequence in one sentence, shows counts for bulk, requires reason when the action requires one, requires typing the count/name for irreversible or ≥ 20-item actions.
* Toast: success (auto-dismiss 5 s), error (persist until dismissed, includes request id), info; max 3 stacked; `role="status"`/`role="alert"` appropriately; never the *only* feedback for a failed save (the form shows it too).

### 4.10 Charts (Recharts, theme-aware)
Chart types allowed: line/area (time series), bar (categorical, stacked for composition), donut (≤ 5 slices only), funnel (order stages), heat strip (hour×day), sparkline. Rules: colour-blind-safe categorical palette (8 colours) validated for contrast on both themes; every chart has a title, unit, as-of time, a **data table alternative** (toggle) and keyboard-reachable data points with tooltips; axis labels localized; RTL mirrors horizontal order of categories where reading order matters but **time axes stay left→right** (documented convention) — verified in screenshots; no chart is drawn from data the backend did not provide (no client-side extrapolation). Charts are code-split (dynamic import) to protect the bundle budget (D-74).

### 4.11 Skeleton / empty / error / success standards
| State | Standard |
|---|---|
| Loading | Skeleton matching final layout (no spinner-only pages); content area reserved to avoid layout shift (CLS ≤ 0.1); after 10 s show "Still loading…" with Retry |
| Empty (first use) | Illustration-free icon, one-line explanation, primary call-to-action if the user has the permission to create |
| Empty (filtered) | "No results for these filters" + Clear filters |
| Error (recoverable) | Message by `code`, Retry button, request id copyable; 401 → login redirect (existing client); 403 → "You don't have access" page that names the missing permission label (not the enum) and contact path; 404 entity page; offline banner |
| Success | Toast + state change visible in place (row updated, badge changed); long-running → job card with progress |
| Partial failure | Per-card/per-section error with local retry (never blank the page for one failing widget) |

### 4.12 Responsive behaviour (mobile / tablet / desktop)
* Phone (< 768): sidebar as drawer; tables as cards; filters in a bottom sheet; primary action in a sticky bottom bar; charts reduce to sparkline + table; forms single column; drawers become full-screen sheets. Operational pages (order detail, dispatch actions, refunds-to-send, approvals) are fully usable on phone; heavy authoring pages (campaign builder, report builder, media crop) are usable on tablet and above and degrade to read/approve on phone with an explicit notice.
* Tablet (768–1023): collapsed icon sidebar, 2-column forms, tables with pinned first column.
* Desktop (≥ 1024): full layout; split view (list + detail drawer).
* Touch targets ≥ 44×44 CSS px on touch viewports.

### 4.13 Accessibility (WCAG 2.2 AA target)
Landmarks (`header/nav/main/aside`), skip-to-content link, visible focus ring (≥ 3:1), full keyboard operation (no keyboard trap; roving tabindex in menus/tabs/grids), dialogs focus-trapped and labelled, live regions for toasts and async results, form errors announced, tables use `<table>` semantics with `scope`, sortable headers expose `aria-sort`, icon-only controls named, colour never sole information carrier, reduced motion respected, zoom to 200% without loss, text spacing override tolerant, `lang`/`dir` set on `<html>` and on mixed-language fragments (`<bdi>` for user-generated names/phones). Automated: `@axe-core/playwright` scan on every new page in both locales and both themes (zero serious/critical violations — gate A-01); manual checklist per module with a screen-reader smoke test on the primary flow (VoiceOver, TalkBack — recorded, not automated).

### 4.14 AR/EN and RTL
* Catalogs `lib/i18n/{en,ar}` with **compile-time key parity** (existing mechanism extended to all pages: today only 4 of 28 pages use it → all pages migrated; a lint test fails on any hard-coded user-visible string in `features/*` and `app/(admin)/*`).
* Pluralization via ICU-style helper (Arabic has six plural forms — zero, one, two, few, many, other); numbers/dates/currency via `Intl` with `Africa/Cairo`; currency shown as "EGP"/"ج.م" with locale-appropriate placement; digits policy as §3.1.
* Direction switches `<html dir>`; icons with direction (chevrons, back arrows, progress) mirror; logos, charts' time axes, phone numbers, order numbers, codes and any Latin identifiers stay LTR inside RTL text (`<bdi dir="ltr">`).
* Backend returns **both** `nameEn/nameAr` where entities are bilingual today (sector, subcategory, vendor names as stored); the Dashboard shows the locale-appropriate one with fallback; the spec adds no new bilingual entity fields except where a module says so (campaign names/messages: `title_en/title_ar`, `body_en/body_ar` — required for broadcasts).
* RTL screenshot tests (Playwright) for every new page.

### 4.15 Formatting rules (Africa/Cairo, EGP)
Dates `dd MMM yyyy`; date-time `dd MMM yyyy, HH:mm` 24-hour in Africa/Cairo with a tooltip of the ISO instant; relative times ("5 min ago") only for ≤ 24 h and with absolute time in the title; money `EGP 1,234.50` (AR: `١٬٢٣٤٫٥٠ ج.م` only when the admin selected Eastern digits); percentages one decimal; durations `1 h 05 m`; large counts `12.4k` only in KPI cards (tables show exact).

---
## 5. Module specifications

### 5.0 Template (every module follows it)
`Purpose · Pages (PG) · Journeys · Actions (permission · audit · confirmation) · Endpoints (API plan IDs; REUSE / EXTEND / NEW) · Data · Permissions · Audit · Validation · States (module-specific loading/empty/error/success) · List behaviour (search/filter/pagination/sorting) · Reports/exports · AR/EN + RTL · Responsive (mobile/tablet/desktop) · Tests (unit/integration/e2e/Playwright) · Dependencies · Acceptance (AC IDs in the Acceptance Matrix)`.
Unless a module says otherwise: loading/empty/error/success follow §4.11; list behaviour follows §3.3/§4.5–4.7; AR/EN + RTL follow §4.14; the responsive rules follow §4.12; every new page ships with an axe scan (A-01) and RTL screenshot test. **Test taxonomy used below:** *U* backend unit (Jest), *I* backend integration (real PostgreSQL), *E* backend e2e (supertest, `apps/backend/test/e2e`), *D* dashboard unit (Vitest/Jest as existing), *PW* Playwright (existing fixtures), *X* axe/RTL/visual (Playwright).

---

### 5.1 Module 1 — Executive Control Tower (prefix CT)
**Purpose.** One landing page that tells an executive and the operations lead, within seconds, what is happening now (live operations), how the business is doing in a period (executive KPIs) and what needs attention (alerts/SLAs), with every number drillable to the list that produced it.

**Pages.** PG-CT-1 *Executive overview* (`/control-tower`, evolves the existing page) · PG-CT-2 *Live operations* (`/control-tower/live`: active orders by stage, drivers online/idle/busy, pending acceptance, dispatch alerts, refunds to send — the existing operations facts, restructured) · PG-CT-3 *Alerts & SLA board* (`/control-tower/alerts`).

**Journeys.** (1) Open → see KPI strip for *today vs yesterday* (default) → change period → click a KPI → land on the filtered list (Orders/Finance/Reports) with identical filters. (2) Operations lead opens Live → sees an alert "Order #… no eligible driver" → opens order → assigns. (3) Executive opens Alerts → filters severity → acknowledges an alert (adds note, does not resolve the cause).

**KPI definitions (server-side, one definition each; shown in the info tooltip):**
| KPI | Definition (Africa/Cairo day boundaries) |
|---|---|
| Orders placed | count of orders with `created_at` in range, any status |
| Orders delivered | count with delivered timestamp in range |
| Cancellation rate | cancelled ÷ placed (same cohort: orders *placed* in range) |
| Gross merchandise value (GMV) | Σ order item subtotals of non-cancelled segments (customer-paid goods value, before discounts/fees) |
| Net delivered sales | gross sales (§8) of segments delivered in range |
| Delivery fees collected | Σ delivery fee of delivered orders |
| Hatly revenue (recognized) | commission recognized + delivery-fee share per §8.1 — **not** gross sales |
| Average order value | GMV ÷ non-cancelled orders |
| On-time delivery % | delivered where `delivered_at ≤ promised_at` ÷ delivered with a promise |
| Avg. acceptance time / avg. preparation time / avg. delivery time | medians (P50) and P90 from status events |
| Active vendors / active drivers | with ≥ 1 order / ≥ 1 delivery in range |
| Outstanding refunds | Σ refund recorded − sent (not yet sent) at as-of time |
| Open dispatch alerts | count of unresolved |
Each KPI returns `{value|null, previous|null, deltaPct|null, asOf, definitionKey}`; `null` = no data. Comparison periods: previous period of equal length, or same weekdays last week.

**Actions.** Acknowledge alert (`VIEW_ORDERS`+ note; audited), change comparison, save a dashboard view (private), export KPI snapshot (RPT).
**Endpoints.** CT-01 (REUSE+EXTEND: `asOf`, 10 s single-flight cache), CT-02, CT-03 (REUSE), CT-04 search (NEW), CT-05 KPIs (NEW), CT-06 time series (NEW), CT-07 alerts (NEW), CT-08 SLA summary (NEW), CT-09 self-permissions/navigation (EXTEND), CT-10…13 saved views (NEW).
**Data.** Reads: `orders, order_vendor_segments, deliveries, dispatch_alerts, financial_events, refund_payouts, order_status_events`. New: `alert_acknowledgements (alert_key, acknowledged_by, note, at)`, `saved_views` (§4.7). KPI reads use the report definitions of §7 (single definition, D-20).
**Permissions.** Page: `VIEW_ORDERS` (operations), `VIEW_REPORTS` (KPI strip), `VIEW_FINANCIALS` (money KPIs: GMV, revenue, outstanding refunds; hidden otherwise — a user without it sees counts only).
**Audit.** Alert acknowledgement; saved-view create/delete (generic interceptor).
**Validation.** `from ≤ to`, range ≤ 366 days, `compare ∈ {previous,sameWeekdayLastWeek,none}`.
**States.** KPI cards load independently (each `ready/no-data/error`); one failing KPI never blanks the page; live panels show "as of hh:mm:ss" and a paused indicator when the tab is hidden; polling interval 20 s visible, paused hidden, backs off to 60 s after 3 consecutive errors; first-use empty state explains that data appears after the first order.
**List behaviour.** Alerts: filter severity/reason/vendor/zone/age, sort by age or severity, keyset pagination; drill-through lists carry filters in URL.
**Reports/exports.** "Executive summary" report (RPT-S01) = KPI snapshot for a range (XLSX/PDF).
**AR/EN/RTL.** Sparklines and time axes stay LTR; KPI labels/definitions localized; Arabic plural forms for counts.
**Responsive.** Phone: KPI cards 2-up, alerts list as cards, charts reduced to sparklines; tablet: 3-up; desktop: 4-up + side panel.
**Tests.** U: KPI formulas and null handling, Cairo-day boundary; I: KPI queries vs hand-computed fixture incl. cancelled/partially rejected/restored discount; E: permission matrix for each endpoint (403 for missing, money fields absent without `VIEW_FINANCIALS`); D: KPI card, polling hook (pause/backoff); PW: overview → drill-through; live ops refresh; alert acknowledge; X: axe + RTL.
**Dependencies.** WS-1 (ReportingClock, report registry, indexes), WS-2 (shell, KpiCard, ChartFrame), WS-4 (report definitions), WS-5 (§8 formulas), WS-P (summary cache).
**Acceptance.** M01-01…M01-10.

---

### 5.2 Module 2 — Order Management (prefix ORD)
**Purpose.** Find, understand and act on any order without leaving one screen: advanced search, a complete timeline, the money picture, dispatch, refunds, notes, and safe administrative actions that always go through the existing state machine and money services.

**Pages.** PG-ORD-1 *Orders* (`/orders`, evolves `order-search`; the old route redirects) · PG-ORD-2 *Order detail* (`/orders/[id]`, tabs: Overview · Items & vendor parts · Timeline · Money · Dispatch · Refunds · Notes) · PG-ORD-3 *Hatly/Wasally queue* (`/orders/hatly`: unpriced orders awaiting price confirmation, service requests, route cards) · PG-ORD-4 *Failed deliveries* (existing, migrated) · PG-ORD-5 *Refunds to send* (cross-link to PAY).

**Journeys.** (1) Support finds an order by number/phone/customer name → opens detail → reads timeline → resends a notification. (2) Operations cancels an order on the customer's request: *Cancel* → reason (required, enumerated + free text) → preview of the money outcome (server-computed: refund destination, discount restoration) → confirm → state machine executes, refunds recorded, coupon restored (PD-014/015), audit written. (3) Ops confirms the price of a Hatly service order (existing flow). (4) Ops filters "Pending acceptance > 5 min", selects 20, bulk-resends vendor notification or bulk-assigns drivers.

**Actions** (permission · audit · confirm):
| Action | Permission | Notes |
|---|---|---|
| View list/detail | `VIEW_ORDERS` | PII masked without `VIEW_CUSTOMER_PII` |
| Act on a vendor part on behalf (accept/prepare/ready/reject) | `MANAGE_ORDER_FULFILMENT` | existing (ORD-04); reason required for reject |
| Cancel order | `MANAGE_ORDER_ISSUES` | NEW (ORD-05); reason required; cannot cancel after delivery; goes through the same use case as the customer cancellation extended for admin actor; refunds/restoration per PD-014/015; idempotent (`Idempotency-Key`) |
| Add/read internal note | `VIEW_ORDERS` read / `MANAGE_ORDER_ISSUES` write | NEW (ORD-07/08); notes immutable (append-only), visible to staff only |
| Resend customer/vendor notification | `MANAGE_ORDER_ISSUES` | NEW (ORD-09); rate-limited per order (3/h); audited |
| Assign / reassign driver | `ASSIGN_REASSIGN_ORDERS` | existing (FLT-02/03) |
| Confirm item price (Hatly services) | `MANAGE_HATLY_SERVICE_PRICING` | existing (ORD-11) |
| Failed-delivery resolution / refund | `MANAGE_ORDER_ISSUES` | existing (ORD-14…16) |
| Bulk resend / bulk assign | as the single action | cap 50, same use case, per-item result (D-35). **Bulk cancel is intentionally not offered** (irreversible money consequences) |
| Export filtered list | `ORDERS_EXPORT` | async export (RPT) respecting masking |

**Endpoints.** ORD-01 list (EXTEND: filters, sort, keyset, `summary`), ORD-02 detail (EXTEND: totals block from backend, flags `customerCanCancel`, `adminCanCancel`), ORD-03 by number (REUSE), ORD-04 segment status (REUSE), ORD-05 cancel (NEW), ORD-06 timeline (NEW unified), ORD-07/08 notes (NEW), ORD-09 resend notification (NEW), ORD-10 Hatly queue (NEW), ORD-11 confirm-price (REUSE), ORD-12 bulk resend (NEW), ORD-13 bulk assign (NEW), ORD-14/15/16 failed delivery (REUSE).
**Data.** Reads: orders and all event tables. New: `order_notes (id, order_id, author_user_id, body, created_at)` (append-only). New index set: `orders(created_at)`, `orders(status, created_at)`, `orders(vendor_branch_id, created_at)`, `orders(customer_id, created_at)`; trigram/prefix index on order number for suffix search (`pg_trgm` is verified at migration time; fallback: exact + prefix search only).
**Filters.** Status (multi), payment method/status, fulfilment type, created/delivered date range, vendor, branch, sector, zone, driver, customer (id/phone/name), amount range, has-refund, has-discount/coupon code, partially-rejected, pending-acceptance, Hatly/Wasally, pending-price, cancelled-by (customer/vendor/admin/system).
**Sort.** created_at (default desc), total, delivered_at, status; **keyset** on `(created_at,id)`.
**Detail composition (all from backend).** Header (number, status, placed time, customer chip, channel), Totals block (subtotal, discounts split by funding, delivery fee, additional-vendor fees, total, paid, refunded recorded vs sent), Segments (each with vendor, state, history with on-behalf label, reason), Timeline (merged, filterable by actor/type), Dispatch (assignments, attempts, alerts), Refunds (recorded vs sent), Offer consumptions (consumed/restored), Notes.
**Validation.** Cancel: `reasonCode ∈ enum`, `reasonText ≤ 500`, order not in `DELIVERED/CANCELLED`; bulk: ≤ 50 ids, same action, confirmation count equals ids length.
**Audit.** `ORDER_ADMIN_CANCELLED`, `ORDER_NOTE_ADDED`, `ORDER_NOTIFICATION_RESENT`, `ORDER_BULK_ACTION` (explicit) + interceptor.
**States.** Detail loads header first then tabs lazily; Timeline skeleton; empty notes "No notes yet"; cancel in progress locks the dialog and shows the resulting money outcome on success.
**Reports.** Orders report (RPT-S02), order lines report, cancellations report, refunds report.
**AR/EN/RTL.** Order numbers, phone numbers and codes `dir="ltr"` inside RTL; status labels localized from enum maps (single map shared with exports).
**Responsive.** Phone: list cards (number, status pill, total, time), detail as accordion tabs, action bar sticky; tablet/desktop: split list+drawer preview.
**Tests.** U: cancel use case (admin actor), filters builder, summary; I: cancel concurrency with driver assignment, idempotent replay, restoration exact-once, bulk partial failures; E: permission matrix, masking, route inventory; D: filter bar↔URL, DataTable; PW: search→detail→cancel→timeline; bulk resend; RTL; axe.
**Dependencies.** WS-1 (indexes, permissions), WS-2, WS-5 (money block), WS-4 (export), WS-P (query budgets).
**Acceptance.** M02-01…M02-14.

---

### 5.3 Module 3 — Marketplace (prefix MKT)
**Purpose.** Control what customers browse: sectors, subcategories, the Home banners and their order, with media-picker-only imagery and a preview that matches the app.

**Pages.** PG-MKT-1 *Sectors* (list + drawer editor) · PG-MKT-2 *Subcategories* (under a sector; includes branch assignment view) · PG-MKT-3 *Home banners* (list, scheduling, preview) · PG-MKT-4 *Home preview* (renders the public composition for a chosen zone: banners, sectors, sections — read-only, uses the same public services).

**Journeys.** Create sector → pick/upload image (aspect-locked crop) → set Arabic/English names → order → activate; deactivate a sector (warns with counts of vendors/subcategories affected); schedule a banner (start/end), pick image, link target (vendor/sector/product/url-internal), preview in Arabic and English.

**Actions.** Create/edit/activate/deactivate sector & subcategory (`MANAGE_MARKETPLACE_SECTORS`); banners create/edit/activate/deactivate/delete/reorder (`MANAGE_HOME_BANNERS`); delete banner is soft-protected: active banner cannot be deleted (deactivate first); each audited by interceptor. Deactivating a sector hides it in the app immediately via cache epoch bump (D-69).
**Endpoints.** MKT-01…06 sectors (REUSE; EXTEND create/patch with `mediaAssetId`), MKT-07…12 subcategories (REUSE, UI new; EXTEND `mediaAssetId`), MKT-13/14 branch sector/subcategories (REUSE), MKT-15…22 banners (REUSE; EXTEND `mediaAssetId`; legacy `POST …/image` kept, deprecated), MKT-23 reorder (EXTEND/NEW — uses existing display-order columns; verified at WS-7 start), MKT-24 home preview (NEW, read-only).
**Data.** `marketplace_sectors/subcategories/home_banners` + `*_media_asset_id` (§6.8). No new tables.
**Image policy (purpose → §6.3).** SECTOR_IMAGE, SUBCATEGORY_IMAGE, HOME_BANNER.
**Validation.** Bilingual names required (AR+EN) ≤ 60 chars; unique name per parent; banner `endsAt > startsAt`; link target must exist and be active at save time; sector deactivate requires confirmation when it has active vendors.
**States.** Preview panel shows loading skeleton → rendered tile; broken/missing image shows a labelled placeholder *in the Admin only*; success toast and "live in app within ≤ 60 s" note (cache TTL) unless epoch bumped (immediate).
**List behaviour.** Search by name (AR/EN), filter active/inactive/sector, sort by order/name/updated, offset pagination.
**Reports.** Banner performance is **not fabricated**: no impression/click tracking exists → the page shows no performance numbers; a later telemetry decision would be a separate change request (recorded in the Decision Register only if the owner requests it).
**AR/EN/RTL.** Bilingual fields side by side with direction-correct inputs (`dir=rtl` on the Arabic input).
**Responsive.** Editors in drawers (tablet+), full-screen sheets on phone; crop tool requires tablet+ (phone offers pick-from-library and re-upload).
**Tests.** U: link-target validation, ordering; I: epoch bump on mutation; E: permissions, media FK restrict, legacy `imageUrl` compatibility; PW: create sector with upload+crop, schedule banner, preview; X.
**Dependencies.** WS-3 (Media), WS-2, WS-P (cache epochs).
**Acceptance.** M03-01…M03-09.

---

### 5.4 Module 4 — Vendor & Branch Management (prefix VND)
**Purpose.** Onboard, configure and monitor vendors and branches: profile, hours, zones, commission, acceptance mode, staff, products and performance — as tabs of one coherent page instead of the current 726-line monolith.

**Pages.** PG-VND-1 *Vendors* · PG-VND-2 *Vendor detail* (Overview · Branches · Staff · Commission · Documents? (**not specified: no document entity exists; omitted**) · Activity) · PG-VND-3 *Branches* (cross-vendor list) · PG-VND-4 *Branch detail* tabs (Profile · Hours & status · Delivery zones · Commission & acceptance · Products · Performance · Media) · PG-VND-5 *Staff* · PG-VND-6 *Onboarding* (checklist per vendor).

**Journeys.** Create vendor → logo (media picker) → first branch (address, hours, zones, sector/subcategories, cover image) → commission → staff user → onboarding checklist turns green → activate. Operations opens a branch → toggles open/closed → sees live acceptance stats. Finance changes commission → effective-from preview → confirm → applies prospectively (existing rule; history shown from audit + financial events).

**Actions.** Vendor CRUD/activate/deactivate (`MANAGE_VENDORS`), open/close branches (`OPEN_CLOSE_VENDOR_BRANCHES`), commission rate (`MANAGE_VENDOR_COMMISSION`, requires reason; shows current vs new and "applies to orders accepted after confirmation"), acceptance mode (`MANAGE_ORDER_FULFILMENT`, existing), staff create/activate/deactivate (`MANAGE_VENDOR_STAFF`), cover/logo (`MANAGE_VENDORS` + media purpose rule). Deactivating a vendor with open orders is blocked with the list of blocking orders.
**Endpoints.** VND-01…09 vendors (REUSE; EXTEND `logoMediaAssetId`), VND-10 commission (REUSE, UI new), VND-11 auto-accept (REUSE), VND-12 branches list (NEW), VND-13 branch detail (NEW composition), VND-14 branch profile/hours/cover patch (EXTEND/NEW — verified at start of WS-7), VND-15 performance (NEW), VND-16…19 staff (REUSE; EXTEND list with filters), VND-20 onboarding checklist (NEW derived), VND-21 commission history (NEW derived).
**Data.** `vendors, vendor_branches` (+ `cover_media_asset_id`, `logo_media_asset_id`), staff users. No new table for checklist (derived).
**Performance metrics (vendor/branch, range-based, backend-computed):** orders received/accepted/rejected/cancelled, acceptance rate, rejection rate by reason, avg acceptance time, avg preparation time, gross sales, commission recognized, rating (existing counters), top products.
**Validation.** Commission 0–100 with 2 decimals; hours open<close or overnight flag; at least one zone to be activatable; sector set before activation; branch phone E.164.
**States.** Onboarding checklist items show reason when blocked; hours editor validates overlaps inline.
**List behaviour.** Search name/phone; filter active, open/closed, sector, zone, commission range, auto-accept; sort name/orders/created.
**Reports.** Vendor performance (RPT-S05), vendor sales, branch SLA.
**Responsive.** Branch tabs become an accordion on phone; hours editor stacked by day.
**Tests.** U: checklist derivation, commission-prospective rule; I: deactivation guard with open orders; E: permission matrix, vendor-role isolation unchanged; PW: onboarding flow, commission change with audit visible; X.
**Dependencies.** WS-3 (images), WS-2, WS-4/5 (performance & commission figures), WS-7.
**Acceptance.** M04-01…M04-11.

---
### 5.5 Module 5 — Product & Inventory (prefix CAT)
**Purpose.** Manage the catalogue across all vendors from one place: products, additional images, option groups, categories, master catalog and vendor listings, stock and bulk operations — with imagery handled only through the Media platform.

**Pages.** PG-CAT-1 *Products* (cross-vendor list; saved views) · PG-CAT-2 *Product editor* (Details · Pricing & options · Images · Inventory · Availability · History) · PG-CAT-3 *Master catalog* (catalog products + vendor listings) · PG-CAT-4 *Categories* (vendor menu categories) · PG-CAT-5 *Inventory board* (low-stock, out-of-stock, unlimited) · PG-CAT-6 *Bulk import/export* (existing Excel flow, migrated; shows validation report before apply).

**Journeys.** Admin searches "milk" across vendors → bulk-selects 30 → "Set inactive" with reason → per-item result. Admin opens a product → uploads primary image + 3 additional images (drag/drop, reorder) → saves. Admin creates a master catalog product → lists it for 5 vendors (existing listing endpoints). Admin opens the inventory board → filters low stock (≤ threshold) → sets quantity or zero. Import: download template → upload xlsx → validation report (errors by row) → apply (idempotent; re-apply does not duplicate).

**Actions.** Product create/edit/activate/deactivate/set-inventory-zero (`MANAGE_CATALOG`); images (primary + additional) with the media purpose rules; bulk activate/deactivate/price-change-by-percent/set-stock (`MANAGE_CATALOG`, cap 50, confirmation, per-item audit — **price change by percent shows the old/new price preview per item before confirm**); catalog-product CRUD + listings (`MANAGE_CATALOG`); category CRUD; import/apply (`MANAGE_CATALOG`); export (`CATALOG_EXPORT`).
**Endpoints.** CAT-01 list (EXTEND), CAT-02…07 (REUSE), CAT-08…10 import (REUSE), CAT-11 product media (NEW), CAT-12 bulk (NEW), CAT-13 inventory board (NEW), CAT-14 inventory settings (platform setting + optional per-product `lowStockThreshold`), CAT-15…22 catalog-products + listings (REUSE, UI new), CAT-23…28 categories (REUSE).
**Data.** `products` (+ `media_asset_id`, `low_stock_threshold` nullable), new `product_media (id, product_id, media_asset_id, sort_order, is_primary)` with a partial unique index (one primary per product) and `(product_id, sort_order)` unique; `catalog_products` (+ `media_asset_id`). Option groups/values: **no image** (D-14). The Customer API's product responses gain additive `images[]` (`{url, thumbnailUrl}`), primary first; `imageUrl` is unchanged and equals the primary's display URL.
**Validation.** Price ≥ 0 minor units; stock integer ≥ 0; at most 8 images per product (setting `PRODUCT_MAX_IMAGES`, default 8); option group rules as existing; bulk percent change within ±90% and result price ≥ 0; unique SKU/name rules as existing.
**States.** Editor shows per-image upload progress and failure/retry; unsaved-change guard; the inventory board shows "No low-stock items" success state; import validation report is a table with downloadable error file.
**List behaviour.** Search name (AR/EN)/SKU/vendor; filter vendor, branch, category, sector, active, stock state (in/low/out/unlimited), has-image, has-offer, price range; sort name/price/stock/updated/orders; keyset pagination (≥ 50k products possible).
**Reports/exports.** Products & inventory report (RPT-S07), low-stock report, price list export (round-trips with the import format: the export file is a valid import file).
**AR/EN/RTL.** Name/description AR+EN side-by-side; numeric inputs LTR.
**Responsive.** Phone: list cards with quick toggles (active, stock), editor single column, image reorder via explicit move buttons (no drag required); tablet+: drag reorder.
**Tests.** U: bulk percent rounding, threshold logic, primary-image invariant; I: `product_media` constraints, concurrent stock decrement unchanged (regression of e2e 50), import idempotency; E: permission matrix, vendor isolation, compatibility of old `imageUrl`; PW: upload multiple images, reorder, bulk deactivate, import; X.
**Dependencies.** WS-3 (Media), WS-2, WS-4 (export), WS-7.
**Acceptance.** M05-01…M05-13.

---

### 5.6 Module 6 — Delivery & Fleet (prefix FLT)
**Purpose.** Operate the fleet: dispatch board, driver management with earnings and performance, vehicle types, cash remainders, delivery performance.

**Pages.** PG-FLT-1 *Dispatch board* (`/dispatch`, replaces the 23-line redirect: dispatchable orders, active deliveries, alerts, assign/reassign) · PG-FLT-2 *Drivers* (list) · PG-FLT-3 *Driver detail* (Profile · Deliveries · Earnings · Performance · Commission · Cash remainders · Activity) · PG-FLT-4 *Vehicle types* · PG-FLT-5 *Cash remainders* · PG-FLT-6 *Delivery performance*.
**Journeys.** Ops sees an unassigned order with alert → *Assign* → driver picker ranked by availability/last location age/active load (read-only facts; ranking is explicit, not hidden magic) → assign. Driver verification: review → verify/unverify with reason. Finance reviews a driver's earnings for a period and sees reconciliation with the settlement period.
**Actions.** Assign/reassign (`ASSIGN_REASSIGN_ORDERS`; override flows `OVERRIDE_DISPATCH`), create/verify driver and set vehicle type (`MANAGE_DRIVERS`), change commission (`MANAGE_DRIVER_COMMISSION`, reason, prospective), change online status (`CHANGE_DRIVER_ONLINE_STATUS`; existing permission — endpoint presence verified in WS-8; if absent it is added), cash remainder approve/reject (`MANAGE_CUSTOMER_WALLET`, existing), vehicle types CRUD (`MANAGE_VEHICLE_TYPES`).
**Endpoints.** FLT-01…03 dispatch (REUSE), FLT-04 list (EXTEND), FLT-05 create (REUSE), FLT-06 verification (REUSE), FLT-07 vehicle type (REUSE), FLT-08 vehicle-type list (REUSE), FLT-09 driver detail (NEW), FLT-10 driver deliveries (NEW), FLT-11 earnings (NEW), FLT-12 performance (NEW), FLT-13 commission (REUSE), FLT-14 online-status (verify/NEW), FLT-15…17 vehicle types admin (REUSE), FLT-18…21 cash remainders (REUSE), FLT-22 live fleet (NEW), FLT-23 delivery performance (NEW).
**Data.** `drivers, deliveries, dispatch_alerts, dispatch_attempts, driver_cash_remainders, vehicle_types`. No new tables. Driver *documents* are not modelled today and are **not added** (no evidenced requirement); verification stays a flag with reason/audit.
**Driver performance metrics (backend):** deliveries completed/failed, acceptance rate (offers accepted ÷ attempted), unanswered-attempt streaks, on-time %, avg delivery time, cash remainders, rating (counter), earnings by period. **Earnings** = driver commission recognized + reimbursements per §8.2 (never inferred in UI).
**Validation.** Cannot assign to an offline/unverified driver without `OVERRIDE_DISPATCH` and reason; reassign requires reason; commission 0–100.
**States.** Live fleet view: map disabled (`MAPS_PROVIDER=none` shows DISABLED) → table of drivers with last-seen age; stale (> 2 min) locations marked "stale" with grey dot; polling per §4.
**List behaviour.** Drivers: search name/phone; filter verified, online, vehicle type, zone, busy; sort name/last-seen/deliveries. Dispatchable: filter zone/age/payment, sort age.
**Reports.** Driver performance (RPT-S08), delivery SLA (RPT-S14), driver earnings/settlement statement (RPT-S11), cash remainders.
**Responsive.** Dispatch board on tablet landscape and desktop is the primary surface; phone supports assign/reassign via cards.
**Tests.** U: ranking function, eligibility rules; I: assign vs concurrent cancel (PD-014 regression), reassign reason; E: permission matrix incl. `OVERRIDE_DISPATCH`; PW: assign flow, driver verification, commission change; X.
**Dependencies.** WS-2, WS-5 (earnings), WS-8, WS-P (live endpoints budgeted).
**Acceptance.** M06-01…M06-11.

---

### 5.7 Module 7 — Customer Management (prefix CUS)
**Purpose.** A customer 360 for support and operations: identity, orders, wallet, loyalty, addresses, ratings, notes, coupons; safe block/unblock; audited wallet adjustments; review moderation; deletion requests.

**Pages.** PG-CUS-1 *Directory* · PG-CUS-2 *Customer detail* (Overview · Orders · Wallet · Loyalty · Addresses · Ratings · Coupons · Notes · Activity) · PG-CUS-3 *Wallet adjustments* (pending approvals) · PG-CUS-4 *Reviews* (moderation queue) · PG-CUS-5 *Deletion requests* (existing).
**Journeys.** Support finds a customer by phone → sees masked phone → clicks *Reveal* (audited, `VIEW_CUSTOMER_PII`) → reviews orders and wallet ledger. Support credits EGP 50 goodwill: *Adjust wallet* → amount, direction, reason code, note → if above threshold → pending approval by a second admin (`WALLET_ADJUST_APPROVE`, different user) → ledger row `ADJUSTMENT` appears. Block abusive customer: *Block* with reason → `is_active=false`, sessions revoked → login refused with the standard message; *Unblock* reverses. Moderator hides a rating → counters recomputed.
**Actions.** Block/unblock + notes (`MANAGE_CUSTOMERS`), wallet adjustment request (`MANAGE_CUSTOMER_WALLET`), approve/reject (`WALLET_ADJUST_APPROVE`, creator ≠ approver), hide/unhide rating (`MODERATE_REVIEWS`), reveal PII (`VIEW_CUSTOMER_PII`, each reveal audited with field and entity), export (`CUSTOMERS_EXPORT`, masked unless PII permission), process deletion requests (existing).
**Endpoints.** CUS-01 list (EXTEND), CUS-02 detail (EXTEND), CUS-03 orders (NEW), CUS-04 wallet ledger (NEW), CUS-05 loyalty (NEW), CUS-06 addresses (NEW), CUS-07 ratings (NEW), CUS-08/09 notes (NEW), CUS-10/11 block/unblock (NEW), CUS-12 wallet adjustment (NEW), CUS-13 pending adjustments (NEW), CUS-14 approve/reject (NEW), CUS-15 ratings moderation list (NEW), CUS-16/17 hide/unhide (NEW), CUS-18 deletion requests (REUSE), CUS-19 reveal PII (NEW), CUS-20 customer coupons/consumptions (NEW).
**Data.** `users, customers (profile), wallet_transactions, loyalty_transactions, addresses, ratings, offer_consumptions` + new `customer_notes (id, customer_user_id, author_user_id, body, created_at)`, `wallet_adjustments (id, customer_user_id, amount_minor (signed), reason_code, note, status PENDING|APPROVED|REJECTED|APPLIED, requested_by, decided_by, decided_at, wallet_transaction_id, idempotency_key)`, `rating_moderation (rating_id, hidden, reason, by, at)` or `ratings.hidden_at/hidden_by/hidden_reason` (decided in the API plan §Entities).
**Validation.** Adjustment amount ≠ 0, |amount| ≤ `WALLET_ADJUSTMENT_MAX_MINOR` (setting, default 100000), reason code enum + note ≤ 300; a debit cannot take the wallet below zero; approver ≠ requester; threshold `WALLET_ADJUSTMENT_APPROVAL_THRESHOLD_MINOR` (setting, default 5000) above which approval is required, otherwise applied immediately by a user with both permissions; block requires reason; cannot block a user with the SUPER_ADMIN/staff role.
**Money rule.** Wallet adjustment is a ledger `ADJUSTMENT` row created through the existing wallet service with the adjustment id as idempotency key; **no balance field is edited directly**. Hatly-funded vs not: an adjustment is a goodwill cost, reported under "Customer wallet adjustments" in Finance (§8.5), not in sales.
**States.** Masked fields display `••••• 1234`; reveal replaces inline for 60 s then re-masks; empty ledger "No wallet activity".
**List behaviour.** Search phone/name/email/order number; filter active/blocked, has orders, last order date range, wallet balance range (finance permission), city/zone, registered date; sort last order/registered/orders count/lifetime value.
**Reports.** Customer report (RPT-S06: acquisition, orders, repeat rate, lifetime value), wallet liability, loyalty, ratings.
**Responsive.** 360 tabs become accordion on phone; wallet ledger as cards.
**Tests.** U: approval rule, masking function, counters recompute; I: adjustment idempotency/double-approve race, block + session revocation, rating hide recompute; E: permission matrix, masked vs unmasked payloads, audit of reveal; PW: block flow, adjustment two-person flow (two sessions), reveal; X.
**Dependencies.** WS-1 (permissions, masking, idempotency), WS-2, WS-5 (ledger rules), WS-9.
**Acceptance.** M07-01…M07-12.

---

### 5.8 Module 8 — Finance & Accounting (prefix FIN)
**Purpose.** Make the ledger visible and trustworthy: a financial-events explorer, revenue and commission summaries, Hatly-funded discount net, liabilities, loans and reconciliation — all computed by the backend with the definitions of §8.

**Pages.** PG-FIN-1 *Ledger explorer* · PG-FIN-2 *Revenue & commissions* · PG-FIN-3 *Hatly-funded discounts* · PG-FIN-4 *Liabilities* (wallet balances, loyalty liability, refunds to send, unpaid settlements, driver cash) · PG-FIN-5 *Reconciliation* · PG-FIN-6 *Employee loans* (existing, migrated + list) · PG-FIN-7 *Financial event detail* (drawer with linked events: original ↔ compensation).
**Journeys.** Finance filters ledger by type + date + vendor → sees totals → drills to an event → sees linked compensation (e.g. `HATLY_FUNDED_OFFER_DISCOUNT_RECORDED` ↔ `_RESTORED`) and the order → exports the filtered ledger (`FINANCE_EXPORT`). Reconciliation: pick a date range → three-way comparison **payments received ↔ ledger ↔ settlements** → each difference listed with its explanation or flagged "unexplained"; unexplained difference must be zero on the acceptance dataset.
**Actions.** Read-only for ledger/summaries (`VIEW_FINANCIALS`), export (`FINANCE_EXPORT`), employee-loan create/repay (`MANAGE_EMPLOYEE_LOANS`, existing). **No Dashboard action edits or deletes a financial event** (append-only; D-24).
**Endpoints.** FIN-01 ledger (NEW keyset), FIN-02 ledger summary (NEW), FIN-03 revenue (NEW), FIN-04 commissions (NEW), FIN-05 reconciliation (NEW), FIN-06 Hatly-funded discounts (NEW), FIN-07…10 loans (REUSE), FIN-11 loans list (NEW), FIN-12 liabilities (NEW), FIN-13 event detail (NEW).
**Data.** `financial_events` (+ indexes `(created_at)`, `(type, created_at)`, `(vendor_branch_id, created_at)`), `payments, refund_payouts, settlement periods, wallet_transactions`. No new table for reads.
**Definitions** — see §8 (authoritative).
**Validation.** Range ≤ 366 days for summaries; ledger requires at least a date range or an order id (prevents unbounded scans); type filter from the enum.
**States.** Summary cards always show *definition* link; "no data" if the period has no events; reconciliation shows a green "Balanced" state only when every delta is explained.
**List behaviour.** Ledger: filter type (multi), date, order id/number, vendor, branch, driver, amount range, funding (Hatly/vendor); sort date/amount; keyset.
**Reports.** Ledger export, revenue & commission, Hatly-funded discounts, liabilities, reconciliation, employee loans (RPT-S09, S10, S12, S13, S18, S22).
**AR/EN/RTL.** Event type names localized via enum map; amounts LTR with currency.
**Responsive.** Tables as cards on phone with type/amount/time as primary fields.
**Tests.** U: each formula in §8 with fixtures incl. cancelled/partial/restored/refund-sent; I: summary vs independent SQL on a generated dataset (property-style); E: permission matrix, money absent without `VIEW_FINANCIALS`; PW: drill-through, export; X.
**Dependencies.** WS-1 (indexes, clock), WS-4, WS-5.
**Acceptance.** M08-01…M08-11.

---
### 5.9 Module 9 — Payments, Refunds & Settlements (prefix PAY)
**Purpose.** One place for money movement states: manual-transfer verification, all payments, refunds (**recorded vs sent**), settlement periods (**closed vs paid**), statements, and recorded payouts/collections — without ever treating a status as proof of cash.

**Pages.** PG-PAY-1 *Manual transfers* (existing; verification queue) · PG-PAY-2 *Payments* (all methods) · PG-PAY-3 *Refunds* (tabs: To send · Sent · All; existing "Refunds to send" generalized) · PG-PAY-4 *Settlements* (vendor periods / driver periods; tabs Open · Closed-unpaid · Partially paid · Paid) · PG-PAY-5 *Settlement statement* (period detail: every contributing order/event, totals, payments, status, export/PDF) · PG-PAY-6 *Close settlement* (existing buttons → a guided dialog showing the proposed period and totals *before* closing).

**Journeys.** (1) Finance approves/rejects a manual transfer (existing) → order proceeds. (2) Finance opens *Refunds to send*, sends money outside the system, then *Mark sent* (reference + date) → status Sent; a recorded refund never shows "sent" before this. (3) Finance closes a vendor period: dialog previews period dates (contiguous with the previous), gross sales, commission, payable → confirm → period CLOSED (immutable). (4) Finance records a payout of EGP 4,000 against the closed period → status PARTIAL; later 1,000 → PAID. A mistaken payment entry is **voided by a reversing record**, never deleted. (5) Statement exported as PDF (gate S-PDF) or XLSX.

**Actions & permissions.** Verify/reject/refund manual transfer (`VERIFY_MANUAL_PAYMENTS`, existing); mark refund sent (`VERIFY_MANUAL_PAYMENTS`, existing); close vendor/driver period (`CLOSE_VENDOR_SETTLEMENTS`/`CLOSE_DRIVER_SETTLEMENTS`, existing); view vendor periods (`VIEW_VENDOR_FINANCIAL_REPORTS`, **now used**), driver periods (`VIEW_DRIVER_SETTLEMENTS`, **now used**); record/void settlement payment (`MANAGE_SETTLEMENT_PAYMENTS`, new; second approver above `SETTLEMENT_PAYMENT_APPROVAL_THRESHOLD_MINOR`, setting, default off = 0 meaning no approval) ; export (`FINANCE_EXPORT`).
**Endpoints.** PAY-01…06 (REUSE; EXTEND filters/pagination), PAY-07/08 payments list/detail (NEW), PAY-09 refunds ledger (NEW), PAY-10…13 period lists/details (NEW), PAY-14/15 close (REUSE), PAY-16 record payment (NEW), PAY-17 list payments (NEW), PAY-18 void payment (NEW), PAY-19 statement document job (NEW), PAY-20 outstanding summary (NEW).
**Data.** Existing `payments, refund_payouts, financial_events, vendor_settlement_periods, driver_settlement_periods`; new `settlement_payments` (D-25) `(id, party_type VENDOR|DRIVER, period_id, direction PAYOUT|COLLECTION, amount_minor >0, method, reference, paid_at (date, Cairo), recorded_by, status RECORDED|VOIDED, voided_by, voided_at, void_reason, idempotency_key unique, created_at)`; additive columns `vendor_settlement_periods.net_payable_minor` (D-26) and `payment_status` derived (not stored; computed) — a stored cached `paid_minor`/`derived_status` maintained transactionally is **not** used to avoid drift. Derived status: `UNPAID` (Σ active payments = 0), `PARTIAL` (0 < Σ < payable), `PAID` (Σ = payable), `OVERPAID` (Σ > payable; blocks further payments, requires void/adjustment). For driver periods the payable is `net_payable_minor` (which can be negative = driver owes Hatly → direction COLLECTION).
**Validation.** Payment only against a CLOSED period; amount > 0; amount ≤ remaining unless explicitly allowed overpay flag with reason (default not allowed); `paid_at` not in the future; reference ≤ 120; void requires reason and is allowed once.
**Money rules.** §8.3, §8.4. Closing a period never changes order data; statements read stored period totals and the same event set used to compute them (reconciled by test); the statement lists any event in the period range not included in the stored total as an **exception** (should be none).
**States.** Statement skeleton; PDF generation shows job progress; "Provisional accounting policy" banner while U-01 is unconfirmed (D-26).
**List behaviour.** Payments: filter method/status/date/order/customer; Refunds: status (recorded/sent), method, age, order; Settlements: party, status, date range, amount; sort age/amount/date; keyset for payments/refunds, offset for periods.
**Reports.** RPT-S15 (vendor statements), S11 (driver), S16 (payments & refunds), S13 (liabilities incl. unpaid settlements), S18 (reconciliation).
**Responsive.** Statement is read-first on phone (summary + expandable lines); recording a payment possible on phone.
**Tests.** U: derived status matrix (partial, exact, over, void), refund recorded≠sent; I: concurrent payment recording (idempotency + sum check), void exactly-once, closed-period immutability, statement totals vs events; E: permission matrix, previously-unused permissions now enforced; PW: close → pay partial → pay rest → statement export; refund mark-sent; X.
**Dependencies.** WS-1, WS-4 (statement export), WS-5, WS-2.
**Acceptance.** M09-01…M09-14.

---

### 5.10 Module 10 — Marketing & Growth (prefix MKG)
**Purpose.** Show real growth and loyalty data and let Marketing communicate with customers through an approved, auditable broadcast and in-app inbox — without fabricated metrics.

**Pages.** PG-MKG-1 *Growth overview* (new customers, repeat rate, order frequency, coupon-driven orders, loyalty issuance/redemption/expiry, notification delivery stats) · PG-MKG-2 *Retention* (cohorts by first-order month) · PG-MKG-3 *Loyalty* (liability, config shortcut → Platform Configuration keys, ledger) · PG-MKG-4 *Broadcasts* (list/detail/compose) · PG-MKG-5 *Audiences* (saved segments).
**Journeys.** Marketing builds an audience (rules: last order within N days / no order for N days / wallet balance range (finance perm) / zone / registered between / has used coupon X) → sees a live **count preview** (≥ 20 hides exact counts below 20 to avoid re-identification: displays "< 20") → composes AR+EN title/body → chooses channel (push + in-app inbox; SMS unavailable unless U-03) → submits for approval → approver (different user, `BROADCAST_APPROVE`) reviews preview (rendered in both languages) → approves → schedule or send now → progress card (queued, sent, failed, opened if the app reports opens) → completes.
**Actions.** Create/edit draft, submit, cancel (`MANAGE_BROADCASTS`); approve/reject (`BROADCAST_APPROVE`, creator ≠ approver, reason on reject); send test to self (`MANAGE_BROADCASTS`, to the admin's own device only); audience CRUD (`MANAGE_BROADCASTS`); read analytics (`MARKETING_VIEW`).
**Endpoints.** MKG-01 growth overview (NEW), MKG-02 retention (NEW), MKG-03 loyalty overview (NEW), MKG-04 loyalty config (REUSE business-config), MKG-05…13 broadcasts (NEW: create, list, get, patch, submit, approve, reject, cancel, send-test), MKG-14 recipients (NEW), MKG-15 stats (NEW), MKG-16…18 audiences (NEW: create/list/preview count), customer-side MKG-20 inbox list, MKG-21 unread count, MKG-22 mark read, MKG-23 read-all (NEW, Customer API).
**Data.** New `audiences`, `notification_broadcasts`, `broadcast_recipients`, `customer_inbox_messages`; push uses the existing Firebase provider and device tokens; existing order notifications untouched. See API plan §Entities.
**Rules.** Quiet hours (setting `BROADCAST_QUIET_HOURS` default 22:00–08:00 Cairo): scheduling inside quiet hours requires an explicit override flag + reason; per-customer frequency cap (`BROADCAST_MAX_PER_CUSTOMER_PER_DAY`, default 1) enforced at expansion; unsubscribed/notification-disabled customers excluded (device token absent or preference off — preference model verified in WS-9; if no preference field exists, only the OS-level push permission applies and in-app inbox is still delivered); idempotent send (recipient unique per broadcast).
**Validation.** Title ≤ 60, body ≤ 240 (AR and EN both required), deep link must be in the app's supported set (order, vendor, sector, offer, product, inbox), audience non-empty at approval time.
**States.** Draft autosave; approval pending badge; sending progress with cancel; failure list with retry-failed.
**List behaviour.** Broadcasts: filter status/date/creator; sort created/scheduled; offset pagination. Recipients: filter status; keyset.
**Reports.** Campaign/broadcast performance (RPT-S19), growth (RPT-S06 sections).
**Responsive.** Compose requires tablet+ (phone: review & approve only).
**Tests.** U: audience rule compiler, frequency cap, quiet hours; I: recipient expansion idempotency, send restart safety (kill worker mid-batch → no duplicates), approval four-eyes; E: permission matrix, customer inbox isolation (customer A cannot read B's messages), app endpoint contract; Flutter: inbox screen + unread badge; PW: compose→approve→send (stub provider); X.
**Dependencies.** WS-1 (jobs, idempotency), WS-9, Customer app inbox (additive), WS-2.
**Acceptance.** M10-01…M10-09.

---

### 5.11 Module 11 — Coupons, Promotions & Campaigns (prefix CPN)
**Purpose.** (D-40) Full lifecycle for discounts: create/edit/clone/schedule offers and coupons, targeted coupon grants, performance and budget visibility equal to consumption rows (including reversals), and campaigns that bundle offers, banners and messaging under an approval workflow.

**Pages.** PG-CPN-1 *Offers & coupons* (list; existing page evolved) · PG-CPN-2 *Offer editor* · PG-CPN-3 *Offer performance* (redemptions, restored, budget used/remaining, per-customer distribution, Hatly-funded net) · PG-CPN-4 *Coupon grants* · PG-CPN-5 *Campaigns* (list) · PG-CPN-6 *Campaign builder/detail* (Overview · Offers · Banners · Audience · Messages · Schedule · Approval · Performance · Timeline).
**Journeys.** Create a percentage subtotal offer with coupon code, budget, usage limit, per-customer limit, dates → preview → activate. Edit rules of a live offer (restricted, below). Clone last month's offer. Grant a coupon to an audience/specific customers. Campaign: draft → add offers (existing or new) and banners (Home banner, image via media picker) → audience (§5.10) → messages (broadcast) → schedule → submit → approval (four-eyes) → SCHEDULED → RUNNING (offers/banners activate at start; messages sent) → COMPLETED (everything deactivates at end) → performance.
**Edit rules for live offers (consistency with existing constraints).** Allowed while active: extend `endsAt`, raise usage limit/budget, rename, change description. **Not allowed while consumptions exist:** change discount type/value, funding source, coupon code, applicability scope (vendor/branch/product). To change those: *Clone* → new offer (old deactivated). This preserves PD-014/015 restoration arithmetic.
**Actions.** Offer create/edit/activate/deactivate/clone/grant (`MANAGE_OFFERS`); campaign draft/edit/submit/cancel (`MANAGE_CAMPAIGNS`); approve/reject (`CAMPAIGN_APPROVE`; creator ≠ approver); view performance (`MARKETING_VIEW` or `MANAGE_OFFERS`); export (`MARKETING_EXPORT`).
**Endpoints.** CPN-01…07 offers (REUSE create/get/list/activate/deactivate; NEW edit, clone), CPN-08 performance (NEW), CPN-09 consumptions (NEW keyset), CPN-10/11 grants (NEW), CPN-12…22 campaigns (NEW: create, list, get, patch, submit, approve, reject, schedule, cancel, performance, timeline).
**Data.** Existing `offers` (fields incl. coupon_code, limits, budget, consumed counters), `offer_consumptions` (incl. `is_reversed`). New: `coupon_grants (id, offer_id, customer_user_id, granted_by, granted_at, expires_at, redeemed_at nullable)`; additive `offers.audience_id` nullable, `offers.created_by`; `campaigns (id, name_en, name_ar, status, starts_at, ends_at, audience_id, created_by, approved_by, approved_at, rejection_reason, version)`, `campaign_items (campaign_id, item_type OFFER|BANNER|BROADCAST, item_id, sort_order)`. Lifecycle D-41.
**Validation.** Coupon code unique, case-insensitive, 4–20 chars A–Z0–9; dates `endsAt > startsAt`; budget ≥ 0; percent 1–100; fixed ≤ configured cap; campaign window must contain its offers' windows or the builder shifts them explicitly (shown in a diff); overlapping offers of the same type on the same scope warn (not block).
**Money rules.** Offer performance numbers equal sums of `offer_consumptions` (consumed − reversed); Hatly-funded net = recorded − restored (§8.6); no ROI is displayed unless inputs are all real (revenue attributable = orders that used the offer, gross sales basis; shown with its definition).
**States.** Campaign timeline shows each transition with actor/time; RUNNING campaigns show live consumption counters (polling 30 s); FAILED state lists failed items with retry-per-item.
**List behaviour.** Offers: filter status/type/funding/date/has-coupon, search name/code; sort created/ends/consumption; Campaigns: filter status/date/creator.
**Reports.** RPT-S17 (offers), RPT-S19 (campaigns), S12 (Hatly-funded).
**Responsive.** Builder tablet+; approval and performance phone-friendly.
**Tests.** U: edit-rule matrix, code validator, lifecycle transitions; I: scheduled start/stop job exactly-once, grants redemption, budget cap under concurrency (regression of e2e 114/115); E: permission matrix, creator≠approver; PW: offer lifecycle, campaign approval with two users; X.
**Dependencies.** WS-3 (banner images), WS-9, WS-1 (jobs), MKG (audiences/broadcasts).
**Acceptance.** M11-01…M11-12.

---

### 5.12 Module 12 — Reports & Analytics (prefix RPT)
**Purpose.** A governed reporting and export platform: reports defined once in the backend, runnable in the Dashboard with filters/totals, exportable as CSV/XLSX/PDF through background jobs with secure, expiring, audited downloads.

**Pages.** PG-RPT-1 *Report catalogue* (grouped by family, permission-filtered, search) · PG-RPT-2 *Report runner* (parameters, preview table with totals footer, chart toggle where defined, export menu) · PG-RPT-3 *Exports* (my exports / all exports for authorised users: status, progress, size, expiry, download, cancel, re-run) · PG-RPT-4 *Saved reports* (named parameter sets, shareable within permission) · PG-RPT-5 *Schedules* (recurring exports delivered **in-app**; email delivery is out of scope because no email channel exists) · PG-RPT-6 *Analytics dashboards* (per domain: Sales, Operations, Finance, Fleet, Catalog, Marketing — built from report definitions only).

Full platform specification: §7. Endpoints: RPT-01…17. Data: `report_exports`, `saved_reports`, `report_schedules`, `background_jobs`, export file storage via the existing provider (private, signed). Permissions: §7.3. Audit: request, completion, download, expiry, cancel (explicit events, §9.4).
**States.** Runner: parameter validation inline; large-result warning ("about 240,000 rows — export as CSV"); preview limited to 200 rows with total row count; export job card with progress %, rows written, cancel; expired file state with *Re-run*.
**List behaviour.** Exports: filter status/report/requester/date; sort created; keyset.
**Responsive.** Catalogue and exports phone-friendly; runner preview as cards; parameter pickers in bottom sheet.
**Tests.** U: parameter schemas, formatters (money/date/enums), CSV escaping (formula-injection guard), XLSX writer; I: each report vs independent SQL on the generated dataset (reconciliation test), job lifecycle (crash recovery, cancel, expiry), download authorization at request *and* download; E: permission matrix per report family, masked columns without PII permission, expired/other-user download denied; PW: run → export XLSX → download; cancel; saved report; X.
**Dependencies.** WS-1 (jobs, indexes, clock), WS-2, WS-4, per-family WS (data semantics).
**Acceptance.** M12-01…M12-14.

---
### 5.13 Module 13 — Media Management (prefix MED)
**Purpose.** The only way images enter the platform from the Admin: direct upload with processing, a library with usage tracking, reuse across entities, safe replace/delete. Platform specification in §6.

**Pages.** PG-MED-1 *Library* (grid/list, search, filters, bulk select) · PG-MED-2 *Asset detail* (preview of variants, metadata, alt text AR/EN, usage list, history) · PG-MED-3 *Cleanup* (unreferenced assets, soft-deleted assets awaiting purge, storage totals) · embedded **MediaPicker** (§6.6) in every image field.
**Actions.** Upload (single/multi), crop on upload or re-crop, edit metadata, replace-everywhere (with usage confirmation), soft delete (blocked while referenced), restore (within retention), purge preview/run, backfill legacy images (SUPER_ADMIN). Permissions: `MEDIA_VIEW`, `MANAGE_MEDIA`, `MEDIA_DELETE`, plus the purpose-owning permission for entity assignment (§6.5).
**Endpoints.** MED-01…14. **Data.** `media_assets`, `media_variants`, `product_media`, `*_media_asset_id` FKs (§6.8, API plan §Entities).
**States/lists/tests/dependencies/acceptance.** Defined in §6 (tests §6.12) and Acceptance M13-01…M13-16.

---

### 5.14 Module 14 — Admin Users, RBAC & Audit (prefix IAM)
**Purpose.** Control who can do what, prove who did what, and reset access safely.

**Pages.** PG-IAM-1 *Admin users* (list, create, activate/deactivate) · PG-IAM-2 *User detail* (Profile · Permissions (grouped catalogue with checkboxes, search, "what this unlocks" help) · Templates applied · Sessions · MFA · Activity) · PG-IAM-3 *Permission templates* · PG-IAM-4 *Audit log* (filters, entity history link, export) · PG-IAM-5 *Security* (own MFA enrolment, existing) · PG-IAM-6 *Sessions* (active sessions, revoke).
**Journeys.** SUPER_ADMIN creates an admin → applies the "Finance" template (copy) → adds one extra permission → user logs in, enrolment forced → navigation shows only permitted modules. Support lead loses laptop: SUPER_ADMIN *Resets MFA* (reason, typed confirmation, audited; user must re-enrol at next login; their refresh tokens revoked) . Auditor opens an order → *History* → sees every admin action for that entity. Auditor exports audit for a date range (`AUDIT_EXPORT`, itself audited).
**Rules.** Only SUPER_ADMIN manages users, grants, templates, MFA resets (role guard unchanged). A SUPER_ADMIN cannot deactivate or demote themselves or the last active SUPER_ADMIN. Grants/revokes audited with before/after sets. Permission catalogue is the single source (§9.2) and also drives navigation, templates and the e2e route-inventory test.
**Endpoints.** IAM-01…21. **Data.** `users`, `user_permissions`, new `permission_templates (id, key, name_en, name_ar, is_system, permissions text[], created_by, updated_at)`, audit table `admin_audit_logs` (+ indexes), session/refresh-token table (existing, read-only list). **Details:** §9.
**Validation.** Template permission set ⊆ catalogue; cannot grant a permission whose feature flag is off (warning only); password policy as existing; MFA reset reason ≥ 10 chars.
**States.** Permission editor shows a diff (added/removed) before save; the audit log shows skeletons and keyset paging; empty history "No recorded admin actions for this item".
**List behaviour.** Users: filter role/active/MFA enrolled/template; search name/email. Audit: filter actor, action, target type/id, date, outcome, route; sort date; keyset.
**Reports.** Audit export (RPT-S21); permission matrix report (who has what; XLSX) — a report definition `RPT-S25` *Permission matrix* (SUPER_ADMIN).
**Responsive.** Permission editor on phone becomes grouped accordion; audit rows as cards.
**Tests.** U: template apply = set copy; last-super-admin guard; I: grant/revoke audit before/after; revocation takes effect on next request (cache TTL ≤ 30 s documented and tested); E: route inventory (99) extended; template routes SUPER_ADMIN only; MFA reset flow; PW: create user → template → login → nav filtered; reset MFA; audit history; X.
**Dependencies.** WS-1, WS-2, WS-10.
**Acceptance.** M14-01…M14-13.

---

### 5.15 Module 15 — System Monitoring & Integration Health (prefix SYS)
**Purpose.** Show the real health of the platform from real telemetry: dependencies, jobs, request behaviour, cache, database, client performance — and raise alerts when thresholds are crossed. No fabricated or demo values (D-44).

**Pages.** PG-SYS-1 *Overview* (status tiles: API, Database, Redis, Storage, SMS, Maps, Push (FCM), Jobs, Exports, Cache) · PG-SYS-2 *Integrations* (per integration: configured?, last check time, result, latency, last error, **Run check now**) · PG-SYS-3 *Requests & errors* (rate, error rate, latency P50/P95/P99 by route group, top error codes; no payloads/PII) · PG-SYS-4 *Jobs* (queue depth, oldest queued, failures, retry/cancel) · PG-SYS-5 *Database & cache* (pool usage, slow-query counter, migrations status, Redis status, circuit state, cache hit ratios per domain) · PG-SYS-6 *Client performance* (Customer/Vendor/Driver/Dashboard telemetry: startup, TTFMC, API latency, image failures — aggregated, with app version/platform splits).
**Telemetry (D-43, D-70).** In-memory per-instance aggregation flushed every 60 s to `system_metric_buckets (bucket_start, instance_id, metric_key, dims jsonb, count, sum, min, max, histogram jsonb)`, retention 14 days at 1-min resolution then rolled up hourly (retained 90 days) by `METRIC_ROLLUP`. Request metrics via a Nest interceptor (route *pattern*, never raw URL with ids; status class; duration histogram buckets [25,50,100,200,400,800,1600,3200 ms]). `integration_checks (id, key, status OK|DEGRADED|DOWN|DISABLED, latency_ms, detail, checked_at)` written by `INTEGRATION_PROBE` (every 60 s per configured integration; probes are **read-only/no-cost**: DB `SELECT 1`, Redis `PING`, storage `HEAD`/list-prefix on a sentinel key with write+delete only in the on-demand "deep check", FCM config validation without sending, SMS provider *configuration* check without sending (no paid message is sent by a probe), Maps provider mode).
**Alert rules (platform settings, defaults).** API 5xx rate > 2% for 5 min; P95 > budget for 10 min; DB pool wait > 100 ms P95; Redis circuit open; job queue oldest-queued > 5 min; export failure rate > 20%; integration DOWN. Alerts surface in the Control Tower alerts board (CT-07) and the nav indicator; **external paging/email is out of scope** (no channel verified).
**Actions.** Run integration check now (`MANAGE_SYSTEM_JOBS`, rate-limited 1/min per integration), retry/cancel job (`MANAGE_SYSTEM_JOBS`), view (`VIEW_SYSTEM_HEALTH`).
**Endpoints.** SYS-00 (REUSE `/health`, `/health/ready`), SYS-01…13. **Validation.** Metric keys whitelist; telemetry ingestion size-limited (≤ 4 KB, ≤ 60 requests/min per client).
**States.** "No data yet" for new installations; stale probe (> 3× interval) shown as UNKNOWN; DISABLED integrations listed with the configuration key that enables them.
**List behaviour.** Jobs: filter type/status/date; errors: filter route group/status class/time window.
**Reports.** System report (RPT-S26 *Operational health summary*) optional export.
**Responsive.** Tiles stack; charts reduce to sparklines on phone.
**Tests.** U: histogram bucketing, rollup arithmetic, alert evaluation; I: flush on shutdown, multi-instance sum, probe results persistence; E: permission matrix, telemetry ingestion limits and PII scrubbing; PW: overview renders real values from a seeded backend; DISABLED states; X.
**Dependencies.** WS-1 (jobs), WS-2, WS-P (instrumentation shared), WS-10.
**Acceptance.** M15-01…M15-10.

---

### 5.16 Module 16 — Platform Configuration (prefix CFG)
**Purpose.** Every operational setting visible, typed, validated, explained and versioned — no setting changes behaviour silently.

**Pages.** PG-CFG-1 *Settings* (grouped: Orders & dispatch · Fees & pricing · Payments (manual transfer) · Loyalty & wallet · Security (MFA policy) · Reporting (timezone, retention) · Media limits · Notifications & campaigns · Performance & caching · Feature flags) · PG-CFG-2 *Setting history* (who changed what, before/after) · PG-CFG-3 *Delivery pricing* (delivery-zone fees) · PG-CFG-4 *Service areas & zones* · PG-CFG-5 *Hatly service configuration* (pricing config, route defaults) · PG-CFG-6 *Vehicle types* (shared with Fleet).
**Rules.** A schema registry (`business_config_schema`: key, type, unit, min/max, enum, default, group, label AR/EN, help AR/EN, `requiresRestart`, `sensitive`, `deprecated`) drives the UI and the backend validation; the 4 backend keys that have no UI today are surfaced; the retired `VENDOR_SEGMENT_AUTO_ACCEPT_ENABLED` enum value is removed (migration-free code change) and its stored row, if any, is left untouched and shown under "Retired" read-only. Sensitive values (payment destinations, secrets) are never displayed in history diffs (masked), and **secrets are not stored in business config**. Changing a setting with financial effect shows an impact sentence and requires reason (audited).
**Actions.** Edit/reset-to-default (`MANAGE_BUSINESS_CONFIG`), pricing (`MANAGE_HATLY_SERVICE_PRICING`), zones/areas (`MANAGE_SERVICE_AREAS`), delivery fee multiplier (`MANAGE_DELIVERY_FEE_MULTIPLIER`), read (`CONFIG_VIEW` or `MANAGE_BUSINESS_CONFIG`).
**Endpoints.** CFG-01…12. **Data.** `business_config` (existing) + additive `business_config_history` (or audit-derived; decided in API plan §Entities: **audit-derived** to avoid a duplicate store, with the schema registry in code and a read endpoint).
**Validation.** Type/range/enum per schema; cross-field rules (e.g. fee multiplier ≥ 1; threshold ordering) in one validator; unknown keys rejected.
**States.** Dirty-state per group; save-all with per-key results; "Restart required" badge only where true.
**List behaviour.** Search key/label; filter group/changed-from-default/deprecated.
**Responsive.** Single-column forms; zone editor tablet+.
**Tests.** U: schema validators; I: history from audit; E: permission matrix, secret masking; PW: edit/save/history; X.
**Dependencies.** WS-1, WS-2, WS-10, WS-P (cache-ttl settings).
**Acceptance.** M16-01…M16-10.

---

## 6. Media platform (WS-3)

### 6.1 Principles
Binaries only in storage; metadata in PostgreSQL; originals not retained by default; every stored object is a processed derivative; references are database-enforced; existing `*_url` columns keep working; no change to storage provider configuration; no external-URL inputs in the Admin (D-10…D-16). **sharp** is the image engine (dependency register §14).

### 6.2 Pipeline (server-side, synchronous per file, bounded by the existing concurrency limiter `UPLOAD_MAX_CONCURRENT`)
1. **Receive** multipart (`file`, `purpose`, optional `entityHint`, optional `crop {x,y,width,height}` in source pixels, optional `altEn/altAr`). Reject > 5 MB (byte limit enforced while streaming; abort early), reject missing/duplicate file part.
2. **Authorize** by purpose (§6.5).
3. **Detect type from bytes** (existing `detectImageType`): JPEG / PNG / WebP only. Declared MIME and extension are ignored.
4. **Header probe** with `sharp(buffer, { limitInputPixels: 40_000_000 }).metadata()`: reject if pixels > 40 MP (`MEDIA_TOO_MANY_PIXELS`), width/height below purpose minimum (`MEDIA_TOO_SMALL`), above purpose maximum edge before processing (`MEDIA_TOO_LARGE_DIMENSIONS`, default 8000 px), animated multi-frame inputs rejected (`MEDIA_ANIMATED_NOT_ALLOWED`), non-RGB exotic colour spaces converted.
5. **Decode strictly** (`failOn: 'error'`): a corrupt/truncated file fails with `MEDIA_CORRUPT` (no partial output).
6. **Orient then strip**: `rotate()` (apply EXIF orientation) **before** removing metadata; output metadata stripped (no EXIF/GPS/ICC/XMP): `withMetadata()` is never called; colour profile converted to sRGB.
7. **Crop** (if provided and the purpose has a fixed aspect): validated against source bounds; otherwise **centre-crop to the purpose aspect** only when the purpose enforces exact aspect (banner); product/sector images use `fit: inside` without cropping unless the user crops.
8. **Variants:** `display` — WebP, max edge 1600 px, quality 82, `effort` default; `thumb` — WebP, max edge 320 px, quality 78; both never upscale (`withoutEnlargement`). An additional `medium` (640 px) is **not** generated unless the baseline (WS-P0) shows list cards over-fetching (decision recorded in the P-phase report; the schema supports arbitrary variant names).
9. **Content-addressed keys:** `media/<yyyy>/<mm>/<sha256-first-16>-<variant>.webp`; sha256 of the **display bytes** is stored for dedupe: uploading the same processed bytes returns the existing asset (`deduplicated:true`) and does not create a second object.
10. **Store** via the existing provider; both variants written before the DB row is committed; on any failure after a write, written keys are deleted (compensation) and the failure is surfaced; orphan sweeper job removes keys without rows older than 24 h.
11. **Respond** with `{ id, status, purpose, width, height, bytes, mimeType: 'image/webp', altEn, altAr, variants: { display: {url,width,height,bytes}, thumb: {...} } }` (URLs follow the private/signed mechanism if `STORAGE_ACCESS=private`).
12. **Audit** `MEDIA_UPLOADED` (asset id, purpose, bytes, dimensions, dedupe flag).
13. **Cache headers on serve:** keys are content-addressed → `Cache-Control: public, max-age=31536000, immutable` for public access; private access serves signed URLs with TTL and `private, max-age=<ttl-60>`.

Memory/CPU safety: sharp concurrency limited (`sharp.concurrency(MEDIA_SHARP_THREADS)`, default 2), `sharp.cache(false)` for upload paths, per-request deadline 15 s, rate limits via the existing `mediaUpload` policy (per user and IP).

### 6.3 Purpose policies (limits are policy data, not scattered constants)
| Purpose | Allowed roles/permission | Min px (w×h) | Max edge | Aspect | Notes |
|---|---|---|---|---|---|
| `VENDOR_LOGO` | `MANAGE_VENDORS` | 200×200 | 4000 | 1:1 enforced (crop UI) | |
| `BRANCH_COVER` | `MANAGE_VENDORS` | 800×400 | 6000 | 2:1 enforced | Customer `Vendor.coverImageUrl` |
| `SECTOR_IMAGE` | `MANAGE_MARKETPLACE_SECTORS` | 400×400 | 4000 | 1:1 enforced | |
| `SUBCATEGORY_IMAGE` | `MANAGE_MARKETPLACE_SECTORS` | 300×300 | 4000 | 1:1 enforced | |
| `HOME_BANNER` | `MANAGE_HOME_BANNERS` | 1200×600 | 6000 | **2:1** enforced (the ratio the Customer banner slot uses is confirmed from `home_banner` widget at implementation; the policy value changes in one place) | |
| `PRODUCT_PRIMARY` / `PRODUCT_ADDITIONAL` | `MANAGE_CATALOG` | 400×400 | 6000 | free (crop optional; square thumbnail generated by `cover` for `thumb` only) | |
| `CATALOG_PRODUCT` | `MANAGE_CATALOG` | 400×400 | 6000 | free | |
| `CAMPAIGN_VISUAL` | `MANAGE_CAMPAIGNS` | as `HOME_BANNER` | | | stored as a banner asset |
| `GENERAL` | `MANAGE_MEDIA` | 100×100 | 8000 | free | library-only, not assignable to entities that require a specific purpose |
Aspect and minimums come from the existing Customer rendering sizes where they exist; **no requirement is invented**: the values above are policy defaults editable by a single policy file and surfaced in the upload error messages; any change is reflected in tests by reading the policy, not hard-coded numbers.

### 6.4 Error codes (all localized in the Dashboard)
`MEDIA_FILE_TOO_LARGE, MEDIA_UNSUPPORTED_TYPE, MEDIA_CORRUPT, MEDIA_TOO_MANY_PIXELS, MEDIA_TOO_SMALL, MEDIA_TOO_LARGE_DIMENSIONS, MEDIA_BAD_ASPECT, MEDIA_ANIMATED_NOT_ALLOWED, MEDIA_PURPOSE_FORBIDDEN, MEDIA_IN_USE, MEDIA_NOT_FOUND, MEDIA_PROCESSING_TIMEOUT, MEDIA_STORAGE_FAILED, MEDIA_RATE_LIMITED`. Each message states the limit and the received value.

### 6.5 Authorization and security
Upload = purpose permission (table above). Library view = `MEDIA_VIEW`; edit metadata = `MANAGE_MEDIA`; delete/restore/purge = `MEDIA_DELETE`; assign to entity = the entity's own manage permission (checked when the entity is saved with `mediaAssetId`; the backend verifies the asset exists, is ACTIVE and its purpose matches the field). Vendor-role users keep their own existing endpoints (vendor product image) which are re-implemented on the media pipeline with vendor-scoped authorization and the same limits; **an asset is never accessible across vendors by id** (tests). SVG/GIF/HEIC/PDF rejected; response `X-Content-Type-Options: nosniff` and existing CSP/sandbox retained; file names are never used in keys; no path parameters; library listing exposes only metadata and signed/public URLs per access mode. Antivirus is not added (raster-only, re-encoded through sharp: the stored bytes are always a fresh encode, which removes embedded payloads) — documented residual risk. Rate limits per user and per IP (existing policy).

### 6.6 Dashboard MediaPicker
* Controls: drag-and-drop zone, click-to-select, paste from clipboard, multi-file selection (per-field `maxFiles`), **library tab** (search, filter by purpose, reuse existing asset), **upload tab**.
* Per file: client-side pre-checks (type by `File.type`+magic bytes read of first 12 bytes, size ≤ 5 MB, dimensions via `createImageBitmap` against min/max) giving instant feedback — the server remains authoritative.
* **Crop/aspect editor** (tablet+): fixed aspect for the purpose (lock icon), zoom, pan, rotate 90°, shows resulting pixel size and warns if below the recommended size; outputs crop rect in source pixels (server crops).
* **Progress/cancel/retry:** `XMLHttpRequest`/axios upload progress per file; cancel aborts the request; failure shows the localized code and *Retry*; concurrency 3 uploads at once, queue visible.
* **Primary + additional images:** ordered list; first = primary (badge); reorder (drag on tablet+, move buttons everywhere); remove from this entity (does not delete the asset); replace (opens picker for that slot).
* Preview uses `thumb` for grids and `display` for the detail preview; alt text fields (AR/EN) optional but encouraged (a11y).
* Accessible: dropzone is a button with instructions, progress announced via live region, keyboard reorder, error summary.

### 6.7 Library, reuse, replace, delete
* Library filters: purpose, status, uploader, date, size, dimensions, usage (used/unused), text on name/alt/tags; sort date/size/usage; keyset.
* **Usage tracking:** `GET /admin/media/:id/usage` returns every entity referencing the asset (entity type, id, display name, field) from the FK columns and `product_media`; also counts references from order/cart snapshots **by URL** for information (snapshots are never rewritten).
* **Replace-everywhere:** creates a new asset from the new upload and re-points all references in one transaction (updating FK columns and `*_url`), keeps the old asset as soft-deleted (restorable); requires `MEDIA_DELETE` + typed confirmation with the usage count; audited with the full reference list. Snapshots keep the old URL (historical truth).
* **Delete:** soft delete (`status=DELETED, deleted_at`) refused with `MEDIA_IN_USE` (409) while referenced (also guaranteed by FK `RESTRICT` at DB level so a race cannot orphan a reference); binaries purged by `MEDIA_PURGE` after `MEDIA_RETENTION_DAYS` (default 30) **only if still unreferenced** and not referenced by any snapshot URL (snapshot URL check uses an index on URL columns of snapshot tables; the purge job logs and skips if a hit is found).
* **Unreferenced cleanup:** assets uploaded but never assigned for > 7 days are listed in *Cleanup*; deletion is manual-confirmed or an explicit job (`purge-unreferenced`, dry-run default).

### 6.8 Data model summary (full DDL in the API plan §Entities)
`media_assets (id uuid pk, purpose, status ACTIVE|DELETED, original_name text (display only), mime_type, bytes (display), width, height, sha256 unique(active), alt_en, alt_ar, tags text[], uploaded_by, created_at, deleted_at, deleted_by, legacy_source_url nullable)`; `media_variants (id, asset_id fk, name DISPLAY|THUMB|ORIGINAL, storage_key unique, width, height, bytes, mime_type)`; `product_media`; FK columns `vendors.logo_media_asset_id, vendor_branches.cover_media_asset_id, marketplace_sectors.media_asset_id, marketplace_subcategories.media_asset_id, products.media_asset_id, catalog_products.media_asset_id, home_banners.media_asset_id` (all nullable, `ON DELETE RESTRICT`). The existing `*_url` column is written with the `display` variant URL whenever the FK is set, in the same transaction.

### 6.9 Compatibility and backfill
* **Preserve existing URLs:** existing image URLs are not rewritten, migrated or invalidated. The backfill job (`MEDIA_VARIANT_BACKFILL`, SUPER_ADMIN, resumable, batch 100, idempotent) registers each existing local/S3 file referenced by a `*_url` column as a `legacy` asset (`legacy_source_url`), reads the stored object, and generates `thumb` and `display` variants **next to** it; the entity's `*_url` is **not** changed (it keeps serving the original); `thumbnailUrl` for the Customer API is resolved from the asset when present, else falls back to the original URL. Objects that cannot be read are recorded as `LEGACY_UNREADABLE` and listed — never deleted, never blocking.
* **Snapshots** (order items, carts, proof of delivery) are never modified.
* **Customer/Driver APIs** gain only additive fields (`thumbnailUrl`, `images[]`); older builds ignore them.
* **Uploads table** unchanged; customer/driver-owned uploads stay there.

### 6.10 Storage and delivery
Existing providers only. Keys are content-addressed under `media/`. Local driver: unchanged static serving with the long-cache headers above. S3 driver: unchanged signer; private access → signed URLs with TTL (`STORAGE_SIGNED_URL_TTL`), refreshed by the API on each response (clients never persist signed URLs; image cache keys use the stable key — see §13 image caching). Disk/bucket usage shown on *Cleanup*.

### 6.11 Audit events
`MEDIA_UPLOADED, MEDIA_METADATA_UPDATED, MEDIA_RECROPPED, MEDIA_REPLACED_EVERYWHERE, MEDIA_DELETED, MEDIA_RESTORED, MEDIA_PURGED, MEDIA_BACKFILL_STARTED/COMPLETED`.

### 6.12 Media tests (summary; per-criterion list in Acceptance M13)
U: policy validation, key derivation, dedupe; I: pipeline with real sharp on fixtures (valid JPEG/PNG/WebP, EXIF-rotated, GPS-tagged, corrupt, truncated, 41 MP, animated, tiny, wrong magic, polyglot) asserting output has **no EXIF/GPS** (read back with sharp metadata), correct orientation, variant sizes, WebP type; FK RESTRICT and delete-while-referenced race; replace-everywhere transactionality; storage compensation when the second write fails (fault injection); backfill idempotency/resume; E: purpose authorization matrix, cross-vendor isolation, rate limits, legacy DTO compatibility; PW: upload multi-file with progress, cancel, retry, crop, reorder, delete-blocked, library reuse; X: axe/RTL; Provider contract spec extended to run the pipeline against local and the S3 fake.

---
## 7. Reporting and export platform (WS-4)

### 7.1 Architecture
* **Report registry (backend, D-20):** each report is a class implementing `ReportDefinition { id, family, titleKey, parameters (zod/class-validator schema), columns[] (key, labelKey, type: text|int|money|percent|date|datetime|enum|bool, sortable, piiLevel: none|pii|financial), query(params, cursor/limit) → rows, totals(params) → row, reconcile(params) → {ok, deltas[]}, viewPermissions[], exportPermission, maxRows, supportsChart }`. The runner, CSV/XLSX/PDF writers, the Dashboard preview, scheduled exports and the KPI endpoints all call the same definition.
* **SQL:** plain parameterized SQL through TypeORM `query`/QueryBuilder in the definition; no string-built SQL from user input; all date ranges through `ReportingClock` (§3.1); sorting/filters whitelisted per report; read-only transaction (`SET TRANSACTION READ ONLY`), statement timeout `REPORT_STATEMENT_TIMEOUT_MS` (default 30 s preview, 300 s export).
* **Streaming:** exports read with keyset batches (default 2,000 rows) so memory is bounded; CSV is streamed to storage; XLSX built with SheetJS in `aoa`/sheet-stream-safe chunks bounded by the 100,000-row cap (D-22).
* **Isolation from live traffic:** export concurrency capped (`JOBS_CONCURRENCY_REPORT_EXPORT`, default 2), batches sleep-yield under high DB pool utilisation (>80%), preview queries limited to 200 rows; a load test (P-04) proves API latency is not degraded by exports.
* **Caching:** identical preview requests (same params, same user permissions class) are cached in Redis for 60 s (optional, D-08); exports are never served from cache.

### 7.2 Report catalogue (initial, complete for this scope)
Legend — perms: **V** = view permissions (all of), **X** = export permission. `FIN$` = money columns need `VIEW_FINANCIALS`; `PII` = needs `VIEW_CUSTOMER_PII` else masked. Dates are Cairo calendar dates (§3.1). Totals row is computed by the backend over the whole filtered set.

| ID | Report | One row = | Key measures / columns (source of truth) | Filters | Totals | V | X | Reconciles to |
|---|---|---|---|---|---|---|---|---|
| S01 | Executive summary | KPI | KPIs of §5.1 (single definitions) | range, compare | n/a | VIEW_REPORTS (+FIN$) | REPORTS_EXPORT | KPI endpoint = same code (test) |
| S02 | Orders | order | number, created, status, customer (PII), vendors, payment method/status, subtotal, discounts (Hatly/vendor), delivery fee, total, refunded recorded/sent, cancelled-by, delivered_at (orders, segments, financial_events) | range, status, payment, vendor, branch, zone, driver, sector, coupon | count, Σ total, Σ discounts, Σ refunded | VIEW_REPORTS, VIEW_ORDERS (+FIN$) | ORDERS_EXPORT | Σ(rows) = independent SQL; counts = Control Tower counters for same range |
| S03 | Order lines & product sales | order item | product, vendor, qty, unit price, line total, status (order_items snapshot) | range, vendor, product, category, sector | Σ qty, Σ line total | VIEW_REPORTS, VIEW_ORDERS | ORDERS_EXPORT | Σ line totals of non-cancelled = GMV (§5.1) |
| S04 | Sales by period/sector/vendor | bucket | orders, GMV, net delivered sales, AOV, cancellations (day/week/month; sector/vendor/branch dimension) | range, granularity, dimension | per column | VIEW_REPORTS, VIEW_ORDERS (+FIN$) | ORDERS_EXPORT | Σ buckets = S02 totals |
| S05 | Vendor & branch performance | vendor/branch | orders, acceptance/rejection rates, reasons, avg acceptance/prep time, gross sales, commission recognized, rating | range, vendor, branch, sector | per column | VIEW_REPORTS, VENDORS_VIEW (+FIN$) | ORDERS_EXPORT | gross/commission = settlement definitions (§8.1) |
| S06 | Customers | customer | registered, orders, first/last order, repeat flag, lifetime value (GMV), wallet balance (FIN$), coupon use | range, zone, active/blocked, cohort | count, Σ | VIEW_REPORTS, VIEW_CUSTOMERS (PII) | CUSTOMERS_EXPORT | order counts = S02 |
| S07 | Products & inventory | product | vendor, price, stock, state (in/low/out), sold qty in range, active, image present | vendor, category, stock state | count by state | VIEW_REPORTS, CATALOG_VIEW | CATALOG_EXPORT | sold qty = S03 |
| S08 | Driver performance | driver | deliveries, failed, on-time %, avg delivery time, acceptance rate, cash remainders, rating | range, driver, vehicle type, zone | per column | VIEW_REPORTS, FLEET_VIEW | FLEET_EXPORT | deliveries = S02 delivered count by driver |
| S09 | Ledger (financial events) | financial event | time, type (bucketed §8.1), order, vendor, branch, driver, amount, funding party, linked event id, idempotency key | range, type, vendor, branch, driver, order | Σ by sign/type | VIEW_REPORTS, VIEW_FINANCIALS | FINANCE_EXPORT | Σ = ledger summary FIN-02 |
| S10 | Revenue & commissions | bucket | vendor commission recognized, driver commission recognized, Hatly-funded discount net, Hatly revenue (§8.1), commission collected/outstanding (§8.4) | range, granularity, vendor | per column | VIEW_REPORTS, VIEW_FINANCIALS | FINANCE_EXPORT | Hatly revenue = Σ components (test) |
| S11 | Driver earnings & settlement statement | driver period/line | per period: earnings, commission owed, reimbursements, net payable, payments, status; lines per delivery | driver, period, status | per column | VIEW_REPORTS, VIEW_DRIVER_SETTLEMENTS | FINANCE_EXPORT | stored period totals = Σ lines; exceptions list empty |
| S12 | Hatly-funded discounts | consumption/event | offer, order, recorded, restored, net, reversal reason | range, offer, vendor | Σ recorded, Σ restored, net | VIEW_REPORTS, VIEW_FINANCIALS | MARKETING_EXPORT or FINANCE_EXPORT (either) | net = consumed − reversed (S17) |
| S13 | Liabilities | liability type | wallet balances total/count, loyalty points outstanding (and EGP value at current rate), refunds recorded−sent, closed-unpaid settlements (vendor/driver), driver cash outstanding | as-of date | per type | VIEW_REPORTS, VIEW_FINANCIALS | FINANCE_EXPORT | wallet Σ = Σ wallet ledger per customer |
| S14 | Delivery SLA | delivery | promised vs actual, acceptance→pickup→delivery durations, reassignments, unanswered attempts | range, zone, driver, vendor | P50/P90, on-time % | VIEW_REPORTS, FLEET_VIEW | FLEET_EXPORT | deliveries count = S08 |
| S15 | Vendor settlement statements | vendor period/line | period, gross sales, commission owed, net payable, payments, status, lines per order | vendor, branch, period, status | per column | VIEW_REPORTS, VIEW_VENDOR_FINANCIAL_REPORTS | FINANCE_EXPORT | stored period = Σ lines (R3) |
| S16 | Payments & refunds | payment/refund | method, status, amounts, claimed/verified times, verifier, refund recorded→sent latency | range, method, status | Σ by status | VIEW_REPORTS, VIEW_FINANCIALS | FINANCE_EXPORT | R1, R2 |
| S17 | Coupon & offer performance | offer | redemptions, reversed, net uses, budget used/remaining, discount given (Hatly/vendor), orders, GMV of orders using offer | range, offer, type, status | per column | VIEW_REPORTS, MARKETING_VIEW | MARKETING_EXPORT | Σ consumptions − reversed |
| S18 | Reconciliation | check | R1…R6 (§8.7) with expected/actual/delta/explanation | range | n/a | VIEW_REPORTS, VIEW_FINANCIALS | FINANCE_EXPORT | self-checking |
| S19 | Campaign & broadcast performance | campaign/broadcast | state, offers used, orders attributed (orders using campaign offers), recipients, sent, failed, delivered/opened where reported | range, status | per column | VIEW_REPORTS, MARKETING_VIEW | MARKETING_EXPORT | recipients = broadcast_recipients |
| S20 | Cancellations & failed deliveries | order | reason, cancelled-by, stage, refund outcome, failure resolution | range, reason, vendor | counts, Σ refund | VIEW_REPORTS, VIEW_ORDERS | ORDERS_EXPORT | counts = S02 cancelled |
| S21 | Audit log | audit row | time, actor, action, target, outcome, route | range, actor, action, target | count | VIEW_AUDIT_LOG | AUDIT_EXPORT | row count = audit viewer |
| S22 | Employee loans | loan/repayment | principal, repaid, remaining, status | employee, status | Σ | VIEW_REPORTS, VIEW_FINANCIALS | FINANCE_EXPORT | loan detail endpoint |
| S23 | Wallet & loyalty | transaction | type, amount, balance after, reason, actor | range, type, customer | Σ by type | VIEW_REPORTS, VIEW_FINANCIALS | FINANCE_EXPORT | S13 |
| S24 | Ratings | rating | target (vendor/driver/product), stars, hidden flag, order | range, target, stars | counts, avg | VIEW_REPORTS, VIEW_CUSTOMERS | CUSTOMERS_EXPORT | denormalized counters recompute check |
| S25 | Permission matrix | admin × permission | who holds what, via which template, last login | role | n/a | SUPER_ADMIN | AUDIT_EXPORT | `user_permissions` |
| S26 | Operational health summary | metric | availability %, error rate, P95 by route group, job failures | range | per column | VIEW_SYSTEM_HEALTH | REPORTS_EXPORT | metric buckets |

Required families from the brief are all covered: executive (S01), sales (S04), orders (S02,S03,S20), vendor/branch (S05,S15), product/inventory (S07), customer (S06,S24), driver/delivery (S08,S14,S11), commission (S10), ledger (S09), payments/refunds (S16), settlement statements (S11,S15), coupon/offer (S17,S12), campaign (S19), SLA (S14).

### 7.3 Permission model for reports and exports
* **View a report** = `VIEW_REPORTS` **and** the report's family view permissions (table above); money columns are returned only with `VIEW_FINANCIALS` (or `VIEW_VENDOR_FINANCIAL_REPORTS` / `VIEW_DRIVER_SETTLEMENTS` for their own families); PII columns masked without `VIEW_CUSTOMER_PII`. A report whose every column is hidden for the caller is not listed.
* **Export** = view permissions **and** the report's export permission; the permission is checked **at request time and again at download time** (a revoked admin cannot download a previously generated file) (acceptance G-12).
* A user may download only their own exports unless they hold `AUDIT_EXPORT` + the export's report permissions (then "all exports" tab). Exports of SUPER_ADMIN-only reports (S25) are visible only to SUPER_ADMIN.
* Exports **apply masking identically** to the screen; a masked column in the preview is masked in the file (single code path).

### 7.4 Formats and limits (D-22)
| Format | Use | Limits | Notes |
|---|---|---|---|
| CSV | all reports | streamed; no row cap other than `REPORT_EXPORT_MAX_ROWS` (default 2,000,000) with a visible warning; UTF-8 **with BOM** for Excel/Arabic compatibility; `,` delimiter; RFC-4180 quoting | formula-injection guard: cells starting with `= + - @ \t \r` are prefixed with `'` (tested) |
| XLSX (SheetJS) | tabular reports | ≤ 100,000 rows / 50 MB; one sheet "Data", sheet "Parameters" (filters, generated at (Cairo), generated by, definitions link), sheet "Definitions" (column meanings); frozen header, numeric/date cell types, RTL sheet view when exported in Arabic | above the cap only CSV is offered with a clear message |
| PDF | S01, S11, S15 (statements), selected summaries | ≤ 5,000 rows; Arabic/English templates; gated by S-PDF (D-23) | header with company name, period, generated-at (Cairo), page numbers, totals; fonts embedded |
Locale of an export: the requester's current locale unless chosen; headers translated; enum values translated by the same maps as the UI; money as numbers with 2 decimals (+ optional `_minor` columns when "Include minor units" is ticked).

### 7.5 Job lifecycle, storage, download, expiry
`POST /admin/reports/:id/exports {params, format, locale, includeMinor}` + `Idempotency-Key` → creates `report_exports (id, report_id, params jsonb, format, locale, status, job_id, requested_by, row_count, file_bytes, storage_key, checksum_sha256, created_at, started_at, finished_at, expires_at, last_downloaded_at, download_count, error_code)` and a `REPORT_EXPORT` job. Progress (0–100) from rows written/estimated count; cancel is cooperative; failure stores `error_code` (never stack traces). Files are written to the existing storage provider under a **private prefix** (`exports/`), never public, served only through `GET /admin/exports/:id/download` which re-checks permission, writes an audit event, increments counters and returns a short-lived signed URL (S3) or streams (local) with `Content-Disposition: attachment`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. **Expiry:** `EXPORT_RETENTION_HOURS` (default 72); `EXPORT_FILE_PURGE` job deletes the object and marks `EXPIRED`; row metadata is kept 12 months for audit. Request rate limits: 10 export requests/hour/user; per-user concurrent 2.

### 7.6 Date-range handling
Parameters are `from`/`to` Cairo dates (inclusive) or presets resolved server-side; the export's "Parameters" sheet prints both the dates and the resolved UTC instants. Day-end boundaries are tested around midnight and DST (§3.1).

### 7.7 Index plan (additive migrations; see API plan §Indexes)
`orders(created_at)`, `orders(status, created_at)`, `orders(vendor_branch_id, created_at)`, `orders(customer_id, created_at)`; `financial_events(created_at)`, `(type, created_at)`, `(vendor_branch_id, created_at)`; `payments(created_at)`, `(status, created_at)`; `order_vendor_segments(vendor_branch_id, created_at)`, `(status, updated_at)`; `deliveries(driver_id, created_at)`, `(delivered_at)`; `offer_consumptions(offer_id, created_at)`; `wallet_transactions(customer_id, created_at)`, `(type, created_at)`; `admin_audit_logs(created_at)`, `(actor_user_id, created_at)`, `(target_type, target_id, created_at)`; `users(created_at)`. Created with `CREATE INDEX CONCURRENTLY IF NOT EXISTS` in non-transactional migrations (D-09). Each index must be justified by an `EXPLAIN (ANALYZE, BUFFERS)` of a catalogue query on the generated dataset (§15.3) before and after; an index without a measured benefit is removed from the migration (and its absence recorded).

### 7.8 Performance targets for reports (P-03)
On the acceptance dataset (§15.3: 500k orders, 2M financial events, 1M wallet transactions over 24 months): preview of any report with a 31-day range returns the first 200 rows + totals in **P95 ≤ 2.5 s**; a 12-month range ≤ 8 s; CSV export of 100k rows completes in ≤ 90 s with memory ≤ 256 MB RSS growth; no report holds a connection > the statement timeout. **Rollup rule:** a report whose measured P95 exceeds its target after index tuning gets a documented rollup table (`report_rollup_<name>`, rebuilt by `METRIC_ROLLUP`-style job, reconciled to the live query by test) — never earlier (D-21).

### 7.9 Reconciliation testing
Every report has an automated reconciliation test: totals recomputed with an independent SQL written separately from the definition (kept in the test) over the generated dataset; any mismatch fails CI. Cross-report identities (S04 Σ = S02 totals; S10 components; S12 ↔ S17; S13 wallet ↔ ledger) are asserted.

---

## 8. Finance correctness (authoritative definitions; D-24)

**Principle.** Every money figure is derived from the append-only financial events, payment/refund records and settlement tables by **named, tested functions** in one backend module (`FinanceDefinitions`), used by KPIs, reports, statements and the Dashboard. A new `financial_events.type` cannot be added without classifying it in the registry (a unit test enumerates the enum and fails on an unclassified value).

### 8.1 Definitions
| Term | Definition | Notes |
|---|---|---|
| **Gross Sales (vendor)** | Σ item line totals of vendor segments in non-cancelled, non-rejected state, as stored in `gross_sales_minor` on a closed period; reports use the same SQL function as the settlement close | **≠ Hatly revenue.** Belongs to the vendor's goods |
| **Commission Recognized** | Σ `VENDOR_COMMISSION_RECOGNIZED` events (vendor) and the driver-commission recognized events (driver) in range, net of any reversing events of the same family (types classified in the registry; confirmed by enumerating the enum in WS-5) | Recognition ≠ cash |
| **Commission Collected** | Σ `commission_owed` of settlement periods whose derived status is `PAID` (§8.4). Partial payments do **not** count as partially collected (conservative; provisional under U-01) | "Outstanding commission" = recognized − collected |
| **Hatly Revenue (recognized)** | Vendor commission recognized + driver commission recognized + Hatly-owned margins that exist as classified financial events (service-order margin only if such an event type exists — verified in WS-5) − Hatly-funded discount net (§8.6) | Never equals gross sales; reports show the components |
| **Delivery fees collected** | Σ delivery fee of delivered orders (customer-paid) — informational; Hatly revenue uses commission components, not the whole fee | |
| **Refund Recorded** | Σ refund-recorded financial events (obligation created) | A *liability* until sent |
| **Refund Sent** | Σ `refund_payouts` rows (money actually sent, marked by an admin) | Wallet refunds are instantaneous ledger credits and count as sent at credit time (their `ORDER_REFUND` wallet transaction is the proof) |
| **Refunds outstanding** | Recorded − Sent (never negative; a negative result is a reconciliation failure R2) | KPI "Outstanding refunds" |
| **Settlement Closed** | Period status CLOSED: totals frozen | **≠ paid** |
| **Settlement Paid** | Derived `PAID` status from active settlement payments (§8.4) | |
| **Hatly-funded discount recorded** | Σ `HATLY_FUNDED_OFFER_DISCOUNT_RECORDED` | |
| **Hatly-funded discount restored** | Σ `HATLY_FUNDED_OFFER_DISCOUNT_RESTORED` (PD-015) | |
| **Hatly-funded discount net** | recorded − restored | Reused `FinancialEventService.hatlyFundedDiscountSummary` |
| **GMV** | Σ item subtotals of non-cancelled segments (§5.1) | Not revenue |
| **Wallet liability** | Σ current customer wallet balances (ledger sum, reconciled to stored balance) | |
| **Loyalty liability** | outstanding points × current conversion rate (setting) — shown with the rate and as-of | |

### 8.2 Driver economics
Driver period fields exist (`total_earnings_minor`, `total_commission_owed_minor`, `total_reimbursements_owed_minor`, `net_payable_minor`). **Earnings** are those recorded events; the Dashboard never computes them. `net_payable_minor` may be negative (driver owes Hatly → COLLECTION).

### 8.3 Settlement semantic rules
1. A period is created/closed only by the existing close use case; closing is idempotent per period boundary and immutable afterwards.
2. After CLOSED, money movement is recorded **only** as `settlement_payments` rows (never as edits to period totals).
3. `OVERPAID` is an error state: it blocks new payments and appears on the Alerts board and in S18.
4. The statement page and PDF show: period dates (Cairo), parties, every contributing order/event line, totals, payments (with voided ones greyed and listed), status, and the accounting-policy banner while U-01 is unconfirmed.

### 8.4 Derived settlement payment status
`remaining = net_payable − Σ active(PAYOUT) + Σ active(COLLECTION)` for a payout-direction period (signs mirrored for collection-direction). `UNPAID` if Σ active = 0; `PAID` if remaining = 0 and Σ > 0 (or net_payable = 0 and period CLOSED); `PARTIAL` if 0 < settled < |net_payable|; `OVERPAID` if settled > |net_payable|. A zero-net closed period is `PAID` by definition ("nothing due"). All arithmetic in integer minor units inside one SQL function used by every consumer.

### 8.5 Wallet adjustments and goodwill
Wallet adjustments (D-27) are customer-cost entries, reported in S13/S23 and the Finance "Liabilities" page; they are **not** counted as discounts, refunds or commissions. Dual control per §5.7.

### 8.6 Offer/discount arithmetic
Per PD-014/015: restoration happens exactly once per reversed consumption; net = recorded − restored; offer budget/limits are restored by the same event; reports show both sides and the net, never only one.

### 8.7 Reconciliation checks (S18 / FIN-05)
R1 payments PAID (by day) = payment ledger events; R2 refunds recorded − sent = outstanding KPI and ≥ 0; R3 each closed period's stored totals = Σ of its contributing events (exceptions listed); R4 Hatly-funded recorded − restored = Σ (consumed − reversed) discount amounts of Hatly-funded offers; R5 per-customer wallet ledger sum = stored balance; R6 Σ active settlement payments by period = derived status inputs and no period is OVERPAID. Each check returns expected, actual, delta, and either an explanation (a documented, classified difference) or `UNEXPLAINED`. Acceptance: zero `UNEXPLAINED` on the acceptance dataset and after the full regression of money e2e tests.

### 8.8 Write operations (all idempotent, audited, transactional)
Settlement payment record/void (`settlement_payments`), wallet adjustment (+ approval), refund mark-sent (existing), employee loan operations (existing). Each uses `Idempotency-Key`, writes an explicit audit event, and, where it changes a ledger (wallet), goes through the existing wallet/financial services — never raw updates.

---

## 9. RBAC, audit and security

### 9.1 Principles (D-30…D-36)
Backend enforcement is authoritative on every route; navigation is a UX filter; existing permission names are kept; presets copy; SUPER_ADMIN retains role-level control of user/permission/template management; four-eyes for approvals; masking by default; every sensitive action audited.

### 9.2 Permission catalogue
**Existing (33, unchanged names):** listed in §2.1. **Read rule (new):** a *read* route declares `@RequiresAnyPermission(X_VIEW, MANAGE_X)`; `MANAGE_*` therefore keeps implying read, so no existing grant loses access and no data migration is needed.
**New permissions (28):**
| Group | Permissions |
|---|---|
| Sensitive data | `VIEW_FINANCIALS`, `VIEW_CUSTOMER_PII` |
| Read-only views | `VENDORS_VIEW`, `CATALOG_VIEW`, `FLEET_VIEW`, `MARKETING_VIEW`, `CONFIG_VIEW`, `MEDIA_VIEW`, `VIEW_SYSTEM_HEALTH` |
| Create/update | `MANAGE_CUSTOMERS`, `MANAGE_MEDIA`, `MANAGE_CAMPAIGNS`, `MANAGE_BROADCASTS`, `MANAGE_SETTLEMENT_PAYMENTS`, `MANAGE_SYSTEM_JOBS`, `MODERATE_REVIEWS` |
| Delete | `MEDIA_DELETE` |
| Approve | `CAMPAIGN_APPROVE`, `BROADCAST_APPROVE`, `WALLET_ADJUST_APPROVE` |
| Export | `ORDERS_EXPORT`, `CUSTOMERS_EXPORT`, `FINANCE_EXPORT`, `CATALOG_EXPORT`, `FLEET_EXPORT`, `MARKETING_EXPORT`, `AUDIT_EXPORT`, `REPORTS_EXPORT` |
`VIEW_REPORTS`, `VIEW_VENDOR_FINANCIAL_REPORTS`, `VIEW_DRIVER_SETTLEMENTS` become enforced (previously unused). The permission metadata (group, labelKey AR/EN, description, dangerous flag, feature flag) lives in one registry used by the permission editor, navigation, templates and the route-inventory test. `GET /admin/permissions` returns the catalogue.

### 9.3 Role templates (D-31)
System templates (copy semantics; editable by SUPER_ADMIN only for custom ones; system ones are code-defined and re-synced on startup without touching users):
| Template | Permissions |
|---|---|
| Finance | VIEW_ORDERS, VIEW_CUSTOMERS, VIEW_REPORTS, VIEW_FINANCIALS, VIEW_VENDOR_FINANCIAL_REPORTS, VIEW_DRIVER_SETTLEMENTS, CLOSE_VENDOR_SETTLEMENTS, CLOSE_DRIVER_SETTLEMENTS, MANAGE_SETTLEMENT_PAYMENTS, VERIFY_MANUAL_PAYMENTS, MANAGE_CUSTOMER_WALLET, MANAGE_EMPLOYEE_LOANS, FINANCE_EXPORT, ORDERS_EXPORT, REPORTS_EXPORT |
| Operations | VIEW_ORDERS, MANAGE_ORDER_FULFILMENT, MANAGE_ORDER_ISSUES, ASSIGN_REASSIGN_ORDERS, OVERRIDE_DISPATCH, MANAGE_DRIVERS, CHANGE_DRIVER_ONLINE_STATUS, OPEN_CLOSE_VENDOR_BRANCHES, VENDORS_VIEW, FLEET_VIEW, VIEW_CUSTOMERS, VIEW_REPORTS, VIEW_SYSTEM_HEALTH, ORDERS_EXPORT, FLEET_EXPORT |
| Support | VIEW_ORDERS, MANAGE_ORDER_ISSUES, VIEW_CUSTOMERS, VIEW_CUSTOMER_PII, MANAGE_CUSTOMERS, MODERATE_REVIEWS, MANAGE_CUSTOMER_WALLET |
| Catalog | MANAGE_CATALOG, CATALOG_VIEW, CATALOG_EXPORT, MANAGE_MARKETPLACE_SECTORS, MANAGE_HOME_BANNERS, MANAGE_MEDIA, MEDIA_VIEW, VENDORS_VIEW |
| Marketing | MANAGE_OFFERS, MANAGE_HOME_BANNERS, MANAGE_CAMPAIGNS, MANAGE_BROADCASTS, MANAGE_LOYALTY_CONFIG, MARKETING_VIEW, MARKETING_EXPORT, MANAGE_MEDIA, MEDIA_VIEW, VIEW_REPORTS, VIEW_CUSTOMERS |
| Read-only | VIEW_ORDERS, VIEW_CUSTOMERS, VIEW_REPORTS, CATALOG_VIEW, VENDORS_VIEW, FLEET_VIEW, MARKETING_VIEW, CONFIG_VIEW, MEDIA_VIEW, VIEW_SYSTEM_HEALTH (no money, no PII, no exports) |
**Approvers** (`CAMPAIGN_APPROVE`, `BROADCAST_APPROVE`, `WALLET_ADJUST_APPROVE`), `MEDIA_DELETE`, `AUDIT_EXPORT`, `VIEW_AUDIT_LOG`, `MANAGE_BUSINESS_CONFIG`, `MANAGE_VENDORS`, `MANAGE_*_COMMISSION`, `MANAGE_HATLY_SERVICE_PRICING` are **not in any system template** — granted individually, deliberately.

### 9.4 Audit events (D-33: explicit, structured `metadata`; plus the global interceptor for all mutations)
`EXPORT_REQUESTED, EXPORT_COMPLETED, EXPORT_DOWNLOADED, EXPORT_EXPIRED, EXPORT_CANCELLED, PII_REVEALED, WALLET_ADJUSTMENT_REQUESTED/APPROVED/REJECTED/APPLIED, SETTLEMENT_PAYMENT_RECORDED/VOIDED, MFA_RESET, PERMISSION_GRANTED/REVOKED (with before/after sets), TEMPLATE_APPLIED/CREATED/UPDATED/DELETED, BULK_ACTION (action, count, ids hash, results), MEDIA_* (§6.11), ORDER_ADMIN_CANCELLED, ORDER_NOTE_ADDED, ORDER_NOTIFICATION_RESENT, CUSTOMER_BLOCKED/UNBLOCKED, RATING_HIDDEN/UNHIDDEN, CAMPAIGN_*/BROADCAST_* transitions, CONFIG_CHANGED (key, before/after masked if sensitive), SESSION_REVOKED, USER_CREATED/DEACTIVATED, INTEGRATION_CHECK_RUN, JOB_RETRIED/CANCELLED`. Audit rows never contain secrets or full PII (phone numbers masked in metadata).
**Entity history:** `GET /admin/audit-logs/entity/:type/:id`; every detail page has a *History* tab.
**Export auditing:** request, completion and each download are separate rows with requester, report id, params hash, format, row count, file checksum.

### 9.5 Masking rules (D-34)
| Data | Without `VIEW_CUSTOMER_PII` | Notes |
|---|---|---|
| Phone | `+20 ••• ••• 1234` | |
| Email | `a•••@domain.com` | |
| Address text / coordinates | district/city only; coordinates hidden | order detail shows zone |
| Customer name | first name + initial | |
| Wallet balance / lifetime value | hidden without `VIEW_FINANCIALS` | |
Vendor staff and driver phone numbers are operationally necessary for `FLEET_VIEW`/`VENDORS_VIEW` holders and are not masked for them. Reveal action audited (`PII_REVEALED`), per field, auto re-masks after 60 s.

### 9.6 Bulk actions (D-35)
Server accepts `{ ids[≤50], action, params, reason?, confirmCount }`; validates `confirmCount == ids.length`; executes each through the **single-item use case** (same permission, same validations, same audit, same idempotency per item via derived key `bulkId:itemId`); returns `{ results: [{id, ok, code?}] }`; no transaction across items (partial success is explicit); the UI shows the per-item table and offers *Retry failed*. "Select all matching" is supported only for **non-destructive** actions via a server `selectionToken` bounded to 50 items per execution round. Destructive bulk actions (cancel, void, delete) are not offered.

### 9.7 Authentication hardening reused (not rebuilt)
CSRF double-submit header, HttpOnly cookie session, refresh rotation with reuse detection, TOTP MFA with recovery codes and enrolment policy, login brake, throttling. **MFA reset** (`DELETE /admin/users/:id/mfa`, SUPER_ADMIN): reason ≥ 10 chars, typed confirmation, revokes the target's refresh tokens, forces re-enrolment, writes `MFA_RESET`, notifies the target via the audit trail (email not assumed). Session list/revoke built on the refresh-token table (IAM-19/20/21; table shape verified at start of WS-10).

---

## 10. Marketing, campaign and notification architecture

### 10.1 Components
`audiences` → `notification_broadcasts` (message definition + schedule + state) → `broadcast_recipients` (one row per customer; unique `(broadcast_id, customer_id)`) → delivery workers → channels: (a) `customer_inbox_messages` (always, in-app), (b) push via existing Firebase provider to registered device tokens, (c) SMS **excluded** by default (U-03). `campaigns` orchestrate `offers`, `home_banners` and `broadcasts` through `campaign_items`.

### 10.2 State machines
* **Broadcast:** `DRAFT → PENDING_APPROVAL → APPROVED → SCHEDULED → SENDING → COMPLETED | CANCELLED | FAILED`; reject returns to `DRAFT` with reason; `SENDING → CANCELLED` stops further batches (already-sent stay sent).
* **Campaign:** `DRAFT → PENDING_APPROVAL → APPROVED → SCHEDULED → RUNNING → COMPLETED | CANCELLED | FAILED` (D-41). Transitions are validated in one function; every transition writes `campaign_events (campaign_id, from, to, actor, at, note)`; edits after approval return the campaign to `DRAFT` (approval is invalidated) and are recorded.
* **Four-eyes:** approver ≠ creator and ≠ last editor; enforced in the use case and by a unit + e2e test.

### 10.3 Sending algorithm (idempotent, restart-safe)
1. At `SCHEDULED → SENDING` (or send-now) a `CAMPAIGN_EXPAND_AUDIENCE` job evaluates the audience rules in pages (keyset by customer id) and inserts recipients with `ON CONFLICT DO NOTHING`, applying frequency cap, quiet-hours and exclusion rules.
2. `BROADCAST_SEND` jobs claim batches of recipients (`status=PENDING → SENDING` with `FOR UPDATE SKIP LOCKED`, batch 200), create the inbox message (unique `(customer_id, broadcast_id)`), then call the push provider for each device token; per-recipient result stored (`SENT|FAILED|SKIPPED_NO_TOKEN|SKIPPED_CAP|SKIPPED_OPTED_OUT`), failures retry up to 3 times with back-off, permanent push failures (invalid token) deactivate the token via the existing token service.
3. Restart safety: a batch left `SENDING` beyond the visibility timeout returns to `PENDING`; the unique inbox/recipient constraints prevent duplicates; push delivery duplicates are prevented by marking `SENT` before acknowledging only after the provider confirms (at-least-once is documented; duplicates on a worker crash between provider success and DB commit are bounded to one batch and mitigated with a per-recipient collapse key = broadcast id so the device displays one notification).
4. Progress counters are derived from `broadcast_recipients` (not incremented counters) to avoid drift.

### 10.4 Customer app impact (additive)
New inbox screen and unread badge using endpoints MKG-20…23; deep-link routing for allowed targets; push tap opens the inbox item; no change to existing order notification flow. Requires a new Customer build (additive; a backend without the inbox returns 404 and the app hides the entry).

### 10.5 Compliance/safety
No PII in broadcast bodies; test sends only to the author's device; every send audited; approvals mandatory; per-customer caps; global kill switch `FEATURE_BROADCASTS=false` stops workers claiming `BROADCAST_SEND` jobs.

---

## 11. System monitoring and telemetry (WS-10 with WS-P instrumentation)

### 11.1 Server telemetry
* **Request metrics:** interceptor records route pattern, method, status class, duration; histogram buckets as §5.15; per instance aggregation flushed every 60 s (and on graceful shutdown) to `system_metric_buckets`.
* **`Server-Timing` header (all responses, D-68):** `auth;dur=`, `guards;dur=`, `db;dur=` (sum of query times), `dbq;desc="N queries"`, `cache;desc="hit|miss|bypass"`, `app;dur=`, `total;dur=`. Disabled by `SERVER_TIMING_ENABLED=false`; contains no identifiers. Used by WS-P0 baselines and exposed to the browser for the Dashboard's own measurements.
* **DB:** TypeORM `maxQueryExecutionTime` (default 200 ms) logs `slow_query` events (statement fingerprint, duration, route; parameters never logged); counters `db.slow_queries`, `db.query_count_per_request` histogram, pool metrics (`total, idle, waiting`) sampled every 10 s; pool size reviewed from P0 evidence (`DB_POOL_MAX` setting; default retained until evidence).
* **Cache:** hit/miss/bypass/circuit-open counters per domain (`home`, `sectors`, `banners`, `vendors`, `catalog`, `reports`).
* **Jobs:** queue depth per type, oldest queued age, runtime histogram, failures.
* **Business-event counters:** orders placed/failed checkout, payment claims, dispatch alerts — already logged as business events; counted into buckets for the alert board.

### 11.2 Client telemetry (D-70)
`POST /telemetry/client-metrics` (public with throttling + optional bearer for role; rejects > 4 KB) accepts an array of metric samples:
`{ app: 'customer'|'driver'|'vendor-web'|'admin-web', appVersion, buildMode: 'release'|'profile'|'debug', platform: 'android'|'ios'|'web', osVersion (major), deviceClass: 'low'|'mid'|'high' (derived on-device from RAM/CPU class — no model strings), network: 'wifi'|'4g'|'3g'|'2g'|'offline'|'unknown', metrics: [ { key, valueMs|count, ts } ] }`.
Keys: `app.cold_start_ms` (process start → first frame), `app.ttfmc_ms` (first meaningful content, per screen id), `screen.ready_ms:<screen>`, `api.latency_ms:<routeGroup>`, `api.failure:<routeGroup>:<class>`, `image.load_ms`, `image.failure`, `frames.jank_pct:<screen>`. Debug-mode samples are accepted but **tagged and excluded from every dashboard and budget evaluation** (D-61). No user id, device id, IP storage, no URLs with ids; sampling rate is a server-supplied setting (`CLIENT_TELEMETRY_SAMPLE_RATE`, default 0.1, returned by `GET /config/client` so it can be turned off without a release). Retention 14 days raw buckets.

### 11.3 Integration probes
As §5.15. Probe results never include credentials; endpoints and keys shown masked.

### 11.4 SDK decision
No monitoring SDK adopted (D-43/D-70). Revisit only if in-house telemetry cannot answer a question the baseline needs; trigger recorded in the Decision Register as a change request.

---
## 12. WS-0 — Home Aggregation closure (formal workstream)

### 12.1 What exists (local, uncommitted — verified)
Backend `modules/home-products` (controller, service, cache, epoch interceptor, types, DTO, unit specs), e2e `116-home-product-sections`, bench script `test/perf/home-sections-bench.mjs`; Flutter `HomeProductSectionsApi`, `homeSnapshotProvider` (one request, 404 → legacy fallback), `HomeSectionError` retry cards, tests `home_product_sections_test.dart`, `home_waterfall_perf_test.dart`. Contract v1: sections `OFFERS / MOST_ORDERED / NEW`, vendors list, query `deliveryZoneId`, `sections=`, header `X-Home-Cache`. Cache: epoch key `home:sections:epoch`, per-section keys, TTL 60 s, single-flight + Redis NX lock, 250 ms per-command timeout, 15 s circuit; invalidation by `HomeCacheEpochInterceptor` after successful admin/vendor catalogue mutations.

### 12.2 Closure scope (all required before WS-0 is "done")
| # | Task | Evidence required |
|---|---|---|
| 0.1 | Full verification after the final edits: backend `tsc`, unit, e2e (incl. 116 and the Redis-outage case rerun), integration; Flutter `test` + `analyze`; Dashboard `tsc`/unit/build | recorded run outputs; baselines compared to the known baselines in the test-infra notes (no new failures) |
| 0.2 | Redis outage e2e with the real shared client (not a second connection) re-run; circuit-breaker behaviour asserted (first request ≤ 1 s degraded, later ≤ 50 ms) | e2e green |
| 0.3 | Invalidation completeness: stock and delivered-count changes currently rely on TTL — decide and test: stock changes bump the epoch through the same interceptor/service hook for order placement that changes stock and delivered counts only on TTL (documented: MOST_ORDERED ordering is allowed to lag ≤ 60 s) | e2e + doc |
| 0.4 | **Zone passing (D-50):** the app passes `deliveryZoneId` **only** when the selected address resolves to a valid active zone (present in `GET /delivery-zones`); otherwise sends none (marketplace-wide, today's behaviour) | Flutter unit tests (zone present/absent/inactive), e2e zone-filtered equivalence |
| 0.5 | **See-all unchanged (D-51):** no change to See-all lists; their multi-request path is measured by WS-P0 and addressed in P2/P1 only with specified requirements | WS-P0 baseline contains the See-all waterfall |
| 0.6 | Documentation: `PRODUCT_DECISIONS.md` entry, release notes with deployment order (backend first; older app builds keep working; new app on old backend uses the 404 fallback), LAUNCH_PROGRESS section | docs updated |
| 0.7 | Performance evidence handover: local numbers (22 → 1 request; 24 → 9 ms cold / 1 ms warm; ~510 → ~170 ms at 150 ms RTT; legacy fan-out 429 under 40 clients) are labelled **lab-only**; Release-mode and realistic-network results are produced by WS-P0 (never claimed before) | WS-P0 baseline |
| 0.8 | **No deployment** (D-52) — no migration is part of Home aggregation (none exists); deployment is a separate, authorised step | n/a |

### 12.3 Not assumed
Home aggregation reduces one screen's request fan-out; it does **not** by itself address API origin latency, HTTP caching, image weight, startup serial work, list building, navigation reloads, Vendor/Driver/Admin performance. WS-P audits those independently (§13).

---

## 13. Performance Engineering (workstream WS-P)

### 13.1 Scope and principles
Coverage (each has a section below): Customer app startup and first meaningful content (§13.7.1); Home screen and independent section loading (§13.7.2); API latency, request count and payload size (§13.7.3); backend and database bottlenecks (§13.7.4); image delivery, optimization and caching (§13.7.5); Redis caching and invalidation (§13.7.6); navigation state preservation and redundant reloads (§13.7.7); pagination and lazy loading (§13.7.8); network resilience and partial failures (§13.7.9); Vendor and Driver performance (§13.7.10); Admin Dashboard performance (§13.7.11); production-like monitoring and regression tests (§13.8–13.9).

Principles: **audit first** (D-60); **Release-mode physical-device, realistic-network evidence only for app acceptance** (D-61); budgets are absolute (D-62); every optimization has a before/after taken the same way; correctness is not traded for speed (no stale prices/stock, no cache without invalidation); no speculative caching; privacy-safe telemetry.

### 13.2 Evidence audit — what is actually known today
Each row states its conditions so nothing is mistaken for a device result.

| # | Observation | Conditions / source | Interpretation (hypothesis, not conclusion) |
|---|---|---|---|
| E1 | Production `GET /sectors` TTFB **1.0–1.9 s** repeatedly; payload **761 B** | `curl` timings from the developer Mac network, several samples, this session | Latency is not payload-bound; origin or path overhead dominates — H1 |
| E2 | `GET /home-banners` ≈ 0.29 s; `GET /health` 0.45–0.76 s | same | `/health` (trivial) slower than banners → variance and path cost, not just DB — H1/H16 |
| E3 | All probed public JSON API responses carry `Cache-Control: no-store`; ETag present; gzip via Cloudflare; HTTP/2; `cf-cache-status: DYNAMIC` | response headers | No client or edge caching of static catalog data — H2 |
| E4 | Uploaded images served `public, max-age=86400`, Cloudflare HIT | headers on a probed image | Cacheable but daily revalidation, non-immutable names, original dimensions — H4/H17 |
| E5 | Legacy Home ≈ 24 requests; categories median 10.2 s → 1.3 s after decoupling; rows ≈ 8 s due to 18 concurrent product requests contending on origin | earlier Production measurement of the previous Home implementation (debug/simulator-class client, this-Mac network) | Fan-out + origin contention; evidence for H3 — **not** Release/device data |
| E6 | Home aggregation: 22 → 1 request; 24 → 9 ms cold / 1 ms warm backend; ~510 → ~170 ms at 150 ms RTT; legacy fan-out hit 429 under 40 clients | local backend, Dart perf harness (debug), simulated RTT | Lab-only; shows the mechanism works, not the user experience |
| E7 | Backend: no `compression` middleware in `main`; DB pool default max 10; TypeORM logging only in development; no slow-query logging | repository read | H8/H11 |
| E8 | Customer app: `CachedNetworkImage` in 4 files, **0** `memCacheWidth/Height`; `cacheWidth` only in the logo | repo grep | Full-size decode in lists — H4 |
| E9 | Customer app: 9 files use builder lists vs **18** files with static `ListView(children:)`; 37 `autoDispose` providers; `IndexedStack` keeps Home mounted | repo grep | H6/H7 — which of the 18 are bounded/small to be determined by audit |
| E10 | Customer `main.dart` awaits Firebase initialization (and registers the background handler) and `ThemePreferenceStorage().readThemeMode()` **before** `runApp` | repo read | Serial startup work — H5 |
| E11 | Search has a 400 ms debounce; pagination (`page`/`limit`) exists for vendors, products, loyalty | repo read | partial pagination coverage — H3/H6 |
| E12 | Driver polling 25 s (deliveries) and location 20 s; Vendor Dashboard polling 20 s; Admin operations facts polling 20 s | repo read | load/battery — H13 |
| E13 | Customer release AAB **≈ 58 MB**, versionCode 4; release signing configured; shrink/minify flags not observed in the grep | build outputs / gradle read | H14 (settings to be verified in P2) |
| E14 | Dashboard first-load JS ≈ 103 kB shared, 139–142 kB for key pages | `next build` output | within D-74 budget today; will grow with the design system — H15 |
| E15 | **No Release-mode measurement on any physical device exists** for Customer, Driver or Vendor surfaces | — | WS-P0 produces the first baseline |

### 13.3 Measurement protocol (applies to every app-performance number)

**Build modes.** *Acceptance evidence = Release builds* (exactly the artifact type shipped: Android AAB/APK installed from the signed release configuration, iOS Release/TestFlight-class build). *Profile* builds are allowed for diagnosis (Flutter timeline, widget rebuild stats) and are labelled `profile`. *Debug*, simulator/emulator and `localhost` results are labelled `lab-only` and **cannot** satisfy any P-criterion.

**Instrumentation without distorting results.** (1) Platform-level launch measurements need no app code: Android `adb shell am start -W` (TotalTime/WaitTime) + `reportFullyDrawn()` marker + `dumpsys gfxinfo` frame stats; iOS app launch time via MetricKit / Instruments App Launch template on a Release build. (2) In-app marks via the `PerfProbe` helper (build flag `PERF_PROBE`, default off in store builds) record `app.cold_start_ms`, `app.ttfmc_ms:<screen>`, request timings (HTTP interceptor), frame timing summary (`SchedulerBinding.addTimingsCallback`), memory samples. (3) **Probe-effect check (P-40):** the same scenarios run with the probe off using only platform measurements; the P90 difference must be ≤ 5%, otherwise the probe numbers are not accepted.

**Reference device classes** (concrete models chosen from what the owner supplies — U-08; class definitions are the contract):
| ID | Class | Definition |
|---|---|---|
| DV-L | Low-end Android | ≤ 3 GB RAM, entry-level SoC, Android 10–12 era, 720p–1080p panel, ≥ 3 years old |
| DV-M | Mid-range Android (reference) | 4–6 GB RAM, mid SoC, current-minus-2 Android |
| DV-I | Older iPhone | A11–A12 generation (iPhone 8/XR class) on a supported iOS |
| DV-H (optional) | Current flagship | for ceiling reference only; never used for acceptance |
Rules: device charged > 50%, thermal state nominal, storage > 20% free, background apps closed, same OS version across runs, screen brightness fixed, battery saver off, airplane mode for the network profile except the controlled interface.

**Network profiles** (shaped on the path to the *staging* environment that mirrors production topology; shaping applied at a controlled Wi-Fi access point/gateway (`tc netem` on a Linux/macOS gateway or a hardware shaper) for Android and Network Link Conditioner custom profiles for iOS; cellular tests run on a real SIM in the field as a spot check, recorded with signal strength):
| ID | Profile | RTT | Down / Up | Loss |
|---|---|---|---|---|
| N1 | Good Wi-Fi | 20 ms | 30 / 10 Mbps | 0% |
| N2 | Regular 4G (**reference**) | 70 ms | 8 / 3 Mbps | 0.5% |
| N3 | Weak 4G / good 3G | 300 ms | 1.6 / 0.75 Mbps | 2% |
| N4 | Flaky | N2 with a 5 s outage every 30 s and a 20 s total outage once per run | | |
| N5 | Offline | none | | |
Server-side time is separated from network time using `Server-Timing` (§11.1) so slow networks cannot hide server regressions and vice versa.

**Environment and data.** Staging that mirrors production topology (reverse proxy → Node → PostgreSQL → Redis, behind the same CDN class if available — otherwise the CDN effect is measured separately in production by read-only probes), loaded with the **synthetic acceptance dataset** (§15.3: ≥ 30 vendors across sectors/zones, ≥ 3,000 products, ≥ 500 offers/banners combined, realistic image set processed through the Media pipeline (sizes 100 kB–5 MB originals), 500k orders). A test customer with an address in an active zone and one with none. Production is never load-tested; read-only latency probes are allowed.

**Statistics.** Cold start: ≥ 20 runs per device × profile (kill the app and clear it from recents between runs; "cold" = process not resident; every 5th run after a device restart as "first-install-cold"). Flows: ≥ 15 runs. Report P50/P90/P95/max and the run list; discard nothing without a recorded reason (e.g., OS dialog). A criterion passes on **P90** unless stated otherwise. Server load tests: 3 × 5-minute runs at the stated concurrency after a 60-s warm-up, report P50/P95/P99, error rate, CPU, event-loop lag, pool wait.

**Scenario catalogue** (customer): SC1 cold start → first frame; SC2 cold start → TTFMC (banners and categories visible with images); SC3 Home complete (all sections); SC4 warm start; SC5 relaunch after process kill with a valid session; SC6 sector → vendor list; SC7 vendor → first products page; SC8 search → results; SC9 add to cart → cart; SC10 checkout quote; SC11 30-s Home/vendor-list scroll (jank, memory); SC12 tab switching Home→Orders→Home (request count); SC13 flaky-network Home; SC14 offline cold start; SC15 See-all list open. Driver: DC1 cold start → deliveries visible; DC2 idle online for 1 h (requests/bytes/battery); DC3 active delivery with location updates for 30 min. Vendor web: VW1 login → orders list; VW2 new-order notice latency; VW3 products page with images. Admin web: AW1…AW8 (§13.7.11).

**Reporting.** Each baseline/verification run produces `docs/performance/baselines/<yyyy-mm-dd>-<build>.md` (device, OS, build id/mode, network, dataset version, raw run table, aggregates, screenshots of traces) and appends to `docs/performance/results.csv`. Budgets live in `docs/performance/budgets.json` (D-73).

### 13.4 Metrics, baselines and target budgets
"Baseline" = the committed WS-P0 Release-mode result (`TBD-P0` until produced — **no baseline value is claimed in this document**). "Target" is the acceptance budget (D-62). Values apply to the reference device DV-M on N2 unless a column says otherwise; the DV-L and N3 columns are the second tier. Initial budgets may be tightened (never relaxed) after P0.

#### Customer app
| Metric | Definition | Baseline | Target DV-M/N2 (P90) | Target DV-L/N3 (P90) |
|---|---|---|---|---|
| Cold start to first frame | process start → first rendered frame of the shell | TBD-P0 | ≤ 2.0 s | ≤ 3.5 s |
| TTFMC (Home) | banners + categories with images visible (cold, signed-in, valid session) | TBD-P0 | ≤ 2.5 s | ≤ 5.0 s |
| Home complete | all product sections ready or in explicit error state | TBD-P0 | ≤ 4.0 s | ≤ 7.0 s |
| Warm start | resume from background → interactive | TBD-P0 | ≤ 1.0 s | ≤ 1.8 s |
| Sector → vendor list | tap → list rendered | TBD-P0 | ≤ 1.5 s | ≤ 3.0 s |
| Vendor → first products page | tap → first page rendered | TBD-P0 | ≤ 1.5 s | ≤ 3.0 s |
| Search results | last keystroke → results (after the 400 ms debounce) | TBD-P0 | ≤ 1.2 s | ≤ 2.5 s |
| API requests on cold Home | count until Home complete | ≈ 22–24 (legacy), 1 aggregate + banners/sectors/session today (to be counted in P0) | ≤ 6 (target 4) | same |
| JSON bytes on cold Home | gzip'd response bytes excluding images | TBD-P0 | ≤ 150 kB | same |
| Image bytes above the fold | bytes of images painted in the first viewport | TBD-P0 | ≤ 400 kB | same |
| Janky frames in 30-s scroll | frames > 16.7 ms (60 Hz) or > 8.3 ms (120 Hz) budget as % of frames | TBD-P0 | ≤ 5% | ≤ 10% |
| Worst frame | max frame time during scroll | TBD-P0 | ≤ 100 ms | ≤ 200 ms |
| Memory after scrolling 200 images | peak PSS (Android) / footprint (iOS) | TBD-P0 | ≤ 300 MB | ≤ 220 MB (DV-L) |
| Redundant reloads on tab switch | API calls triggered by returning to a visited tab within 60 s | TBD-P0 (suspected > 0) | 0 | 0 |
| Behaviour under N4 (flaky) | Home shows successful sections + per-section retry; no blank screen; no crash | TBD-P0 | pass | pass |
| Behaviour under N5 (offline cold start) | shows cached sectors/banners (D-65, if shipped) or a clear offline state within 2 s; no infinite spinner | TBD-P0 | pass | pass |
| Release size | AAB size | ≈ 58 MB | no growth; reduction target set after the size analysis in P2 | — |

#### API (measured server-side with Server-Timing at 20 concurrent virtual users on staging with the dataset)
| Endpoint class | Target P95 (server `total`) | Target P99 | Queries per request (uncached) | Payload gzip |
|---|---|---|---|---|
| Public catalog, cache hit | ≤ 80 ms | ≤ 200 ms | 0 | per row below |
| Public catalog, cache miss | ≤ 250 ms | ≤ 600 ms | ≤ 6 | |
| `/sectors`, `/home-banners` | (as above) | | ≤ 2 | ≤ 5 kB |
| `/home/product-sections` | hit ≤ 80 ms / miss ≤ 350 ms | ≤ 800 ms | ≤ 8 | ≤ 60 kB |
| `/vendors` page (20) | ≤ 250 ms | | ≤ 4 | ≤ 30 kB |
| `/vendor-branches/:id/products` page (20) | ≤ 250 ms | | ≤ 5 | ≤ 40 kB |
| Authenticated reads (orders list/detail, wallet, cart) | ≤ 300 ms | ≤ 700 ms | ≤ 6 / ≤ 12 detail | ≤ 25 kB list page |
| Order placement (write path) | ≤ 1.2 s | ≤ 2.5 s | n/a | |
| Admin list endpoints (typical filters) | ≤ 400 ms | ≤ 900 ms | ≤ 5 | ≤ 60 kB |
Observation to beat: Production `GET /sectors` TTFB 1.0–1.9 s (E1) — after remediation the staging server `total` must meet the table and the production-like end-to-end TTFB must be explained by RTT + `Server-Timing`.
Error budget: 0 responses 429 during a legitimate cold launch of a single device (P-43); 5xx < 0.1%.

#### Database / Redis
| Metric | Target |
|---|---|
| Slow queries (> 200 ms) per 10 k requests on the dataset | 0 for catalog endpoints; list known exceptions with plans |
| Pool wait P95 under 20 VUs | ≤ 20 ms; no pool exhaustion events |
| Seq scans on tables > 100k rows in catalog/orders endpoints | 0 (documented exceptions only) |
| Redis hit ratio on hot public reads (steady state) | ≥ 90% |
| Redis operation latency P99 | ≤ 10 ms; with Redis down: endpoints still correct and P95 ≤ 2× the uncached budget |

#### Vendor (Dashboard vendor pages) and Driver app
| Metric | Baseline | Target |
|---|---|---|
| Vendor: orders list API P95 | TBD-P0 | ≤ 300 ms |
| Vendor: new-order notice latency (placement → visible) | ≤ 20 s polling today (inferred) | P95 ≤ 25 s with change-detection polling; bytes per idle poll ≤ 1 kB (304 or tiny JSON) |
| Vendor: products page with 100 products | TBD-P0 | LCP ≤ 2.5 s; images thumbs; paginated |
| Driver: cold start → deliveries visible | TBD-P0 | DV-M ≤ 2.5 s; DV-L ≤ 4.0 s |
| Driver: requests per hour while online and idle | 144 (25 s polling) + 180 (20 s location) = ~324/h inferred | ≤ 70/h idle (adaptive + push-triggered); active delivery location cadence unchanged for accuracy but batched/skip-if-stationary |
| Driver: battery over 1 h idle online | TBD-P0 | ≤ baseline − 30% (measured with platform energy tools) |
| Driver: data per hour idle | TBD-P0 | ≤ 150 kB |

#### Admin Dashboard (reference desktop: 4-core/8 GB; tablet: iPad-class; network broadband 10 Mbps/40 ms; stress: Fast 3G)
| Metric | Target |
|---|---|
| LCP (list pages, warm API) | ≤ 2.5 s (broadband) / ≤ 4.0 s (stress) |
| INP | ≤ 200 ms |
| CLS | ≤ 0.1 |
| First-load JS per route (gzip) | ≤ 180 kB (D-74); charts/editors/cmdk/PDF preview loaded on demand |
| Route transition (client navigation, cached shell) | ≤ 300 ms P90 to skeleton, ≤ 1.0 s to data on LAN |
| Table with 100 rows render + interaction | scripting ≤ 100 ms |
| API-bound list pages (P95 incl. network) | ≤ 800 ms |
| Polling | single shared poller per data source; paused when hidden; backoff on error |

### 13.5 Bottleneck hypotheses and investigation methods
Each hypothesis is *tested in P0* and either confirmed (becomes a remediation task with its measurement), refuted (documented, no work), or marked inconclusive (instrumentation improved).
| ID | Hypothesis | How it is investigated (method / tool) | Confirmed if | Remediation if confirmed |
|---|---|---|---|---|
| H1 | Origin/path latency dominates tiny public GETs (E1/E2) | `Server-Timing` `total` vs client TTFB for the same request; TTFB from inside the staging host to localhost vs via proxy vs via CDN; `curl -w` phases (DNS, connect, TLS, TTFB); event-loop lag (`monitorEventLoopDelay`); middleware/interceptor/guard timings; throttler/Redis RTT; CPU on host (owner infra) | `total` ≪ TTFB (network/proxy) or `total` high (app) — decides branch | proxy/keep-alive/TLS config (owner U-07/infra) or app-side fixes below |
| H2 | `no-store` forces refetch of rarely-changing data on every launch (E3) | count of requests/bytes on repeated launch; header audit | requests repeat with identical bodies | D-63/D-64 (Cache-Control + ETag + client conditional cache) |
| H3 | Request fan-out on non-Home screens (vendor lists, categories, See-all) | per-scenario waterfall from `PerfProbe` + proxy log; count of requests per screen | > budget or serial dependencies | aggregate/batch endpoints or prefetch; concurrency caps; shared providers |
| H4 | Full-size decode + oversized image bytes (E4/E8) | bytes per image from network trace; decoded size vs layout size; memory/jank during scroll in Release (platform tools); `cacheWidth` audit | decoded > 2× layout or bytes > budget | D-67 (variants, immutable URLs, memCache sizes) |
| H5 | Serial/blocking startup work before first frame (E10) | Android `am start -W` + in-app marks before/after each `await`; iOS Instruments launch; startup timeline in *profile* for attribution only | pre-`runApp` work > 150 ms or first frame waits on network | parallelize/defer Firebase, FCM permission, theme preload; splash policy |
| H6 | Eager list building (18 static `ListView(children:)` files) | classify each list by max length and data source; Release scroll jank on large lists; memory | any unbounded/long list built eagerly | builder/sliver conversion + pagination |
| H7 | Provider lifecycle causes redundant reloads (37 `autoDispose`) | scenario SC12 request counts; provider create/dispose log in profile | reload on return within 60 s | `keepAlive` for session-wide data; scope autoDispose to screens; D-66 lazy tabs |
| H8 | DB inefficiencies: N+1, missing indexes, heavy joins (`hasActiveOfferForProductSql`, best-selling order SQL), pool size 10 (E7) | `EXPLAIN (ANALYZE, BUFFERS)` per catalogue query on the dataset; `pg_stat_statements`; query-count-per-request; `auto_explain` locally; pool wait metric | seq scan on > 100k rows, > query-count budget, pool waits | indexes (additive), query rewrite/projection, batching, pool tuning |
| H9 | Payload bloat (unused fields on list endpoints) | field-usage audit (response fields vs fields read by the app code); gzip'd size | unused fields > 30% of payload | list-DTO slimming (additive), detail-on-demand |
| H10 | Hot public reads uncached beyond Home | hit ratio instrumentation; query counts | cache miss rate 100% | D-69 per-domain caches |
| H11 | No origin compression matters when CDN is absent/bypassed (E7) | compare staging (no CDN) vs production sizes | large payload at origin without compression | enable `compression` (Brotli at CDN, gzip origin) after measuring CPU cost |
| H12 | Weak failure handling beyond Home (30 s timeouts, no retry, blank screens) | fault-injection runs under N4/N5; chaos switches on staging (return 500/timeout for one endpoint) | blank screen, spinner > 10 s, crash | D-71 policy + per-section errors |
| H13 | Polling cost (E12) | requests/bytes/hour from probe; battery energy tools 1 h | above targets | D-72 |
| H14 | App size/asset bloat (E13) | `flutter build appbundle --analyze-size` (diagnostic build, no store build changed), asset audit, R8/shrink flags review | large unused assets/deps | shrink resources, font subsetting, remove unused packages |
| H15 | Admin bundle/waterfall growth | `next build` report, Lighthouse CI, React Profiler, Playwright trace waterfall | budgets exceeded | code-split, prefetch, shared poller |
| H16 | Edge/CDN path: `DYNAMIC` for API; TTFB from Egypt | field RUM by network class (client telemetry), synthetic probes from the dev network; CDN analytics (U-09) | high p50 TTFB independent of origin `total` | CDN cache rules for public catalog (U-07), connection reuse |
| H17 | Image serving: daily revalidation, non-immutable names | header audit; revisit scenario (second launch bytes) | repeat downloads of unchanged images | content-addressed immutable (D-67) |
| H18 | Event-loop blocking (sync crypto, big JSON) | `monitorEventLoopDelay` P99; CPU profile (`--cpu-prof` on staging); load test | P99 lag > 50 ms | offload/chunk; cache serialized payloads |

### 13.6 Remediation catalogue (tasks; each task has dependencies, tests and a measurement)
Tasks are grouped by phase; the roadmap (separate document) orders them. A task exists in the plan only if its hypothesis is confirmed in P0, except those marked **(pre-decided)** which are required by decisions D-63…D-75 regardless.
| Phase | Task | Hyp. | Dependencies | Verification |
|---|---|---|---|---|
| P0 | P0-1 `docs/performance/` structure, `budgets.json`, results CSV | — | — | file present, schema validated by a unit test |
| P0 | P0-2 synthetic dataset generator (shared §15.3) | — | WS-1 migrations (indexes optional) | deterministic seed; counts verified |
| P0 | P0-3 backend instrumentation: `Server-Timing`, query counter, slow-query log, pool/event-loop metrics (**pre-decided**) | H1 H8 H18 | — | e2e asserts header & counters; no PII in logs |
| P0 | P0-4 client `PerfProbe` (Flutter customer/driver) with local JSON export of every run, and web-vitals reporter (Dashboard/vendor pages); the ingestion endpoint `POST /telemetry/client-metrics` and `GET /config/client` are delivered by WS-1 task T-1.9 and consumed at P7 | all | P0-3 | unit; debug-tag exclusion test (e2e once T-1.9 lands) |
| P0 | P0-5 device lab and network-shaping runbook (devices U-08) | — | owner | runbook executed once, result attached |
| P0 | P0-6 scenario scripts (UI Automator/XCUITest/adb for apps; Playwright for web) and server load scripts | — | P0-2 P0-4 | scripts run end-to-end on a Release build |
| P0 | P0-7 **baseline report** (all scenarios × DV-L/DV-M/DV-I × N1–N5; server baselines) and hypothesis verdicts | all | P0-1…6 | report committed; each H marked confirmed/refuted/inconclusive; P-01 |
| P1 | P1-1 public HTTP caching headers + ETag (**pre-decided**, D-63) | H2 | P0-3 | e2e headers; 304 path; authenticated endpoints still `no-store` |
| P1 | P1-2 per-domain Redis caches & epochs for sectors, banners, vendors, branch detail, first product pages, categories (D-69) | H10 | WS-0 pattern | e2e invalidation matrix; outage test |
| P1 | P1-3 query optimization (per confirmed H8): indexes, N+1 removal, projections; additive migrations | H8 | P0-7 | EXPLAIN before/after; query-count budget in e2e |
| P1 | P1-4 payload slimming with additive list DTOs | H9 | P0-7 | payload budget tests |
| P1 | P1-5 pool/timeouts/compression decisions | H8 H11 H18 | P0-7 | load test before/after |
| P1 | P1-6 operations-facts 10-s cache with single-flight | H13 | — | e2e |
| P1 | P1-7 throttling policy review: legitimate launches never 429 (P-43) | H3 | — | load test with 40 clients/IP class |
| P2 | P2-1 startup path: parallelize/defer non-critical init; preload theme synchronously; splash policy | H5 | P0-7 | SC1/SC2 vs baseline |
| P2 | P2-2 conditional HTTP cache + in-flight dedupe + cancel on exit (**pre-decided**, D-64) | H2 H3 | P1-1 | request-count tests |
| P2 | P2-3 disk cache for sectors/banners (D-65, **GATE**: ships only if TTFMC improves) | H2 | P2-2 | SC2/SC14 A/B |
| P2 | P2-4 lazy tab construction with state preservation (D-66) | H7 | P0-7 | SC12 = 0 reloads |
| P2 | P2-5 list conversion to builders/slivers where lists are dynamic or unbounded | H6 | audit | jank budget; widget tests |
| P2 | P2-6 pagination/infinite scroll on remaining unbounded lists; prefetch threshold | H3 H6 | P1-4 | tests with 1,000-item fixtures |
| P2 | P2-7 image policy: sized decode (`memCacheWidth/Height` from layout×DPR), stable cache keys, no layout shift, above-the-fold precache | H4 | P3-1 (thumbs) | SC11 memory/jank; golden tests |
| P2 | P2-8 network policy (D-71): timeouts, single jittered GET retry, offline banner | H12 | — | fault-injection tests |
| P2 | P2-9 per-section partial-failure UI across screens (generalize `HomeSectionError`) | H12 | — | widget tests |
| P2 | P2-10 provider lifecycle review (`keepAlive` set) | H7 | P0-7 | SC12 |
| P2 | P2-11 rebuild minimization (`select`, const, RepaintBoundary where measured) | H6 | P0-7 | frame timing |
| P2 | P2-12 size reduction (D-75) | H14 | P0-7 | size report |
| P2 | P2-13 Release-mode verification run on the device lab vs baseline | all | P2-1…12 | P-06…P-21 |
| P3 | P3-1 additive `thumbnailUrl`/`images[]` in Customer API (from variants) | H4 | WS-3 pipeline | e2e contract |
| P3 | P3-2 backfill of legacy images (variants beside originals) | H4 H17 | WS-3 | job tests |
| P3 | P3-3 immutable cache headers for content-addressed keys (**pre-decided**) | H17 | WS-3 | header e2e |
| P3 | P3-4 adoption in Dashboard/vendor pages (thumbs in lists) | H4 | P3-1 | bundle/LCP |
| P5 | P5-1 vendor orders change detection (`/vendor/orders/changes`, ETag/304), visibility pause, backoff (D-72) | H13 | — | request/byte budgets |
| P5 | P5-2 vendor products page: pagination + thumbs | H4 H6 | P3-1 | LCP |
| P5 | P5-3 Driver app: startup, adaptive polling, push-triggered refresh, conditional GET, batched location | H5 H13 | P1-1 | requests/h, battery, startup |
| P5 | P5-4 Driver battery/data 1-h test on DV-L/DV-M | H13 | P5-3 | P-31, P-32 |
| P6 | P6-1 bundle budget enforcement; code-split charts/editors/cmdk/PDF preview | H15 | WS-2 | CI bundle check |
| P6 | P6-2 SWR cache/dedupe/prefetch-on-hover; shared poller | H15 | WS-2 | Playwright traces |
| P6 | P6-3 self-hosted subset fonts incl. Arabic, `font-display: swap` | H15 | WS-2 | LCP/CLS |
| P6 | P6-4 web-vitals field reporting to telemetry | — | P0-4 | data visible in SYS-06 |
| P7 | P7-1 performance pages (SYS-04/05/06) fed by real telemetry | — | WS-10 | M15 |
| P7 | P7-2 CI gates (D-73): query-count + payload budgets per PR; bundle budget per PR | — | P0-1 | CI fails on regression (proved by a deliberately regressing branch in the pipeline test) |
| P7 | P7-3 nightly seeded-dataset latency job and trend | — | P0-2 | report artifact |
| P7 | P7-4 release-candidate device-lab protocol & checklist | — | P0-5 | executed once per RC |
| P7 | P7-5 production alerting on client telemetry regressions (TTFMC P90 week-over-week +15% → alert) | — | P7-1 | alert rule test |

### 13.7 Per-surface specifications

#### 13.7.1 Customer app startup and first meaningful content
* Target sequence (cold): native splash → Dart `main()` → **no network or plugin initialization on the critical path** other than what the first frame needs → shell + Home skeleton → banners/sectors from the conditional cache or network → TTFMC. Firebase init, notification permission prompts, FCM token registration, analytics-style work move after first frame (post-frame callback) or run in parallel and never block `runApp`; the background message handler registration stays at isolate start as Firebase requires.
* Theme and locale are read through a synchronously available preloaded value (a tiny preferences read started before `runApp` and awaited only if it completes within the splash window; otherwise default then update without flash — flash avoided by matching the splash theme to the system theme).
* Session restore does not block the first frame; Home renders public content while the session validates.
* Measurements: SC1, SC2, SC4, SC5, SC14; instrumentation marks: `main_enter`, `first_frame`, `home_skeleton`, `banners_visible`, `categories_visible`, `ttfmc`.

#### 13.7.2 Home screen and independent section loading
* Sections load independently (banners, categories, product sections); a failing section shows its own retry card without blocking others (already true for product sections; verified for banners/categories in P0).
* Above-the-fold priority: banners + categories requested first; below-the-fold product sections requested when the aggregate returns or when scrolled near (whichever the P0 data shows to be faster; **no change if the single aggregate already meets TTFMC/Home-complete budgets**).
* Zone parameter per D-50; See-all unchanged per D-51 (its waterfall measured in P0 and treated like any other list in §13.7.8).
* Image placeholders reserve layout (no jumping); first banner image `precache`d.

#### 13.7.3 API latency, request count and payload size
* Budgets in §13.4; every endpoint exposes `Server-Timing`; e2e budgets assert **query count** and **payload size** for the catalogue of hot endpoints (versioned in `budgets.json`).
* Request-count budget enforced per screen scenario by the probe in P0/P2 verification (not in CI).
* HTTP caching for public endpoints per D-63; conditional requests per D-64. Authenticated/personalized responses remain `no-store`/`private`.
* List endpoints return list-DTOs (id, name, price, thumbnail, flags); heavy fields (descriptions, option groups) only in detail DTOs — additive, old fields remain until the oldest supported app build no longer needs them (removal is out of scope).

#### 13.7.4 Backend and database
* Evidence-driven (D-68): P0-3 instrumentation → hypotheses H1, H8, H18 tested → fixes P1-3/P1-5.
* Candidate areas to inspect first (not conclusions): global interceptor/guard chain cost per request (audit interceptor on reads, throttler store round trips), vendor list query (ratings aggregation, active-offer detection, delivery-zone filtering), best-selling ordering SQL over `order_items`, product list joins with option groups, per-request repeated permission/user lookups, TypeORM hydration of unused relations.
* Pool: `DB_POOL_MAX` evaluated against core count and observed pool-wait; no change without data. Timeouts: statement timeout for public endpoints (`PUBLIC_STATEMENT_TIMEOUT_MS`, default 5 s) so a bad query cannot starve the pool.
* Migrations for indexes are additive and `CONCURRENTLY` (D-09) and shared with §7.7.

#### 13.7.5 Image delivery, optimization and caching
* Pipeline and variants: §6. API additive fields (`thumbnailUrl`, `images[]`). Content-addressed keys → `immutable` caching (revisit launches transfer 0 bytes for unchanged images).
* Client: request `thumb` for cards/lists, `display` for detail/banners as sized; decode at layout size × DPR (`memCacheWidth/Height`); stable image cache key = storage key (not the signed URL) so signed-URL refreshes do not invalidate the cache; disk cache limits (e.g., 150 MB, 14-day stale period) set by P0 data; low-end devices (DV-L class derived on device) disable fade-in animations and lower `FilterQuality`.
* Legacy images: until backfilled, the app falls back to the original URL but still decodes at layout size.
* Verification: bytes above the fold, memory after 200 images, revisit bytes = 0, first image paint times (`image.load_ms`).

#### 13.7.6 Redis caching and invalidation
* Pattern (from WS-0): key = `domain:version:epoch:params-hash`; **epoch** per domain (`home`, `sectors`, `banners`, `vendors`, `catalog`) bumped by the existing interceptor after successful admin/vendor mutations of the relevant entities (and by order placement for stock-sensitive domains if P0 shows staleness issues); single-flight + NX lock; per-command timeout 250 ms; 15-s circuit; TTL short (30–60 s default, setting) because epoch handles correctness and TTL bounds the rest.
* Never cached: carts, wallet, orders, prices in checkout quote, anything user-specific, anything money-final.
* Correctness tests: invalidation matrix (each admin/vendor mutation that changes a cached view → the next read reflects it within 1 request), stampede test (100 concurrent misses → 1 DB execution), Redis-down test (correct, within 2× uncached budget), key-space test (no unbounded keys: params whitelisted and hashed).
* Observability: hit/miss/bypass/circuit counters per domain (§11.1), shown in SYS-05.

#### 13.7.7 Navigation state preservation and redundant reloads
* Tabs are constructed lazily on first visit, then kept alive (D-66) with scroll positions preserved; going back from detail screens returns to the same scroll offset and loaded pages; screen-scoped providers dispose, session-wide data (sectors, banners, user, cart, addresses) is kept for the session with a freshness window (60 s) after which a revalidation (conditional request) happens in the background without a spinner.
* Rule: returning to a visited screen within 60 s triggers **zero** blocking loads; at most one background conditional revalidation per data source.
* Verification: SC12, widget tests that count provider creations, e2e of back-stack scroll restoration.

#### 13.7.8 Pagination and lazy loading
* Every list that can exceed 30 items is paginated server-side (page size 20 for product/vendor lists, 20 orders, 30 notifications) with a prefetch threshold of 5 items from the end and end-of-list state; lists render through builders/slivers; image-heavy lists use `thumb` only.
* Pagination state survives navigation (D-66). Pull-to-refresh resets to page 1.
* Verification: fixtures of 1,000 items produce ≤ 2 page loads on initial display and constant memory growth per page; no `ListView(children:)` over unbounded data (lint check via a custom analyzer test that scans for the pattern on allow-listed files, P-19).

#### 13.7.9 Network resilience and partial failures
* Policy D-71: connect 5 s, receive 15 s (GET), one jittered retry (200–600 ms) for idempotent GET on network errors/5xx (not 4xx), no automatic write retries, `Idempotency-Key` where the app intentionally retries writes (checkout), cancellation on screen exit.
* UI: per-section errors with retry; global offline banner; stale data kept visible with an "updating" indicator rather than replaced by a spinner; optimistic UI only for favourites.
* Chaos verification (staging switches `CHAOS_FAIL_ROUTE_PATTERN`, `CHAOS_LATENCY_MS`, enabled only outside production by environment check): scenarios SC13/SC14 under N4/N5 and per-endpoint failure injection; acceptance P-20, P-21.

#### 13.7.10 Vendor and Driver performance
* **Vendor (web, Dashboard vendor pages):** orders feed uses the change-detection endpoint (`GET /vendor/orders/changes?since=<cursor>` returns `{cursor, newOrderIds[], changedSegmentIds[]}` with ETag/304); the full list refetch happens only when something changed; polling interval 15 s visible / paused hidden / backoff on error / immediate refetch on tab focus; optional Web Push is **not** in scope (no provider verified). Products page: pagination (50), thumbnails, virtualized table only if > 200 rows are ever rendered (server pagination prevents it).
* **Driver (Flutter):** FCM data message triggers a deliveries refresh (push-triggered, FCM integrated); fallback polling adaptive: active delivery 15 s, online idle 60 s, background/offline none; `GET /driver/deliveries` supports ETag/304; location: 20 s cadence during an active delivery retained; idle-online cadence 60 s and skipped when stationary (< 20 m movement) with a heartbeat every 120 s; batched upload via `POST /driver/location/batch` when the network is poor (≤ 20 points); startup path audit like §13.7.1.
* Verification: DC1, DC2, DC3; request/byte counts from the probe; battery via platform energy tools; regression: dispatch still sees location freshness ≤ 90 s for online drivers.

#### 13.7.11 Admin Dashboard performance
* Budgets §13.4. The design system (WS-2) is built to them: dynamic imports for charts/cmdk/media crop/PDF preview; icon tree-shaking; self-hosted subset fonts (Latin + Arabic) with `font-display: swap`; no client-side waterfalls (parallel SWR hooks, prefetch on hover/focus for row → detail); shared poller; server pagination so tables never render > 100 rows; skeletons reserve space (CLS).
* Scenarios AW1 login → control tower; AW2 orders list filter → detail; AW3 customers → 360; AW4 report runner preview; AW5 media library grid (thumbs); AW6 finance ledger scroll; AW7 settings; AW8 route transitions between five pages. Measured with Lighthouse CI (lab) + Playwright traces and field web-vitals telemetry.

### 13.8 Production-like monitoring (links to §11)
Server request/DB/cache/job metrics and client telemetry feed SYS-04…06; budgets from `budgets.json` define threshold lines; client telemetry segments by `buildMode`, platform, deviceClass, network, app version. Alert rules: API P95 over budget 10 min; cache hit ratio < 60% for 15 min; pool wait P95 > 100 ms; client TTFMC P90 +15% vs trailing 7-day baseline (min sample size 200); image failure rate > 2%. **No fabricated values**: dimensions without data show "no data".

### 13.9 Performance regression tests and gates (D-73)
| Gate | Where | What fails the build |
|---|---|---|
| Query-count & payload budgets | backend e2e (every PR) | any hot endpoint exceeding its budget in `budgets.json` |
| Cache correctness suite | backend e2e | stale read after mutation, stampede, outage |
| Header contract | backend e2e | public endpoint missing `Cache-Control`/`ETag` per D-63, or authenticated endpoint cacheable |
| Dashboard bundle budget | CI (`next build` size check) | route > 180 kB gzip |
| Lighthouse CI (lab) | nightly + release candidate | LCP/CLS/INP regression > 10% vs trailing median |
| Seeded-dataset latency | nightly | P95 over budget for 2 consecutive nights |
| Flutter unit/widget budgets | PR | request counts per provider test, list-pattern lint, image size parameters present |
| Device-lab Release run | per release candidate (manual-triggered, scripted) | any P-criterion over budget on DV-M/N2 (DV-L/N3 second tier) |
| App size | per release candidate | growth > 2% without justification |
CI gates are built in P7-2; the rest are checklists in the release protocol (P7-4). Nightly timing jobs never block PRs (noise); they open an alert/ticket.

### 13.10 Dependencies of WS-P
WS-0 (Home pattern, closure), WS-1 (migrations/indexes/jobs/config/telemetry tables), WS-3 (variants, immutable keys, backfill), WS-4 (report indexes, export isolation test), WS-10 (monitoring pages), owner items U-07, U-08, U-09. WS-P0 may start immediately after WS-1's instrumentation tasks; its Release-mode baseline needs devices (U-08) — everything else proceeds without them and is labelled lab-only.

### 13.11 Acceptance
P-01…P-44 in the Acceptance Matrix; the workstream is complete only when every P-criterion passes **on Release builds on the reference devices** with evidence committed under `docs/performance/baselines/`.

---
## 14. Technical architecture and dependency register

### 14.1 Target architecture (additions only; nothing is replaced)
```
Dashboard (Next.js 15)                      Customer / Driver apps (Flutter)
 ui/* design system  features/<module>/*      PerfProbe, conditional HTTP cache,
 SWR hooks · MediaPicker · charts             inbox, lazy tabs, thumbnails
          │ cookie session + CSRF (unchanged)            │ bearer (unchanged)
          ▼                                              ▼
 NestJS API ── modules (existing) + NEW: reporting · media · finance-definitions · campaigns/broadcasts ·
               system-monitoring · permission-templates · jobs · telemetry · perf (Server-Timing, cache headers)
          │  PostgreSQL (source of truth: data, jobs, exports meta, media meta, metrics buckets)
          │  Redis (optional: caches, locks, rate limits)
          │  Object storage (existing providers: local fs | S3-compatible): media/, exports/ (private)
          │  Worker loop (in-process, DB-backed): REPORT_EXPORT · MEDIA_* · CAMPAIGN_* · BROADCAST_SEND · METRIC_ROLLUP · INTEGRATION_PROBE
```
Modules are added under `apps/backend/src/modules/` following the existing module/DTO/controller/service/spec layout. Shared kernel additions (WS-1): `ReportingClock`, `FinanceDefinitions`, `PermissionRegistry`, `JobsModule`, `IdempotencyService`, `ServerTimingInterceptor`, `CacheHeadersInterceptor`, `MetricsModule`.

### 14.2 New dependency register
"Verify at install time" means: the check is performed when the owning workstream starts (this specification could not audit the registry or the dependency's current maintenance state); the result is recorded in the workstream report; a failed check triggers the listed alternative via a change request.

| Dependency | Where | Purpose | Alternatives considered | Why this | Install-time checks | Bundle/runtime impact | Removal path |
|---|---|---|---|---|---|---|---|
| **sharp** | backend | decode/orient/strip/resize/encode WebP, pixel limits | jimp (pure JS, slow), `@squoosh/lib` (unmaintained), ImageMagick CLI (process spawning, policy risk) | native libvips speed, memory-safe limits (`limitInputPixels`), orientation + metadata control | prebuilt binary for the Docker base image (linux glibc/musl as used), Node 22 compatibility, licence (Apache-2.0 + libvips LGPL notes), `npm audit`, install in CI image without compilers | runtime only; no client bundle | replace behind `ImageProcessor` interface (single file) |
| **puppeteer-core** (+ system Chromium) | backend worker | PDF from HTML with Arabic shaping | pdfmake, `@react-pdf/renderer`, wkhtmltopdf (unmaintained) | correct bidi/shaping via the browser engine | **GATE S-PDF**; Chromium in the worker image (U-05); sandbox flags; memory per render; Node 22 compat; audit | worker image size increase (recorded); isolated worker concurrency 1 | fall back to pdfmake with embedded font + pre-shaping, re-validated on S-PDF |
| **xlsx (SheetJS)** | backend | XLSX/CSV writing (already used for import) | exceljs | already present; no new dependency | keep the CDN tarball pinned with checksum; confirm write-path features used (styles limited) | none new | exceljs behind `WorkbookWriter` interface |
| @radix-ui/react-* (dialog, popover, dropdown-menu, tabs, tooltip, select, checkbox, switch, radio-group, accordion, toast) | dashboard | accessible primitives | headless-ui, Ariakit, hand-rolled | mature a11y/focus management, tree-shakable, RTL aware | React 18/Next 15.5 compat, licence MIT, audit, per-package size | each ≤ ~10 kB gzip, imported per primitive | primitives are wrapped in `ui/*` so replacement is local |
| **cmdk** | dashboard | command palette | kbar | small, accessible | compat, audit | ~5 kB, lazy loaded | local |
| **@tanstack/react-table** | dashboard | headless table | AG Grid, MUI DataGrid | headless, no styling lock-in, no paid tier | compat, audit | ~14 kB | local (`DataTable` wrapper) |
| **react-hook-form**, **zod**, **@hookform/resolvers** | dashboard | forms + schema validation mirroring DTOs | formik+yup | performance, small | compat, audit | ~25 kB total, per-route | local |
| **recharts** | dashboard | charts (line/area/bar/donut/funnel) | visx, chart.js, ECharts | declarative SVG, accessible markup possible, React-native | React 18 compat, audit, tree-shake behaviour measured against the bundle budget | lazy-loaded chunk (budgeted ≤ 90 kB gzip, only on chart pages) | `ChartFrame` wrapper |
| **react-easy-crop** | dashboard | crop/zoom/rotate with fixed aspect | cropperjs, hand-written canvas | simple fixed-aspect API | compat, audit, touch + RTL behaviour test | ~8 kB lazy | local |
| lucide-react (or equivalent) | dashboard | icon set, tree-shaken | heroicons | per-icon imports | licence, audit | per-icon | local |
| **web-vitals** | dashboard | field LCP/INP/CLS to telemetry | none needed | official small library | audit | ~2 kB | local |
| **@axe-core/playwright** | dashboard (dev) | accessibility scans | pa11y | integrates with existing Playwright | audit | dev only | — |
| **@lhci/cli** (Lighthouse CI) | CI (dev) | lab performance budgets | WebPageTest | scriptable | Chrome availability in CI | dev only | — |
| autocannon **or** k6 (external binary) | perf tooling | server load tests | existing `home-sections-bench.mjs` pattern | verify availability; prefer no new runtime dependency (script-only) | licence | dev only | — |
| Flutter: none required for batching/dedupe | customer/driver | conditional HTTP cache, dedupe, probe — implemented on the **existing HTTP client** (confirmed at the start of WS-P2) | `dio_cache_interceptor` | avoid dependency if the client supports interceptors; if a package is adopted, same checks | audit, licence, null-safety, SDK constraints | small | local |
| Flutter: file cache for sectors/banners | customer | JSON files via the already-present path provider (if present) | sqflite/drift, hive | minimal | confirm availability | tiny | local |

**Job runner decision (D-07) — evaluation.** DB-backed `background_jobs` vs BullMQ (Redis) vs pg-boss (Postgres library):
| Criterion | DB-backed (chosen) | BullMQ | pg-boss |
|---|---|---|---|
| Survives Redis loss | yes | no (Redis is optional by design, e2e 98) | yes |
| New dependency | none | yes + Redis persistence requirements | yes |
| Transactional enqueue with business write | yes | no | yes |
| Throughput needed (admin-scale: exports, media, broadcasts; peak ~ hundreds/hour; broadcast batches of 200) | sufficient | high | sufficient |
| Observability in Dashboard | own table (simple) | requires adapter | own tables |
| Operational risk | lowest | Redis memory/eviction policy interplay with caches | maturity/version fit **not verifiable here** |
Re-evaluate only if queue-wait P95 > 60 s at expected load (D-07).

**Existing storage.** Reused unchanged: local-filesystem and S3-compatible providers, byte-based validation, private-media redirect, signed URLs, concurrency limiter, rate-limit policies. No storage configuration is changed by this plan.

### 14.3 Configuration additions (all optional with safe defaults; validated by the existing config schema)
`REPORTING_TIMEZONE, REPORTING_WEEK_START, REPORT_STATEMENT_TIMEOUT_MS, REPORT_EXPORT_MAX_ROWS, EXPORT_RETENTION_HOURS, JOBS_WORKER_ENABLED, JOBS_CONCURRENCY_*, MEDIA_KEEP_ORIGINAL, MEDIA_SHARP_THREADS, MEDIA_RETENTION_DAYS, PRODUCT_MAX_IMAGES, PUBLIC_CATALOG_CACHE_SECONDS, PUBLIC_CATALOG_SWR_SECONDS, PUBLIC_STATEMENT_TIMEOUT_MS, SERVER_TIMING_ENABLED, SLOW_QUERY_MS, DB_POOL_MAX, CLIENT_TELEMETRY_SAMPLE_RATE, BROADCAST_QUIET_HOURS, BROADCAST_MAX_PER_CUSTOMER_PER_DAY, WALLET_ADJUSTMENT_MAX_MINOR, WALLET_ADJUSTMENT_APPROVAL_THRESHOLD_MINOR, SETTLEMENT_PAYMENT_APPROVAL_THRESHOLD_MINOR, LOW_STOCK_THRESHOLD, FEATURE_*`. Sensitive-environment variables are not added; no secret is introduced.

---

## 15. Test strategy

### 15.1 Layers and tools (existing tooling reused)
| Layer | Tool | Scope |
|---|---|---|
| Backend unit | Jest | pure functions: formulas (§8), clock, policies, state machines, validators, formatters, masking |
| Backend integration | Jest + real PostgreSQL (existing disposable DB harness) | migrations up/down, constraints, SQL correctness, concurrency, job lifecycle, sharp pipeline fixtures |
| Backend e2e | supertest (existing world incl. Redis) | endpoint contracts, permission matrix, audit, idempotency, cache headers, route inventory (99) |
| Dashboard unit | existing runner | components, hooks, formatters, i18n parity, lint rules |
| Playwright | existing fixtures | journeys per module, RTL, a11y (axe), responsive viewports |
| Flutter | `flutter test`, `integration_test` (profile for diagnosis) | providers, widgets, cache logic, inbox; Release acceptance via the device-lab protocol (§13.3) |
| Performance | scripts in `apps/backend/test/perf`, Lighthouse CI, device lab | §13.9 |
| Security | e2e abuse cases, dependency audit, upload fuzz fixtures | §6.12, §9 |

### 15.2 Mandatory test categories per workstream (the Definition-of-Done checklist uses these)
1. New routes: permission matrix test (allowed, forbidden, unauthenticated), route-inventory entry. 2. Validation: boundary and malformed input. 3. Idempotency for retryable writes. 4. Audit assertion for every mutation. 5. Concurrency for money/state changes. 6. Migration up/down + backward compatibility (old code on new schema). 7. Compatibility of unchanged endpoints (snapshot of existing responses). 8. Masking. 9. Dashboard: AR/EN key parity, RTL screenshot, axe, responsive viewports. 10. Performance budgets of the touched endpoints. 11. Regression gate: full backend unit + e2e + integration, dashboard build + unit + Playwright, affected Flutter suites — all at baseline or better.

### 15.3 Synthetic acceptance dataset (deterministic; created by a script in `apps/backend/test/data`, **never run against Production**)
Parameters (seeded RNG): 40 vendors / 80 branches across 6 sectors and 5 zones; 4,000 products with 1–3 images (generated procedural images run through the Media pipeline); 600 offers/coupons/banners combined; 120 drivers; 20,000 customers; **500,000 orders** over 24 months with realistic status mix (86% delivered, 8% cancelled, 3% partially rejected, 3% in flight), multi-vendor segments, all payment methods, refunds recorded/sent, Hatly-funded discounts with restorations, 2,000,000 financial events, 1,000,000 wallet transactions, settlement periods closed per branch/driver for 24 months with a mix of paid/partial/unpaid payments, 200 audit rows per admin-day for 5 admins. The generator emits a **manifest of expected aggregates** (totals per month, per vendor, outstanding refunds…) computed independently from the generation logic, used by reconciliation tests. Size knob (`--scale 0.01…1`) so CI uses 1% and nightly uses 100%.

### 15.4 Regression baselines
The known green baselines (backend unit/e2e/integration counts, Flutter totals, Playwright counts, dashboard build) recorded in the project's test-infrastructure notes and `LAUNCH_PROGRESS` are the starting point; every workstream gate compares against them (no weakened or deleted tests; new failures block).

---

## 16. Traceability and document control

### 16.1 Module → workstream → acceptance
| Module | Primary workstream(s) | Acceptance family |
|---|---|---|
| 1 Executive Control Tower | WS-6 (+WS-4, WS-5, WS-P1) | M01 |
| 2 Order Management | WS-6 | M02 |
| 3 Marketplace | WS-7 | M03 |
| 4 Vendor & Branch | WS-7 | M04 |
| 5 Product & Inventory | WS-7 (+WS-3) | M05 |
| 6 Delivery & Fleet | WS-8 | M06 |
| 7 Customer Management | WS-9 | M07 |
| 8 Finance & Accounting | WS-5 | M08 |
| 9 Payments/Refunds/Settlements | WS-5 | M09 |
| 10 Marketing & Growth | WS-9 | M10 |
| 11 Coupons/Promotions/Campaigns | WS-9 | M11 |
| 12 Reports & Analytics | WS-4 | M12 |
| 13 Media Management | WS-3 | M13 |
| 14 Admin Users/RBAC/Audit | WS-1, WS-10 | M14 |
| 15 System Monitoring | WS-10 (+WS-P7) | M15 |
| 16 Platform Configuration | WS-10 | M16 |
| Design system & shell | WS-2 | G-01…G-20 |
| Home aggregation | WS-0 | G-30…G-36 |
| Performance engineering | WS-P (P0…P7) | P-01…P-44 |

### 16.2 Glossary
**TTFMC** time to first meaningful content (banners + categories with images). **Release-mode** the production-built artifact. **Lab-only** non-acceptance evidence. **Four-eyes** creator ≠ approver. **Epoch** monotonically bumped cache version. **GATE** decided item that must pass a stated verification before adoption. **Recorded vs sent** obligation created vs money actually sent.

### 16.3 Change control
This specification changes only through a change request that edits the Decision Register first, then this document, then the dependent documents in the order API plan → roadmap → acceptance matrix, keeping identifiers stable (IDs are never reused).

---
*End of Final Master Implementation Specification.*

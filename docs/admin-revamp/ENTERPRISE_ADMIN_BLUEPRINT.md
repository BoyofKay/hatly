# Hatly Enterprise Admin — Master Audit & Product Blueprint

**Status:** audit only — nothing was implemented, migrated, deployed or committed. **Date:** 2026-10-30. **Awaiting:** owner review and approval before any implementation is prepared.
**Method:** every statement below comes from reading the repository (route inventory parsed from all `*.controller.ts`; Dashboard pages, libraries and components read; storage/upload/finance/audit modules read; tests counted). Where something is an inference or needs a live check it is marked **[verify]**. Counts from the route parser are heuristic (±a few) and are labelled "≈".

---

## 1. Executive summary

**What exists.** Hatly is a mature, well-tested transactional platform: NestJS backend (≈48k lines, 62 entities, 65 migrations, ≈253 routes, 33 permissions, 159 unit + 69 e2e + 25 integration spec files), a Customer Flutter app (≈31.6k lines, 707 localized strings, ≈100 test files), a thin Driver app (≈2.3k lines), and a Next.js Dashboard (≈15k lines, 28 admin pages + 3 vendor pages, 30 Playwright specs). Orders, multi-vendor segments, wallet/transfer/COD money, refunds, offers/coupons, dispatch, settlements, Hatly/Wasally services, delivery zones, MFA'd dashboard sessions and an admin audit log are real and tested.

**What the Admin Dashboard is today.** A *set of operational forms*, not a control platform: a flat 24-link top bar, no permission-aware navigation, no shared design system (11 small components; Tailwind utility classes per page), no table/filter/pagination/chart/export components, no dashboards or KPIs beyond the Control Tower counters, English-only except four pages, no dark mode, no responsive strategy beyond defaults.

**The three decisive findings**
1. **There is almost no reporting or export.** The permission `VIEW_REPORTS` exists but is **referenced by no endpoint**. The only file formats handled anywhere are product-import `.xlsx` (in) and an import template (out). There is no sales/finance/driver/vendor report, no CSV/Excel/PDF export, no job queue, no list endpoint for financial events or settlement history, and `orders` / `financial_events` lack date-range indexes. Reports are therefore **mostly new backend work**, built on data that *is* already recorded (order/segment/status events, financial events, payments, refund payouts, offer consumptions, deliveries).
2. **Image handling is the most structurally incomplete area.** Uploads are base64-in-JSON (customers/drivers) plus four multipart endpoints (vendor logo, vendor product image, home banner image, Excel import). There is **no image library** (no `sharp`), no resizing, thumbnails, WebP conversion, dimensions metadata, media library, reuse or delete; the `uploads` table stores only `url` + uploader. Sectors, subcategories, admin-created products, catalog products and categories accept an **external/plain `imageUrl` string**, and the admin vendor page still shows a logo-URL text box beside the upload button. The owner's "direct upload everywhere" requirement needs a **new Media module**, but the storage providers (local filesystem, S3-compatible, with signed URLs, keys, validation, rate limits and tests) are reusable as-is.
3. **Roughly half of what the backend can do for admins has no screen.** Of ≈253 routes, ≈128 are called by the Dashboard; of the ≈125 that are not, 44 are admin/vendor routes — including the whole subcategory admin, the master **catalog-products** admin (listings between a catalog product and vendor products), per-branch/driver **commission rates**, delivery-zone/sector/banner **activate/deactivate**, Hatly-service pricing config, MFA reset, and order lookup by number. These are "backend exists, Admin controls missing" and are cheap wins for the revamp.

**Strengths to protect.** Money logic is centralized and idempotent (financial events, refund payouts, compensation events); admin mutations are audited globally; a route-authorization inventory test (`99`) and an admin-mutation audit test (`94`) exist; MFA, CSRF, session cookies and rate limits are implemented; Redis is already optional-by-design (`98-redis-outage`). The revamp must reuse these, not re-derive them in the UI.

**Recommended shape.** One *Admin Platform* with a real design system, permission-aware navigation (16 modules → ≈70 pages), a shared data-table/filter/export layer, a Media Library, and a Reporting service (read-optimized queries + async export jobs). ≈10 workstreams (§15), the first being the design system + navigation shell + Media + Reporting foundations, because every other module consumes them.

**Pending prior work.** The Home Aggregation API (`GET /home/product-sections`) is implemented locally and partially verified; it is part of this audit (§8 of Section 14 and §15 WS-0) with a safe completion plan.

---

## 2. Complete feature coverage matrix

Legend — **Backend / Customer / Driver / Vendor-DB / Admin-DB**: ✔ complete, ◐ partial, — absent. **Class**: C = Complete · P = Partially implemented · B = Backend only · A = Available in another app but missing Admin controls · N = Not implemented · X = Implemented but not working · V = Requires verification.

| # | Feature | Backend (routes / evidence) | Cust | Drv | Vend | Admin | Permission | Tests | Class / gap |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Order lifecycle + segments + partial rejection | `orders`, segment state machine, refunds, events | ✔ | ◐ | ✔ | ◐ (search, detail, on-behalf actions) | VIEW_ORDERS, MANAGE_ORDER_FULFILMENT | unit + e2e 60–66, 113, 114 | **P** — Admin cannot cancel / change order status from the UI (`PATCH /orders/:id/status` is not called by Admin; only COLLECTED). No order timeline filters, bulk actions, notes. |
| 2 | Order search / detail | `GET /admin/orders`, `/:id`, `/by-number/:n` | — | — | — | ✔ search+detail | VIEW_ORDERS | e2e 96, PW | **C** (by-number unused) |
| 3 | Dispatch & fleet ops | `delivery`: assign/reassign, alerts, control-tower summary/deliveries/drivers | — | ◐ | — | ✔ Control Tower, alerts, drivers | ASSIGN_REASSIGN_ORDERS, MANAGE_DRIVERS | unit + e2e 70, 83, 84, 86 | **C/P** — `/dispatch` page is a 23-line redirect; no map, no driver detail/earnings/history page |
| 4 | Drivers | `admin/drivers` (create, verify, vehicle type, list), commission rate | — | login, deliveries, online, location | — | ◐ list/verify/vehicle | MANAGE_DRIVERS, MANAGE_DRIVER_COMMISSION | e2e 70, 84 | **A/P** — commission-rate UI absent; no performance/earnings/documents; **Driver app Earnings & Profile features are empty directories** |
| 5 | Failed deliveries & resolution/refund | `failed-delivery-resolution` | ◐ | ✔ report | — | ✔ | MANAGE_ORDER_ISSUES | e2e 85 | **C** |
| 6 | Manual-transfer verification + refunds-to-send | `payments` | ✔ claim | — | — | ✔ | VERIFY_MANUAL_PAYMENTS | e2e 67, 113 | **C** (no payment/refund history list, no search) |
| 7 | Wallet | customer wallet + ledger; admin credit only via cash-remainder approve | ✔ | — | — | ◐ | MANAGE_CUSTOMER_WALLET | e2e 66, 67 | **P** — no admin wallet view/adjust/credit with reason; no customer ledger in Admin **[verify customer detail content]** |
| 8 | Cash remainders | `driver-cash-remainder` | — | ✔ | — | ✔ list/approve/reject | MANAGE_CUSTOMER_WALLET | e2e 85 | **C** |
| 9 | Customers | `GET /admin/customers`, detail | ✔ | — | — | ◐ view-only | VIEW_CUSTOMERS | e2e 97 | **P** — no block/deactivate, no notes, wallet, loyalty, addresses, orders tab, no export |
| 10 | Vendors / branches | `admin/vendors`, `admin/vendor-branches` (+ open/close, activate, sector, subcategories, commission, auto-accept) | ◐ browse | — | ◐ | ✔ vendors, branch page | MANAGE_VENDORS, OPEN_CLOSE_…, MANAGE_VENDOR_COMMISSION | e2e 30, 109 | **P** — commission-rate & subcategory UIs missing; branch page is a 726-line monolith |
| 11 | Vendor staff | `admin/vendor-staff` | — | — | login | ✔ | MANAGE_VENDOR_STAFF | PW | **C** |
| 12 | Marketplace sectors | `admin/sectors` (+ activate/deactivate) | ✔ | — | — | ◐ list/edit | MANAGE_MARKETPLACE_SECTORS | e2e 73, 89 | **P** — activate/deactivate unused; image by URL only |
| 13 | Subcategories | `admin/subcategories` (6 routes) + branch assignment | ✔ | — | — | — | MANAGE_MARKETPLACE_SECTORS | e2e 73 | **B** |
| 14 | Master catalog (catalog-products + listings) | `admin/catalog-products` (8 routes), public catalog | ◐ | — | — | — | MANAGE_CATALOG | e2e 35 | **B** |
| 15 | Products / categories / options | `admin/products`, `admin/product-categories`, options, Excel import/export template | ✔ | — | ✔ (vendor page 850 lines) | ◐ inside branch page only | MANAGE_CATALOG | e2e 30, 41, 42, 50 | **P** — no product list/search across vendors, no bulk edit, no admin image upload (URL only), no inventory board |
| 16 | Inventory | `inventoryMode`, quantity, set-zero, concurrency-safe decrement | ✔ | — | ✔ | ◐ | MANAGE_CATALOG | e2e 50 | **P** — no low-stock view/alerts |
| 17 | Offers / flash sale / subtotal / coupons | `admin/offers` (create, list, get, (de)activate) | ✔ coupon entry | — | — | ◐ create/list | MANAGE_OFFERS | e2e 55, 65, 114, 115 | **P** — no edit, no performance (redemptions, budget, ROI), coupon codes are part of offers (no distribution, segments, scheduling UI) |
| 18 | Campaigns / promotions | `modules/promotions` contains an **empty `entities/` folder** | — | — | — | — | — | — | **N** |
| 19 | Home banners | `admin/home-banners` (9) incl. image multipart | ✔ | — | — | ✔ | MANAGE_HOME_BANNERS | e2e 108, PW | **C** (get-by-id & activate/deactivate unused); image only via upload ✔ |
| 20 | Loyalty | customer routes; config keys | ✔ | — | — | ◐ via Settings keys | MANAGE_LOYALTY_CONFIG | e2e 72 | **P** — no loyalty ledger/liability view |
| 21 | Ratings | customer rate vendor/driver/product | ✔ | — | — | — | — | e2e 91 | **A** — no moderation, no review list, no export |
| 22 | Notifications | customer in-app + push (device tokens) | ✔ | ✔ push | — | — | — | e2e 88 | **N** for Admin (no broadcast/campaign messaging, no template management) |
| 23 | Delivery pricing / zones / service areas | `delivery-zones`, `service-areas`, delivery-fee | ✔ | — | — | ✔ | MANAGE_SERVICE_AREAS | e2e 82, 105, 110 | **C/P** — zone activate/deactivate & get-by-id unused |
| 24 | Hatly/Wasally service config & pricing | `business-config`, route defaults, `hatly-service-pricing-config` | ✔ | ✔ route card | — | ✔ settings, route defaults, price confirm | MANAGE_HATLY_SERVICE_PRICING | e2e 71, 81, 87 | **P** — pricing-config page absent |
| 25 | Settlements (vendor/driver) | `admin/settlement/*/close` only | — | ◐ | — | ◐ close buttons | CLOSE_VENDOR/DRIVER_SETTLEMENTS | unit + PW | **P** — **no settlement history/statement list, no per-order breakdown, no payout marking, no statement export** |
| 26 | Financial events / ledger | `financial_events` (append-only) | — | — | — | detail-page list only | VIEW_VENDOR_FINANCIAL_REPORTS (unused) | e2e 115 | **B** — no ledger explorer, no totals |
| 27 | Employee loans | `admin/employee-loans` | — | — | — | ✔ | MANAGE_EMPLOYEE_LOANS | unit | **C** |
| 28 | Commissions | rate PATCH endpoints | — | — | — | — | MANAGE_VENDOR/DRIVER_COMMISSION | unit | **B** |
| 29 | Reports | none | — | — | — | — | VIEW_REPORTS (**no endpoint uses it**) | — | **N** |
| 30 | Exports (CSV/Excel/PDF) | none (only product-import xlsx in) | — | — | ◐ import template | ◐ import | — | e2e 77 | **N** |
| 31 | Media upload / library | `uploads` (base64), 4 multipart endpoints, local + S3 providers | ◐ | ◐ proof photo | ◐ product image | ◐ logo, banner | any authed (uploads) | e2e 75, 77, 79, 109 | **P** (see §6) |
| 32 | Admin users, roles, permissions | `admin/users`, `admin/permissions`, grant/revoke, MFA | — | — | — | ✔ users, security | role SUPER_ADMIN | e2e 20, 92, 99 | **P** — no role templates/groups, no invite flow, MFA reset (`DELETE /admin/users/:id/mfa`) has no UI |
| 33 | Audit log | `admin_audit_logs`, viewer endpoint + global interceptor | — | — | — | ✔ viewer | VIEW_AUDIT_LOG | e2e 94, 100 | **C** — no export, no entity-history view |
| 34 | Account deletion requests | auth/deletion | ✔ | — | — | ✔ | role | e2e 101, 103 | **C** |
| 35 | System health / monitoring | `/health`, `/health/ready`; business-event logs; operations facts | — | — | — | ◐ Control Tower facts | VIEW_ORDERS | e2e 00, 98 | **P** — no integration health page (SMS, maps, FCM, storage, Redis, DB), no error-rate/latency view, no monitoring SDK |
| 36 | Platform configuration | `business-config` (22 keys), vehicle types, MFA policy | ✔ | — | — | ◐ settings page (18 keys) | MANAGE_BUSINESS_CONFIG | e2e 106 | **P** — 4 backend keys have no UI; one retired key still in the enum |
| 37 | Home aggregation (new) | `GET /home/product-sections` + Redis | ✔ | — | — | — | public | unit 34, e2e 20 | **V** — see §14 |

---

## 3. Current Admin Dashboard inventory

**Stack:** Next.js 15.5 (App Router, client components), React 18, Tailwind 3 (one brand colour `hatly.orange`), axios, swr (declared; usage minimal), TypeScript. **No** component library, table library, chart library, form library, date picker, rich-text, toast system or icon set. Cookie session with CSRF header; 15-min access cookie auto-refresh; MFA enrolment redirect.

**Admin pages (28):** control-tower, order-search (+ detail), customers (+ detail), vendors (+ detail), branches/[id], vendor-staff, drivers, dispatch (redirect stub), failed-deliveries (+ detail), manual-transfer, cash-remainders, settlement, employee-loans, vehicle-types, sectors, service-areas, delivery-zones, offers, banners, settings, users, security (MFA), audit-log, account-deletion-requests, login. **Vendor pages (3):** orders list (auto-refresh, NEW badge, sound), order detail, products (categories, products, options, Excel import, image upload). Public: privacy, account-deletion.

**Shared components (11, 1,430 lines):** ProductOptionsEditor (409), HatlyServiceItem, SegmentOperations, DispatchAction, RefundsToSend, OperationsBanner/Badge, OrderRefundsAndAttempts, BranchAcceptanceMode, OperationsFactsCard, OrderTotals, LocaleToggle. All are domain widgets; there are **no primitives** (button, input, table, modal, badge, tabs, empty-state, pagination).

**Libraries worth keeping:** `lib/api/*` (≈35 typed API wrappers incl. the new operations/refund/segment wrappers), `lib/api/client.ts` (CSRF + refresh + MFA-redirect interceptor), `lib/auth/*` (`useAdminPermission`), `lib/i18n/*` (en/ar catalog with compile-time key parity — only 4 pages use it), `lib/money.ts`, `lib/use-operations-facts.ts` (polling hook), `components/operations/*` (new, tested), Playwright fixtures (`e2e/*-fixtures.ts`, 30 specs).

**Observed UX gaps (facts):** nav is a single horizontal list of 24 links (no grouping, no active state, no permission filtering — a user without a permission still sees the link); list pages are ad hoc (tables on 7 pages; most lists are card lists); only the audit log, order search, customers and control tower have server-side filtering/pagination; 4 of 28 pages are bilingual/RTL; `aria-label` appears 19 times in total; no skip-links/focus management/keyboard patterns; no dark mode; no breadcrumbs; no global search; no saved filters; no empty-state/skeleton standard (each page writes its own).

---

## 4. Backend / API coverage

Routes by module (≈): products 35, auth 22, sectors 17, vendors 20, delivery 19, orders 19, business-config 11, catalog 10, cart 10, finance 9, home-banners 9, delivery-zones 8, payments 8, notifications 6, permissions 6, offers 5, addresses 5, driver-cash-remainder 5, service-areas 6, ratings 4, failed-delivery 3, favorites 3, loyalty 3, wallet 2, health 2, audit 1, discovery 1, uploads 1, home-products 1.

**Admin routes with no Dashboard caller (44, heuristic — verified by name search for 8):** MFA reset; `business-config` list (Settings reads per key); `hatly-service-pricing-config` GET/PUT; catalog-products ×8; delivery-zone get/activate/deactivate; cash-remainder get; driver & branch commission-rate; home-banner get/activate/deactivate; order by-number; user permissions GET; product-category get; product get; sector get/activate/deactivate; subcategories ×7 + branch subcategories; service-area get. These are **reuse candidates** — no backend change needed.

**Authorization:** `@RequiresPermission` on every operational admin route; role-only (`@Roles(SUPER_ADMIN)`) on user/permission management; 10 admin routes show no explicit permission in the parse (users, permissions, delivery-zone create/fee, admin product get) — expected to be role-guarded at class level **[verify against e2e 99 inventory]**. A global audit interceptor records admin mutations.

**Gaps (backend):** no aggregation/reporting endpoints; no list endpoints for financial events, settlement periods, payments, refunds, wallet ledger (admin), offer consumptions, ratings, notifications, uploads; no bulk operations; no async job/queue; no export streaming; no admin "orders/:id/cancel" route with reason (generic `PATCH /orders/:id/status` exists); no media metadata/variants; no integration-health endpoint; no notification broadcast; no promotions/campaign model.

---

## 5. Reports and exports inventory

**Existing:** product Excel **import** (validate/apply) and import **template** download (SheetJS `xlsx` dependency, multipart limits, 5 MB). Control Tower counters (`/admin/control-tower/summary`) and operations facts; settlement `close` computes totals per period (commission sum from `VENDOR_COMMISSION_RECOGNIZED`, gross sales from non-cancelled segments); `hatlyFundedDiscountSummary`; order refund summary. **Nothing** produces CSV/XLSX/PDF output for users; no streaming; no queue (Redis is used for throttling/OTP/locks/caches only); no reporting permission enforcement (`VIEW_REPORTS`, `VIEW_VENDOR_FINANCIAL_REPORTS` unused).

**Data available for reports (recorded today):** orders (totals, fee, discount, payment method, status, timestamps), order status events (timeline), segment events (actor, role, reason, on-behalf), financial events (commission, driver commission, reimbursements, refunds recorded/sent, Hatly-funded discount recorded/restored), payments, refund payouts, wallet ledger, offer consumptions (incl. reversed), deliveries (assigned/picked/delivered, reassignment count, consecutive unanswered), dispatch alerts/attempts, ratings (denormalized counters), loyalty transactions, driver cash remainders, employee loans, settlement periods.

**Reuse vs new:** reuse the SheetJS dependency (it can *write* xlsx/csv) and the multipart/limits patterns; reuse financial-event idempotent semantics for "net" definitions (e.g. Hatly-funded net = recorded − restored). **New:** Reporting module (query layer), export job runner + storage of generated files (reuse storage providers with private access/signed URLs), report catalogue/permissions, PDF renderer (new dependency — requires approval).

**Index readiness [verify with EXPLAIN on production-sized data]:** `orders` has indexes on status, customer, vendor_branch and a unique order number — **no `created_at` index**; `financial_events` has `order_id` and `type` indexes only — **no date index**. Date-range reports will need additive indexes (migration, local-verified first).

---

## 6. Media upload / storage assessment

**Existing capabilities (reusable):**
- `UploadsController POST /uploads` (base64 JSON, any authenticated role, rate-limited `mediaUpload` policy, 5 MB).
- Multipart upload on four endpoints via `singleFileMultipartLimits` / `requireUploadedFile` (vendor logo, vendor product image, home-banner image, Excel).
- Providers: **local filesystem** (default; `UPLOADS_LOCAL_DIR`, public prefix `/uploads/files`) and **S3-compatible** (hand-written SigV4 signer, private/public access, signed-URL TTL, key prefix, force-path-style) plus a stub; a contract spec asserts provider parity; concurrency limiter (`UPLOAD_MAX_CONCURRENT`).
- Validation from **bytes** (JPEG/PNG/WebP signature + minimal structure, dimension reader, 5 MB cap, extension from content, never from client name); served `nosniff` + sandbox CSP; private-media redirect; object-isolation tests (e2e 77, 79, 96).
- `uploads` table: `url` (unique) + uploader, used to ensure `imageUrls` only reference real uploads.

**Missing against the owner's requirement:** image processing library (none installed), crop/resize, thumbnails, WebP variants, dimension/format *policies per use*, media library & metadata (name, size, dimensions, mime, hash, usage), search/filter, reuse of assets across entities, replace/delete with reference safety, drag-and-drop & multi-file UI, progress/cancel, per-entity pickers; admin sector/subcategory/product/catalog-product/category images by URL string only; vendor image DTOs deliberately exclude `imageUrl`.

**Image-bearing entities (from entity scan):** Vendor.logoUrl, MarketplaceSector.imageUrl, MarketplaceSubcategory.imageUrl, Product.imageUrl, CatalogProduct.imageUrl, HomeBanner.imageUrl, order-item snapshots (product image, custom-request `imageUrls`), cart items `imageUrls`, proof-of-delivery photo. **No image on:** product categories, vendor branches (cover), offers/campaigns, product options/variants (the "variants" are option values with price deltas — **no image today**), payment destination QR, driver documents.

**Recommended architecture (no storage-service change):**
1. **Media module** (`media_assets` + `media_variants` tables, **no binaries in PostgreSQL**): asset id, storage key(s), original name, mime, bytes, width, height, sha256 (dedupe), purpose tag, uploader, status (ACTIVE/DELETED), created. Variants: `original`, `display` (WebP, max 1600 px), `thumb` (WebP 320 px) with their keys.
2. **Processing:** add `sharp` (new dependency — approval required) in an upload pipeline: validate bytes (existing code) → decode → apply per-purpose policy (min/max dimensions, aspect e.g. banner 2:1) → strip EXIF → generate WebP variants → store via the existing provider. Synchronous for single files (bounded by 5 MB and the existing concurrency limiter); multi-file = N independent requests with client-side queue/progress (no new queue needed).
3. **Entities reference `media_asset_id`** (additive nullable FK) while keeping the current `*_url` columns populated from the asset's display variant (backward compatible with all apps and the Customer app's resolver); a backfill registers existing uploads as assets (local-verified, additive).
4. **Authorization:** upload = permission-scoped by purpose (`MANAGE_CATALOG`, `MANAGE_HOME_BANNERS`, `MANAGE_VENDORS`, …) plus a new `MANAGE_MEDIA` for the library; delete is blocked while referenced; private bucket access + signed URLs stay the production default (`STORAGE_ACCESS=private`).
5. **Dashboard:** one `MediaPicker` (upload / drag-drop / paste / pick from library, crop with fixed aspect per purpose, preview, progress, retry) used by every image field; external-URL text inputs removed (backend keeps accepting legacy URLs only for existing data and import).
6. **Security:** bytes-based type check (existing), size/dimension limits, decompression-bomb guard (pixel cap before decode), EXIF/GPS stripping, per-user and per-IP rate limits (existing policy), unguessable keys, no SVG, antivirus not required for raster-only **[decision]**, audit event on upload/replace/delete.

**Estimated scope:** backend ≈ 2 tables + migration, service/controller (≈10 routes), sharp pipeline, backfill script, ≈ 60 tests; Dashboard ≈ picker + library page + integration into ≈ 9 screens; Customer/Driver apps unchanged (URLs stay valid). **Decision needed:** is local-filesystem storage acceptable for production or is the existing S3-compatible driver to be enabled (it exists; configuration/provider choice is the owner's — no paid service is introduced by this blueprint).

---

## 7. Permission and security assessment

**RBAC today:** roles CUSTOMER / DRIVER / VENDOR / VENDOR_MANAGER / ADMIN / SUPER_ADMIN; 33 permissions granted per admin user by SUPER_ADMIN; global `PermissionsGuard`; Dashboard hides *controls* by permission (`useAdminPermission`) but **not navigation**. New in this session: `MANAGE_ORDER_FULFILMENT`. Missing for the target scope: reporting permissions per report family (`VIEW_REPORTS` exists but unused), `EXPORT_DATA`, `MANAGE_MEDIA`, `VIEW_FINANCE`, `MANAGE_SETTLEMENTS` history, `MANAGE_CUSTOMERS` (block/notes), `VIEW_SYSTEM_HEALTH`, `MANAGE_CAMPAIGNS`, `MODERATE_REVIEWS`, `SEND_NOTIFICATIONS`. **Role templates** (Finance, Operations, Support, Catalog, Marketing, Read-only) are absent — every admin is individually granted.

**Security controls present:** HttpOnly cookie sessions + CSRF token, refresh rotation with reuse detection, TOTP MFA with recovery codes and enrolment policy, login brute-force brake, throttling (Redis-backed with per-instance fallback), upload validation + CSP/nosniff, global admin-mutation audit, IDOR/object-isolation e2e (91, 96), route-authorization inventory (99), identifier sweep (93), Redis-outage behaviour (98), dependency audit docs.

**Risks specific to the revamp:** exports concentrate PII/financials (needs permission + audit + expiry); bulk actions amplify mistakes (need confirmation + audit + reversibility); media uploads widen the attack surface (§6); permission-aware navigation must never be treated as authorization (the backend stays authoritative); a design system rewrite must not drop existing CSRF/session behaviour in `lib/api/client.ts`.

---

## 8. Enterprise information architecture

Top-level navigation (permission-filtered, RTL-aware, with global search and a command palette):

1. **Control Tower** — Executive overview · Live operations · Alerts & SLAs
2. **Orders** — All orders · Hatly/Wasally requests · Failed deliveries · Refunds to send · Issues
3. **Marketplace** — Sectors · Subcategories · Home layout (banners) · Collections
4. **Vendors** — Vendors · Branches · Staff · Onboarding · Commission
5. **Catalog** — Products · Master catalog · Categories · Options · Inventory · Bulk import/export
6. **Fleet** — Dispatch board · Drivers · Vehicle types · Cash remainders · Earnings
7. **Customers** — Directory · Wallet & loyalty · Support · Ratings & reviews · Deletion requests
8. **Finance** — Ledger · Payments · Refunds · Settlements · Commissions · Employee loans · Reconciliation
9. **Marketing** — Campaigns · Coupons · Offers · Banners · Notifications
10. **Reports** — Catalogue · Scheduled/Exports · Saved reports
11. **Media** — Library · Usage
12. **Access** — Admin users · Roles · Audit log · Sessions & MFA
13. **System** — Integration health · Jobs/exports · Logs
14. **Settings** — Platform configuration · Delivery pricing · Service areas & zones · Payments · Hatly services

Cross-cutting: global search (orders by number, customers by phone, vendors, products), notification centre (operations counters already exist), locale/RTL toggle, keyboard shortcuts, breadcrumbs, URL-addressable filters.

---

## 9. Proposed page and module inventory (target ≈ 70 pages)

| Module | Pages (new = ●, existing evolved = ○) |
|---|---|
| 1 Executive Control Tower | ○ Control Tower (live ops); ● Executive KPIs (revenue, orders, AOV, on-time %, cancellation %, active vendors/drivers, outstanding refunds); ● Alerts & SLA board |
| 2 Order Management | ○ Orders list (advanced filters, saved views); ○ Order detail (timeline, segments, money, dispatch, refunds, actions incl. admin cancel with reason); ● Hatly/Wasally queue; ○ Failed deliveries; ● Issues/notes |
| 3 Marketplace | ○ Sectors (+activate/deactivate, upload image); ● Subcategories; ○ Banners/Home layout (+ preview, schedule); ● Collections **[decision: new concept?]** |
| 4 Vendors & Branches | ○ Vendors list/detail; ○ Branch detail (split into tabs: profile, hours, zones, commission, acceptance, products); ○ Staff; ● Onboarding checklist; ● Vendor performance |
| 5 Product & Inventory | ● Products (cross-vendor list/search/bulk); ○ Product editor (+media, options, variants); ● Master catalog + listings; ○ Categories; ● Inventory board / low-stock; ○ Excel import/export |
| 6 Delivery & Fleet | ○ Dispatch board; ○ Drivers (+detail, documents, commission, earnings, performance); ○ Vehicle types; ○ Cash remainders; ● Delivery performance |
| 7 Customers | ○ Directory/detail (orders, wallet ledger, loyalty, addresses, ratings, notes, block); ● Wallet adjustments; ● Support tools; ● Review moderation |
| 8 Finance & Accounting | ● Ledger explorer (financial events, filters, totals); ● Revenue & commission summaries; ○ Employee loans; ● Reconciliation (payments vs ledger vs settlements) |
| 9 Payments/Refunds/Settlements | ○ Manual transfers; ○ Refunds to send (+history); ● Payments list; ● Settlement periods list/statement/breakdown/mark-paid; ○ Close settlement |
| 10 Marketing & Growth | ● Growth overview; ● Notifications/broadcast **[decision]**; ● Referral/loyalty overview |
| 11 Coupons/Promotions/Campaigns | ○ Offers (edit, clone, schedule); ● Coupons (codes, limits, usage, restore view); ● Campaigns **[needs model]**; ● Promotion performance |
| 12 Reports & Analytics | ● Report catalogue + runner; ● Export jobs; ● Saved reports; dashboards per domain |
| 13 Media Management | ● Library; ● Usage/references; ● Cleanup |
| 14 Admin Users/RBAC/Audit | ○ Users; ● Roles/templates; ○ Audit log (+ entity history, export); ○ Security/MFA (+reset UI) |
| 15 System Monitoring | ● Integration health (DB, Redis, SMS, Maps, FCM, storage); ● Error/latency view **[needs telemetry decision]**; ● Background jobs |
| 16 Platform Configuration | ○ Settings (grouped, validated, all 22 keys, history); ○ Delivery pricing; ○ Service areas & zones; ○ Hatly service config & route defaults |

---

## 10. Backend gaps

1. Reporting module (queries, permissions, pagination, totals, filters) + export jobs + storage of results + download authorization.
2. Media module (§6) + `sharp` + migration + backfill + permissions.
3. List endpoints: financial events, payments, refunds/payouts, settlement periods (+ statements), wallet ledger (admin), offer consumptions, ratings, uploads/media.
4. Admin order actions: cancel with reason, add note, resend notification; bulk actions where safe.
5. Customers: block/unblock, notes, wallet adjustment with audited reason.
6. Marketing: campaign/promotion model (the `promotions` module is an empty shell), notification broadcast, coupon analytics.
7. System: integration-health endpoint (DB, Redis, SMS provider, Maps provider mode, FCM config, storage driver), job status.
8. RBAC: new permissions + role templates; permission metadata endpoint for navigation (names/groups) **(reuse `/admin/me/permissions`)**.
9. Indexes for report date ranges (additive migration, local-verified).
10. Cleanup: remove retired `VENDOR_SEGMENT_AUTO_ACCEPT_ENABLED` enum value; surface the 4 config keys without UI.

## 11. Frontend gaps

Design system and component library; permission-aware navigation shell; data-table/filters/pagination/saved views; form/validation kit; modal/drawer/toast; charts; media picker/library; export UI; i18n/RTL for all pages (24 pages to migrate); accessibility pass; responsive layouts; skeleton/empty/error standards; splitting of monolith pages (branch 726 lines, products 850, banners 496, settings 536, control tower 481, delivery zones 458, offers 441); Playwright coverage for new flows.

## 12. Reusable components and services (keep)

Backend: financial event service + idempotency keys; refund/wallet services; settlement close; control-tower facts; audit interceptor/log; permissions guard; storage providers + validation + rate limits; Redis client/cache (`HomeSectionsCache` pattern with epoch/circuit breaker is reusable for report caching); `FinancialEventService.hatlyFundedDiscountSummary`; segment event history; order refund summary.
Frontend: `lib/api/*` wrappers + axios client; `useAdminPermission`; i18n catalogs; `components/operations/*`; `HatlyServiceItem`, `ProductOptionsEditor`, `OrderTotals`; Playwright fixtures; `lib/money.ts`.

---

## 13. Technical dependencies (map)

```
Design system ──► every page
Navigation shell ◄── /admin/me/permissions (exists) ◄── new permission catalogue (WS-1)
Media module (WS-2) ──► Banners, Sectors, Subcategories, Products, Variants/Options, Categories, Vendors/Branches, Campaigns
   └─ needs: sharp (approval), storage provider (exists), migration (additive), MANAGE_MEDIA
Reporting module (WS-3) ──► all analytics dashboards, exports, finance statements
   └─ needs: date indexes (migration), export jobs (queue/Redis or DB-backed job table), result storage (exists), SheetJS (exists), PDF lib (approval)
Finance ledger/list APIs (WS-5) ──► Settlements UI, Reconciliation, Executive KPIs
   └─ financial semantics (net Hatly-funded, refunds recorded vs sent, commission recognition) must be defined ONCE in backend
Orders (admin cancel/notes) ──► uses existing state machine + refund pipeline (no UI-side money logic)
Marketing/Campaigns ──► new backend model; coupons reuse offers/consumptions (restoration rules PD-014/015)
Monitoring ──► health endpoint extension; optional telemetry (decision)
```
**Permission dependencies:** each module introduces its read/write/export triple; navigation and routes use one catalogue. **Financial dependencies:** statements and KPIs must read the ledger/derived services — never recompute from order totals in the UI. **Reporting dependencies:** consistent time-zone handling (Africa/Cairo) and currency (minor units, EGP) in one backend layer.

---

## 14. Risks and regression considerations

- **Scope vs stability:** the Dashboard is the operational lifeline (dispatch, refunds, settlements). Migrate page-by-page behind the existing routes; keep Playwright specs green at every step; no big-bang swap.
- **Money correctness:** reports/statements are read-only over existing ledgers; any new write (wallet adjust, mark-paid) needs idempotency keys, audit and e2e.
- **Performance:** unindexed date scans on `orders`/`financial_events` (§5); exports must run off the request path.
- **Privacy:** exports/PII; retention and expiry of generated files.
- **i18n/RTL retrofit** touches every page; build the kit first.
- **Dependencies requiring approval:** `sharp`, a PDF library, possibly a charting library, possibly a job queue (BullMQ on the existing Redis) or a DB-backed job table (no new infra).
- **Open prior items:** retired config enum value; "See all" Home path; documentation debt.

### Pending work audit — Home Aggregation API (implemented locally, not finished)
| Item | State |
|---|---|
| `GET /home/product-sections` (3 sections, contract v1, zone scope, `sections=` subset) | Implemented; e2e equivalence test vs the old composition passed (20/20 before the last change) |
| Redis section caching (60 s TTL, per-section keys, single-flight, lock) | Implemented; 34 unit tests pass |
| Cache invalidation (epoch bump on admin/vendor catalogue mutations) | Implemented; e2e covers price/activate/vendor/offer; **stock/delivered-count changes rely on TTL only** |
| Redis outage safety (per-command 250 ms timeout + 15 s circuit) | Implemented after measuring 25–32 s/request without it; unit-tested; **e2e not rerun after this change** |
| Flutter integration (single request, per-section retry cards, 404 legacy fallback) | Implemented; 17 new + existing Home tests passed |
| Final verification | **Incomplete:** full backend unit/e2e/integration, full `flutter test` + `analyze`, dashboard build not rerun after the final edits; Admin Dashboard untouched |
| Documentation | **Missing:** PD entry, release notes/deploy order, LAUNCH_PROGRESS section |
| "See all" lists | **Still use the old multi-request path** (`homeSectionProductsProvider`); decision whether to add a `limit`-parameterised aggregation or leave as is |
| Perf evidence | Local only (22 → 1 request; 24 → 9 ms cold / 1 ms warm; ~510 → ~170 ms at 150 ms RTT; legacy fan-out hits 429 under 40 clients). **No Production-like contention reproduction; no Release-mode numbers** |
| Zone behaviour | Backend supports `deliveryZoneId`; the app does not pass it (Home has never zone-filtered) — owner decision |

**Safe completion plan (not executed):** (1) rerun, in order, backend `tsc`, unit, e2e (incl. `116`), integration; (2) `flutter test` + `analyze`; (3) dashboard `tsc`/unit; (4) write PD-016 + release-notes addendum + deployment order (backend first; the 404 fallback protects an early app); (5) decide See-all and zone items; (6) measure on a staging backend with representative data **only after approval**; (7) no deploy. Estimated effort: ≈ half a day.

---

## 15. Recommended implementation workstreams

| WS | Name | Contents | Depends on |
|---|---|---|---|
| 0 | Close prior work | Home aggregation verification/docs (§14) | — |
| 1 | Foundation | Design system (tokens, primitives, tables, forms, feedback, charts), navigation shell + permission catalogue, i18n/RTL kit, a11y baseline, Playwright harness upgrades | — |
| 2 | Media platform | Media module + sharp pipeline + MediaPicker/Library + integrate into banners, sectors, subcategories, products, options, categories, vendors/branches | WS-1 (UI), approvals (sharp) |
| 3 | Reporting & export platform | Reporting service, indexes, export jobs, report catalogue UI, CSV/XLSX (PDF later) | WS-1 |
| 4 | Orders & Control Tower | Order list/detail revamp, admin cancel/notes, executive KPIs, alerts board | WS-1, WS-3 (KPIs) |
| 5 | Finance & payments | Ledger explorer, settlement history/statements, payments/refunds lists, reconciliation | WS-3 |
| 6 | Catalog & inventory | Cross-vendor products, master catalog + listings, categories, inventory board, bulk | WS-1, WS-2 |
| 7 | Vendors & fleet | Vendor/branch tabs, commission, onboarding, drivers detail/earnings/performance, dispatch board | WS-1, WS-3 |
| 8 | Customers & marketing | Customer 360, wallet adjustments, review moderation, coupons/campaigns, notifications | WS-1, backend models |
| 9 | Access, audit & system | Roles/templates, MFA reset UI, audit export/history, integration health, config console | WS-1 |
| 10 | Hardening | Performance, accessibility audit, Arabic review, security review, docs, training | all |

Each workstream: backend additions with unit/e2e/integration tests first, then UI, then Playwright; every workstream ends with a regression gate (full backend, dashboard build, Playwright, affected Flutter suites). Migrations are additive and verified on local disposable databases before any deployment proposal.

---

## 16. Acceptance criteria by module

**Cross-cutting (all modules):** permission-filtered navigation and routes; server-authoritative authorization with an e2e test per new route; audit entry for every mutation; AR/EN with RTL parity (catalog keys compile-checked); keyboard-operable, labelled controls (WCAG 2.1 AA targets); loading/empty/error states; responsive down to tablet; URL-addressable filters; no money logic in the UI; Playwright coverage of the main flow; no regression in existing Playwright/backend suites.

1. **Executive Control Tower:** KPIs match report queries to the minor unit; refreshes ≤ 30 s without blocking; every tile drills into a filtered list; counters agree with existing operations facts.
2. **Orders:** filter by status/date/payment/zone/vendor/driver/customer; saved views; detail shows timeline, segments with history, money, refunds, dispatch; admin cancel requires reason, permission, audit, uses the existing state machine; exports respect filters.
3. **Marketplace:** sectors/subcategories/banners editable with media picker only; activate/deactivate; preview matches app rendering; schedules respected.
4. **Vendors/Branches:** tabs for profile/hours/zones/commission/acceptance/products; commission change audited and applies prospectively; performance metrics reconcile with reports.
5. **Product & Inventory:** cross-vendor search/sort/bulk edit with confirmation; stock board with low-stock threshold; variants/options with images; import/export round-trips without loss.
6. **Delivery & Fleet:** dispatch board matches Control Tower facts; driver detail shows earnings reconciling with settlements; commission editable with audit.
7. **Customers:** profile 360 (orders, wallet, loyalty, addresses, ratings); block/unblock and wallet adjustment require reason + permission + audit + idempotency; exports masked per permission.
8. **Finance & Accounting:** ledger totals equal sums of events; net Hatly-funded = recorded − restored; reconciliation report shows zero unexplained difference on test data.
9. **Payments/Refunds/Settlements:** refund "sent" is never shown before marking; settlement statements list every contributing event and reconcile to the period total; closed periods immutable.
10. **Marketing & Growth:** only real data; segment/campaign actions audited; no notification without explicit approval flow.
11. **Coupons/Promotions/Campaigns:** redemption, budget and limits visible and equal to consumption rows (incl. reversed); edit rules consistent with existing offer constraints.
12. **Reports & Analytics:** every report supports date range, filters, sort, totals footer; totals equal an independent SQL check in tests; CSV/XLSX downloads; large exports run as jobs with progress, expiry and permission check; normal API latency unaffected under export load (load test).
13. **Media Management:** direct upload/drag-drop/multi-file with progress and retry; crop to per-purpose aspect; WebP display + thumbnail generated; dimension/format/size errors explained; replace/delete blocked while referenced; no binary in PostgreSQL; no external-URL field in any admin form; unauthorized access rejected (tests).
14. **Admin Users/RBAC/Audit:** role templates grant exactly their permission sets; navigation reflects grants; MFA reset available to SUPER_ADMIN with audit; audit searchable/exportable with entity history.
15. **System Monitoring:** health page reports DB, Redis, SMS, Maps, FCM, storage with last-check time and degraded states; degraded state visible within one polling interval.
16. **Platform Configuration:** every config key surfaced, typed and validated, with change history and audit; retired keys removed; no setting changes behaviour silently.

---

## Decisions requested from the owner
1. Approve adding **`sharp`** (image processing) and, for PDF, a PDF library; confirm no charting library preference.
2. Storage: stay on local filesystem for now or enable the existing S3-compatible driver (owner-provided bucket) — no change made by this blueprint.
3. Job runner for exports: BullMQ on the existing Redis vs a DB-backed job table.
4. Marketing scope: do "Campaigns" and "Notifications broadcast" need new models now (the `promotions` module is empty)?
5. Role templates: confirm the proposed set (Finance, Operations, Support, Catalog, Marketing, Read-only).
6. Home aggregation: See-all path and zone passing.
7. Telemetry for System Monitoring (error/latency): in-house from logs vs a monitoring SDK.

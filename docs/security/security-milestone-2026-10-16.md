# Security, tenant isolation, abuse protection & production readiness — milestone report (2026-10-16)

Scope: backend API (NestJS), dashboard, customer and driver apps, dependencies, staging deployment kit. Nothing was committed,
pushed or deployed; no production data was touched. This is **not** a claim that Hatly is completely secure — residual risks are
listed in §4 and the release blockers in §9.

Builds on (not re-implemented): HttpOnly dashboard sessions + CSRF, TOTP MFA, append-only `admin_audit_logs`, the route
authorization inventory (e2e 99), the Group 8 IDOR fixes (e2e 20/91), Redis-backed rate limiting (e2e 78/95), upload hardening.

## 1. Authorization model and route matrix

The live application has **244 routes** (read from the running app's own guard metadata by `test/e2e/support/route-inventory.ts`):

| Enforced rule | Routes | How it is enforced |
|---|---|---|
| PERMISSION (`@RequiresPermission`) | 127 | global `PermissionsGuard`; SUPER_ADMIN passes all, ADMIN needs the explicit grant (read from the DB per request) |
| ROLES (`@Roles` + `RolesGuard`) | 93 | role from the verified JWT; staff accounts re-checked in the DB on every request (deactivation is immediate) |
| PUBLIC | 22 | **reviewed allowlist** (new): auth entry points, health, the public catalogue (sectors, vendors, branches, products, search) |
| Any authenticated role | 2 | allowlist: `POST /auth/logout`, `POST /uploads` (both act on the caller only) |
| `@Roles` without `RolesGuard` | 0 | e2e 99 fails the build if one appears |

Object-level (BOLA) ownership is enforced in the services, never by the client:

| Role | Resource | Ownership rule (server) | Deny contract | Evidence (e2e) |
|---|---|---|---|---|
| Customer | orders, detail, tracking, cancel, rating-state | `order.customerId === token user` | 404 (indistinguishable) | 20, 91, **96** |
| Customer | addresses, cart & cart items, favorites | per-customer rows | 404 | 20 |
| Customer | nested option values in cart body | value must belong to that product's own groups | 400 | **96** |
| Customer | custom-request / proof photos | `uploads.uploaded_by_user_id` must be the caller | 400 `INVALID_IMAGE_REFERENCE` | **96** |
| Customer | notifications (read, list, unread) | `customer_id` in the UPDATE/SELECT predicate | 404 | **96** |
| Customer | wallet, ledger, loyalty | no id parameter exists; token's own ledger | — | 91 |
| Customer | ratings (vendor/item/driver) | must be the order's customer, order delivered | 403/404 | 91, **96** |
| Customer | manual-transfer claim | must own the order | 404 | 20 |
| Vendor staff | products, options, values, stock, activation, image | `vendor_staff` link to the product's branch (per request) | 403/404 | 20, **96** |
| Vendor staff | nested ids (`vendorBranchId`, `categoryId`) in bodies | branch must be owned; category must belong to that branch; `vendorBranchId` not accepted on update | 400/403 | **96** |
| Vendor staff | orders, segment status, weight, price | segment's branch must be owned | 404 | 20 |
| Vendor staff | import template / validate / apply | branch ownership per row | 403 | **96** |
| Vendor staff | customer data in orders | view excludes `customerId` and `deliveryAddressSnapshot` | — | unit `vendor-orders.service.spec` |
| Vendor staff | link removed (replay) | link re-read every request | 403/404 next request | **96** |
| Driver | deliveries, status, purchase amount, cash remainder, weight | `delivery.driverId` = caller's driver | 404 | 20, **96** |
| Driver | replay after admin reassignment | ownership re-read; old driver refused, order unchanged | 403/404 | **96** |
| Admin | every `/admin/*` route | permission-gated or ADMIN/SUPER_ADMIN only | 403 | 20, 99 |
| Admin | permission grant/revoke, user list, MFA reset | SUPER_ADMIN only; revocation effective next request | 403 | 20, 92 |
| Anyone | role/identity in bodies, spoofed headers, `alg=none`, edited or foreign-algorithm JWTs | `forbidNonWhitelisted`, HS256-only verification | 400 / 401 / 403 | 10, 20, **96** |

**Identifier sweep (new, e2e 93):** every one of the parameterised routes is called, as a role that is let in, with malformed ids, an
unknown UUID, an injection string, a traversal string, 2000-character values, and hostile values in 18 common query parameters.
Pass criteria: never a 5xx, never a stack trace or SQL text. It found **six real defects** (fixed, §4).

## 2. Rate limits (Redis-backed, user-keyed when signed in, IP otherwise; every limit also counts toward the 600/min aggregate)

| Route group | Limit | Key | New? | Bypass tests |
|---|---|---|---|---|
| Password logins (3 routes), dashboard login | 10/min + per-account brake (10 failures/15 min, before bcrypt) | IP + phone | — | brake shared across all routes; unknown phones identical; re-formatted phone never reaches a password check (**78**) |
| Registration / request-code / legacy register | 5/min + per-phone OTP cooldown (60 s) and attempt cap | IP + phone | — | 95 |
| Token refresh / dashboard refresh, logout | 20–30/min + reuse detection | IP | — | 10, 92 |
| MFA setup/enable/disable + per-account code brake | 5/10/5 per min | user + account | — | 92 |
| Customer password change, phone verify | 5/5/10 per min (+ brake) | user | — | 95 |
| Search | 60/min | user/IP | — | 78 |
| Checkout quote / order creation | 30 / 10 per min | user | — | 78 |
| **Geocoding** `/geo/search`, `/geo/reverse` (paid quota) | 30/min each | user | **yes** | trailing slash, upper case, HEAD share the bucket; other users unaffected (**78**) |
| **Delivery-fee preview** | 30/min | user | **yes** | — |
| **Custom requests** (Hatly Service, vendor custom items) | 20/min | user | **yes** | — |
| **Customer cancellation** | 10/min, counted whatever the outcome | user | **yes** | foreign-id probing exhausts the budget (**78**) |
| **Manual-transfer claim**, **loyalty conversion** | 10/min | user | **yes** | **78** |
| **Ratings** | 20/min | user | **yes** | **78** |
| Image upload / product image / Excel import | 30 / 20 / 10 per min + concurrency cap | user | — | 79, 77 |
| Everything else | 100/min per route + 600/min aggregate | user/IP | — | 78 |

Identity behind proxies: `TRUST_PROXY` must be a hop count or proxy list (`true`/`*` refused at boot), so `X-Forwarded-For` from a
client is ignored unless a configured proxy set it. Multi-instance: counters are atomic Lua in Redis (e2e 78/98 cover the outage
fallback). Refused requests now emit `security.rate_limited`.

## 3. Request and resource exhaustion

* Body limits 100 KB (8 MB base64 upload route); multipart: one file, ≤ 10 fields, ≤ 16 KB per field; uploads validated by byte
  signature (JPEG/PNG/WebP), 5 MB, stored under server-generated names; upload concurrency capped (unchanged, verified).
* **New:** map-provider calls bounded at 5 s (they had no timeout); vendor order list capped at the newest 500 segments; driver
  delivery list returns all active deliveries + the newest 200 finished (both lists loaded the whole history every time).
* Pagination: every paginated list clamps `limit` to ≤ 50/100 or refuses it; absurd `page` values are harmless (e2e 93).
* Remaining unbounded lists (admin-only, permission-gated): `/admin/products`, `/admin/vendors`, `/admin/vendor-branches`,
  `/admin/drivers`, `/admin/offers`, `/admin/manual-transfer-payments`, `/admin/cash-remainders`, `/admin/orders/failed-deliveries`.
  Bounded by marketplace size today; add server pagination together with the dashboard tables (residual, Low).

## 4. Findings

### Fixed in this milestone

| # | Finding | Severity | Fix | Test |
|---|---|---|---|---|
| F1 | Six routes answered **HTTP 500** to a malformed identifier (`/admin/orders/by-number/:orderNumber`; `vendorBranchId`/`categoryId` query filters on `/admin/products`, `/admin/product-categories`, `/admin/offers`, both import templates). Values were bound parameters (no injection), but each was an unhandled DB error and an oracle | Medium | global `UuidParamPipe` now also validates named `@Query('…Id')` values; `by-number` answers 404 for non-UUID non-order-numbers | e2e 93, unit pipe spec |
| F2 | **Loyalty idempotency key pre-emption.** The client's raw key was stored in globally-unique ledger columns shared with system keys (`order-refund:<orderId>:cancel` …). Anyone knowing an order id (vendor/driver staff with a customer account) could occupy that key and make the victim's cancellation fail (refund credit collides) | Medium | client keys are namespaced `loyalty-convert:<customerId>:<key>` (legacy raw keys still recognised as replays); key length capped (an over-long key was a 500) | unit loyalty spec (+3 tests), int `transaction-rollback`, e2e 85 |
| F3 | **Map provider calls had no timeout** — a hung provider held checkout/address requests open indefinitely | Medium | `AbortSignal.timeout(5 s)`, categorised `timeout` failures | unit google-maps spec |
| F4 | Paid geocoding + other abuse-prone/financial customer routes ran on the generic 100/min | Medium | 7 named policies (§2) | e2e 78 |
| F5 | **Audit gap:** ~70 privileged mutations (offers, vendors/branches, zones, driver verification, dispatch, settlement, manual-transfer approve/reject/refund, failed-delivery refunds, commissions, catalogue) left no audit record | Medium | global `AdminMutationAuditInterceptor` (§8) | e2e 94 |
| F6 | **MFA key change ⇒ 500** on sign-in; production could start without `MFA_ENCRYPTION_KEY` and let admins enrol under the refresh-secret-derived key | Medium | fail-safe 503 `MFA_UNAVAILABLE` + operational log; key REQUIRED at boot in production/staging | unit key-rollout (6), env validation |
| F7 | Production could start with an **unauthenticated Redis** (holds sessions, OTP state, rate-limit counters) | Medium | strict boot error unless `REDIS_URL` has a password or `ALLOW_UNAUTHENTICATED_REDIS=true`; warning for non-TLS | env validation |
| F8 | **Unbounded lists**: vendor orders (all history + items per view), driver deliveries (all history incl. past customers' phone/address) | Low–Medium | caps (§3); active deliveries never cut | unit specs |
| F9 | **4 production-high dependency advisories** (`lodash`, `js-yaml`, `node-forge`, `firebase-admin`) + EOL Node 20 runtime | High (hygiene; not reachable per analysis) | overrides + firebase-admin 14 + modular API port + Node 22 images | full suites; `npm ci` |
| F10 | No signal for refused auth/access/rate-limit/money requests | Low | `security.*` WARN events (§8) | unit filter spec |

### Remaining (not fixed here)

| Finding | Severity | Reachability | Plan |
|---|---|---|---|
| **Private media are capability URLs**: user uploads (custom-request/prescription photos, proof-of-delivery photos) are served to anyone holding the unguessable `/uploads/files/<uuid>.<ext>` URL (local static, or a 302 to a short-lived signed S3 URL). Names are 122-bit random — not predictable or listable — but a leaked URL never expires and is not tied to a user | Medium | requires the URL (seen by the customer, the branch, the driver, admins) | add a `visibility` to uploads; serve PRIVATE ones only via short-lived signed URLs minted per authorised read (order detail for owner/branch/driver/admin), keep catalogue images public. Touches every view that emits an upload URL + the apps' image widgets — a dedicated change |
| Driver app keeps past customers' phone/address for the newest 200 finished deliveries | Low–Medium | the driver who delivered | the driver app now tolerates a missing phone (this milestone); after that build is installed, redact phone/address server-side for deliveries finished > 24 h |
| Customer device-token re-registration moves a known FCM token to the caller (needed when a device changes account) | Low | requires the victim's FCM token (only on the device) | accept; document |
| Registration oracle when `CUSTOMER_OTP_ENABLED` is OFF (new phone → account; existing → generic 401) | Low | inherent without OTP | keep OTP on in production (SMS provider) |
| Staging FALLBACK mode (`NODE_ENV=development`, no Maps key) skips the strict boot checks; safety then rests on the template values | Low | staging only | use strict staging with a Maps key, or add an explicit `HATLY_DEPLOYED=true` strict switch |
| Admin-only unbounded lists (§3) | Low | admins | paginate with the dashboard tables |
| No vendor MFA | Low–Medium | vendor accounts are branch-scoped (no cross-tenant power) | §6 |
| Reads are not audited | Low | — | add for customer-PII reads (admin customer search/detail) if required |
| Remaining moderate/low advisories need Nest 11 | Moderate | not reachable (dependency-audit.md) | Nest 11 upgrade |

## 5. Financial integrity and concurrency

Verified (existing + this milestone): prices, discounts, fees, totals and payment status are computed server-side (no client price field
is accepted — `forbidNonWhitelisted`, e2e 96 rejects `priceMinor`/`customerId` in a cart body); order creation is idempotent under 5
parallel submits (e2e 50/91); wallet cannot be spent twice (row lock + DB unique keys, e2e 91/66); loyalty conversion serialises per
customer (row lock) and is idempotent (unit + int); refunds are cumulative and replay-safe (e2e 62/63/80); manual-transfer claims are
idempotent under 5 concurrent requests (e2e 67); a payment becomes PAID only through an admin with the permission, recording the
verifier (e2e 67) — there is no online gateway callback that could be forged; settlement period closes are idempotent under concurrency
(int). Confirmed defect fixed: **F2** (idempotency-key pre-emption). Pricing policy was not changed.

## 6. Authentication, sessions, MFA

Dashboard sessions (HttpOnly/SameSite=Strict/Secure cookies, CSRF HMAC token, refresh rotation with reuse detection, server-side logout,
immediate staff deactivation) re-verified by e2e 92 (23 tests). MFA: enrolment, replay, concurrency, recovery codes, per-account brake,
reset, policy and audit pass (e2e 92); key handling hardened (F6); rollout procedure in `mfa-rollout.md` (policy NOT enabled, nobody
enrolled). **Vendor MFA** — not invented here: vendor staff are scoped to their own branches (no cross-tenant power), use the same
password brake, and are deactivated instantly. Recommended rollout: widen `MFA_ROLES` to `VENDOR_MANAGER` behind a separate policy
flag, voluntary first, after the admin rollout has run for a cycle (needs a dashboard copy change + support procedure for lost devices).

## 7. Headers, CORS, proxies, deployment configuration

Verified in code/tests: API security headers + no-store (e2e 72), dashboard CSP/frame-ancestors/nosniff, exact CORS origins with
credentials (wildcard refused), `TRUST_PROXY` hop count only, Swagger off by default in production/staging, HSTS in strict mode, 5xx
messages hidden in production, query strings never logged. New boot rules: `MFA_ENCRYPTION_KEY` required; Redis must authenticate.
Staging kit generates the MFA key and keeps the policy off. Docker images moved to `node:22-bookworm-slim` (not built here — Docker is
not installed on this Mac).

## 8. Audit trail and monitoring

* `admin.mutation` rows for every ADMIN/SUPER_ADMIN POST/PUT/PATCH/DELETE outside `/auth/*`: actor, role, route template, target id,
  required permission, HTTP status, SUCCESS/FAILURE, IP, body **field names only**. Explicit, richer entries remain for sign-in, MFA,
  permissions, vendor staff, business config, Hatly Service pricing, sector switch (no double entries; reviewed list pinned in e2e 94).
* **Fail-closed vs resilient.** The interceptor runs after the handler committed, so it is *resilient*: an audit-write failure is
  logged loudly (`AUDIT WRITE FAILED`) and the completed action is not reversed. Reason: the money-moving actions already persist
  durable, append-only domain records inside their own transactions (financial events with idempotency keys, payments with the
  verifier, settlement periods with `closedByUserId`, wallet ledger), so the audit log is the cross-cutting index, not the source of
  truth. Explicit audit calls that pass the action's `manager` are effectively fail-closed (a failed insert aborts that transaction).
  The table stays append-only (DB trigger); no deletion path was added. **Read side (launch-readiness G-11):** `GET /admin/audit-logs` (permission `VIEW_AUDIT_LOG`, SUPER_ADMIN bypass) and the dashboard **Audit log** page list it — read-only, exact-match filters, no phone numbers in the response; e2e `100-admin-audit-log-viewer`.
* Monitoring events (one WARN JSON line, no body/query/token/phone): `security.auth_failed`, `security.access_denied`,
  `security.rate_limited`, `security.financial_rejected`, `mfa.secret_undecryptable`, `external_provider.failed` (now incl. `timeout`).

## 9. Environment, migration notes, staging validation

* **New/changed env:** `MFA_ENCRYPTION_KEY` (required in production/staging; generate once, never change), `ALLOW_UNAUTHENTICATED_REDIS`
  (acknowledgement only), Redis URL must carry a password in production/staging. No database migration in this milestone.
* **Runtime:** Node ≥ 22 (firebase-admin 14). Rebuild both images.
* **Staging validation:** (1) `init-staging-env.sh` on a fresh host → key present; (2) build both images on Node 22; (3) boot → no
  config errors; (4) `deploy/staging/smoke.mjs`; (5) send one real FCM push (firebase-admin 14 in a real environment — the unit tests
  mock the SDK); (6) confirm `admin_audit_logs` gets `admin.mutation` rows; (7) check logs for `security.*` events; (8) a geocode burst
  → 429 after 30/min.

## 10. Follow-up verification (2026-10-16, overnight milestone)

Found and fixed after this report: the staging backend image would not have started (production packages nested under `apps/backend/node_modules` were not
copied into the runtime stage), CI ran Node 20, `npm run start:prod` pointed at a non-existent file. Details, evidence and the Staging-only checks:
[staging-readiness-checklist.md](staging-readiness-checklist.md). Image builds are still unexecuted (no Docker on the development Mac).

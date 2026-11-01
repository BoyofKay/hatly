# Staging readiness checklist (prepared 2026-10-16)

**Status: the only things done against Staging are read-only requests to its public HTTPS endpoints (§11). Nothing in §3–§8 has been executed there.** This file separates what was verified on the local working tree (§1–§2)
from what can only be verified on the real Staging stack (§4 onward). Follow it top to bottom; stop at the first failed step.
Companion documents: [RUNBOOK](../../deploy/staging/RUNBOOK.md) (how to deploy), [mfa-rollout.md](mfa-rollout.md),
[security-milestone-2026-10-16.md](security-milestone-2026-10-16.md), [dependency-audit.md](dependency-audit.md).

## 1. Required versions

| Item | Required | Where it is pinned |
|---|---|---|
| Node.js | **>= 22** (firebase-admin 14 and its Google client libraries declare `engines >=22`; Node 20 is end-of-life) | root `package.json` `engines`; CI (`.github/workflows/ci.yml`, 3 jobs); `node:22-bookworm-slim` in both Dockerfiles |
| Backend image | `deploy/staging/backend.Dockerfile` (build context = repository root) | multi-stage: prod-deps → build → runtime; `CMD node dist/src/main.js` |
| Dashboard image | `deploy/staging/dashboard.Dockerfile` (needs build arg `NEXT_PUBLIC_API_BASE_URL`, baked in at build) | `next start -p 3001` |
| PostgreSQL / Redis | `postgres:16-alpine`, `redis:7-alpine` (compose) | `deploy/staging/docker-compose.staging.yml` |

Guarded by `apps/backend/src/config/deployment-consistency.spec.ts` (CI Node major = `engines`; Dockerfile Node majors; `start:prod` and `CMD`
paths; nested production `node_modules` are copied into the image — see §2, item D1).

## 2. Verified locally (current working tree, 2026-10-16)

| Check | Command | Result |
|---|---|---|
| Backend typecheck | `npx tsc --noEmit -p apps/backend/tsconfig.json` | clean |
| Backend unit | `npm test --workspace=apps/backend -- --ci` | 152 suites / 2,265 tests passed |
| Backend integration (dedicated DB + Redis DB, reset per run) | `npm run test:integration --workspace=apps/backend -- --ci` | 23 suites / 299 tests passed |
| Backend e2e | `NODE_OPTIONS=--max-old-space-size=6144 npx jest --ci --config test/jest-e2e.json --runInBand --forceExit` (in `apps/backend`) | 53 suites / 798 tests passed (2026-10-16 evening, after the audit-log viewer was added; earlier: 52 / 791) |
| Backend build | `npm run build --workspace=apps/backend` | OK; entry point is `dist/src/main.js` |
| Dashboard | `npx tsc --noEmit` and `npm run build` (in `apps/dashboard`) | clean / OK |
| Dashboard Playwright (backend rebuilt from the current source; real login throttle untouched) | `npx playwright test` (in `apps/dashboard`) | 117 passed, 0 failed, 1 skipped (earlier: 113; +4 for the audit-log page; see note) |
| Customer app | `flutter analyze` / `flutter test` | 28 infos (no errors/warnings; same count as the recorded baseline) / 997 passed |
| Driver app | `flutter analyze` / `flutter test` | 2 infos (pre-existing) / 53 passed |
| Lockfile | `npm ci --dry-run`; `npm ci --omit=dev --workspace=apps/backend --include-workspace-root --ignore-scripts` in a scratch copy | OK |
| Production audit | `npm audit --omit=dev` | 8 advisories: 0 critical, 0 high, 7 moderate, 1 low — [dependency-audit.md](dependency-audit.md) |
| Shell / YAML / JS syntax | `bash -n deploy/staging/*.sh`; YAML parse of `ci.yml` and `docker-compose.staging.yml`; `node --check deploy/staging/smoke.mjs` | OK |
| Whitespace | `git diff --check` | clean |
| **Docker** | `which docker` | **not installed — no image has been built or run**. Everything below is a scratch-layout simulation, not an image build |
| Backend runtime layout (scratch copy of the Dockerfile stages: `npm ci --omit=dev …` + `dist` + nested `node_modules`) | boot in `NODE_ENV=staging` against a disposable DB and a password-protected throw-away Redis | boots; `/health/ready` database+redis up; strict-mode refusals verified: localhost DB/Redis, missing `MFA_ENCRYPTION_KEY`/`REDIS_URL`/`CORS_ALLOWED_ORIGINS`/`JWT_REFRESH_SECRET`, Redis URL without password, `TRUST_PROXY=true`, malformed MFA key, wildcard CORS — each exit 1 with a secret-free message |
| Dashboard runtime layout (scratch copy of the build + runtime stages, API URL baked in) | `npm ci --workspace=apps/dashboard …`, `next build`, `next start -p 3001` | build OK; 15.6 KB compiled CSS; bundle contains the staging API URL, no `localhost:3000`; CSP `connect-src 'self' https://api-sales.hatly.dev`, frame-ancestors none, `/_next/image` 404 |
| Migration rehearsal (disposable local databases, compiled code, same CLI command as `staging.sh`) | `typeorm migration:show/run/revert` | empty DB: 59 pending; all 59 apply; five reverted → exactly the expected 54 applied / 5 pending in the documented order; forward again OK; schema checked (trigger, columns, tables); append-only trigger refuses UPDATE and DELETE on a committed row; reverting 58 drops the table and its rows |
| Backup/restore rehearsal | `pg_dump -Fc` → migrate → `pg_restore` into a NEW database | restored DB is back at 54 applied / 5 pending |
| Dashboard session flow on the strict-mode runtime (simulation-only admin in the disposable DB) | `curl` | cookies `HttpOnly; SameSite=Strict; Secure`, no token in the JSON body; write without CSRF token → 403, wrong token → 403, valid token → 200, valid token + foreign Origin → 403; refresh without `X-Requested-With` → 403, with it → 200, foreign Origin → 403; logout revokes the refresh cookie (reuse → 401); a deactivated admin is rejected immediately (`me` 401, login 401) |
| Rate limits on the strict-mode runtime | 13 wrong logins | 10 × 401, then 429; limited by client IP (a second client IP with another phone is unaffected) **and** by phone (a second client IP with the same phone is limited); extra left-hand `X-Forwarded-For` entries do not change the bucket (`TRUST_PROXY=1`) |
| SIGTERM | probe, see D8 | hook runs after the fix |

Notes: (a) One Playwright run showed a single failure (`admin-control-tower` › "…assigned from the ORDER DETAIL page", `order-operations` not
visible within the 5 s expect); it passed 3/3 in isolation and in the next full run. The failure screenshot shows the page rendered, so the
likely cause is the first on-demand compile of that route by the Next dev server — **a cause that was not proven**. (b) The login rate limit
(10/min per client) correctly blocked back-to-back suite reruns; wait ~2 minutes between Playwright runs. (c) Flutter and the e2e/integration
counts are local only; no Staging data was read or written.

### Defects found and fixed in this milestone

| ID | Defect | Fix | Evidence |
|---|---|---|---|
| D1 | **Staging backend image would not start.** `npm ci --omit=dev` places `firebase-admin` 14.5.0 and 32 other production packages under `apps/backend/node_modules`; the image's runtime stage copied only `/repo/node_modules` → `Cannot find module 'firebase-admin/app'` at boot (the push provider imports it eagerly). Docker is not installed here, so this was reproduced by recreating the stage layout in a scratch directory | runtime stage now also copies `/repo/apps/backend/node_modules` | scratch reproduction: `MODULE_NOT_FOUND` before, loads after; `deployment-consistency.spec.ts` fails against the old Dockerfile and passes now. **A real `docker build` + boot is still required (§4)** |
| D2 | CI ran Node 20 (3 jobs) while the code requires Node 22 | `node-version: 22` | `deployment-consistency.spec.ts` |
| D3 | `npm run start:prod` ran `node dist/main`, which does not exist | `node dist/src/main` | `deployment-consistency.spec.ts` |
| D4 | `apps/backend/.env` was mode 644 | `chmod 600` (metadata only; contents never read) | `stat` |
| D5 | Stale docs (54 migrations as the current total; superseded dependency tables) | reconciled, history kept and labelled | RUNBOOK §5, dependency-audit.md |
| D7 | Dashboard compiled no Tailwind outside the staging image (no `postcss.config.js` in the repo) | config file added; Dockerfile asserts it | build size before/after; Playwright 113 passed |
| D8 | **No graceful shutdown.** `main.ts` never called `app.enableShutdownHooks()`, so on SIGTERM (`docker stop`, a rolling deploy) Node died on the signal and the `OnApplicationShutdown`/`OnModuleDestroy` code (Redis quit, throttler store, wait for the dispatch sweep) never ran | `app.enableShutdownHooks()` in `main.ts` (not in `configureApp`, which the test harnesses call per app) | probe on the compiled backend: Redis `quit` ran on SIGTERM with the hook (1) and not without it (0); `deployment-consistency.spec.ts` |
| D9 | `smoke.mjs` always registers a customer, so it could not be run against an environment whose data must not change | new `--read-only` flag skips the writing block; new read-only `security-smoke.sh` | both run against the local rehearsal and the live Staging endpoints (§11) |
| D6 | Three untracked 70-byte PNGs in `apps/backend/` | removed — byte-identical to the test fixture `PNG_1X1_BASE64`, UUID-named by the upload provider, dated Oct 3 (before e2e uploads moved to a temp dir), referenced nowhere | `sha1` equal, `git status`, grep |

## 3. Before touching the Staging database

> The full, ordered, gated sequence (evidence → keep old images → backup → build → image checks → plan → migrate → start → smoke → rollback) is **RUNBOOK §9**. Run `deploy/staging/staging-evidence.sh` on the VPS first: it reads the migrations table directly, because `./staging.sh plan` can only show the migrations compiled into the image that is built at that moment (the old image knows 54, not 59).

1. **Verified backup first** — exact commands (and the restore test) are in [RUNBOOK §5](../../deploy/staging/RUNBOOK.md). A dump counts only after `pg_restore -l` lists its table data (54 tables at 54 migrations). Rehearsed locally: dump → migrate → restore into a new database → back at 54 applied / 5 pending.
2. **Reviewed plan.** `./staging.sh plan` is read-only (target guard + `typeorm migration:show`). Required output: target
   `postgres/hatly_staging`, `NODE_ENV=staging` (or the documented fallback), `OK (isolated staging)`.
3. **Expected plan** — 54 migrations applied (`[X]`, last one `1700005300000-OrderStatusCollected`) and exactly these five pending, in this order:

   | # | Migration file (`apps/backend/src/database/migrations/`) | Nature |
   |---|---|---|
   | 55 | `1700005400000-CustomerNotifications` | new table + index |
   | 56 | `1700005500000-SectorCustomRequests` | new column with default |
   | 57 | `1700005600000-ProductOptionSelectionLimits` | new columns + check constraint |
   | 58 | `1700005700000-AdminAuditLogs` | new table + append-only trigger |
   | 59 | `1700005800000-StaffMfaCredentials` | new table |

   All five are additive (no `DROP`/rewrite in `up`), so the previous application version keeps working on the new schema. Anything
   different from this list: **stop**.
4. **`./staging.sh migrate` needs its own explicit approval** from the person responsible, given after the plan above was reviewed.
   Afterwards run `./staging.sh plan` again: no `[ ]` left.

## 4. Environment variables (names only — never write values into tickets, logs or this repository)

Source of truth: `deploy/staging/env.staging.template` (generated into `/opt/hatly-staging/.env.staging`, mode 600, by `init-staging-env.sh`).
Check presence without printing: `grep -c '^NAME=' /opt/hatly-staging/.env.staging` per name, or `./staging.sh validate`.

- **Database/Redis:** `STAGING_DB_NAME`, `STAGING_DB_USER`, `STAGING_DB_PASSWORD`, `STAGING_REDIS_PASSWORD`, `DATABASE_URL`, `REDIS_URL` (must carry the Redis password), `DB_SSL`, `ALLOW_INSECURE_DB`
- **Runtime/proxy:** `NODE_ENV`, `PORT`, `API_PREFIX`, `TRUST_PROXY`, `STAGING_PUBLIC_API_URL`, `STAGING_API_HOST_PORT`, `STAGING_DASHBOARD_HOST_PORT`, `ENABLE_API_DOCS` (must stay `false`)
- **Browser access:** `CORS_ALLOWED_ORIGINS` (exact dashboard origin, never `*`)
- **Secrets:** `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, **`MFA_ENCRYPTION_KEY`**, `DASHBOARD_ADMIN_MFA_REQUIRED` (stays `false` until §7 step 5)
- **Storage/maps/providers:** `STORAGE_DRIVER`, `UPLOADS_LOCAL_DIR`, `UPLOADS_PUBLIC_URL_PREFIX`, `MAPS_PROVIDER`, `GOOGLE_MAPS_API_KEY`, `ALLOW_MISSING_SMS_PROVIDER`, `ALLOW_MISSING_PUSH_PROVIDER`, `OTP_LOG_CODE_FOR_LOCAL_DEV` (must be `false`), `SEED_ALLOW_DATABASE`, `DEFAULT_CITY`, `DEFAULT_CURRENCY`
- **Push (only when FCM is configured):** `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` (all three or none — the boot validator refuses a partial set)
- **Optional acknowledgement:** `ALLOW_UNAUTHENTICATED_REDIS` (do not set; Staging Redis has a password)
- **Dashboard build arg:** `NEXT_PUBLIC_API_BASE_URL` (HTTPS API URL; baked into the bundle and into the CSP `connect-src`)

The backend refuses to boot (clear `ConfigurationError`, no secret in the message) when a required value is missing, `MFA_ENCRYPTION_KEY` is not
32 bytes of base64, the Redis URL has no password, or `TRUST_PROXY` is `true`/`*`.
An **existing** `.env.staging` does not get `MFA_ENCRYPTION_KEY` automatically — the line must be added by hand (generate with `openssl rand -base64 32`,
store it with the other secrets, back it up; losing or changing it forces every admin to re-enrol).

## 5. Hostnames, cookies, CORS, proxy, Redis — checks on the deployed stack

First run the read-only script — it covers 5.2, 5.3, 5.7 and the unauthenticated part of the session routes: `deploy/staging/security-smoke.sh --api https://api-sales.hatly.dev/api/v1 --dashboard https://sales.hatly.dev`. It needs no credentials and writes nothing. The rest below needs an operator.

Hostnames per RUNBOOK §2: dashboard `https://sales.hatly.dev`, API `https://api-sales.hatly.dev/api/v1`. They must share a registrable
domain: the dashboard cookies (`hatly_at`, `hatly_rt`, `hatly_sid`) are `HttpOnly; SameSite=Strict` (and `Secure` when the request arrived over TLS
through the configured proxy), so a dashboard on a different site would never be authenticated.

| # | Check (Staging only) | How | Pass criterion |
|---|---|---|---|
| 5.1 | Cookie attributes | sign in on the dashboard, inspect the three cookies in the browser's storage panel | all `HttpOnly`, `Secure`, `SameSite=Strict`; no token in `localStorage`/`sessionStorage` |
| 5.2 | CORS (note: for a foreign origin the API still sends `Access-Control-Allow-Credentials: true` but **no** `Allow-Origin`, so the browser rejects the response — harmless, verified) | `curl -si -H 'Origin: https://sales.hatly.dev' https://api-sales.hatly.dev/api/v1/health` and the same with `Origin: https://evil.example` | first returns `Access-Control-Allow-Origin: https://sales.hatly.dev` + `Allow-Credentials: true`; second returns no allow-origin |
| 5.3 | Security headers | `curl -sI https://sales.hatly.dev/login` | `content-security-policy` with `frame-ancestors 'none'` and `connect-src` containing the API origin, `x-frame-options: DENY`, `x-content-type-options: nosniff` |
| 5.4 | `TRUST_PROXY=1` | one request through the HTTPS edge, then read the `ip` in a `security.*` log line (e.g. a wrong-password login) | the real client address, not the Docker bridge or a Cloudflare address; if the orange cloud is enabled, revisit `TRUST_PROXY` (RUNBOOK §2) |
| 5.5 | Rate limits keyed per client | 11–12 wrong logins for ONE made-up phone from one address → 429 (`security.rate_limited` logged). A second address with a *different* phone is unaffected; the same phone from another address is limited too (the login limit has a per-phone dimension). Use made-up phones so no real account's failure brake is touched | as described |
| 5.6 | Redis | `docker compose … exec redis redis-cli ping` without a password must answer `NOAUTH`; `ss -ltnp \| grep -E ':(5432\|6379)\b'` shows nothing published; backend log has no "REDIS_URL is not TLS" error (a warning is acceptable only because Redis is on the private compose network) | as described |
| 5.7 | Swagger off | `curl -si https://api-sales.hatly.dev/docs` and `…/api/v1/docs` | 404 (both) |
| 5.8 | Media | upload one image; open its `/uploads/files/<uuid>.<ext>` URL | served. Remember the documented limit: private uploads are capability URLs (§9) |

## 6. Smoke tests and browser validation

* **Run (safe on any state):** `node deploy/staging/smoke.mjs --read-only --api https://api-sales.hatly.dev/api/v1 --dashboard https://sales.hatly.dev` — GET/OPTIONS and unauthenticated requests the auth guard refuses; writes nothing.
  The default (no flag) also **registers and logs in one throw-away customer** (random phone, random password; registration is limited to 5/min per client) — run it only
  with approval for that one row of test data.
* **Playwright is NOT a Staging-safe suite.** `apps/dashboard/e2e` provisions fixture accounts, orders and a business-config value through the admin API in
  `global-setup.ts`, needs a known SUPER_ADMIN password, and `security-headers.spec.ts` pins `connect-src … http://localhost:3000`. Do not point it at
  Staging without separate approval and Sales-data decisions; use 5.1–5.8 above and the manual dashboard walk in §7 instead. (To run the suite locally:
  `apps/dashboard/e2e/README.md`.)

### Controlled FCM push (once the three `FCM_*` variables are configured)

1. On a tester phone with the customer app, sign in as a **tester** account (not a real customer); the app registers its device token through `POST /customer/device-token`
   (`{ token, platform }`) — nothing to type by hand and no credential is exposed.
2. Cause one customer-visible order event for that tester's own order (e.g. place a tester order and have a tester ops/admin account advance its status).
3. Expected: the push arrives on the phone, a `customer_notifications` row exists for that order, and the backend log has **no** `external_provider.failed` line with `provider":"fcm"`.
4. If nothing arrives: look only at that log line's `operation`/category (it never contains the key); do not paste or echo `FCM_PRIVATE_KEY`.

## 7. MFA rollout sequence (procedure: [mfa-rollout.md](mfa-rollout.md); the policy stays OFF until step 5)

1. **Key.** Ensure `MFA_ENCRYPTION_KEY` is set in `.env.staging` *before any admin enrols*; restart the backend. It must never change afterwards.
   `DASHBOARD_ADMIN_MFA_REQUIRED=false`.
2. **Pre-check (read-only):** `SELECT count(*) FILTER (WHERE enabled_at IS NOT NULL) AS enabled, count(*) AS rows FROM staff_mfa_credentials;` — expect 0 / 0 after migration 59.
3. **Enrol at least two SUPER_ADMIN accounts** (dashboard → Security): authenticator code, **store the 8 recovery codes offline**.
4. **Verify login and recovery for each:** sign out → password → code prompt → signed in; then sign in once with a recovery code (it is one-time), and
   confirm a SUPER_ADMIN can reset the other (`DELETE /admin/users/:id/mfa`, audited). Enrol the ADMIN accounts the same way.
5. **Only then — and only with explicit authorisation —** consider `DASHBOARD_ADMIN_MFA_REQUIRED=true` and a restart. From then on an un-enrolled admin can only reach
   enrolment. Rollback: set it back to `false` and restart; never remove or change the key.
6. **Emergency (last SUPER_ADMIN locked out, no recovery codes):** database break-glass in [dashboard-sessions-mfa-audit.md](dashboard-sessions-mfa-audit.md) §2 — requires
   a recorded, two-person decision.

## 8. Rollback, compatibility, monitoring

* **Application rollback:** `./staging.sh down` keeps volumes. Re-deploy the previous image tag. Because the five migrations are additive, the previous
  version runs on the new schema; the previous version simply ignores the new tables/columns. (Sign-in for dashboards on the *previous* build would not use
  the cookie sessions — roll the dashboard and API back together.)
* **Schema rollback:** each migration has a `down`, but `typeorm migration:revert` on Staging is a data-affecting action — never without a fresh backup and approval.
  Note `admin_audit_logs` is append-only by trigger: reverting migration 58 drops the table and the history in it.
* **Restore:** restore from the §3 dump into a *new* database first; never over a running one.
* **Watch after deploy** (backend logs, one JSON line per event): `security.auth_failed`, `security.access_denied`, `security.rate_limited`,
  `security.financial_rejected`, `mfa.secret_undecryptable` (must be 0), `external_provider.failed`, `AUDIT WRITE FAILED` (must be 0). Confirm `admin_audit_logs` receives
  `admin.mutation` rows after one dashboard change, and `/health/ready` reports database + redis.
* **Push:** firebase-admin 14 has only been exercised with mocked SDK calls — send one real FCM push once credentials exist.

## 9. Review matrix (current code and documents, 2026-10-16)

Legend: **V** verified safe behaviour (evidence named) · **D** confirmed defect (fixed → see §2) · **S** unverified, needs Staging · **R** accepted residual risk needing an explicit decision.

| Area | Class | Evidence / note |
|---|---|---|
| Dashboard cookie sessions, refresh rotation + reuse detection, server-side logout, CSRF | **V** | e2e 92 (23), Playwright `dashboard-session.spec.ts`; **S**: cookie `Secure` flag and real-hostname behaviour (§5.1) |
| Access cookie after logout | **R** (observed) | logout revokes the *refresh* session server-side; an already-issued access JWT keeps working until its 15-minute expiry (stateless access token). Deactivation is immediate (DB liveness check), logout is not. Accept, or shorten the TTL / add a session check |
| CORS exact origins with credentials; proxy / client-IP | **V** (code, e2e 72, env validation) / **S** (real edge, §5.2, §5.4) | |
| MFA key requirement, enrolment, recovery, reset | **V** (e2e 92, key-rollout spec, env validation) / **S** (§7) | key loss = every admin re-enrols; recorded in mfa-rollout.md |
| Redis authentication / TLS | **V** boot rule (env validation spec) / **S** staging network (§5.6) | non-TLS `redis://` is accepted only as a warning on a private network |
| Object-level authorization, identifiers | **V** | e2e 91 (IDOR ratings/checkout), 93 (identifier sweep), 96 (object isolation), route-inventory test (every route guarded) |
| Rate limiting: auth, geocoding (paid), financial | **V** | e2e 78/98; observed live in this milestone (login 429 under repeated suite runs); **S**: per-client keying behind the real proxy (§5.5) |
| Private media capability URLs | **R** | unguessable (122-bit) but never expire and are not tied to a user; fix = visibility flag + signed URLs (dedicated change) |
| Financial idempotency, refunds, settlement, concurrency | **V** | e2e 50/62/63/66/67/80/85/91, integration `transaction-rollback`, `settlement-calculation`; F2 fixed earlier. **Unresolved:** the earlier one-off `settlement-calculation` failure (original output lost; ~100 clean runs; cause unproven — a same-millisecond `periodEnd` race that the spec now avoids is the leading, unproven hypothesis) |
| Audit log coverage and append-only behaviour | **V** | e2e 94; trigger refuses UPDATE/DELETE (migration 58). **R (retention):** the table grows without bound; its FK to `users` has no cascade, so an actor with audit rows can never be hard-deleted (no user-deletion path exists today); `TRUNCATE`/owner-level DDL are not blocked by a row trigger. A retention/erasure policy needs a decision before launch |
| Pagination / resource caps, driver and customer data minimisation | **V** (caps, e2e 93, unit specs) / **R** | driver app keeps past customers' phone/address for the newest 200 finished deliveries; admin-only lists unbounded |
| Registration account enumeration | **R** | inherent when `CUSTOMER_OTP_ENABLED` is off; keep OTP on once an SMS provider exists |
| Dependency advisories | **R** | 8 moderate/low, all need a Nest major; none reachable per analysis — [dependency-audit.md](dependency-audit.md); the dev-only tree has 1 critical / 44 high |
| Dashboard builds outside Docker rendered unstyled | **D (fixed, D7)** | `apps/dashboard/postcss.config.js` added (identical to the config the staging image used to inject); clean build → 15.6 KB stylesheet (was ~900 B of raw `@tailwind` directives); full Playwright 113 passed; the image build now asserts the file exists; guarded by `deployment-consistency.spec.ts` |
| Docker images actually build and boot | **S** | not executable here (no Docker); D1 was found by static/scratch reproduction only |
| Mock noise in unit logs (`manager.transaction is not a function`) | note | test double lacks a savepoint-capable manager; the code path is best-effort by design; tests pass |

## 10. What only Staging can confirm (not done)

Docker image builds and boot (§4 of the RUNBOOK) · the five migrations (§3) · cookie `Secure`/host behaviour, CORS, client IP, Redis `NOAUTH`, header checks (§5) ·
`smoke.mjs` (§6) · MFA enrolment, recovery and reset with real devices (§7) · a real FCM push · restore test of the pre-migration dump.

## 11. Live Staging observations (2026-10-16, read-only, public endpoints only)

Hostnames come from the repository (`RUNBOOK.md`): API `https://api-sales.hatly.dev/api/v1`, dashboard `https://sales.hatly.dev` — both resolve to `152.228.240.4`, ports 22/80/443 answer,
TLS validates. **No SSH or Compose access was attempted**: the runbook records that this Mac's key is not authorised and no account name is configured (guessing one would be circumventing
access). Consequently nothing inside the host was inspected: image tags, Node runtime, migration status, `.env.staging` contents and Redis/Postgres exposure are **unknown**.

| Observation | Result |
|---|---|
| `GET /health`, `/health/ready` | 200, `database: up`, `redis: up` |
| `security-smoke.sh` | 8 FAIL, 1 WARN — all consistent with a **pre-milestone build** (below) |
| `smoke.mjs --read-only` | all checks passed (guest endpoints, CORS allow/deny, 401s, dashboard HTTPS, bundle built against the staging API URL, no localhost URL) |
| `GET /auth/dashboard/me` | **404** (an up-to-date build answers 401) → the cookie-session API is not deployed |
| Dashboard `/login` headers | only `cache-control` and `x-powered-by` — **no CSP, no `x-frame-options`, no `nosniff`** → the new dashboard build is not deployed |
| CORS for the approved origin | `Allow-Origin` correct, **no `Allow-Credentials`**; preflight does not allow `X-CSRF-Token` → old CORS code |
| API headers | `nosniff`, `DENY`, `no-store`, CSP `default-src 'none'`, rate-limit headers present; **no `Strict-Transport-Security`** (consistent with the documented fallback `NODE_ENV=development`, which switches strict mode — including HSTS — off) |
| Swagger | `/docs`, `/api/v1/docs`, `/api/docs` → 404 |
| Dashboard stylesheet | 15 KB compiled (the old image injected the PostCSS config) |

Conclusion (verified facts only): Staging is up and healthy but is running the **pre-security-milestone code**; every item in §3–§8 therefore still applies. Not verified: migration status
(the five migrations are assumed pending because the new routes are absent — only `./staging.sh plan` on the VPS can confirm it).

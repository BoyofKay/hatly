# Staging update plan — bring the Staging VPS to the current build (PLAN ONLY; nothing below has been executed)

Prepared 2026-10-17 after a **read-only inspection** of the VPS on 2026-10-16 21:50–22:05 UTC (SSH as `ubuntu`, the account recorded in the 2026-10-12 session; every remote command was a read: `docker ps/diff/logs`, `stat`, `find`, `sha256sum`, `journalctl`, and SELECTs in a session forced read-only — a `CREATE TABLE` probe was refused as expected). Nothing on the server was modified, restarted, copied to, or deployed. Secrets were never printed (variable *names* only).

## 1. Verified current state of Staging (2026-10-16)

| Area | Finding |
|---|---|
| Host | `152.228.240.4`, Ubuntu 24.04.5, 6 vCPU, 11.7 GB RAM (10.5 GB available), 96 GB disk (82 GB free), Docker 29.9.0 / Compose 5.6.0; up 7 days |
| Containers (compose project `hatly-staging`, file `/opt/hatly-staging/hatly/deploy/staging/docker-compose.staging.yml`) | `backend` (127.0.0.1:13000), `dashboard` (127.0.0.1:13001), `postgres:16`, `redis:7`, `caddy:2` (80/443) — all up 4 days, **healthy, 0 restarts** |
| Deployed images | backend `hatly-staging-backend:local` = `c6faf4e9f254`, built 2026-10-12 04:20 UTC; dashboard `hatly-staging-dashboard:local` = `5ec0a892ff79`, built 04:16 UTC. **Node 20.20.2** in both. Dashboard is **Next 14.2.35** |
| Source on the server | `/opt/hatly-staging/hatly` = the 2026-10-12 bundle **exactly**: 950 of the bundle's 952 files byte-identical; the 2 that differ are the two documented hand-copies (`apps/backend/src/scripts/seed-dev-marketplace.ts`, `deploy/staging/staging.sh`); nothing in the tree was modified after 2026-10-12 04:22 UTC. `staging.sh` on the server is identical to the Mac's. Plus 962 macOS `._*` junk files (AppleDouble) from the owner's initial manual upload at ~00:08 UTC on 10-12 — harmless, gone after the planned side-by-side swap |
| Config (`/opt/hatly-staging/.env.staging`, mode 600, last written 2026-10-12 04:14) | 31 variable names; `NODE_ENV=development` (the documented fallback), `MAPS_PROVIDER=deterministic`, `TRUST_PROXY=1`, `CORS_ALLOWED_ORIGINS=https://sales.hatly.dev`, `ENABLE_API_DOCS=false`, Redis URL has a password (unauthenticated probe answers `NOAUTH`), JWT secrets distinct and ≥ 32 chars. **Missing:** `MFA_ENCRYPTION_KEY`, `DASHBOARD_ADMIN_MFA_REQUIRED`, Google Maps key, FCM trio (explicitly acknowledged via `ALLOW_MISSING_*`) |
| Database `hatly_staging` | 12 MB; **54 migrations applied, exactly the five expected pending** (`CustomerNotifications`, `SectorCustomRequests`, `ProductOptionSelectionLimits`, `AdminAuditLogs`, `StaffMfaCredentials`) — read from the `migrations` table, none of the new tables exist. Data = test data only: 5 customers (all created 10-12), 2 drivers, 1 vendor, 1 vendor manager, 1 admin, 1 super admin; 15 vendors / 16 branches / 76 products / 7 sectors / 8 offers; 11 orders (6 PENDING, 1 READY_FOR_PICKUP, 1 DELIVERED, 3 CANCELLED; newest 2026-10-13 21:45) |
| Media | volume `hatly-staging_uploads`: 114 files, 7.5 MB |
| Edge | Caddy serves exactly the two staging hostnames (live config = repo file); Let's Encrypt certificates valid to **2027-01-10**, renewing normally; UFW allows only SSH/80/443 |
| Logs | backend: no errors (only `fcm not_configured` warnings at boot and one `no_eligible_driver` alert from a 10-12 test order); dashboard: 87 "Failed to find Server Action" errors = **internet scanners probing the public Next 14 dashboard**; caddy: client disconnects only |
| Everything else on the box | untouched: the owner's production-preparation area `/opt/hatly-git` (compose, `.env.production`, backups under `/opt/hatly-backups`) and a Next dashboard dev server on 127.0.0.1:3100 since 10-10 — **out of scope, not inspected beyond `git status`** |
| Host security observations (not part of this update) | `sshd` has `PasswordAuthentication yes`, `fail2ban` inactive: **42,802 failed SSH password attempts and 60 accepted logins since 10-12** (internet noise; no sign of compromise — no unexplained interactive login or sudo command that I could find; the human logins are 2026-10-09 to 10-12, and every later sudo command traces to the recorded sessions). Recommend key-only SSH + fail2ban as a **separate approval** |

### What is server-only (must be preserved — none of it lives in the images)

1. **Database contents** (volume `pgdata`): seed + testers + 11 orders + the **2026-10-13 fixture fix** applied by the earlier session (Grilled-Chicken size deltas, two vendors' subcategory assignments). A rebuild/restart never touches it; migrations are additive.
2. **Uploads volume** (7.5 MB), **Caddy certificates**, **Redis data** (sessions) — all in named volumes outside the build.
3. **`.env.staging`** and **`.sales-credentials`** — outside the source tree; the update does not edit them.
4. **The 2026-10-12 source tree** (incl. the two hand-copied files) — kept as `hatly.pre-<date>` by the swap, and archived in the backup.
5. **The running images** — re-tagged `rollback-…` before the new build overwrites the `:local` tags.
6. **7 probe scripts** inside the backend container's `/tmp` (written by earlier sessions' `docker cp`) — ephemeral; the plan copies them out first, then they disappear when the container is recreated.
7. The Oct-12 bundle on the Mac (`~/Downloads/hatly-staging-bundle/`) is the exact copy of what is running — **do not overwrite it**; the new bundle goes in a new folder.

## 2. Differences between Staging and the Mac working tree

* **Backend routes: 217 on Staging, 246 on the Mac — 29 added, 0 removed** (static scan of the controllers; live probes confirm the key ones are 404 on Staging today). Because nothing was removed, the existing staging apps (Oct-12 APK, old dashboard) stay compatible.
* **The customer app (current Mac build) calls 59 endpoints; 54 exist on Staging; 5 do not — exactly the ones the closed test needs:** `GET /customer/notifications`, `GET /customer/notifications/unread-count`, `POST /customer/notifications/read-all`, `POST /customer/notifications/:id/read`, **`POST /auth/customer/delete-account`** (store requirement; Google reviewers may test it). Without the update the notification bell degrades silently (count 0) and the notifications screen errors; account deletion fails.
* **New backend + old database is broken, proven locally:** the new backend against a database at the 54 staging migrations returns **HTTP 500 on `GET /sectors`** (`column custom_requests_enabled does not exist`) — the app's home data. **Therefore migrations must run before the new backend starts.** The opposite order is safe: all five migrations are additive (new tables; new columns with defaults), so the *old* backend keeps working after `migrate` until it is replaced.
* Dashboard-only new routes (cookie sessions `/auth/dashboard/*`, MFA, audit log, product options): the old dashboard still works with the new API (bearer sign-in route `POST /auth/password/login` is kept). The new dashboard needs the new API. Best done together.
* Other changed behaviour customers can notice: option-selection limits, custom requests (off until a sector is switched on), loyalty idempotency, stricter rate limits, checkout/cart validation, map-provider timeouts, security headers/CSP, Node 20 → 22, Next 14 → 15.
* Size of the change: 55 backend runtime source files modified + 28 new; 12 dashboard runtime files modified + 7 new; the Dockerfiles, env template and `init-staging-env.sh`; 5 migrations; root `package.json`/lockfile (Next 15, firebase-admin 14, overrides).
* **Boot compatibility with the existing env file was verified offline:** the new backend's validator run against a synthetic copy of the staging env (names and non-secret values from the inspection) reports **0 errors, 0 warnings**. No env edit is needed. (Switching later to strict `NODE_ENV=staging` would require `MFA_ENCRYPTION_KEY` and a Maps key — not part of this update.)

## 3. The update, step by step (every ⛔ needs your explicit approval first; stop after each phase and report)

Exact commands are in `deploy/staging/RUNBOOK.md` §9 (refined 2026-10-17); this is the shape and the impact.

| Phase | What happens | Changes on the server | User impact | Gate |
|---|---|---|---|---|
| **0 Mac prep** | build the new bundle (`COPYFILE_DISABLE=1 tar …`, verified: no `._*`, no `.env*`, no keys), checksum it in a **new** folder | none | none | — |
| **1 Verified backup** | in `/opt/hatly-staging/backups/pre-update-<UTC>/` (mode 700): `backup-postgres.sh` (compose mode; `pg_dump -Fc`, listed with `pg_restore -l`, SHA-256 manifest — expect 54 migrations, < 1 MB); **restore drill** into a throw-away `hatly_drill_*` database (created and dropped, refuses any other name); tar of the uploads volume; tar of the current source tree; copies of `.env.staging` and `.sales-credentials` (stay on the server, never printed); the 7 probe scripts; `docker tag` of both running images as `rollback-<date>`; manifest | new directory + 2 image tags + a transient DB created/dropped in Postgres | none | ⛔ A1 |
| **2 Upload + side-by-side swap** | upload the bundle to `/opt/hatly-staging/incoming/`, verify SHA-256, `mv hatly hatly.pre-<date>`, extract the new tree into a fresh `hatly/`, check `staging.sh` hash and executable bits | `/opt/hatly-staging/hatly` replaced (old tree preserved) — **does not affect running containers** | none | ⛔ A2 |
| **3 Build only** | `./staging.sh validate && ./staging.sh build` → new images (Node 22, Next 15). Running containers keep using the old images. Then the no-network image checks (Node 22, `firebase-admin/app` resolves, user `node`, empty env → `ConfigurationError`) | the two `:local` image tags move to the new builds (old ones are protected by the rollback tags); ~2–3 GB disk; ~3–6 min | none | ⛔ A3 |
| **4 Plan** | `./staging.sh plan` — read-only in effect; **must** show 54 `[X]` and exactly the five `[ ]` in order; anything else stops the update | one throw-away container | none | (part of A3) |
| **5 Migrate** | `./staging.sh migrate` — one transaction; adds 3 tables + 3 columns (defaults) + 1 constraint + 5 rows in `migrations`; then `plan` must show no `[ ]` and the objects must exist | **schema change** (additive); no existing row is altered | none (old backend keeps serving) | ⛔ A4 |
| **6 Start the new apps** | `./staging.sh apps` recreates **backend and dashboard only**; Postgres, Redis, Caddy, volumes, networks and UFW are not touched. Customers' sessions survive (same JWT secrets, Redis kept). Health checks and logs watched until healthy | 2 containers recreated | **≈ 40–70 s of 502s**; dashboard users sign in again once (cookie sessions replace the old browser tokens) | ⛔ A5 |
| **7 Verify** | `security-smoke.sh` (expect all PASS except the known HSTS WARN, which stays until strict mode), `smoke.mjs --read-only`, the 5 new customer endpoints answer 401 not 404, a tester customer logs in and sees notifications, delete-account refuses a wrong password (do **not** delete a real tester), new dashboard login/refresh/logout, counts unchanged (5 customers, 11 orders, 76 products), no `ConfigurationError`/error spikes in logs | none | none | — |

Estimated total: 25–40 minutes, low-traffic window (only testers use Staging).

## 4. Rollback (and how the manual state is protected)

| Situation | Action | Notes |
|---|---|---|
| Build fails or image checks fail (phase 3–4) | nothing to roll back — the old containers never stopped | `docker tag` the rollback tags back if the `:local` tag moved |
| `migrate` fails | nothing applied (single transaction) — fix the cause and retry | verified behaviour (disposable-DB rehearsal) |
| New apps misbehave (phase 6–7) | `docker tag …:rollback-<date> …:local` for both images, `./staging.sh apps` (≈ 1 min). The additive schema stays; the old backend runs on it | database content is untouched either way |
| Source tree must go back | `mv hatly hatly.failed && mv hatly.pre-<date> hatly` | restores the two hand-copied files too |
| Data damage (not expected) | restore the verified dump into a **new** database via `restore-drill.sh <dump> --keep`, inspect, repoint deliberately; dropping/replacing the live DB is a separate approval | never `migration:revert` (drops the audit log / MFA secrets) |
| Anything unexpected | stop and report; do not improvise on the box | |

**Not part of this update, not touched:** `/opt/hatly-git`, port 3100, `/opt/hatly-backups`, UFW, SSH configuration, `.env.staging`/`.sales-credentials`, the volumes.

## 5. Risks

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| Build needs the network (npm registry, `cdn.sheetjs.com` for `xlsx`) | low — it worked on 10-12 | build is done before any switch; failure changes nothing |
| First compose-mode run of the backup/drill scripts (verified only in direct mode and with a Docker-less rehearsal) | low-medium | they run in phase 1 before anything else changes; a failure stops the update |
| Cookie sessions across `sales.hatly.dev` ↔ `api-sales.hatly.dev` | low — same registrable domain, DNS-only (no Cloudflare), exact CORS origin, `TRUST_PROXY=1` behind one Caddy | `security-smoke.sh` + a real sign-in in phase 7; rollback in 1 min |
| Stricter rate limits surprise testers (login 10/min per client and per phone) | low | announce; limits are deliberate |
| Existing Oct-12 APK/old dashboard compatibility | low — no routes removed | verified statically; checked live in phase 7 |
| Public Next 14 dashboard is being probed right now | exists today | the update moves it to Next 15 |
| The update is **not** a security-hardening of the host (SSH password auth, no fail2ban) | exists today | separate approval recommended |

## 6. The approval I need (smallest set)

**Approve phases 0–4 as one "prepare" go** (backup + verified restore drill + upload + side-by-side swap + build + plan — no change visible to users and fully reversible), **then, after I report the plan output, approve phases 5–6** (migrate + restart). Or approve each gate separately. Nothing is done until you say so.

## 7. Phases 0–4 EXECUTED on 2026-10-17 (owner approval: "prepare" only) — results

Server time of the run: 2026-10-17 03:43–03:50 UTC. **Not done and still waiting for your separate approval: phase 5 (migrate) and phase 6 (restart).** The live stack was never touched: after phase 4 the five containers have the same ids and uptime (backend/dashboard still on the `c6faf4e9f254` / `5ec0a892ff79` images), `https://api-sales.hatly.dev/api/v1/health/ready` answered 200 throughout (polled every 30 s during the build), the database still has **54** migrations / 11 orders / 11 users, no drill database remains, and `.env.staging` / `.sales-credentials` / the active source tree are unchanged (file counts and mtimes identical).

**Deviations from the plan, all in the direction of your boundaries:** (a) the new tree was extracted **beside** the active one (`/opt/hatly-staging/hatly-20261017`) instead of moving the active tree aside; (b) the new images were built under **separate tags** (`…:candidate-20261017`) via a compose override, so the running `…:local` tags never moved; (c) the plan was run with `docker run` from the candidate image on the `hatly-staging_internal` network with the same env file and the same target-guard logic as `staging.sh`.

| Phase | Result |
|---|---|
| **0 bundle (Mac)** | `~/Downloads/hatly-staging-bundle-20261017/` — 21.2 MB, 1,761 entries, sha256 `3b279911f05da3c2…`; 0 AppleDouble/env/key entries; the Oct-12 bundle folder is untouched and still verifies |
| **1 backup — location `/opt/hatly-staging/backups/pre-update-20261017T0343Z/` (mode 700, 16 MB, 16 files, every file verified against `MANIFEST.sha256`)** | `hatly-staging-20261017T034312Z.dump` (206,256 bytes, **54 table-data sections**, SHA-256 `b4ac820510cf…`, manifest json); **restore drill (compose mode, first real run): restored into `hatly_drill_20261017034326` → 54 tables, 54 migrations recorded, 11 users → `restore drill OK` → dropped (0 left)**; `uploads.tgz` (114 files, 7.5 MB); `source-tree-as-running-2026-10-12.tgz` (the exact running tree incl. the 2 hand-copied files); `env.staging.copy` and `sales-credentials.copy` (mode 600, never printed, stay on the server); `probe-scripts/` (the 7 container-only scripts); `containers-before.txt`, `compose-ps-before.txt`, `images-before.txt`; image tags `hatly-staging-backend:rollback-20261017` and `…dashboard:rollback-20261017` added. (My first manifest attempt tripped on a directory and was redone; the final one verifies 16/16.) |
| **2 side-by-side upload** | bundle in `/opt/hatly-staging/incoming-20261017/` (sha256 verified), extracted to `/opt/hatly-staging/hatly-20261017/` — 1,398 files, 0 junk, 0 env/key files; `staging.sh`, compose file and `Caddyfile.staging` hashes equal the Mac's (`f27b66fe…`, `db08f7fd…`, `318847d4…`). Tar printed harmless "unknown extended header keyword" warnings (macOS attributes in the archive; no files created). Active tree: 1,916 files, newest mtime 2026-10-12 04:21 — untouched |
| **3 build (only)** | both images built in ~3 min, **0 errors**, log `/opt/hatly-staging/build-20261017.log`; backend `fc54889aaffc` (703 MB), dashboard `d7abce803882` (1.31 GB); the dashboard stage ran `test -f apps/dashboard/postcss.config.js` successfully. Image checks (no network, no env): backend **Node v22.23.3**, user `node`, `firebase-admin` **14.5.0** resolves (`app` and `messaging` functions present — the nested-modules fix works in the real image), `dist/src/main.js` present with 177 migration-folder entries, CMD `node dist/src/main.js`, port 3000, AppModule loads with **0 `MODULE_NOT_FOUND`** and the expected `ConfigurationError` for the empty environment; dashboard **Node v22.23.3**, user `node`, **Next 15.5.27**, compiled CSS **15,652 bytes** with no raw `@tailwind`, `postcss.config.js` present, 27 bundle files embed the staging API URL, **0 embed `localhost:3000`** |
| **4 migration plan** | target guard: `postgres/hatly_staging \| NODE_ENV=development \| OK (isolated staging)`; `migration:show` exit 0 — **54 applied (last `54 OrderStatusCollected1700005300000`), 5 pending in exactly this order: `CustomerNotifications1700005400000`, `SectorCustomRequests1700005500000`, `ProductOptionSelectionLimits1700005600000`, `AdminAuditLogs1700005700000`, `StaffMfaCredentials1700005800000`**; 0 error lines. No migration was executed |

### Unexpected differences found (none blocks phases 5–6, one changes how phase 6 must be run)

1. **Compose convergence preview (`docker compose config --hash`): identical for postgres, redis, backend and dashboard; DIFFERENT for `caddy`** — the compose files are byte-identical, but the Caddyfile bind mount resolves to a different host path in the side-by-side directory. Consequence: if phase 6 were run from the new directory with a plain `up -d`, Caddy would be recreated (a short outage of the HTTPS edge). **Therefore phase 6 will run by a rename-swap so every path is identical to today** (`mv hatly hatly.pre-20261017 && mv hatly-20261017 hatly`; Caddy keeps its mount on the original file inode and its hash then matches), and only `backend` and `dashboard` are named in `up -d`. Compose recreates them because their image IDs change (the same behaviour that recreated the backend on 2026-10-12 after its rebuild).
2. Host disk after the build: 19 GB used / 77 GB free (was 15 / 82); memory unaffected (10.3 GB available); load peaked at 2.2 during the build.
3. Leftovers created by these phases (all additions; kept until you accept the update): `/opt/hatly-staging/{backups/pre-update-…, incoming-20261017, hatly-20261017, build-20261017.log}`, the two `rollback-20261017` tags, the two `candidate-20261017` images. **Do not run `docker image prune`/`docker system prune`.**

### Phases 5–6 as they will be run (unchanged by approval — nothing below has been executed)

* **Phase 5 migrate (⛔ A4):** guard + `migration:run` from the candidate image: `sudo docker run --rm --network hatly-staging_internal --env-file /opt/hatly-staging/.env.staging --entrypoint node hatly-staging-backend:candidate-20261017 /repo/node_modules/typeorm/cli.js -d dist/src/database/data-source.js migration:run`, then the same command with `migration:show` (no `[ ]` left) and the three new tables / three new columns present. One transaction; the old backend keeps serving on the additive schema.
* **Phase 6 restart (⛔ A5):** `docker tag …candidate-20261017 …:local` for both images (old ones stay as `rollback-20261017`) → rename-swap of the tree (above) → `config --hash` again must show all five services identical → `./staging.sh apps` → health/log checks → phase 7 verification.
* **Rollback after phase 6:** re-tag `rollback-20261017` as `:local`, `./staging.sh apps`; `mv` the trees back; the additive schema stays.

### Final safety review (2026-10-17, before phases 5–6)
`docs/launch/PHASE5_6_SAFETY_REVIEW.md` supersedes the phase 5–6 sketch above: the migration now runs through the guarded script `deploy/staging/phase5-migrate-guarded.sh` (target guard, plan assertion, lock/statement timeouts, post-assertion; rehearsed on disposable databases and its refusal paths run on the real candidate image with the network disabled), preceded by the read-only `phase5-preflight.sh` (passed on 2026-10-17). Phase 6 is the step-wise `phase6-switch.sh` (`check`, `retag`, `swap`, `backend`, `dashboard`, `verify`, `rollback-apps`, `rollback-tree`): it recreates only `hatly-staging-backend-1` and then `hatly-staging-dashboard-1` with `--no-deps --force-recreate`, and asserts that postgres, redis and caddy remain the original containers.



## 8. Phases 5–6 EXECUTED on 2026-10-17 (owner-authorized autonomous Staging update) — results

Full record in `LAUNCH_PROGRESS.md` §3j. Summary: rehearsal on a restored copy passed → `phase5-preflight.sh` passed → `phase5-migrate-guarded.sh` applied the five migrations on live (54 → 59, exit 0, one transaction) → `phase6-switch.sh check / retag / swap / backend / dashboard / verify` all OK (backend and dashboard healthy in 10 s each; Caddy, PostgreSQL and Redis are the original containers) → public smoke suites, route checks, log scan and rollback-artifact checks passed. Rollback was not needed; `rollback-20261017` image tags, `/opt/hatly-staging/hatly.pre-20261017`, the backup and the 114 uploads are intact. Outstanding: the owner-run authenticated checks (`deploy/staging/post-update-auth-checks.sh`).

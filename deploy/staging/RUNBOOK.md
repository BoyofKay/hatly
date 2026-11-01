# Hatly Sales Staging — runbook

Isolated staging on the existing VPS (`152.228.240.4`), separate from production. **Nothing here touches production**: its own
compose project (`hatly-staging`), network, PostgreSQL + Redis (own volumes/passwords, no published ports), env file and media
volume. Public access only through HTTPS: `https://sales.hatly.dev` (dashboard) and `https://api-sales.hatly.dev/api/v1` (API).

This file is the exact procedure; the final report says which steps actually ran. **All commands run on the VPS** as a user that
can `sudo docker`, unless stated otherwise.

## 0. What is needed from you (cannot be done from the Mac session)
1. **SSH access** for whoever runs this — the Mac session's key is not authorised on the VPS (every login attempt was refused).
2. **Cloudflare DNS** (zone `hatly.dev`): two new records — see §2. No existing record is changed.
3. **Maps decision** (§1): a Google Maps *server* key for staging, or the documented fallback.
4. **Sales-data choice** (§6).

## 1. Maps decision (needed before the backend can boot with `NODE_ENV=staging`)
Staging mode is strict (the backend refuses to start otherwise). It requires `MAPS_PROVIDER=google` **and** `GOOGLE_MAPS_API_KEY`
(delivery distance/fee at checkout). Recommended: a separate, restricted staging key (not the production one).

Fallback if no key is available right now — only for a Sales demo, explicitly weaker: run the backend with `NODE_ENV=development`,
`MAPS_PROVIDER=deterministic` (straight-line distances), keeping `ENABLE_API_DOCS=false`, `CORS_ALLOWED_ORIGINS`, `TRUST_PROXY=1`.
That switches off the strict boot checks (DB TLS acknowledgement, localhost bans, …), so prefer the key.

## 2. DNS / TLS
Create in Cloudflare (zone `hatly.dev`), pointing at the VPS public IP (confirm it with `preflight.sh`):

| type | name | content | proxy |
|---|---|---|---|
| A | `sales` | 152.228.240.4 | DNS only (grey) at first |
| A | `api-sales` | 152.228.240.4 | DNS only (grey) at first |

Why grey: Caddy gets its certificates by ACME, and `TRUST_PROXY=1` assumes exactly one proxy (Caddy) in front of the API. If you later
turn the orange cloud on, set SSL mode to **Full (strict)**, configure Caddy `trusted_proxies` for Cloudflare, and raise `TRUST_PROXY`
accordingly — otherwise every client looks like a Cloudflare IP and shares one rate-limit bucket. Production records are not touched.

Then add `Caddyfile.sales.snippet` to the **existing** Caddy configuration as new site blocks (`caddy validate`, then reload).

## 3. Source + preflight (read-only)
```bash
sudo mkdir -p /opt/hatly-staging && sudo chown "$USER" /opt/hatly-staging
# from the Mac:  scp ~/Downloads/hatly-staging-bundle/* <user>@152.228.240.4:/opt/hatly-staging/
cd /opt/hatly-staging && echo "$(cat hatly-sales-src.tar.gz.sha256)  hatly-sales-src.tar.gz" | sha256sum -c -
tar -xzf hatly-sales-src.tar.gz            # creates /opt/hatly-staging/hatly — does NOT touch /opt/hatly-git
sudo bash hatly/deploy/staging/preflight.sh | tee preflight.out
```
Review: free RAM/disk (roughly 2 GB RAM and ~6 GB disk for the builds and images), the "name collisions" section (must be empty),
ports 13000/13001 free. Stop and report if not.

## 4. Configure, validate, build, start the data stores
```bash
cd /opt/hatly-staging/hatly/deploy/staging
GOOGLE_MAPS_API_KEY=... ./init-staging-env.sh   # writes /opt/hatly-staging/.env.staging (mode 600), prints no secrets, refuses to overwrite
./staging.sh validate                            # compose + variables check (values not printed)
./staging.sh build                               # backend + dashboard images (the dashboard bakes in the HTTPS API URL)
./staging.sh data                                # postgres + redis only (private network, no published ports)
```

## 5. Migrations — review, then run (only against the staging database)

**Counts, as of 2026-10-16 (verify with `ls apps/backend/src/database/migrations | wc -l`):** the source tree contains **59** migrations;
the original Staging deployment (2026-10-12, see "Executed state" below) applied the first **54** (the last one is
`1700005300000-OrderStatusCollected`). On an **empty** staging database all 59 are pending. On the **existing** Staging database **five** are
pending, in this order:

| # | File (`apps/backend/src/database/migrations/`) | What it does (additive only — no existing data is rewritten) |
|---|---|---|
| 55 | `1700005400000-CustomerNotifications` | creates `customer_notifications` (+ index) |
| 56 | `1700005500000-SectorCustomRequests` | adds `marketplace_sectors.custom_requests_enabled boolean NOT NULL DEFAULT false` |
| 57 | `1700005600000-ProductOptionSelectionLimits` | adds `product_options.min_selections` (default 0), `max_selections` + a check constraint |
| 58 | `1700005700000-AdminAuditLogs` | creates `admin_audit_logs` + a trigger that **refuses every UPDATE and DELETE** (append-only) |
| 59 | `1700005800000-StaffMfaCredentials` | creates `staff_mfa_credentials` (encrypted TOTP secrets, recovery-code hashes) |

Which of these Staging has *actually* applied is a fact about the remote database: **do not assume it from this file.** Establish it with the
read-only plan below.

```bash
./staging.sh plan      # read-only: "database target: postgres/hatly_staging | NODE_ENV=staging | OK (isolated staging)" + `typeorm migration:show`
./staging.sh migrate   # WRITES. Same guard first; refuses unless host=postgres and db=STAGING_DB_NAME
```
`plan` runs the target guard and `typeorm migration:show` (it lists applied `[X]` and pending `[ ]` migrations; output verified under `NODE_ENV=staging`).
Two precise caveats, found by reading `staging.sh` and TypeORM's `showMigrations`: (1) it starts a throw-away `backend` container (`dc run --rm`),
and (2) TypeORM creates the `migrations` bookkeeping table if it does not exist — so it is read-only **in effect only on a database that already
has that table** (Staging does). Never run it against a database you have not identified with the target guard line.
**`migrate` requires a separate, explicit approval after the plan has been reviewed** and after the pre-migration backup in
[staging-readiness-checklist.md](../../docs/security/staging-readiness-checklist.md) §3. Review the plan: exactly the five files above
should be `[ ]`, in that order, and every earlier migration `[X]`. Anything else (a different set pending, an unknown migration applied)
stops the procedure.

**Verified backup before `migrate`** (on the VPS; dump files must live outside the compose volumes):
```bash
sudo mkdir -p /opt/hatly-staging/backups && sudo chown "$USER" /opt/hatly-staging/backups
cd /opt/hatly-staging/hatly/deploy/staging
export STAGING_ENV_FILE=/opt/hatly-staging/.env.staging
f=/opt/hatly-staging/backups/pre-migration-$(date +%F-%H%M).dump
docker compose -p hatly-staging --env-file "$STAGING_ENV_FILE" -f docker-compose.staging.yml \
  exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "$f"
ls -l "$f" && docker compose -p hatly-staging --env-file "$STAGING_ENV_FILE" -f docker-compose.staging.yml \
  exec -T postgres sh -c 'pg_restore -l' < "$f" | grep -c 'TABLE DATA'    # must list the table data sections (54 tables at 54 migrations)
```
A backup that was not listed with `pg_restore -l` is not a verified backup. **Restore test** (never over the running database): create a new
database, `pg_restore --no-owner -d <new database> < "$f"`, then confirm `migration:show` against it reports 54 applied / 5 pending.
Rehearsed locally (scratch database, same `pg_dump -Fc` / `pg_restore` flags): 54 applied / 5 pending dumped → 5 migrations applied → dump restored
into a new database → 54 applied / 5 pending again, `admin_audit_logs` absent as expected.

**Facts about the run itself** (rehearsed on disposable local databases from the compiled code in the image layout):
all pending migrations run inside **one** transaction (TypeORM `transaction: all`; the log shows a single `BEGIN`…`COMMIT`), so a failure applies none of the five.
Each is additive; the locks are brief (new tables with foreign keys, two `ALTER TABLE … ADD COLUMN` with constant defaults on PostgreSQL 16, one `CHECK` constraint on `product_options`).
`down` exists for each, but rollback is **not** lossless: reverting `1700005700000-AdminAuditLogs` drops `admin_audit_logs` and every audit row in it (the
append-only trigger blocks `UPDATE`/`DELETE` but not `DROP TABLE`); reverting `…5800000-StaffMfaCredentials` drops all enrolled TOTP secrets and recovery-code
hashes (admins must re-enrol); the other two lose only the data written into the new notification/limit columns after the migration. Prefer restoring the
verified dump into a new database over `migration:revert` on Staging.

History: the 54 migrations were rehearsed from the compiled code on a scratch local database. The five above are exercised on a freshly
reset and migrated local database by every integration-test run (59/59), but have **not** been run against Staging. None belongs to the
authentication/guest-browsing work. There is no automatic migration on application start; never run `migration:run` anywhere else.

## 6. Start the apps, first admin, OTP off, data
```bash
./staging.sh apps && ./staging.sh status
export BOOTSTRAP_ADMIN_PHONE=+20... BOOTSTRAP_ADMIN_NAME="Sales Admin" BOOTSTRAP_ADMIN_PASSWORD='<choose, at least 8 chars>'
./staging.sh bootstrap-admin
ADMIN_PHONE=$BOOTSTRAP_ADMIN_PHONE ADMIN_PASSWORD=$BOOTSTRAP_ADMIN_PASSWORD ./staging.sh otp-off     # CUSTOMER_OTP_ENABLED=false
unset BOOTSTRAP_ADMIN_PASSWORD
```
**OTP must be OFF for Sales.** Its default is ON, and with no SMS provider nobody could register. `otp-off` sets the Admin setting
(the dashboard Settings page shows it too).

**Sales data (decision needed).** A fresh staging DB is empty — no vendors/products to browse. `seed:dev-marketplace` deliberately
refuses any database not literally named `hatly_dev`, and strict staging forbids `*_dev` database names, so it cannot be used as-is
and its guard should not be bypassed. Options: (a) create the catalog through the dashboard; (b) restore a `pg_dump` of the Mac's
**dev** database (dev/test data only — never production) plus its `uploads-storage` into the staging DB/volume, with your OK;
(c) extend the seed guard with an explicit opt-in (code change + approval).

## 7. Verify (from any machine)
```bash
node smoke.mjs --read-only --api https://api-sales.hatly.dev/api/v1 --dashboard https://sales.hatly.dev   # writes NOTHING (safe on any state)
./security-smoke.sh --api https://api-sales.hatly.dev/api/v1 --dashboard https://sales.hatly.dev            # read-only headers/CORS/Swagger/CSP checks
node smoke.mjs --api https://api-sales.hatly.dev/api/v1 --dashboard https://sales.hatly.dev               # FULL run: creates one throw-away customer
```
The full run (without `--read-only`) creates one throw-away customer in staging. Checks: HTTPS, health/ready (db + redis), CORS allow/deny, guest browsing, protected
endpoints = 401, OTP-off registration, phone + password login, wrong password, no overwrite, unverified phone, cart access, the retired
OTP route, and that the dashboard bundle was built against the staging URL with no localhost/tunnel. (Registration is rate-limited to
5/min per client, so wait a minute between runs.) Also on the VPS: `ss -ltnp | grep -E ':(5432|6379)\b'` must show nothing published
by these containers.

## 8. Customer APK (only after §7 passes)
```bash
cd apps/customer-app     # on the Mac, with the Flutter toolchain
flutter build apk --release --dart-define=API_BASE_URL=https://api-sales.hatly.dev/api/v1
unzip -p build/app/outputs/flutter-apk/app-release.apk lib/arm64-v8a/libapp.so | strings | grep -m1 'api-sales\.hatly\.dev'              # present
unzip -p build/app/outputs/flutter-apk/app-release.apk lib/arm64-v8a/libapp.so | strings | grep -E 'localhost:3000|trycloudflare|192\.168\.'   # must print nothing
```
Signing: without `android/key.properties` the release APK is signed with the **debug key** — acceptable only for sideloaded Sales
testing, not for the Play Store (create a keystore + `key.properties` for a real release). Do not add the cleartext switch.

Device checklist (physical phone, mobile data, Wi-Fi off): install; open the app → Home loads as a guest (no sign-in wall);
Explore/search; open a vendor and a product; tap Cart / "add to cart" → sign-in, then back to where you were; register (name, phone,
password) → no code step; log out; log in with phone + password; Orders/Profile tabs; wrong-password message; repeat on a different Wi-Fi.

## Operations
`./staging.sh status | logs [backend|dashboard] | down` (`down` keeps volumes). Rollback = `down`, then remove the two Caddy blocks and
the two DNS records — nothing to undo in production. To destroy the staging data deliberately:
`docker volume rm hatly-staging_pgdata hatly-staging_redisdata hatly-staging_uploads`.
**Since Stage 1 (production TLS) the `caddy_data` volume also holds the production Origin certificate (`/data/tls/hatly-origin`) — never
`down -v` / remove `hatly-staging_caddy_data`: Caddy would refuse to start and every hostname would fail.**

**Caddy configuration across restarts (2026-10-23).** Caddy bind-mounts the single file `deploy/staging/Caddyfile.staging`. A running bind
mount follows the file's inode, so after a tree rename (`mv hatly hatly.pre-<date>`) Caddy keeps reading the renamed-away copy — but every
container **start** (crash restart under `unless-stopped`, `docker restart`, Docker daemon restart — `live-restore` is off — or host reboot)
and every **recreate** mounts whatever is at `/opt/hatly-staging/hatly/deploy/staging/Caddyfile.staging` then. Rules:
1. The repository's `Caddyfile.staging` must always equal what Caddy runs (it carries the production block since Stage 1). A tree that lacks
   it would drop hatly.dev/www/admin/api to Cloudflare 525 at Caddy's next restart.
2. Before any tree swap, and after any Caddyfile change: `ssh ubuntu@152.228.240.4 'bash -s -- <new tree>/deploy/staging/Caddyfile.staging' < deploy/staging/caddy-config-guard.sh`
   must end `CADDY CONFIG GUARD PASSED` (`phase6-switch.sh check|swap` refuses on the same condition).
3. Change the edge config by editing the file Caddy reads **and** the active-path copy (the Stage 1 script does both), then reload with
   `docker exec hatly-staging-caddy-1 caddy reload --adapter caddyfile --config /etc/caddy/Caddyfile --address 127.0.0.1:2019`
   (the admin API listens on 127.0.0.1 only; the default `localhost` resolves to ::1 inside the container and fails).
4. A pending kernel reboot is a planned Caddy restart: run the guard first.

## Open items found while preparing this (not fixed in the repo)
- *(Fixed 2026-10-16)* `apps/dashboard` had no `postcss.config.js`, so Tailwind never compiled outside the staging image (local dev/build: a ~900-byte
  stylesheet with the raw `@tailwind` directives, unstyled pages). The standard config is now in `apps/dashboard/postcss.config.js` (identical to what the image
  used to inject); the image build now only asserts the file exists. Verified: clean build → 15.6 KB stylesheet, full Playwright suite 113 passed.
- *(Fixed 2026-10-16)* `apps/backend` `npm run start:prod` used to run `node dist/main`, which does not exist (the build emits
  `dist/src/main.js`, tests are compiled too); it now runs `node dist/src/main`. The staging image already used the correct path.
- *(Found 2026-10-16)* After the firebase-admin 14 upgrade `npm ci --omit=dev` nests `firebase-admin` and 32 other production packages under
  `apps/backend/node_modules`; the backend image's runtime stage copied only the root `node_modules`, so the container would have died at boot with
  `Cannot find module 'firebase-admin/app'`. The runtime stage now copies both (reproduced and verified in a scratch copy of the stage layout;
  guarded by `apps/backend/src/config/deployment-consistency.spec.ts`). A real `docker build` and boot still has to confirm it.
- The Docker image builds themselves were **not** executed in the Mac session (no Docker there). The compiled application, the 54 migrations that existed then, env generation/validation, strict-staging boot and the smoke test were rehearsed with the same code outside Docker.

## Executed state (2026-10-12) — what is actually running on the VPS
- `/opt/hatly-staging/hatly` (source bundle), `/opt/hatly-staging/.env.staging` (600), `/opt/hatly-staging/.sales-credentials` (600: Sales
  SUPER_ADMIN phone/password and the tester-accounts password — read it there; it is never printed or committed).
- Project `hatly-staging`: postgres, redis, backend (127.0.0.1:13000), dashboard (127.0.0.1:13001) — all healthy; 54/54 migrations *at that date* (5 more exist now — see §5);
  OTP OFF; catalog from the committed seed (7 sectors, 15 vendors, 76 products, 8 offers, 113 images, "Abu Nasseb" delivery zone) and
  tester accounts +20107000000{1..6}.
- **Maps fallback is active** (no staging key): `NODE_ENV=development`, `MAPS_PROVIDER=deterministic` (straight-line distances). To go
  strict: re-generate the env with `GOOGLE_MAPS_API_KEY=...` (new file → `NODE_ENV=staging`) and `./staging.sh apps`.
- UFW now allows 80/443 (for the HTTPS edge). The edge (`./staging.sh edge`, a Caddy container owning ports 80/443) is **not started**:
  start it as soon as the two DNS A records exist. NOTE: the production compose in /opt/hatly-git also defines a Caddy on 80/443; only
  one can own those ports — when production is started, merge the two staging site blocks into that Caddyfile and stop the staging edge.
- Seed opt-in added: `SEED_ALLOW_DATABASE` (exact database name; default guard unchanged) and `SEED_DEV_CUSTOMER_PHONE`.

## 9. Deploying the 2026-10-16 build to the existing Staging — gated sequence (NOT executed; every ⛔ step needs its own explicit approval)

Why the order matters (verified from `staging.sh` and `docker-compose.staging.yml`): the images carry a fixed tag (`hatly-staging-backend:local`, `hatly-staging-dashboard:local`),
`./staging.sh plan` runs `typeorm migration:show` **inside the backend image that exists at that moment**, and `build` overwrites the tag. So (a) the old image can only ever show the 54
old migrations — read the pending state from the database first (step 1) — and (b) the old images must be re-tagged **before** building, or there is nothing to roll back to.

(In the table below, `\|` stands for a plain `|` — a Markdown table escape; type a normal pipe.)

| # | Step (on the VPS, in `/opt/hatly-staging/hatly/deploy/staging`) | Changes anything? | Gate |
|---|---|---|---|
| 0 | **Bundle (on the Mac).** `tar -czf hatly-sales-src.tar.gz --exclude=node_modules --exclude=.git --exclude=.next --exclude='.next-*' --exclude=dist --exclude=.dart_tool --exclude=build '--exclude=.env' '--exclude=.env.*' --exclude='*.keystore' --exclude='*.jks' --exclude=key.properties --exclude=google-services.json --exclude=apps/customer-app --exclude=apps/driver-app --exclude=apps/backend/uploads-storage --exclude=apps/dashboard/test-results --exclude=apps/dashboard/playwright-report --exclude=apps/dashboard/e2e/.auth --exclude=.DS_Store --exclude=Archive.zip --exclude='*.tsbuildinfo' -C hatly .` then `shasum -a 256 hatly-sales-src.tar.gz > hatly-sales-src.tar.gz.sha256`. (Verified locally: 1,632 entries, ~19 MB, contains the Dockerfiles, `postcss.config.js`, all 59 migrations and `docs/assets/pack`; no `.env*`, keys or auth state.) | local file only | — |
| 1 | **Evidence, read-only:** `./staging-evidence.sh \| tee ~/staging-evidence-$(date +%F).txt` (needs the script copied over with the bundle, or run it from the extracted tree). Prints services/health, image ids and dates, Node versions, env var **names** set/MISSING, Redis password/TLS facts, `.env.staging` mode, the migrations table (applied count + which of the five are pending) and the public-edge checks. Prints no value of any secret. | no | send me the output |
| 2 | **Stop condition check.** Expect: 54 applied (last `OrderStatusCollected1700005300000`), the five names pending, `.env.staging` mode 600, Redis `NOAUTH`, nothing published on 5432/6379, all containers healthy. Anything else → stop and report. | no | — |
| 3 | **Keep the old images:** `docker tag hatly-staging-backend:local hatly-staging-backend:rollback-20261016 && docker tag hatly-staging-dashboard:local hatly-staging-dashboard:rollback-20261016` | adds two local tags | — |
| 4 | **Verified backup** (§5 above) including `pg_restore -l` check; record file name and size. | writes a dump file | ⛔ approval |
| 5 | **Source swap, side by side:** `cd /opt/hatly-staging && mv hatly hatly.pre-20261016 && sha256sum -c hatly-sales-src.tar.gz.sha256 && mkdir hatly && tar -xzf hatly-sales-src.tar.gz -C hatly` (the old tree stays for rollback). | filesystem | ⛔ approval |
| 6 | **MFA key** (only if step 1 reported `MFA_ENCRYPTION_KEY MISSING`; the current fallback environment does not need it, strict staging does): append it without printing — `grep -q '^MFA_ENCRYPTION_KEY=' /opt/hatly-staging/.env.staging \|\| printf 'MFA_ENCRYPTION_KEY=%s\n' "$(openssl rand -base64 32)" >> /opt/hatly-staging/.env.staging` — keep mode 600, back the key up with the other secrets, **never change it later**. Leave `DASHBOARD_ADMIN_MFA_REQUIRED=false`. | edits `.env.staging` | ⛔ approval |
| 7 | **Build only** (running containers are not touched): `./staging.sh validate && ./staging.sh build`. Read the log for `MODULE_NOT_FOUND`, `npm ERR!`, and that the dashboard stage passed `test -f apps/dashboard/postcss.config.js`. | builds images | ⛔ approval |
| 8 | **Image checks, no network, no data:** `docker run --rm --entrypoint node hatly-staging-backend:local -e "console.log(process.version, require('firebase-admin/app') ? 'firebase-admin ok' : '')"` (must print `v22.…` and `firebase-admin ok`); `docker run --rm --entrypoint id hatly-staging-backend:local -un` (→ `node`); `docker run --rm hatly-staging-backend:local node -e "require('./dist/src/app.module')" 2>&1 \| grep -c MODULE_NOT_FOUND` (→ 0; a `ConfigurationError` is the expected, intended outcome without env). | no | — |
| 9 | **Reviewed plan:** `./staging.sh plan` — the new image now knows 59. Required: guard line `OK (isolated staging)`, 54 × `[X]`, exactly the five `[ ]` in the order `CustomerNotifications…5400000`, `SectorCustomRequests…5500000`, `ProductOptionSelectionLimits…5600000`, `AdminAuditLogs…5700000`, `StaffMfaCredentials…5800000`. Anything else → stop. | starts a throw-away container; creates the `migrations` table only if absent (it is not) | — |
| 10 | ⛔ **`./staging.sh migrate`** — only after steps 4 and 9 and separate approval. Single transaction. Then `./staging.sh plan` again: no `[ ]`. | **schema change** | ⛔ approval |
| 11 | **Start the new apps:** `./staging.sh apps && ./staging.sh status` (recreates backend and dashboard from the new images; seconds of downtime). Watch `./staging.sh logs backend` for `ConfigurationError`. | restarts services | ⛔ approval |
| 12 | **Smoke, from any machine:** `node smoke.mjs --read-only --api https://api-sales.hatly.dev/api/v1 --dashboard https://sales.hatly.dev` and `./security-smoke.sh --api https://api-sales.hatly.dev/api/v1 --dashboard https://sales.hatly.dev` — **all** checks must pass now (the cookie-session, CSP, CORS-credentials and CSRF-preflight checks that fail on the old build). Then the manual checks in `docs/security/staging-readiness-checklist.md` §5–§7. | no | — |
| 13 | **Later, separately:** MFA enrolment for two SUPER_ADMINs (`docs/security/mfa-rollout.md`); the policy flag stays `false` until explicitly authorised. | — | ⛔ approval |

**Rollback — application only (preferred; the five migrations are additive, so the old build runs on the new schema):**
`docker tag hatly-staging-backend:rollback-20261016 hatly-staging-backend:local && docker tag hatly-staging-dashboard:rollback-20261016 hatly-staging-dashboard:local && ./staging.sh apps`
(`up -d` recreates a container whose image id changed). Confirm with `./staging.sh status` and `smoke.mjs --read-only`.
**Rollback — data:** only if data was damaged: restore the step-4 dump into a **new** database and repoint deliberately; do not use `migration:revert` (§5: it drops the audit log and the TOTP secrets).
**If step 10 fails:** the transaction rolled back — none of the five applied; re-run `plan`, fix the cause, retry; nothing to undo.

### 9a. Exact commands for the 2026-10-17 staging update (refined after the read-only inspection; NOT executed — each block waits for its approval gate)

Facts these rely on (verified 2026-10-16): the box has Docker 29.9 / Compose 5.6, 82 GB free; the stack runs as compose project `hatly-staging`; images `hatly-staging-{backend,dashboard}:local`; env file `/opt/hatly-staging/.env.staging`; the source tree equals the 2026-10-12 bundle plus the two hand-copied files; 54 migrations applied. Full reasoning and rollback: `docs/launch/STAGING_UPDATE_PLAN.md`. Run from the Mac with `H=ubuntu@152.228.240.4`; the helper scripts are **piped over SSH** (they close stdin for Docker, so `bash -s` is safe) so nothing is copied to the server before the backup exists.

**Phase 0 — Mac only: build the new bundle in a NEW folder (never overwrite `~/Downloads/hatly-staging-bundle/`, it is the exact copy of what runs)**
```bash
cd /Users/abdullahrezk/Downloads/hatly-current-mac-handoff && D=~/Downloads/hatly-staging-bundle-$(date +%Y%m%d) && mkdir -p "$D" && \
COPYFILE_DISABLE=1 tar -czf "$D/hatly-sales-src.tar.gz" --exclude=node_modules --exclude=.git --exclude=.next --exclude='.next-*' --exclude=dist --exclude=.dart_tool --exclude=build \
  --exclude='.env' --exclude='.env.*' --exclude='*.keystore' --exclude='*.jks' --exclude=key.properties --exclude=google-services.json --exclude=GoogleService-Info.plist \
  --exclude=apps/customer-app --exclude=apps/driver-app --exclude=apps/backend/uploads-storage --exclude=apps/dashboard/test-results --exclude=apps/dashboard/playwright-report \
  --exclude=apps/dashboard/e2e/.auth --exclude=.DS_Store --exclude=Archive.zip --exclude='*.tsbuildinfo' -C hatly . && \
shasum -a 256 "$D/hatly-sales-src.tar.gz" | awk '{print $1}' > "$D/hatly-sales-src.tar.gz.sha256" && \
tar -tzf "$D/hatly-sales-src.tar.gz" | grep -cE '/\._|(^|/)\.env($|\.)|\.jks$|\.keystore$|key\.properties|google-services|GoogleService' ; echo "(the last number must be 0)"
```

**Phase 1 — verified backup (⛔ A1)**
```bash
H=ubuntu@152.228.240.4; TS=$(date -u +%Y%m%dT%H%MZ); B=/opt/hatly-staging/backups/pre-update-$TS
ssh $H "sudo install -d -m 700 -o ubuntu -g ubuntu /opt/hatly-staging/backups $B && echo $B"
C='HATLY_COMPOSE_FILE=/opt/hatly-staging/hatly/deploy/staging/docker-compose.staging.yml HATLY_COMPOSE_PROJECT=hatly-staging HATLY_ENV_FILE=/opt/hatly-staging/.env.staging'
# database: custom-format dump, listed with pg_restore -l, SHA-256 manifest (expect 54 migrations worth of tables, well under 1 MB)
ssh $H "$C BACKUP_DIR=$B BACKUP_PREFIX=hatly-staging bash -s" < hatly/deploy/production/backup-postgres.sh
# restore drill: restores into a throw-away hatly_drill_* database inside staging Postgres, compares with the manifest, drops it
ssh $H "$C bash -s -- $B/\$(ls -1t $B/*.dump | head -1 | xargs basename)" < hatly/deploy/production/restore-drill.sh
# uploads volume, source tree, env files (they stay on the server), probe scripts, image tags
ssh $H "sudo tar -czf $B/uploads.tgz -C /var/lib/docker/volumes/hatly-staging_uploads/_data . && sudo chown ubuntu:ubuntu $B/uploads.tgz \
  && tar -czf $B/source-tree-2026-10-12.tgz --exclude=node_modules -C /opt/hatly-staging hatly \
  && sudo install -m 600 -o ubuntu -g ubuntu /opt/hatly-staging/.env.staging $B/env.staging.copy && sudo install -m 600 -o ubuntu -g ubuntu /opt/hatly-staging/.sales-credentials $B/sales-credentials.copy \
  && mkdir -p $B/probe-scripts && for f in flow flow2 flow3 flow4 hs probe cx; do sudo docker cp hatly-staging-backend-1:/tmp/\$f.mjs $B/probe-scripts/ ; done \
  && sudo docker tag hatly-staging-backend:local hatly-staging-backend:rollback-${TS%T*} && sudo docker tag hatly-staging-dashboard:local hatly-staging-dashboard:rollback-${TS%T*} \
  && (cd $B && sha256sum * > MANIFEST.sha256) && ls -l $B"
```
Never run `docker image prune`/`docker system prune` before the update is accepted (the rollback tags protect the old layers, but a prune of unused images is exactly how people lose them).

**Phase 2 — upload and side-by-side swap (⛔ A2)**
```bash
ssh $H "mkdir -p /opt/hatly-staging/incoming" && scp -o BatchMode=yes ~/Downloads/hatly-staging-bundle-$(date +%Y%m%d)/hatly-sales-src.tar.gz* $H:/opt/hatly-staging/incoming/
ssh $H 'cd /opt/hatly-staging/incoming && echo "$(cat hatly-sales-src.tar.gz.sha256)  hatly-sales-src.tar.gz" | sha256sum -c - \
  && cd /opt/hatly-staging && mv hatly hatly.pre-$(date -u +%Y%m%d) && mkdir hatly && tar -xzf incoming/hatly-sales-src.tar.gz -C hatly \
  && chmod +x hatly/deploy/staging/*.sh && find hatly -name "._*" | wc -l && sha256sum hatly/deploy/staging/staging.sh hatly/deploy/staging/docker-compose.staging.yml'
```
(Expected: 0 junk files; `staging.sh` and the compose file hash as on the Mac.)

**Phase 3–4 — build only, image checks, plan (⛔ A3).** From now on on the VPS, in `/opt/hatly-staging/hatly/deploy/staging`; log to a dated file, not to the old `build.log`:
```bash
./staging.sh validate && ./staging.sh build 2>&1 | tee /opt/hatly-staging/build-$(date -u +%Y%m%d).log | tail -20
docker run --rm --entrypoint node hatly-staging-backend:local -e "console.log(process.version, !!require('firebase-admin/app'))"   # v22.x true
docker run --rm hatly-staging-backend:local node -e "require('./dist/src/app.module')" 2>&1 | grep -c MODULE_NOT_FOUND                # 0
./staging.sh plan      # 54 x [X] and exactly the five [ ] in order — otherwise STOP
```

**Phase 5 — migrate (⛔ A4):** `./staging.sh migrate && ./staging.sh plan` (no `[ ]` left).

**Phase 6 — start the new apps (⛔ A5):** `./staging.sh apps && ./staging.sh status`; watch `./staging.sh logs backend` for `ConfigurationError`.

**Phase 7 — verify (from the Mac):** `deploy/staging/security-smoke.sh --api https://api-sales.hatly.dev/api/v1 --dashboard https://sales.hatly.dev`, `node deploy/staging/smoke.mjs --read-only …`, and the manual checks listed in `STAGING_UPDATE_PLAN.md` §3.

**Rollback (app only):** `H`: `docker tag hatly-staging-backend:rollback-<date> hatly-staging-backend:local && docker tag hatly-staging-dashboard:rollback-<date> hatly-staging-dashboard:local && ./staging.sh apps`; source tree: `mv hatly hatly.failed && mv hatly.pre-<date> hatly`.

**Executed variant, 2026-10-17 (phases 0–4):** run exactly as in `docs/launch/STAGING_UPDATE_PLAN.md` §7 — the new tree was extracted **beside** the active one (`/opt/hatly-staging/hatly-<date>`), the images were built with a compose override under `candidate-<date>` tags (`docker compose -p hatly-staging --env-file … -f hatly-<date>/deploy/staging/docker-compose.staging.yml -f docker-compose.candidate.override.yml build backend dashboard`), and the plan was run with `docker run … --network hatly-staging_internal --env-file /opt/hatly-staging/.env.staging --entrypoint node <candidate image> /repo/node_modules/typeorm/cli.js … migration:show`. **Lesson for phase 6:** compose gives Caddy a different config hash if the stack is started from a differently-named directory (bind-mount path), so swap the directories by rename (`mv hatly hatly.pre-<date> && mv hatly-<date> hatly`) *before* `./staging.sh apps`, re-check `docker compose config --hash` shows all services identical, and name only `backend dashboard` in `up -d` (as `staging.sh apps` does).

**Phases 5–6 final form (2026-10-17):** use the reviewed scripts, not hand-typed commands — `deploy/staging/phase5-preflight.sh`, `phase5-migrate-guarded.sh`, `phase6-switch.sh` (steps `check | retag | swap | backend | dashboard | verify | rollback-apps | rollback-tree`); the exact invocations, expected output, health checks and rollback are in `docs/launch/PHASE5_6_SAFETY_REVIEW.md` §5. They never name postgres/redis/caddy and never run `migration:revert`.


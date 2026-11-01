# Production readiness — configuration, topology gaps, monitoring (prepared 2026-10-17)

**Scope and honesty.** The repository contains the *staging* kit (`deploy/staging/`) and, new in this phase, production templates and operations scripts (`deploy/production/`). Nothing was deployed, nothing on the VPS was touched. What is known about the production host comes from a read-only inspection recorded in the 2026-10-12 session transcript — **a week old and UNVERIFIED today**; each such fact is marked *(2026-10-12)*. The first action before any production work is to re-capture it (RUNBOOK §9 step 1 style, read-only, needs approval).

## 0. Production deploy kit — built and verified locally 2026-10-23 (supersedes §1–§2 where they differ)

**Topology (decided).** One VPS, one edge: the staging Caddy keeps ports 80/443 and serves production too (Stage 1 put the production
hostnames on it). Production is its own compose project `hatly-prod` — backend, dashboard, PostgreSQL 16, Redis 7 — with **no Caddy, no
published host port**, its own volumes (`hatly-prod_pgdata`, `_redisdata`, `_uploads`) and two networks: the private `hatly-prod_internal`
and the external `hatly-edge`, on which only backend and dashboard sit (aliases `hatly-prod-backend`, `hatly-prod-dashboard`). The staging
Caddy joins `hatly-edge` in Stage 3 (`docker network connect`, no restart). The old `/opt/hatly-git` compose (own Caddy, `TRUST_PROXY=true`,
Oct-10 images) is **never started** and the port-3100 `next-server` is left alone.

**Real client IP (decided).** The production hostnames accept connections **only from Cloudflare's published ranges** (others: 403), and
Caddy **replaces** `X-Forwarded-For` with Cloudflare's `CF-Connecting-IP`; the backend trusts exactly one hop (`TRUST_PROXY=1`). So rate
limits and audit logs see the real customer, and no client can spoof it (a direct-to-origin request cannot even reach the app).
`deploy/production/cloudflare-ranges-check.sh` compares the block with Cloudflare's live list (run weekly and before edge changes).

| File (`deploy/production/`) | Purpose | Verified |
|---|---|---|
| `make-release-bundle.sh` | source bundle on the Mac with a leak scan (no env/keys/keystores/certs/Firebase files/`._*`/node_modules/**`.next*` caches**/mobile apps; private-key text scan) and a completeness check (Dockerfiles, compose, scripts, all migrations); release id `<UTC>-<sha12>` | built `20261023T195446Z-26d59744b313` (9.2 MB, 1,310 entries, 60 migrations); first run caught a 70 MB stale `.next-remote` cache that would have been copied into the dashboard image — excluded (also in the staging RUNBOOK commands) |
| `env.production.template` + `init-production-env.sh` | renders `/opt/hatly-prod/.env.production` (600) on the host: secrets generated there; operator inputs only on **stdin** (allow-listed keys: Maps key optional → `MAPS_PROVIDER=google`, else `none`; Unifonic pair or "no SMS"; FCM trio or "no push") | `scripts/launch/test/production-env.test.mjs` **16/16** against the backend's real `collectEnvIssues` (accepted in production; DB/Redis passwords consistent; 5 distinct secrets; MFA key 32 bytes; 600/700; no value printed; 12 refusal cases write nothing). A real defect was caught by the test (a marker in a comment) |
| `docker-compose.production.yml` | the stack above; healthchecks (backend `/health/ready`, dashboard `/privacy`), memory limits, bounded logs, `restart: unless-stopped` | `docker compose config` on the VPS's own Compose 5.6 (stdin, read-only): 4 services, no published ports, no Caddy, networks/aliases/volumes resolved |
| `prod.sh` | the only operator entry point (pins project, compose file of the current release, env file): `validate`, `env-check` (the built image validates the env with its own boot rules before anything starts), `build`, `data`, `plan`, guarded `migrate` (`CONFIRM_MIGRATE=hatly_prod`, target check, verified backup first when tables exist, re-count), `apps`, `status`, `logs`, `backup` (DB + uploads), `bootstrap-admin`, `stop-apps`; refuses `down` | syntax; exercised end to end by Stage 2 |
| `backup-uploads.sh` | verified tar.gz of the uploads volume (read-only mount, helper = the backend image, listed back, hashed, manifest, retention, off-site hook) | syntax; runs in Stage 2 |
| `stage2-deploy.sh` | **private** start of production, from the Mac: preflight; layout; upload + hash check; env; network; validate; **build**; env-check; data stores; **migrations (60)**; apps; private checks (ready, edge aliases, `/privacy` final with the approved contact, `/account-deletion`, `/login`, no host ports); **first backup + a real restore drill**; staging/public state re-checked identical | **read-only preflight PASSED 2026-10-23 19:55Z** against the real VPS (76 GB free, 10.3 GB RAM available, no conflicting stack, staging Caddy owns 80/443); a fail-open input check (BSD `grep` rejected an empty alternative) was found by this run and fixed + tested |
| `Caddyfile.production-block` + `stage3-edge-switch.sh` | **public** switch: Caddy joins `hatly-edge`; the Stage 1 block is replaced in both Caddyfiles (the inode Caddy reads + the active-path copy); one reload; post-checks through Cloudflare (API ready, `/privacy` final + HSTS, `/account-deletion`, admin `/login`, www), **403 for every direct-to-origin request**, **real-client-IP proof** (the IP the backend logs for an unauthenticated probe = the IP Cloudflare reports for the Mac), `verify-public-pages.sh`; automatic rollback to the Stage 1 file (+ network disconnect if this run connected it) | block validated by the **running** Caddy (stdin, read-only): manual cert still affects only the 4 production names; structural check accepts it and **rejects 9/9 broken variants** (no 403, a 404 instead, missing or spoofable `X-Forwarded-For`, wrong upstream, a missing Cloudflare range, missing HSTS, a changed staging route, the unchanged Stage 1 config); `http://` → `https://` 308 already verified for all four names |
| `cloudflare-ranges-check.sh` | block ranges vs Cloudflare's live list | matches (22 ranges); a removed range is detected |

**Database.** All **60 compiled migrations** (`dist/`, exactly as the image runs them) applied to a brand-new PostgreSQL 16 database in one
transaction (0 s), `migration:show` 60/0, a second run is a no-op, 58 public tables; the database was dropped afterwards. `schema:log` shows
only cosmetic entity-vs-migration differences (168 `created_at/updated_at/deleted_at` columns are `timestamptz` in the database vs `timestamp`
in the entity defaults — the database is the safer type — Postgres-default FK names vs TypeORM hash names, two column defaults); no table or
column is missing; `synchronize` is off everywhere. **Never run `schema:sync`.**

**Deployment sequence (dependency-ordered; ⛔ = needs the owner's approval).**
1. Owner inputs (OPTIONAL since 2026-10-24) in `~/.hatly/production-inputs.env` (mode 600): `GOOGLE_MAPS_API_KEY` → `MAPS_PROVIDER=google`; without it → `MAPS_PROVIDER=none` (PD-009 G: zone pricing for every delivery, straight-line dispatch ranking, no address search). Unifonic → SMS/OTP; without it, a fresh database has customer OTP **on** and registration then cannot complete — an admin decides (supply Unifonic, or switch `CUSTOMER_OTP_ENABLED` off knowingly). FCM → push; without it, in-app notifications only.
2. `make-release-bundle.sh` → bundle (Claude).
3. ⛔ `stage2-deploy.sh apply <bundle>` — private production (build, 60 migrations, first backup + restore drill). No public change.
4. ⛔ `stage3-edge-switch.sh apply` — public switch; `/privacy` and `/account-deletion` become the Play URLs.
5. ⛔ First SUPER_ADMIN: `prod.sh bootstrap-admin` (owner's phone/password, typed on the host); then MFA for two admins before
   `DASHBOARD_ADMIN_MFA_REQUIRED=true` (`docs/security/mfa-rollout.md`).
6. ⛔ Host crons: `prod.sh backup` daily (+ `OFFSITE_CMD`), `ops-watch.sh` every 5 min, `cloudflare-ranges-check.sh` weekly.
7. Business data: zones, vendors, catalogue (Production starts empty — no seed scripts in production).

**Rollback.** Stage 2: nothing public depends on it — `prod.sh stop-apps`; a failed *first* deploy can be removed completely (commands
printed by the script). Stage 3: automatic, back to the Stage 1 "coming soon" file. After go-live: application = re-tag the previous images
and `prod.sh apps`; data = restore a verified dump into a new database (never `migration:revert` in production).

### 0.1 Go-live runbook — the remaining HUMAN steps, in order (prepared 2026-10-24; nothing below has run yet)

Everything Claude could do is done and verified (see `CRITICAL_PATH.md` §0). Each step names who acts. No secret is ever typed on a
command line or pasted into chat.

**A. Deploy (owner — the agent session's permission guard refused these twice; a person must run or allow them).** From the repo root on the Mac:
```bash
! HATLY_PROD_INPUTS=/nonexistent bash deploy/production/stage2-deploy.sh apply /Users/abdullahrezk/Library/Caches/hatly-releases/20261025T203941Z-86a4f42e14a8
! bash deploy/production/stage3-edge-switch.sh preflight     # read-only; must end PREFLIGHT PASSED
! bash deploy/production/stage3-edge-switch.sh apply         # automatic rollback to the Stage 1 page on any failure
```
`/nonexistent` = no operator inputs: `MAPS_PROVIDER=none`, no SMS, no push. To add Unifonic/FCM from the start instead, put the lines in
`~/.hatly/production-inputs.env` (mode 600) and omit `HATLY_PROD_INPUTS=…`. Then on the host: `crontab` via
`/opt/hatly-prod/current/deploy/production/install-host-crons.sh show` → `apply` (backups, ops-watch, Cloudflare-ranges check).

**B. First SUPER_ADMIN (owner, on the host — the password is read silently, never in history/ps):**
```bash
ssh ubuntu@152.228.240.4
read -r -p "Admin phone (+20…): " BOOTSTRAP_ADMIN_PHONE; read -r -p "Admin name: " BOOTSTRAP_ADMIN_NAME; read -r -s -p "Admin password: " BOOTSTRAP_ADMIN_PASSWORD; echo
export BOOTSTRAP_ADMIN_PHONE BOOTSTRAP_ADMIN_NAME BOOTSTRAP_ADMIN_PASSWORD
/opt/hatly-prod/current/deploy/production/prod.sh bootstrap-admin; unset BOOTSTRAP_ADMIN_PASSWORD
```
Then sign in at `https://admin.hatly.dev`, enrol MFA (Security page), and create a second SUPER_ADMIN before `DASHBOARD_ADMIN_MFA_REQUIRED=true`.

**C. Business data (owner/admin, in the dashboard — real values only; the production database starts empty):**
1. **Service areas** → the Belbeis service area: centre latitude/longitude and radius (metres) covering the delivery area and the vendor branches.
2. **Delivery zones** → each area customers choose (Arabic/English name, city/governorate) with its **delivery fee** (EGP, entered in minor units: 15 EGP = 1500). With Maps deferred this fee IS the delivery price.
3. **Settings → Registered-Vendor Additional-Vendor Fee** (minor units) — required: zone pricing fails closed (`DELIVERY_FEE_UNAVAILABLE`) until it is set. (The per-100 m price / minimum fee are only used when Maps is on; the Hatly Service multiplier is seeded 1.5.)
4. **Vendors / Branches / Vendor staff / Sectors / products** — real partners, each branch inside the service area.
5. **Vehicle types + Drivers** — approved, online drivers are what automatic dispatch ranks (straight-line; bicycles are not auto-ranked while Maps is deferred).
6. **Manual transfer** destination + customer-service WhatsApp number, if manual transfer is offered.

**D. Customer registration / OTP — DECISION 2026-10-24: switch OTP OFF temporarily until an SMS provider exists.** The control already
exists and is verified: **Dashboard → Settings → "Customer Authentication — OTP"** (confirmation prompt before switching off) →
`PUT admin/business-config/CUSTOMER_OTP_ENABLED`, server-side permission `MANAGE_BUSINESS_CONFIG` (SUPER_ADMIN implicit), persisted in
`business_config`, every change audited as `business_config.changed` (the setting's name, never its value). Hardened 2026-10-24: the backend
now accepts **only `true`/`false`** for it (400 `INVALID_BUSINESS_CONFIG_VALUE` otherwise) and reads it **fail-safe** (only an explicit `false`
turns OTP off; unset/malformed = ON). Tests: unit (`business-config.service.spec`), e2e `106-otp-admin-control` (default ON, 403 without the
permission, value validation, persistence, audit row, OFF flow, re-enable) + the existing `10-authentication` flows.
- **OFF behaviour (deliberate, not a bypass):** registration = phone + password; the account's phone is stored **UNVERIFIED**; a code a client
  sends is ignored; sign-in is password-only in both modes (unchanged); sessions, roles and authorization are unchanged; no SMS is sent.
- **Risks while OFF:** phone numbers are unproven — a fake number, or **squatting** a real person's number (that person then cannot register
  it). Mitigations: keep the OFF period short; support handles disputes (an admin can review the account; the public account-deletion
  request flow exists); turn OTP back ON as soon as Unifonic works.
- **Turning it back ON:** configure Unifonic on the host (append `UNIFONIC_APP_SID=…` and `UNIFONIC_SENDER_ID=…` to `/opt/hatly-prod/.env.production`,
  remove `ALLOW_MISSING_SMS_PROVIDER=true`, `prod.sh env-check` must PASS, `prod.sh apps`), prove delivery by registering a Hatly-controlled SIM,
  then switch the setting ON. New registrations need a code again; accounts created while OFF keep signing in and can verify their phone
  through the in-app verification flow.
- **When:** only after Stage 3, by the first SUPER_ADMIN in the dashboard (the agent does not change production settings).

**E. Google Play (owner — no Play access exists in the agent session).** See `CRITICAL_PATH.md` §0 "Play" rows. To let the uploader run:
Google Cloud project → enable *Google Play Android Developer API* → create a service account (no IAM roles) → create a JSON key → save it as
`~/.hatly/play-service-account.json` and `chmod 600` it; Play Console → Users and permissions → invite the service-account e-mail with the
app-level permission **"Release apps to testing tracks"** for `dev.hatly.customer` only. Then:
`node scripts/launch/play-upload.mjs --aab apps/customer-app/build/app/outputs/bundle/release/app-release.aab --notes-dir docs/launch/store/release-notes/customer-1.0.0-1 --track internal`
(creates a DRAFT on Internal testing; a person rolls it out). The app record, store listing, App content forms and Play App Signing must exist first (Play Console UI).

## 0.2 Minimum Production DATA before the customer app is usable (written 2026-10-28; none of it exists yet, none of it is code)

**Evidence.** Read-only, unauthenticated `GET https://api.hatly.dev/api/v1/sectors` on 2026-10-28 → `[]`, API healthy (`/health/ready` 200, 0.15–0.6 s). An earlier read-only database check (2026-10-26, other session) found **0 delivery zones, 0 vendors, 0 branches** and no customers. A store build never shows demo content (`kHomeDemoContentEnabled` defaults to debug builds only), so with no data the customer sees only the Hatly Service card — now with an explicit "No stores are available yet" notice instead of a blank page.

**Why a customer cannot save ANY address today (not a bug):** `POST /addresses` requires an **active delivery zone of an active service area** (PD-009 — `DELIVERY_ZONE_UNAVAILABLE` otherwise). `GET /delivery-zones` returns only those, so the app's area dropdown is empty and Save is off. The new e2e `107-address-persistence` pins this exact behaviour *and* proves that the moment a zone exists everything saves and persists.

**What an operator must create, in this order** (Admin dashboard `https://admin.hatly.dev/login`, as SUPER_ADMIN or an admin with the permission shown; every value is the operator's own real business fact — nothing here may be invented or copied from Staging test data):
| # | Create | Dashboard page / endpoint | Needs (real values from the operator) |
|---|---|---|---|
| 1 | **Service area** | `service-areas` · `admin/service-areas` (`MANAGE_SERVICE_AREAS`) | name (+ Arabic), **centre latitude/longitude**, **radius in metres** of the area Hatly really serves |
| 2 | **Delivery zones** (one per neighbourhood/area the customer chooses) | `delivery-zones` · `admin/delivery-zones` (`MANAGE_SERVICE_AREAS`; the *price* needs `MANAGE_DELIVERY_FEE_MULTIPLIER`) | the service area; governorate and city (English + Arabic); zone name (English + Arabic); **delivery fee in piastres** |
| 3 | **Sectors** (the Home categories) | `sectors` · `admin/sectors` — **the dashboard could only LIST sectors until 2026-10-28; "New sector" and Activate/Deactivate exist in the source now but are NOT DEPLOYED yet — until the dashboard is redeployed, create sectors with `POST /admin/sectors`** | name (+ Arabic) and a lowercase slug; image, order and "custom requests" are optional |
| 4 | **Vendor + branch** inside the service area | `vendors`, `branches` · `admin/vendors`, `admin/vendor-branches` | real shop details; the branch must lie in the service area (`VENDOR_OUTSIDE_DELIVERY_AREA` otherwise) **and be assigned to a sector** (a branch with no sector never appears under a Home category) |
| 5 | **Vendor staff login** | `vendor-staff` | phone + initial password of a real person |
| 6 | **Products** (and optionally offers) | vendor dashboard `/products`, admin `offers` | real items and prices |
| 7 | **Drivers + vehicle types** (only when orders will be delivered) | `drivers`, `vehicle-types` | real drivers; the driver APK is a separate deliverable |
Delivery pricing/business settings: `settings`. Until steps 1–2 exist **no address can be saved and no order can be placed**; until 3–6 exist Home stays empty by design.

**Maps are deferred in Production** (`MAPS_PROVIDER=none`): address search and reverse geocoding answer "nothing" (verified, e2e `105-maps-disabled`). Consequences, all by design: a customer saves an address by **typing it and choosing a zone**; a map pin can only come from the phone's **GPS** ("Use my current location"); and **Hatly Service needs coordinates for its *place*** (the pharmacy, the drop-off point — an owner rule, `project-hatly-service-location-rule`), which today can only be captured by standing at that place. Enabling a map provider later removes that limit; it is a deliberate product/cost decision, not a code gap.

**Approval gates:** creating this data is **Production data entry** by the operator (or by Claude only with an explicit instruction for each record); no migration is needed and none is pending for it.

## 0.3 Home banners — what exists in the source, what is NOT deployed, and the order to deploy it (written 2026-10-28; nothing below has run)

**Finding.** There was **no banner feature at all** in Production's code or in the repository: no table, no admin endpoint, no public endpoint, no dashboard page (`GET /api/v1/home-banners` → 404 on Production, read-only check 2026-10-28). The customer Home carousel only ever showed *offer-derived* cards (and demo content in debug builds). It is now implemented locally end to end: admin page `/banners` (create draft → upload image → publish; schedule; order; optional destination = product / vendor branch / sector, never an external link), `GET /home-banners` (public; only published, in-schedule banners whose destination still exists; max 10; no admin fields), the customer carousel (admin banners win; the offer promos are the fallback; a failing banner request is silent), table `home_banners` via migration `1700006000000-HomeBanners` (**additive, reversible, not applied anywhere except the isolated test databases**), permission `MANAGE_HOME_BANNERS` (SUPER_ADMIN has it; grant it to an ADMIN in Users). Images use the existing upload boundary (JPEG/PNG/WebP ≤ 5 MB, bytes checked) and are stored as `/uploads/files/<uuid>.<ext>`; Production's `STORAGE_DRIVER=local` serves them from the API host's volume, publicly and at a stable path (no signed URLs).

**Deployment order when approved (each step is a separate approval — none was taken):** 1. the standard backup (`OPERATIONS_BACKUP_RESTORE_ROLLBACK.md`); 2. apply the one new migration (the OLD backend ignores the table, so migrating first is safe); 3. deploy the backend (adds `/home-banners`, `/admin/home-banners`, the permission); 4. deploy the dashboard (adds Banners; also the sector create/activate form); 5. build and upload a **new customer app version** (higher versionCode) — it contains the banner carousel, the "No stores yet" notice, the Egyptian-numbers-only message, the receive timeout and the address-form changes. **An older app and a newer app both work against either backend:** the new app simply gets a 404 from an old backend and falls back to the offer promos; the old app never asks for banners.
**After an approved deployment, verify (read-only first):** `GET /home-banners` → 200 `[]`; the admin page loads; then, only with explicit approval to write one Production record, create a clearly-named draft, upload an image, publish, confirm `GET /home-banners` returns exactly the public fields and the image URL opens, then unpublish/delete it. **Banner content (the images and their text) is the owner's marketing material — nothing was created or invented.**

## 1. What was seen on the host (2026-10-12) and what it implies

| Fact *(2026-10-12)* | Implication |
|---|---|
| One VPS `152.228.240.4`: Ubuntu 24.04, 6 vCPU, 11.7 GB RAM (10.9 GB free), 96 GB disk (86 GB free), Docker 29.9 / Compose 5.6, UFW allowing only SSH (80/443 were opened later for staging) | Enough for launch-scale traffic. **Single point of failure** and staging + production share it: set container memory limits, keep an off-host backup, and decide whether staging stays on the same box after launch. |
| Production compose at `/opt/hatly-git/compose.yaml` (untracked in git), not running; no production containers; only a dashboard `next-server` v14.2.35 on `127.0.0.1:3100` since Oct 10 | **There is no running production backend yet.** The first production deploy is a full first-time deploy (empty database, all 59 migrations, first SUPER_ADMIN), not an upgrade. |
| Production Caddyfile: `hatly.dev, www.hatly.dev, admin.hatly.dev → dashboard:3001`; `api.hatly.dev → backend:3000`; Caddy in that compose binds 80/443 | The staging Caddy owns 80/443 today. **Only one Caddy can.** Plan: one Caddy for both (merge the two staging site blocks into the production Caddyfile, stop the staging edge) — RUNBOOK already warns. Needs an owner decision on timing. |
| Compose env: `TRUST_PROXY: "true"`, `DB_SSL: "false"` + `ALLOW_INSECURE_DB: "true"`, `NODE_ENV: production`, images `hatly-backend:check` / `hatly-dashboard:check` | `TRUST_PROXY=true` is **refused at boot by the current backend** (security milestone F-series): use a hop count. The images are an old build: they must be rebuilt from the reviewed Dockerfiles. |
| `hatly.dev`, `www`, `api` DNS records are Cloudflare-proxied (orange cloud) *(2026-10-12 notes)* | **Real-client-IP trap:** behind Cloudflare the backend sees Cloudflare's addresses unless Caddy is told to trust Cloudflare and `TRUST_PROXY` is raised accordingly. Wrong = every customer shares one rate-limit bucket and a handful of failed logins lock everybody out. Verify with `deploy/staging/security-smoke.sh` and the §5.4/5.5 checks of the staging checklist **against production** before opening it. |

## 2. Required changes before the first production boot (checklist; none done on the host)

1. **Env file** from `deploy/production/env.production.template` (names/shapes only; secrets generated on the host, mode 600, never in git). Notable rules the backend enforces at boot: `MFA_ENCRYPTION_KEY` present; Redis URL carries a password; `TRUST_PROXY` a hop count; `CORS_ALLOWED_ORIGINS` exact https origins; `UPLOADS_LOCAL_DIR` absolute (and on a **mounted volume**) or S3; `MAPS_PROVIDER=google` + `GOOGLE_MAPS_API_KEY`; SMS and FCM trios or the explicit `ALLOW_MISSING_*` acknowledgement.
2. **Images** built from `deploy/staging/backend.Dockerfile` and `dashboard.Dockerfile` (they contain the 2026-10-16 fixes: nested production `node_modules`, Node 22, compiled PostCSS, `dist/src/main.js`). The dashboard needs `--build-arg NEXT_PUBLIC_API_BASE_URL=https://api.hatly.dev/api/v1` (baked into the bundle **and** the CSP `connect-src`). Note the backend Dockerfile sets `ENV NODE_ENV=staging`; the production env file/compose must set `NODE_ENV=production` explicitly (env overrides image ENV) — verify with the boot log, which prints the mode-specific warnings.
3. **Compose** adapted from the 2026-10-12 file: `TRUST_PROXY=1` (or the Cloudflare-aware value), media volume mounted at `UPLOADS_LOCAL_DIR`, healthchecks on backend/dashboard (staging compose has them), `restart: unless-stopped`, memory limits.
4. **Database**: empty `hatly_prod`; run `typeorm migration:run` **once, with approval** (same guarded procedure as RUNBOOK §5; the backup step is trivial on an empty database but practise it anyway); then create the first SUPER_ADMIN with `bootstrap:admin`, enrol two SUPER_ADMINs in MFA (`docs/security/mfa-rollout.md`) before turning the policy on.
5. **Edge**: Caddy with HSTS (the staging fallback showed none; production runs strict mode which sets it on the API; confirm for the dashboard host in a browser), Cloudflare SSL mode *Full (strict)* if proxied, UFW 80/443.
6. **Verification on the real host (read-only first)**: `security-smoke.sh`, `smoke.mjs --read-only`, the staging-checklist §5 table, then one real order end to end with a tester account.

## 3. Monitoring and alerting — recommendation (cost and account choices are the owner's)

| Layer | What | Cost / account | Status |
|---|---|---|---|
| External uptime | a probe from **outside** the VPS every 1–5 min on `https://api.hatly.dev/api/v1/health/ready` (database + redis up) and the dashboard login page; alert to phone (e-mail/Telegram/WhatsApp bridge) | free tiers exist (UptimeRobot, Better Stack, …); needs an account | **not set up** — `deploy/production/ops-watch.sh` can run from a *second* machine as a free substitute |
| Host watchdog | `deploy/production/ops-watch.sh` from cron on the VPS: API ready, dashboard, TLS days left, newest-backup age, disk %, unhealthy containers; webhook alert only on change + every 6 h | free; a webhook URL (Slack/Discord/Mattermost) | **written and tested** (local + public staging TLS; failure and recovery alerts verified against a local listener) |
| Backups | `backup-postgres.sh` verified dumps + `restore-drill.sh` monthly; backup age is an `ops-watch` check | off-host storage costs money or an existing drive (rclone target) — **owner decision** | **written and rehearsed** (details in `OPERATIONS_BACKUP_RESTORE_ROLLBACK.md`) |
| Error tracking — mobile | Firebase Crashlytics (free; the Firebase project is needed anyway for push) | adds a Google data processor → privacy label/policy must say so (crash data, device ID) | **decision needed**; the apps have the single `ErrorReporting.sink` seam ready (Batch 1) |
| Error tracking — backend/dashboard | Sentry (hosted free tier) **or** structured-log alerting only | hosted Sentry = another processor; self-hosted costs RAM on the same box | **decision needed**; today the backend writes structured JSON logs only |
| Security/ops log events to alert on | `security.rate_limited` bursts, `security.auth_failed` bursts, `security.financial_rejected`, `mfa.secret_undecryptable` (must be 0), `AUDIT WRITE FAILED` (must be 0), `external_provider.failed` (maps/FCM/SMS), `dispatch.*` "no eligible driver" alerts | a log shipper or a simple `docker logs \| grep` cron | **not set up**; the events exist (security milestone §8) |
| Business signal | Control Tower "needs attention" count, failed deliveries queue, manual-transfer payments waiting for review | none | exists in the dashboard — assign a person to watch it during launch week |

Suggested thresholds: API not ready 2 consecutive probes → page; TLS < 14 days → warn; newest backup > 30 h → page; disk > 85 % → warn; any `mfa.secret_undecryptable` or `AUDIT WRITE FAILED` → page.

## 4. Rollback (summary — procedures in `OPERATIONS_BACKUP_RESTORE_ROLLBACK.md` and RUNBOOK §9)

Application: re-tag the previous images and `up -d` (seconds). Data: restore the verified dump into a **new** database; never `migration:revert` in production (it drops the audit log / MFA secrets). Mobile: store releases cannot be pulled back from devices — use staged rollouts (Play) / phased release (Apple) and keep the previous API contract alive for 30 days.

# Staging update — final safety review before phases 5–6 (nothing below has been executed; staging still runs the old version)

Prepared 2026-10-17. Evidence comes from (a) **read-only** commands on the VPS (no write, no restart, no migration; database reads in a read-only session; the only containers started were `docker run --rm --network none` guard tests that cannot reach any database), and (b) rehearsals on **disposable local databases** using the same compiled code and the same script. The state of staging at 04:04 UTC: all five containers up and healthy, 54 migrations applied, no data row changed since the backup (latest update 2026-10-13 21:46 UTC; backup taken 2026-10-17 03:43 UTC).

## 1. Exactly what phase 5 targets — and how it cannot hit production

**Target:** the container `hatly-staging-postgres-1` (172.18.0.3 on the Docker network `hatly-staging_internal`), database **`hatly_staging`**, reached by the hostname `postgres`. Verified: that network contains only the five staging containers; the hostname `postgres` resolves to that container; the Postgres instance holds only `hatly_staging` (and the system `postgres` DB) — **there is no `hatly_prod` database anywhere on the host**; the host has **zero** production containers, networks or volumes (the production compose has never been started).

The command is wrapped in four independent safeguards (script: `deploy/staging/phase5-migrate-guarded.sh`, piped into the candidate image — nothing is copied to the host):

| # | Safeguard | What it blocks | Evidence (all executed) |
|---|---|---|---|
| 1 | **Network scope** — the one-off container joins only `hatly-staging_internal`, so `postgres` can only mean the staging container | any other database, including a future production Postgres on another network | network inspection above |
| 2 | **Target guard** (same rule as `staging.sh target_check`): host must be exactly `postgres`, database must equal `STAGING_DB_NAME`, `NODE_ENV` must be `staging` or `development` (never `production`) — runs **first**, exit 3 | a production-style name, an external host, a production `NODE_ENV` | on the **real candidate image with `--network none`**: `postgres/hatly_staging` → OK; `postgres/hatly_prod` → **REFUSED (exit 3)**; `db.production.example/hatly_staging` → **REFUSED**; `NODE_ENV=production` → **REFUSED**. Rehearsal: refused wrong host, production env, and mismatching db name with the database untouched each time |
| 3 | **Plan assertion**: refuses unless exactly **54 applied** and the **five expected pending, in order** (exit 4). Also aborts if the database is unreachable | wrong database state, a database that already has some of them, a different database that happens to pass the guard | in the real image with no network: guard OK, then **ABORT exit 4 "applied: 0"**; rehearsal at 56 applied → **ABORT exit 4**, database unchanged |
| 4 | **Timeouts** via `PGOPTIONS`: `lock_timeout=5s`, `statement_timeout=120s`, `idle_in_transaction_session_timeout=60s` | queueing behind a busy table and blocking live traffic; a hung statement | rehearsal: with an `ACCESS EXCLUSIVE` lock held on `users` the migration **gave up after 6 s (exit 5), database unchanged**; with the lock released the same script succeeded |

Before the script, the read-only `deploy/staging/phase5-preflight.sh` must print **PRE-FLIGHT PASSED** (stack healthy, 54 migrations, no active/open transactions, candidate and rollback images present, backup verified against its manifest, **no data changed since the backup**). It was run today and passed.

## 2. The five migrations

| # | File | `up()` does | Touches existing tables? | Destructive? |
|---|---|---|---|---|
| 55 | `1700005400000-CustomerNotifications` | `CREATE TABLE customer_notifications` + 2 indexes; FKs to `users` and `orders` | only as FK references (brief `SHARE ROW EXCLUSIVE` lock on `users`, `orders`) | no |
| 56 | `1700005500000-SectorCustomRequests` | `ALTER TABLE marketplace_sectors ADD COLUMN custom_requests_enabled boolean NOT NULL DEFAULT false` | yes — constant default = metadata-only change on PostgreSQL 16 (instant; momentary exclusive lock) | no |
| 57 | `1700005600000-ProductOptionSelectionLimits` | `ALTER TABLE product_options ADD COLUMN min_selections int NOT NULL DEFAULT 0, ADD COLUMN max_selections int` (nullable) + `CHECK (min_selections >= 0 AND (max_selections IS NULL OR max_selections >= GREATEST(min_selections,1)))` | yes — default is constant; the CHECK scans the small table (a few dozen rows) | no |
| 58 | `1700005700000-AdminAuditLogs` | `CREATE TABLE admin_audit_logs` + 2 indexes, an append-only trigger function and trigger on the NEW table; FK to `users` | FK reference only | no |
| 59 | `1700005800000-StaffMfaCredentials` | `CREATE TABLE staff_mfa_credentials`; FK to `users` | FK reference only | no |

**Static check of every `up()` body:** 0 `INSERT/UPDATE/DELETE` statements, 0 `DROP`, 0 `TRUNCATE`, 0 renames, 0 type changes, 0 `SET NOT NULL` on existing columns. The only occurrences of the words DELETE/UPDATE are `ON DELETE CASCADE` in new foreign keys and the new audit table's `BEFORE UPDATE OR DELETE` trigger. **No existing row is read or changed; the only data written is 5 rows in `migrations`.** The `down()` methods drop what `up()` created (which is why we never use `migration:revert`).

**Transaction behaviour:** none of the files opts out of transactions; TypeORM's default `migrationsTransactionMode = all` runs the whole pending set in **one** transaction and records the five `migrations` rows inside it (earlier rehearsal log: a single `BEGIN … COMMIT`). PostgreSQL DDL is transactional, so **all five apply or none do**.

**Safe while the old backend serves traffic?** Yes, by construction and by catalog check: nothing is dropped or renamed; new columns are `NOT NULL DEFAULT …` or nullable, so the old backend's `INSERT`s (which omit them) still succeed and its `SELECT`s (explicit column lists) are unaffected; the CHECK holds for the defaults `(0, NULL)`. The only interaction is momentary locks (a few milliseconds on a 12 MB database) while the FKs/columns are added; with `lock_timeout=5s` the migration gives up instead of making live requests wait. Pre-flight showed no active queries or open transactions (2 idle pooled connections). The reverse order is **not** safe (proven earlier: new backend + old schema → `GET /sectors` returns 500), which is why phase 6 comes strictly after phase 5.

## 3. If it fails midway, and how staging changes are protected

* **A failure inside the migration (SQL error, lock timeout, a collision):** the transaction rolls back — nothing from #55–#59 survives. **Rehearsed:** migration 5 collided with a pre-existing table after migrations 1–4 had run inside the transaction → exit 5; afterwards `migrations` still 54, `customer_notifications`/`admin_audit_logs` absent, the new columns absent. The script then says *"the database is exactly as before"*. **No restore is needed, so nothing made after the backup can be lost.**
* **Staging data after the backup:** none. The newest data change in staging is 2026-10-13 21:46 UTC; the backup is 2026-10-17 03:43 UTC; the pre-flight re-asserts this immediately before phase 5. If anyone were to use staging between now and then, the pre-flight fails ("data changed after the backup — take a fresh backup first") and a new verified backup takes about a minute (`backup-postgres.sh` + `restore-drill.sh`, proven twice).
* **Restore only if something unrelated goes wrong later** (data damage after go-live): restore the newest verified dump into a **new** database (`restore-drill.sh <dump> --keep`), compare, and copy back only what is needed; to keep post-backup changes, first export the rows changed since the backup time (`updated_at/created_at > 2026-10-17 03:43Z`) from the live database, restore, then re-import those rows. The live database is never dropped or replaced without a separate approval. Because the schema change is additive, **application rollback never requires touching data**.

## 4. Folder rename-swap and Docker mounts (re-validated against the live host)

| Fact | Evidence |
|---|---|
| Caddy has exactly one bind mount: `/opt/hatly-staging/hatly/deploy/staging/Caddyfile.staging → /etc/caddy/Caddyfile (ro)`; its other two mounts are named volumes (`caddy_data`, `caddy_config`) | `docker inspect` |
| Backend has one mount (named volume `uploads` at `/data/uploads`); dashboard has none; postgres/redis use named volumes — **no other bind mount points into the source tree** | `docker inspect` |
| A running bind mount follows the file's inode: after `mv hatly hatly.pre-…` Caddy keeps reading the original `Caddyfile.staging`; after the swap the same path holds an identical file (hash `318847d4…` in both trees) — so even a Caddy restart later would mount identical content | hashes of both files |
| Compose **config hashes**: hash of the active compose file == the `config-hash` label of every running container (no drift today); hash of the NEW compose file evaluated at the active path (`--project-directory` = active dir, i.e. exactly the post-swap situation) is **identical for all five services, Caddy included** | `docker compose config --hash` + container labels |
| In the side-by-side directory the Caddy hash differed (path) — that is the reason for the rename-swap instead of running from the new directory | earlier finding, now explained and neutralised |

**Exactly what phase 6 recreates:** the container `hatly-staging-backend-1` (then, as a separate step, `hatly-staging-dashboard-1`) — each with `up -d --no-deps --force-recreate <service>`, the service named explicitly. **`postgres`, `redis` and `caddy` are never named, so they are not recreated or restarted**; the script asserts before and after each step that their container ids still equal the ones recorded in the backup (`containers-before.txt`: caddy `5c3443d8845e`, postgres `31460087956d`, redis `4a371258900…`). `--no-deps` also stops compose from evaluating the dependencies. Expected interruption: backend ≈ 10–40 s (its health check allows 40 s), dashboard ≈ 10–30 s; Caddy keeps answering 502 for those moments. **One assumption to verify live:** Caddy resolves the `backend`/`dashboard` upstream names at connection time (standard behaviour), so it follows the new container without a reload; the `verify` step checks the public URLs, and the contingency (a graceful `caddy reload`, not a restart) would be reported to you before use.

## 5. Exact commands for review (no secrets: the env file is passed by path and never read or printed)

Variables: `H=ubuntu@152.228.240.4`, `D=20261017`. Run from the repository root on the Mac. Stop and report after every numbered step.

**Phase 5 — migrate (approval A4)**
```bash
# 5.0 read-only pre-flight — must end with PRE-FLIGHT PASSED
ssh $H 'bash -s' < deploy/staging/phase5-preflight.sh
# 5.1 guarded migration, run from the candidate image on the staging network (guard → plan assertion → migration:run → post-assertion)
ssh $H "sudo docker run --rm -i --network hatly-staging_internal --env-file /opt/hatly-staging/.env.staging \
  -e PGOPTIONS='-c lock_timeout=5000 -c statement_timeout=120000 -c idle_in_transaction_session_timeout=60000' \
  --entrypoint sh hatly-staging-backend:candidate-$D -s" < deploy/staging/phase5-migrate-guarded.sh
# expected last lines:  == 4. post-assertion: applied=59 pending=0   …   MIGRATION OK: 59 applied, 0 pending      (exit codes: 3 guard, 4 plan differs, 5 failed+rolled back, 6 post-check)
# 5.2 read-only confirmation; the OLD backend is still the one serving
ssh $H 'bash -s -- verify' < deploy/staging/phase6-switch.sh
curl -s https://api-sales.hatly.dev/api/v1/health/ready
```

**Phase 6 — switch (approval A5); only after phase 5 printed MIGRATION OK**
```bash
ssh $H 'bash -s -- check'     < deploy/staging/phase6-switch.sh   # refuses unless 59 migrations, images, trees and the original postgres/redis/caddy are in place
ssh $H 'bash -s -- retag'     < deploy/staging/phase6-switch.sh   # :local -> candidate images (running containers unaffected; old images stay as :rollback-20261017)
ssh $H 'bash -s -- swap'      < deploy/staging/phase6-switch.sh   # mv hatly hatly.pre-20261017 && mv hatly-20261017 hatly; asserts compose hashes unchanged and equal to the running containers' labels
ssh $H 'bash -s -- backend'   < deploy/staging/phase6-switch.sh   # recreates ONLY hatly-staging-backend-1, waits up to 150 s for healthy
ssh $H 'bash -s -- dashboard' < deploy/staging/phase6-switch.sh   # recreates ONLY hatly-staging-dashboard-1
ssh $H 'bash -s -- verify'    < deploy/staging/phase6-switch.sh   # postgres/redis/caddy must still be the original containers
```
**Health and behaviour checks (from the Mac, after phase 6)**
```bash
deploy/staging/security-smoke.sh --api https://api-sales.hatly.dev/api/v1 --dashboard https://sales.hatly.dev      # expect PASS except the known HSTS WARN
node deploy/staging/smoke.mjs --read-only --api https://api-sales.hatly.dev/api/v1 --dashboard https://sales.hatly.dev
for p in /customer/notifications /customer/notifications/unread-count; do curl -s -o /dev/null -w "$p %{http_code}\n" https://api-sales.hatly.dev/api/v1$p; done   # 401, no longer 404
curl -s -o /dev/null -w "delete-account %{http_code}\n" -X POST -H 'content-type: application/json' -d '{}' https://api-sales.hatly.dev/api/v1/auth/customer/delete-account   # 401 (route exists)
ssh $H 'sudo docker logs hatly-staging-backend-1 --tail 60 2>&1 | grep -ciE "ConfigurationError|error"'      # 0
```
Manual: a tester customer signs in (existing sessions keep working), opens notifications; an admin signs in through the new dashboard (one fresh sign-in is expected).

**Rollback (each command is independent and safe to run twice)**
```bash
ssh $H 'bash -s -- rollback-apps' < deploy/staging/phase6-switch.sh   # old images back as :local; recreates ONLY backend and dashboard (the old backend runs fine on the additive schema)
ssh $H 'bash -s -- rollback-tree'         < deploy/staging/phase6-switch.sh   # old source tree back in place; the new one kept as hatly.failed-20261017
# data (not expected): restore-drill.sh <dump> --keep into a NEW database; never migration:revert; replacing the live DB needs its own approval
```

## 6. Residual risks (honest)

| Risk | Assessment |
|---|---|
| The migration has never been run against the **real staging data** (only against rehearsal databases at the same 54 migrations) | low: additive DDL on a 12 MB database; rehearsal covered success, mismatch, mid-way failure and lock contention. **Optional extra:** I can restore the backup into a throw-away `hatly_drill_*` database inside staging Postgres and run the five migrations there first (creates and drops a database; no effect on staging) — say so if you want it |
| Caddy and upstream re-resolution after a backend recreate | standard behaviour, verified by the `verify` step; contingency is a graceful reload |
| 10–70 s of 502s; dashboard users sign in again once (cookie sessions); stricter rate limits | expected, announced |
| Old Oct-12 Android build and old dashboard against the new API | no routes removed (static diff); checked live in the post-checks |
| Host SSH exposure (password auth on, no fail2ban) and public Next-14 probes | exist today, outside this update; recommended separately |

**Approval needed:** phase 5 (A4) and phase 6 (A5) separately — or "approve both, stopping after each step".

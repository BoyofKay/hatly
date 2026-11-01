# Admin Panel + Vendor Dashboard release — maintenance and rollback runbook (migrations 71 + 72)

Scope: backend + dashboard release containing Slice 1 (order exceptions, migration `1700007000000-OrderExceptions`) and Slice 2 (notification outbox, change feed, staff alerts, migration `1700007100000-NotificationOutboxAndChangeFeed`). Production is at migration 70. **Strategy: coordinated maintenance window (Option 1).** The Customer and Driver apps are not part of this release.

## Why a maintenance window (the one compatibility fact that drives everything)

Migration 72 narrows the unique index `UQ_customer_notifications_order_type` to rows without an event key. The **previous** backend writes lifecycle notifications with `ON CONFLICT ("order_id","type")` (no `WHERE`); against the new schema PostgreSQL answers *"no unique or exclusion constraint matching the ON CONFLICT specification"*, the old code swallows the error in its savepoint and **silently writes no notification**. So the old backend must not serve traffic after migration 72 and before the new backend starts. The window therefore is: stop the old apps → migrate → start the new apps. (Everything else in 71/72 is additive and harmless to the old code.)

Migrations are applied by TypeORM with `transaction: each`: a failing migration rolls itself back; earlier ones stay applied.

## 0. Gates that must be green before the window (all verified by the operator, not assumed)

- Fresh archive of the exact working tree, checksum + gzip verified.
- Release bundle built by `deploy/production/make-release-bundle.sh` (refuses secrets/artifacts), checksum verified on the host after upload.
- `prod.sh env-check` PASSED with the NEW image (warnings allowed only if they are the known four: Redis not TLS on the private network, Maps `none`, no SMS provider, no FCM).
- `prod.sh plan` lists **exactly** two pending migrations, in this order: `OrderExceptions1700007000000`, `NotificationOutboxAndChangeFeed1700007100000` (70 applied).
- Fresh backup (DB + uploads) taken **immediately before** the window, with manifest; **restore drill OK**; a copy of the dump kept OFF the host.
- **Migration rehearsal passed**: the same dump restored into a throw-away database (`hatly_drill_…`) on the production Postgres, migrations 71 → 72 run there with the new image, row counts of every business table identical before/after, new tables/triggers present, rolled-back write produces no change event; the scratch database dropped.
- Previous release kept on disk and its images tagged: `20261031T045345Z-97e64fe22247` (backend + dashboard images present).
- Host: ≥ 10 GB free, all four containers healthy.

## 1. Preparation (no user impact; the live release keeps serving)

```bash
REL=<release id>; BD=~/Library/Caches/hatly-releases/$REL; H=ubuntu@152.228.240.4; PD=/opt/hatly-prod; OLD=20261031T045345Z-97e64fe22247
# upload + verify + extract
ssh -o BatchMode=yes $H "set -C; cat > $PD/incoming/$REL.tar.gz.partial && mv -n $PD/incoming/$REL.tar.gz.partial $PD/incoming/$REL.tar.gz" < $BD/hatly-prod-src.tar.gz
ssh $H "cd $PD && echo \"$(cut -d' ' -f1 $BD/hatly-prod-src.tar.gz.sha256)  incoming/$REL.tar.gz\" | sha256sum -c - && mkdir -m 700 releases/$REL.partial && tar -xzf incoming/$REL.tar.gz -C releases/$REL.partial && mv -T releases/$REL.partial releases/$REL && chmod 755 releases/$REL/deploy/production/*.sh"
# images under the new tag (the old tag keeps serving) + env validation by the new image + plan
ssh $H "PROD_RELEASE=$REL $PD/releases/$REL/deploy/production/prod.sh build && PROD_RELEASE=$REL $PD/releases/$REL/deploy/production/prod.sh env-check && PROD_RELEASE=$REL $PD/releases/$REL/deploy/production/prod.sh plan | tail -6"
```
Expected: `sha256sum: OK`; build succeeds; `ENV CHECK PASSED (4 warnings)`; plan shows `[X]` for the 70 existing and `[ ]` for exactly the two new ones.

## 2. Backup, restore drill, migration rehearsal (no user impact)

```bash
ssh $H "PROD_RELEASE=$REL $PD/releases/$REL/deploy/production/prod.sh backup"          # prints: backup OK … + uploads archive
ssh $H 'cd /opt/hatly-prod && f=$(ls -1t backups/hatly-prod-2*.dump | head -1) && HATLY_COMPOSE_FILE=/opt/hatly-prod/releases/'$REL'/deploy/production/docker-compose.production.yml HATLY_COMPOSE_PROJECT=hatly-prod HATLY_ENV_FILE=/opt/hatly-prod/.env.production PROD_RELEASE='$REL' bash releases/'$REL'/deploy/production/restore-drill.sh $f'   # restore drill OK
scp -p $H:$PD/backups/<dump> <dump>.manifest.json ~/Downloads/hatly-backups/prod/      # off-host copy, mode 600
```
Rehearsal: `restore-drill.sh --keep` into `hatly_drill_*`, then run `migration:run` of the new image against that database only (URL derived inside the container, never printed), compare table counts before/after, check triggers/indexes, then `DROP DATABASE hatly_drill_*`.

## 3. Maintenance window

```bash
# 3.1 take the apps down (data stores and volumes stay); this is the established safe way to stop business writes
ssh $H "$PD/current/deploy/production/prod.sh stop-apps"
# 3.2 prove nothing writes: no backend/dashboard container, and only postgres/redis remain
ssh $H 'sudo -n docker ps --format "{{.Names}}" | grep -E "hatly-prod-(backend|dashboard)" || echo "apps stopped"'
ssh $H 'sudo -n docker exec hatly-prod-postgres-1 sh -c '"'"'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and state<>'"'"'"'"'"'idle'"'"'"'"'"'"'"'"'"'   # expect 0 active sessions
# 3.3 guarded migration with the NEW image (takes its own backup first, re-counts afterwards)
ssh $H "PROD_RELEASE=$REL CONFIRM_MIGRATE=hatly_prod $PD/releases/$REL/deploy/production/prod.sh migrate"
# 3.4 switch the release and start the new apps (the dashboard waits for a healthy backend)
ssh $H "cd $PD && echo $REL > RELEASE && ln -sfn releases/$REL current && $PD/current/deploy/production/prod.sh apps && $PD/current/deploy/production/prod.sh status"
```
Expected: `before: 70 migrations applied` → `after: 72 migrations applied` → `OK no pending migrations`; backend/dashboard `healthy`; `/api/v1/health/ready` → `{"status":"ok","checks":{"database":"up","redis":"up"}}`; dashboard `/privacy 200`.

Typical window length: a few minutes (image already built, migrations are DDL on small tables).

## 4. Verification before leaving maintenance (non-destructive; no credentials entered)

- Public: `api.hatly.dev/api/v1/health/ready` 200, `/sectors`, `/home-banners`, `/config/client` 200 (browser User-Agent: Cloudflare 403s the default one); `admin.hatly.dev` `/` 307, `/login` 200, `/exceptions` + all prior routes 200.
- Guards: new API routes answer **401** without a session (`/admin/order-exceptions`, `/admin/order-exceptions/summary`, `/admin/changes`, `/admin/notification-outbox/summary`, `/staff/notifications`, `/staff/notifications/unread-count`, `/vendor/orders/changes`), **not 404** (mounted) and **not 200** (guarded). Customer-only route with no token → 401.
- Database (read-only SQL): 72 migrations; new tables present (`notification_outbox`, `staff_notifications`, `notification_preferences`, `change_events`, `change_feed_state`, `order_exceptions`, `order_exception_items`, `order_exception_events`); 6 `trg_change_*` triggers; `UQ_customer_notifications_order_type` (partial) and `…_event` exist; **row counts of every business table identical to the pre-window baseline** (users 14, orders 18, order_items 29, order_vendor_segments 20, payments 2, wallet_transactions 0, financial_events 0, customer_notifications 32, vendors 33, vendor_branches 32, products 225 …).
- Logs: the new backend log shows no errors; `Redis unavailable for rate limiting` must not appear.
- Notification processing: the worker timer is running (log), `notification_outbox` empty/without FAILED/DEAD rows; `change_events` stays empty until the first real order change (a harmless idle state).
- Caddy/Cloudflare/DNS untouched; Staging untouched.
- Not verifiable by the agent (needs a credential it must not enter): any signed-in screen. **Owner**: sign in once and open Exceptions, Order management, Executive; open the alerts bell. Production has 0 vendor-staff accounts, so the Vendor Dashboard cannot be exercised signed-in until the owner creates a vendor-staff user.

## 5. Rollback decision tree (never blind, never `migration:revert` first, never restore an old DB over newer business data)

| Situation | Action |
|---|---|
| Failure BEFORE migrate (build, env-check, plan, backup, drill, rehearsal) | Nothing in Production changed. Fix and retry; apps keep serving. |
| `stop-apps` done, migrate not started or failed on 71 | DB is at 70 (71 rolls itself back). Restart the OLD release: `ssh $H "$PD/current/deploy/production/prod.sh apps"` (RELEASE unchanged). |
| Migrate failed on 72 (71 applied, 72 rolled back) | DB at 71 (additive, harmless to the old code). Either fix forward and re-run `migrate`, or start the OLD release (`prod.sh apps` with RELEASE still `$OLD`) — the old code is fully compatible with 71. |
| 72 applied, new backend does not become healthy | **Keep maintenance.** Read `prod.sh logs`. Prefer fix-forward (config/env). Old release is NOT a safe interim: it would silently lose lifecycle notifications (see top). Only if the owner accepts that gap for a short, explicit time may the old release run: `echo $OLD > RELEASE && ln -sfn releases/$OLD current && prod.sh apps`. |
| 72 applied and a revert of 72 is really required | Only with the evidence that Slice-2 tables are empty: `select (select count(*) from staff_notifications)+(select count(*) from notification_outbox)+(select count(*) from customer_notifications where event_key is not null)` = 0, after a fresh backup, via `typeorm migration:revert` of the LAST migration only (its `down()` drops only objects created by 72). If any of those counts is > 0 the revert is forbidden without first exporting those rows. |
| Data problem | Restore the verified dump into a NEW database (`restore-drill.sh --keep`) and compare; never overwrite the live database. |

Evidence to preserve on any failure: `prod.sh logs`, `prod.sh plan`, `select name from migrations order by id desc limit 3`, the backup manifest, the timestamps of each step.

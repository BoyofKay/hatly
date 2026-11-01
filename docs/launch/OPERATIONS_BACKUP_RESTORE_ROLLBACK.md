# Backup, restore and rollback — operating procedures (prepared 2026-10-17)

Tools: `deploy/production/backup-postgres.sh`, `deploy/production/restore-drill.sh`, `deploy/production/ops-watch.sh`. All three were rehearsed on disposable local databases (below). **Nothing was installed on the VPS, no cron entry exists, no backup of staging/production was taken.**

## 1. What must be backed up, how often, where

| Asset | Why | Method | Frequency | Retention |
|---|---|---|---|---|
| PostgreSQL (`hatly_prod`): orders, money ledgers, users, audit log | the business | `backup-postgres.sh` (custom-format `pg_dump`, verified with `pg_restore -l`, SHA-256 + manifest) | **every 6 h** recommended for launch weeks (RPO 6 h), daily after; **plus one immediately before every deploy/migration** | 14 days local (script default; always keeps the newest 3) + **off-host copy** |
| Uploaded media (local driver: the `hatly-prod_uploads` volume) | custom-request photos, proof-of-delivery photos | `deploy/production/backup-uploads.sh` (read-only mount into a throw-away helper container, archive listed back, SHA-256 manifest, same retention/off-site hook as the database) — `prod.sh backup` runs both | daily | 14 days |
| `.env.production` and the MFA/JWT/DB secrets | without `MFA_ENCRYPTION_KEY` every admin must re-enrol; without DB password the data is unreachable | copy into the owner's password manager / encrypted offline medium — **never** into the same machine's backup folder or git | once, and on every change | — |
| Redis | sessions, OTP state, rate-limit counters (ephemeral by design; AOF is on) | not backed up; losing it signs everybody out, nothing else | — | — |
| Caddy volume (`hatly-staging_caddy_data`) | Let's Encrypt certs re-issue automatically, **but it also holds the production Cloudflare Origin certificate + key** (`/data/tls/hatly-origin-exact`) | the owner's copy of `origin-exact.pem` + key (secret store) is the backup; never `down -v` the staging stack | on change | — |
| Firebase service account, Apple/Google signing keys | irreplaceable | owner's secret store, 2 offline copies of the Android upload keystore | once | — |

**A backup that lives only on the machine it protects is not a backup.** Set `OFFSITE_CMD` (for example `rclone copy "$1" remote:hatly-backups/` to any drive/object store) before launch; the script fails loudly if that copy fails, and `ops-watch.sh` alerts when the newest backup is older than 30 h. Which off-host target to use (and its cost) is the owner's decision.

Cron example (on the host, as the deploy user; `flock` prevents overlap):

```cron
17 */6 * * *  flock -n /tmp/hatly-backup.lock env HATLY_COMPOSE_FILE=/opt/hatly-git/compose.yaml HATLY_COMPOSE_PROJECT=hatly HATLY_ENV_FILE=/opt/hatly-git/.env.production BACKUP_DIR=/var/backups/hatly OFFSITE_CMD='rclone copy "$1" remote:hatly-backups/' /opt/hatly-git/deploy/production/backup-postgres.sh >> /var/log/hatly-backup.log 2>&1
*/5 * * * *   env API_URL=https://api.hatly.dev/api/v1 DASHBOARD_URL=https://hatly.dev BACKUP_DIR=/var/backups/hatly ALERT_WEBHOOK_URL=… /opt/hatly-git/deploy/production/ops-watch.sh >> /var/log/hatly-ops-watch.log 2>&1
```

## 2. Restore

1. **Never restore over the live database.** Restore into a new one, check it, then switch deliberately.
2. Drill (monthly, and once before launch): `HATLY_COMPOSE_FILE=… HATLY_COMPOSE_PROJECT=… ./restore-drill.sh /var/backups/hatly/<dump>` — creates `hatly_drill_<time>`, restores, compares with the manifest (tables, migrations recorded), prints counts, drops it. It refuses any database name that does not start with `hatly_drill_`.
3. Real restore after data damage: `restore-drill.sh <dump> --keep` to get a verified copy → inspect → point the backend (`DATABASE_URL`) at it, or `pg_dump` the needed rows from it. Media (apps stopped, into the volume): `docker run --rm -v hatly-prod_uploads:/u -v <backup dir>:/b:ro --user 0 --entrypoint tar hatly-prod-backend:<release> -xzf /b/<file> -C /u` — verify the file count against its manifest first.
4. **Whole-host loss** (new VPS): install Docker → copy the secret set → clone/unpack the reviewed release → build images (RUNBOOK §9 steps 7–8) → start `postgres` → restore the newest verified dump → `typeorm migration:show` must list no pending migration → untar media → start apps → re-point DNS/Cloudflare → smoke. Expected RTO 1–2 h with the secrets and an off-host dump at hand.

Rehearsal evidence (disposable local databases, 2026-10-17): dump of a 59-migration database → **57 table-data sections**, SHA-256 manifest; a failed dump (wrong database) exited 1 and left no file; an off-site hook copy succeeded, a failing hook exited non-zero with "stored locally but the OFF-SITE copy FAILED"; the drill restored 57 tables / 59 migrations, ended with `restore drill OK` and dropped the drill database; a missing dump file exited 2. Earlier (2026-10-16): dump at 54 applied → 5 migrations applied → restore into a new database → back at 54 applied / 5 pending. **Compose mode** (the `docker compose exec` path used on the VPS) is the same commands as RUNBOOK §5 but was **not executed** (no Docker here) — run the drill once on the real host before relying on it.

## 3. Rollback

| What went wrong | Action | Notes |
|---|---|---|
| New backend/dashboard build misbehaves | re-tag the previous images and `docker compose up -d` (RUNBOOK §9 rollback; tags are created in step 3 *before* building) | seconds; **forward-only migrations are additive**, so the old build runs on the new schema |
| Bad configuration | restore the previous env file from the secret store; restart | keep the last good env file |
| A migration failed | nothing applied (single transaction); fix and retry | verified: all pending migrations run in one `BEGIN…COMMIT` |
| Data corruption / wrong bulk edit | restore the last good dump into a new database (§2) | do **not** use `migration:revert` in production: reverting `AdminAuditLogs` drops the audit log, reverting `StaffMfaCredentials` drops all TOTP secrets |
| A bad mobile release | halt the staged rollout in Play Console / pause phased release in App Store Connect; ship a fixed build with a higher build number; keep the previous API contract live ≥ 30 days | store releases cannot be recalled from phones that already updated; there is no minimum-version gate yet (recorded in `RELEASE_VERSIONING.md`) |
| Cloudflare / Caddy / certificate problem | revert the Caddyfile in place — the file Caddy actually reads **and** the active-path copy (`deploy/staging/RUNBOOK.md` → "Caddy configuration across restarts"); then `docker exec hatly-staging-caddy-1 caddy reload --adapter caddyfile --config /etc/caddy/Caddyfile --address 127.0.0.1:2019` (the default address fails: admin listens on 127.0.0.1 only). Let's Encrypt certificates are re-issued automatically; the production Origin certificate lives in the `caddy_data` volume and is not re-issued | check `ops-watch` TLS line; `caddy-config-guard.sh` must pass |

Rule for future migrations (expand → deploy → contract): ship only additive schema changes in one release; remove old columns in a later release once no deployed app version uses them. This is what makes the application rollback above safe.

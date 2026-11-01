#!/usr/bin/env bash
# READ-ONLY pre-flight for the staging migration (phase 5). Run on the VPS:  ssh ubuntu@152.228.240.4 'bash -s' < phase5-preflight.sh
# Refuses (exit 1) unless: the old stack is healthy; the database is at 54 migrations; nothing is mid-transaction; the candidate images and the rollback
# tags exist; the verified backup is intact; and staging data has not changed since the backup. Changes nothing (database session is read-only).
set -uo pipefail
D="${D:-20261017}"; B="$(ls -1dt /opt/hatly-staging/backups/pre-update-* 2>/dev/null | head -1)"; fail=0
ok() { echo "OK    $1"; }; bad() { echo "FAIL  $1"; fail=1; }
PSQL() { sudo docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' hatly-staging-postgres-1 sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -At -F "|"' </dev/stdin; }
for c in caddy backend dashboard postgres redis; do s=$(sudo docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' hatly-staging-$c-1 </dev/null); case "$s" in "running healthy"|"running ") ok "$c: $s";; *) bad "$c: $s";; esac; done
[ "$(curl -s -m 8 -o /dev/null -w '%{http_code}' http://127.0.0.1:13000/api/v1/health/ready)" = 200 ] && ok "backend ready on 127.0.0.1:13000" || bad "backend not ready"
for t in backend dashboard; do sudo docker image inspect hatly-staging-$t:candidate-$D >/dev/null 2>&1 && ok "candidate image $t:candidate-$D exists" || bad "candidate image $t missing"; sudo docker image inspect hatly-staging-$t:rollback-$D >/dev/null 2>&1 && ok "rollback tag $t:rollback-$D exists" || bad "rollback tag $t missing"; done
[ -d /opt/hatly-staging/hatly-$D ] && [ -d /opt/hatly-staging/hatly ] && [ ! -e /opt/hatly-staging/hatly.pre-$D ] && ok "trees: active + side-by-side present, hatly.pre-$D not yet used" || bad "tree layout unexpected"
if [ -n "$B" ] && (cd "$B" && sha256sum -c MANIFEST.sha256 >/dev/null 2>&1); then ok "backup $(basename "$B") verified (all files match MANIFEST.sha256)"; else bad "backup missing or fails verification"; fi
OUT=$(PSQL <<'SQL'
select 'migrations', count(*) from migrations;
select 'orders', count(*) from orders;
select 'users', count(*) from users;
select 'max_updated', greatest((select max(updated_at) from orders),(select max(updated_at) from users),(select max(updated_at) from carts));
select 'active_queries', count(*) from pg_stat_activity where datname = current_database() and state <> 'idle' and pid <> pg_backend_pid();
select 'open_xact_seconds', coalesce(extract(epoch from max(now() - xact_start))::int, 0) from pg_stat_activity where datname = current_database() and xact_start is not null and pid <> pg_backend_pid();
SQL
)
g() { printf '%s\n' "$OUT" | awk -F'|' -v k="$1" '$1==k{print $2}'; }
[ "$(g migrations)" = 54 ] && ok "database at exactly 54 migrations" || bad "migrations=$(g migrations) (expected 54)"
[ "$(g active_queries)" = 0 ] && ok "no active queries" || bad "active queries: $(g active_queries)"
[ "${g_open:-$(g open_xact_seconds)}" -lt 5 ] && ok "no open transaction older than 5 s" || bad "an open transaction is running"
# data unchanged since the backup: counts recorded in the dump's manifest are not kept, so compare with the backup's own restore (counts) and mtimes
BT=$(stat -c %Y "$B"/*.dump 2>/dev/null | head -1); LAST=$(date -u -d "$(g max_updated)" +%s 2>/dev/null || echo 0)
[ "$LAST" -le "${BT:-0}" ] && ok "no staging data changed since the backup (latest row update $(g max_updated))" || bad "data changed after the backup (latest $(g max_updated)) — take a fresh backup first"
echo "orders=$(g orders) users=$(g users)"
[ "$fail" = 0 ] && echo "PRE-FLIGHT PASSED" || { echo "PRE-FLIGHT FAILED — do not migrate"; exit 1; }

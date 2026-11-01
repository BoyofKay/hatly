#!/usr/bin/env bash
# Restore DRILL: proves a backup can actually be restored. Restores a dump into a brand-new, throw-away database, compares it with the
# backup's manifest, then drops it. It can never touch the live database: it only ever creates/drops a database whose name starts with
# `hatly_drill_`, and refuses if that name already exists.
#   ./restore-drill.sh /var/backups/hatly/hatly-<timestamp>.dump        (newest dump if omitted and BACKUP_DIR is set)
# Compose mode (production host):  HATLY_COMPOSE_FILE=… HATLY_COMPOSE_PROJECT=… [HATLY_ENV_FILE=…] ./restore-drill.sh <dump>
# Direct mode (rehearsal): HATLY_PG_ADMIN_URL=postgres://admin@host:5432/postgres [HATLY_DRILL_ROLE=hatly] ./restore-drill.sh <dump>
# Add --keep to leave the drill database for inspection (you then drop it yourself).
set -euo pipefail
dump="${1:-}"; keep=0; [ "${2:-}" = "--keep" ] && keep=1; [ "${1:-}" = "--keep" ] && { keep=1; dump=""; }
if [ -z "$dump" ]; then dump="$(ls -1t "${BACKUP_DIR:?give a dump file or set BACKUP_DIR}"/*.dump 2>/dev/null | head -1)"; fi
[ -f "$dump" ] || { echo "no dump file found" >&2; exit 2; }
db="hatly_drill_$(date -u +%Y%m%d%H%M%S)"
manifest="$dump.manifest.json"; want_tables=""; [ -f "$manifest" ] && want_tables="$(sed -E 's/.*"table_data_sections":([0-9]+).*/\1/' "$manifest")"
if [ -n "${HATLY_PG_ADMIN_URL:-}" ]; then
  admin="$HATLY_PG_ADMIN_URL"; role="${HATLY_DRILL_ROLE:-}"
  sql() { psql "$admin" -v ON_ERROR_STOP=1 -Atc "$1"; }
  create() { sql "CREATE DATABASE $db${role:+ OWNER $role}"; }
  drop() { sql "DROP DATABASE IF EXISTS $db"; }
  dburl="$(printf '%s' "$admin" | sed -E "s#/[^/]*\$#/$db#")"
  restore() { pg_restore --no-owner ${role:+--role="$role"} -d "$dburl" "$dump"; }
  query() { psql "$dburl" -Atc "$1"; }
else
  : "${HATLY_COMPOSE_FILE:?set HATLY_COMPOSE_FILE or HATLY_PG_ADMIN_URL}" "${HATLY_COMPOSE_PROJECT:?set HATLY_COMPOSE_PROJECT}"
  SUDO=""; docker info >/dev/null 2>&1 || SUDO="sudo -E"   # -E: compose interpolation needs the caller's variables (e.g. PROD_RELEASE)
  dc() { $SUDO docker compose -p "$HATLY_COMPOSE_PROJECT" ${HATLY_ENV_FILE:+--env-file "$HATLY_ENV_FILE"} -f "$HATLY_COMPOSE_FILE" "$@"; }
  pg() { dc exec -T postgres sh -c "$1" </dev/null; }   # stdin closed so a piped script (ssh host bash -s) is not swallowed
  create() { pg "psql -U \"\$POSTGRES_USER\" -d postgres -v ON_ERROR_STOP=1 -Atc \"CREATE DATABASE $db OWNER \$POSTGRES_USER\""; }
  drop() { pg "psql -U \"\$POSTGRES_USER\" -d postgres -Atc \"DROP DATABASE IF EXISTS $db\""; }
  restore() { dc exec -T postgres sh -c "pg_restore --no-owner -U \"\$POSTGRES_USER\" -d $db" < "$dump"; }
  query() { pg "psql -U \"\$POSTGRES_USER\" -d $db -Atc \"$1\""; }
fi
case "$db" in hatly_drill_*) ;; *) echo "refusing: unexpected database name" >&2; exit 2;; esac
cleanup() { [ "$keep" = 1 ] || drop >/dev/null 2>&1 || echo "WARNING: could not drop $db — drop it by hand" >&2; }
trap cleanup EXIT
create >/dev/null; restore >/dev/null
tables="$(query "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'" | tr -d ' \r')"
migs="$(query "select count(*) from migrations" | tr -d ' \r')"
users="$(query "select count(*) from users" | tr -d ' \r')"
echo "drill database $db restored from $(basename "$dump"): ${tables} tables, ${migs} migrations recorded, ${users} users"
[ "${tables:-0}" -gt 0 ] && [ "${migs:-0}" -gt 0 ] || { echo "restore drill FAILED: restored database looks empty" >&2; exit 1; }
if [ -n "$want_tables" ] && [ "$want_tables" -gt "$tables" ]; then echo "restore drill FAILED: manifest lists $want_tables data sections, restored $tables tables" >&2; exit 1; fi
echo "restore drill OK$([ "$keep" = 1 ] && echo " (database kept: $db)")"

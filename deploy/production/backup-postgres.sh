#!/usr/bin/env bash
# Verified PostgreSQL backup for the Hatly production (or staging) database. Run on the HOST from cron/systemd; prints no secret.
#   HATLY_COMPOSE_FILE=/opt/hatly-git/compose.yaml HATLY_COMPOSE_PROJECT=hatly HATLY_ENV_FILE=/opt/hatly-git/.env.production \
#   BACKUP_DIR=/var/backups/hatly ./backup-postgres.sh
# Direct mode (no Docker — used for rehearsals and managed databases):  HATLY_PG_URL=postgres://user:pass@host:5432/db ./backup-postgres.sh
# What "verified" means: the dump is written to a temporary file, listed with `pg_restore -l` (it must contain table-data sections), hashed,
# and only then moved into place together with a small manifest. A failure at any step leaves NO file that looks like a good backup.
# Optional off-host copy: OFFSITE_CMD='rclone copy "$1" remote:hatly-backups/' (run with the finished dump path as $1; its failure fails the run).
# A backup that exists only on the machine it protects is not a backup — set OFFSITE_CMD before launch (docs/launch/OPERATIONS_BACKUP_RESTORE_ROLLBACK.md).
set -euo pipefail
BACKUP_DIR="${BACKUP_DIR:?set BACKUP_DIR}"; RETENTION_DAYS="${RETENTION_DAYS:-14}"; KEEP_MIN="${KEEP_MIN:-3}"; PREFIX="${BACKUP_PREFIX:-hatly}"
umask 077; mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
ts="$(date -u +%Y%m%dT%H%M%SZ)"; tmp="$BACKUP_DIR/.${PREFIX}-${ts}.dump.partial"; final="$BACKUP_DIR/${PREFIX}-${ts}.dump"
trap 'rm -f "$tmp"' EXIT

if [ -n "${HATLY_PG_URL:-}" ]; then
  mode="direct"; pg_dump -Fc "$HATLY_PG_URL" > "$tmp"
  list() { pg_restore -l < "$1"; }
else
  mode="compose"; : "${HATLY_COMPOSE_FILE:?set HATLY_COMPOSE_FILE or HATLY_PG_URL}" "${HATLY_COMPOSE_PROJECT:?set HATLY_COMPOSE_PROJECT}"
  SUDO=""; docker info >/dev/null 2>&1 || SUDO="sudo -E"   # -E: compose interpolation needs the caller's variables (e.g. PROD_RELEASE)
  dc() { $SUDO docker compose -p "$HATLY_COMPOSE_PROJECT" ${HATLY_ENV_FILE:+--env-file "$HATLY_ENV_FILE"} -f "$HATLY_COMPOSE_FILE" "$@"; }
  dc exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' </dev/null > "$tmp"   # stdin closed: the script may itself be piped (ssh host bash -s)
  list() { dc exec -T postgres pg_restore -l < "$1"; }
fi
[ -s "$tmp" ] || { echo "backup FAILED: empty dump" >&2; exit 1; }
tables="$(list "$tmp" | grep -c 'TABLE DATA' || true)"
[ "$tables" -gt 0 ] || { echo "backup FAILED: the dump lists no table data" >&2; exit 1; }
bytes="$(wc -c < "$tmp" | tr -d ' ')"; sha="$(shasum -a 256 "$tmp" 2>/dev/null | cut -d' ' -f1 || sha256sum "$tmp" | cut -d' ' -f1)"
mv "$tmp" "$final"; trap - EXIT
printf '{"file":"%s","created_utc":"%s","mode":"%s","bytes":%s,"table_data_sections":%s,"sha256":"%s"}\n' "$(basename "$final")" "$ts" "$mode" "$bytes" "$tables" "$sha" > "$final.manifest.json"
if [ -n "${OFFSITE_CMD:-}" ]; then bash -c "$OFFSITE_CMD" _ "$final" || { echo "backup stored locally but the OFF-SITE copy FAILED" >&2; exit 3; }; offsite="copied"; else offsite="NOT CONFIGURED"; fi
# retention: delete dumps older than RETENTION_DAYS but always keep the newest KEEP_MIN
ls -1t "$BACKUP_DIR"/${PREFIX}-*.dump 2>/dev/null | tail -n +$((KEEP_MIN + 1)) | while read -r old; do
  if [ -n "$(find "$old" -mtime +"$RETENTION_DAYS" -print 2>/dev/null)" ]; then rm -f "$old" "$old.manifest.json"; fi
done
echo "backup OK: $(basename "$final") ${bytes} bytes, ${tables} table-data sections, sha256 ${sha:0:12}…, off-site: ${offsite}"

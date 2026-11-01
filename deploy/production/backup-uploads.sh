#!/usr/bin/env bash
# Verified backup of the uploads VOLUME (customer/vendor photos). Companion of backup-postgres.sh; run on the host (prod.sh backup).
#   BACKUP_DIR=/opt/hatly-prod/backups UPLOADS_VOLUME=hatly-prod_uploads HELPER_IMAGE=hatly-prod-backend:<release> ./backup-uploads.sh
# The volume is mounted READ-ONLY into a throw-away helper container (the backend image already present on the host — no pull), archived to a
# temporary file, listed back (the archive must be readable end to end), hashed, and only then moved into place with a manifest.
# Restore (into an EMPTY or new volume, apps stopped):  docker run --rm -v <volume>:/u -v <dir>:/b:ro --user 0 --entrypoint tar <image> -xzf /b/<file> -C /u
set -euo pipefail
BACKUP_DIR="${BACKUP_DIR:?set BACKUP_DIR}"; VOL="${UPLOADS_VOLUME:?set UPLOADS_VOLUME}"; IMG="${HELPER_IMAGE:?set HELPER_IMAGE}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"; KEEP_MIN="${KEEP_MIN:-3}"; PREFIX="${BACKUP_PREFIX:-hatly-prod-uploads}"
SUDO=""; docker info >/dev/null 2>&1 || SUDO="sudo"
umask 077; mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
$SUDO docker volume inspect "$VOL" >/dev/null 2>&1 || { echo "uploads backup FAILED: volume $VOL does not exist" >&2; exit 1; }
ts="$(date -u +%Y%m%dT%H%M%SZ)"; name="${PREFIX}-${ts}.tar.gz"; tmp="$BACKUP_DIR/.${name}.partial"; final="$BACKUP_DIR/$name"
trap 'rm -f "$tmp"' EXIT
$SUDO docker run --rm --network none --user 0 -v "$VOL":/u:ro --entrypoint tar "$IMG" -czf - -C /u . </dev/null > "$tmp"
[ -s "$tmp" ] || { echo "uploads backup FAILED: empty archive" >&2; exit 1; }
files="$(tar -tzf "$tmp" | grep -vc '/$' || true)"          # readable end to end, else tar fails and set -e stops here
bytes="$(wc -c < "$tmp" | tr -d ' ')"; sha="$(sha256sum "$tmp" 2>/dev/null | cut -d' ' -f1 || shasum -a 256 "$tmp" | cut -d' ' -f1)"
mv "$tmp" "$final"; trap - EXIT
printf '{"file":"%s","created_utc":"%s","volume":"%s","bytes":%s,"files":%s,"sha256":"%s"}\n' "$name" "$ts" "$VOL" "$bytes" "$files" "$sha" > "$final.manifest.json"
if [ -n "${OFFSITE_CMD:-}" ]; then bash -c "$OFFSITE_CMD" _ "$final" || { echo "uploads stored locally but the OFF-SITE copy FAILED" >&2; exit 3; }; offsite=copied; else offsite="NOT CONFIGURED"; fi
ls -1t "$BACKUP_DIR"/${PREFIX}-*.tar.gz 2>/dev/null | tail -n +$((KEEP_MIN + 1)) | while read -r old; do
  if [ -n "$(find "$old" -mtime +"$RETENTION_DAYS" -print 2>/dev/null)" ]; then rm -f "$old" "$old.manifest.json"; fi
done
echo "uploads backup OK: $name ${bytes} bytes, ${files} files, sha256 ${sha:0:12}…, off-site: ${offsite}"

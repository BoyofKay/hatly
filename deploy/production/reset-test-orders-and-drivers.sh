#!/usr/bin/env bash
# Runs reset-test-orders-and-drivers.sql inside the production Postgres container (credentials stay in the container; nothing printed).
#   ./reset-test-orders-and-drivers.sh "2026-11-21 23:59:59+02"          # DRY RUN — shows the numbers, changes nothing
#   ./reset-test-orders-and-drivers.sh "2026-11-21 23:59:59+02" apply    # REALLY deletes (after a backup: ./prod.sh backup)
# The cutoff is the moment of the LAST test order: every order up to it is deleted; if any order is newer, the script stops.
set -euo pipefail
cd "$(dirname "$0")"
CUTOFF="${1:?usage: $0 \"YYYY-MM-DD HH:MM:SS+02\" [apply]}"
APPLY="no"; [ "${2:-}" = "apply" ] && APPLY="yes"
if [[ ! "$CUTOFF" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}(:[0-9]{2})?(\+|-)[0-9]{2}$ ]]; then
  echo "cutoff must look like: 2026-11-21 23:59:59+02"; exit 1
fi
if [ "$APPLY" = "yes" ]; then
  read -r -p "This DELETES every order up to $CUTOFF and every driver in PRODUCTION. Backup taken? Type DELETE to continue: " ok
  [ "$ok" = "DELETE" ] || { echo "cancelled"; exit 1; }
fi
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
$SUDO docker exec -i hatly-prod-postgres-1 sh -c "psql -X -q -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v cutoff=\"'$CUTOFF'\" -v apply=$APPLY -f -" < reset-test-orders-and-drivers.sql

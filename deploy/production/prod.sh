#!/usr/bin/env bash
# Single operator entry point for the Hatly PRODUCTION stack, on the host. Pins the compose project (-p hatly-prod), the compose file of the
# CURRENT release and /opt/hatly-prod/.env.production, so a mistyped command can never touch staging. Prints no secret values.
#   /opt/hatly-prod/current/deploy/production/prod.sh <command>
# Layout:  /opt/hatly-prod/{.env.production (600), RELEASE (current release id), releases/<id>/ (source), current -> releases/<id>, backups/}
set -euo pipefail
PROD_DIR="${PROD_DIR:-/opt/hatly-prod}"
export PROD_ENV_FILE="${PROD_ENV_FILE:-$PROD_DIR/.env.production}"
[ -f "$PROD_ENV_FILE" ] || { echo "missing $PROD_ENV_FILE — create it with init-production-env.sh"; exit 1; }
[ "$(stat -c %a "$PROD_ENV_FILE" 2>/dev/null || stat -f %Lp "$PROD_ENV_FILE")" = 600 ] || { echo "$PROD_ENV_FILE must be mode 600"; exit 1; }
export PROD_RELEASE="${PROD_RELEASE:-$(cat "$PROD_DIR/RELEASE" 2>/dev/null || true)}"
[[ "$PROD_RELEASE" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$ ]] || { echo "PROD_RELEASE '${PROD_RELEASE}' is not a release id (<UTC timestamp>-<sha12>)"; exit 1; }
export PROD_SRC_DIR="${PROD_SRC_DIR:-$PROD_DIR/releases/$PROD_RELEASE}"
COMPOSE="$PROD_SRC_DIR/deploy/production/docker-compose.production.yml"
[ -f "$COMPOSE" ] || { echo "missing $COMPOSE"; exit 1; }
BACKUP_DIR="${BACKUP_DIR:-$PROD_DIR/backups}"
SUDO=""; docker info >/dev/null 2>&1 || SUDO="sudo -E"
dc() { $SUDO docker compose -p hatly-prod --env-file "$PROD_ENV_FILE" -f "$COMPOSE" "$@"; }
backend_node() { dc run --rm -T --no-deps prod-backend node "$@" </dev/null; }

# Hard guard: one-off tools must target the PRODUCTION database service of THIS project, nothing else.
target_check() {
  backend_node -e '
    const u = new URL(process.env.DATABASE_URL);
    const ok = u.hostname === "postgres" && u.pathname === "/hatly_prod" && process.env.NODE_ENV === "production";
    console.log("database target:", u.hostname + u.pathname, "| NODE_ENV=" + process.env.NODE_ENV, ok ? "| OK (production)" : "| REFUSED");
    process.exit(ok ? 0 : 3);'
}
typeorm() { dc run --rm -T --no-deps prod-backend node /repo/node_modules/typeorm/cli.js -d dist/src/database/data-source.js "$@" </dev/null; }
applied() { $SUDO docker exec hatly-prod-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from migrations" 2>/dev/null || echo 0' </dev/null; }
user_tables() { $SUDO docker exec hatly-prod-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from information_schema.tables where table_schema='"'"'public'"'"'"' </dev/null; }

case "${1:-help}" in
  validate)  dc config --quiet && echo "compose + interpolation OK (values not printed)";;
  # The backend IMAGE validates the env file with its own boot rules — before anything is started. Messages are secret-free by design.
  env-check) backend_node -e '
      const { collectEnvIssues } = require("./dist/src/config/env.validation");
      const { errors, warnings } = collectEnvIssues(process.env);
      errors.forEach((e) => console.log("ERROR  " + e)); warnings.forEach((w) => console.log("WARN   " + w));
      console.log(errors.length ? "ENV CHECK FAILED" : "ENV CHECK PASSED (" + warnings.length + " warnings)"); process.exit(errors.length ? 1 : 0);';;
  build)     dc build prod-backend prod-dashboard;;
  data)      dc up -d postgres redis; dc ps postgres redis;;
  plan)      target_check; typeorm migration:show;;
  migrate)
    # Guarded: explicit confirmation, target check, a verified backup first whenever the database already holds tables, then a re-count.
    [ "${CONFIRM_MIGRATE:-}" = hatly_prod ] || { echo "refusing: set CONFIRM_MIGRATE=hatly_prod to run migrations on PRODUCTION"; exit 1; }
    target_check
    before="$(applied)"; tables="$(user_tables)"; echo "before: $before migrations applied, $tables public tables"
    if [ "$tables" != 0 ]; then "$0" backup || { echo "STOP: pre-migration backup failed — nothing migrated"; exit 1; }; fi
    typeorm migration:run
    after="$(applied)"; echo "after: $after migrations applied"
    typeorm migration:show | grep -q '\[ \]' && { echo "STOP: migrations still pending after the run"; exit 1; } || echo "OK    no pending migrations";;
  apps)      dc up -d prod-backend prod-dashboard; dc ps prod-backend prod-dashboard;;
  status)
    dc ps
    $SUDO docker exec hatly-prod-backend-1 curl -fsS -m 5 http://127.0.0.1:3000/api/v1/health/ready </dev/null && echo || echo "backend NOT ready"
    $SUDO docker exec hatly-prod-dashboard-1 curl -fsS -m 5 -o /dev/null -w 'dashboard /privacy %{http_code}\n' http://127.0.0.1:3001/privacy </dev/null || echo "dashboard NOT answering";;
  logs)      dc logs --tail=100 "${2:-prod-backend}";;
  backup)
    # Database (verified pg_dump) + uploads volume (tar.gz with a manifest). Off-host copy: set OFFSITE_CMD (see backup-postgres.sh).
    HATLY_COMPOSE_FILE="$COMPOSE" HATLY_COMPOSE_PROJECT=hatly-prod HATLY_ENV_FILE="$PROD_ENV_FILE" BACKUP_DIR="$BACKUP_DIR" BACKUP_PREFIX=hatly-prod \
      bash "$PROD_SRC_DIR/deploy/production/backup-postgres.sh"
    BACKUP_DIR="$BACKUP_DIR" UPLOADS_VOLUME=hatly-prod_uploads HELPER_IMAGE="hatly-prod-backend:$PROD_RELEASE" bash "$PROD_SRC_DIR/deploy/production/backup-uploads.sh";;
  bootstrap-admin)
    : "${BOOTSTRAP_ADMIN_PHONE:?export BOOTSTRAP_ADMIN_PHONE}" "${BOOTSTRAP_ADMIN_NAME:?export BOOTSTRAP_ADMIN_NAME}" "${BOOTSTRAP_ADMIN_PASSWORD:?export BOOTSTRAP_ADMIN_PASSWORD}"
    target_check
    dc run --rm -T --no-deps -e BOOTSTRAP_ADMIN_PHONE -e BOOTSTRAP_ADMIN_NAME -e BOOTSTRAP_ADMIN_PASSWORD prod-backend node dist/src/scripts/bootstrap-admin.js </dev/null;;
  demo-marketplace)
    # The DEMONSTRATION marketplace importer (apps/backend/src/scripts/demo-marketplace.ts). DRY-RUN unless --execute is passed; a write also needs
    # DEMO_IMPORT_CONFIRM_DATABASE=<the database name>. Never run automatically. Pictures come from the release's docs/assets/pack (override with DEMO_MEDIA_DIR).
    #   prod.sh demo-marketplace --dry-run
    #   DEMO_IMPORT_CONFIRM_DATABASE=<db> prod.sh demo-marketplace --execute --service-area "<name>"
    target_check
    DEMO_MEDIA_DIR="${DEMO_MEDIA_DIR:-$PROD_SRC_DIR/docs/assets/pack}"
    [ -d "$DEMO_MEDIA_DIR" ] || { echo "asset pack not found at $DEMO_MEDIA_DIR (set DEMO_MEDIA_DIR)"; exit 1; }
    dc run --rm -T --no-deps -e DEMO_IMPORT_CONFIRM_DATABASE -v "$DEMO_MEDIA_DIR:/demo-media:ro" prod-backend node dist/src/scripts/demo-marketplace.js --media-dir /demo-media "${@:2}" </dev/null;;
  recompress-uploads)
    # Owner decision 2026-11-28: recompress stored photos IN PLACE (same names and formats; links unchanged; metadata removed).
    # Dry run unless --apply is passed; take `prod.sh backup` first.
    target_check
    dc run --rm -T --no-deps prod-backend node dist/src/scripts/recompress-uploads.js "${@:2}" </dev/null;;
  stop-apps) echo "stopping backend + dashboard (data stores and volumes stay)"; dc stop prod-dashboard prod-backend;;
  down)      echo "refusing: production is never brought down with one command. Use stop-apps, or compose directly with intent (never -v)."; exit 1;;
  help|*)    sed -n '2,4p' "$0"; echo "commands: validate env-check build data plan migrate apps status logs [svc] backup bootstrap-admin demo-marketplace recompress-uploads stop-apps";;
esac

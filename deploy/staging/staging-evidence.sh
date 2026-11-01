#!/usr/bin/env bash
# READ-ONLY evidence collector for the Staging VPS. Run it ON THE VPS, as the user that runs ./staging.sh. It prints what is deployed and how it is
# configured, and writes nothing (no build, no migration, no restart, no file change). It never prints a secret: environment variables are reported
# by NAME with set/MISSING, and where a value matters only a derived fact is shown (scheme, "has a password", "decodes to 32 bytes").
#   ./staging-evidence.sh                 # everything below
#   ./staging-evidence.sh | tee staging-evidence-$(date +%F).txt     # keep the output; it is safe to send
#
# Why the migration state is read with a SELECT and not only with `./staging.sh plan`: `plan` runs `typeorm migration:show` inside the backend image
# that is built RIGHT NOW. Before the new build exists that image only knows the 54 old migrations, so it can never list the five pending ones.
# The SELECT below reads the database's own bookkeeping table, independent of any image.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${STAGING_ENV_FILE:-/opt/hatly-staging/.env.staging}"
SUDO=""; docker info >/dev/null 2>&1 || SUDO="sudo"
# stdin is closed for every docker call: when this script is piped (`ssh host bash -s < staging-evidence.sh`) a `docker exec` would otherwise swallow the rest of the script
dc() { $SUDO docker compose -p hatly-staging --env-file "$ENV_FILE" -f "$here/docker-compose.staging.yml" "$@" </dev/null; }
sec() { printf '\n== %s\n' "$1"; }

sec "1. host and env-file permissions (contents are never read)"
if [ -f "$ENV_FILE" ]; then
  mode="$(stat -c '%a %U' "$ENV_FILE" 2>/dev/null || stat -f '%Lp %Su' "$ENV_FILE")"
  echo "env file: present, mode/owner = $mode   (required: 600)"
else echo "env file: MISSING at $ENV_FILE"; fi
echo "docker: $($SUDO docker --version 2>&1)"; echo "compose: $($SUDO docker compose version 2>&1 | head -1)"
echo "uptime: $(uptime | sed 's/^ *//')"; df -h /opt/hatly-staging 2>/dev/null | tail -1

sec "2. services, health, images"
dc ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}' 2>&1 | cut -c1-200
for svc in backend dashboard; do
  cid="$(dc ps -q "$svc" 2>/dev/null | head -1)"
  [ -n "$cid" ] || { echo "$svc: no container"; continue; }
  echo "$svc: image-id=$($SUDO docker inspect --format '{{.Image}}' "$cid" | cut -c1-19)  image-created=$($SUDO docker image inspect --format '{{.Created}}' "$($SUDO docker inspect --format '{{.Image}}' "$cid")" 2>/dev/null | cut -c1-19)  container-started=$($SUDO docker inspect --format '{{.State.StartedAt}}' "$cid" | cut -c1-19)  health=$($SUDO docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}' "$cid")  restarts=$($SUDO docker inspect --format '{{.RestartCount}}' "$cid")"
  echo "$svc: node runtime = $(dc exec -T "$svc" node -v 2>&1 | tr -d '\r')  user = $(dc exec -T "$svc" id -un 2>&1 | tr -d '\r')"
done
echo "images on host:"; $SUDO docker image ls --format '  {{.Repository}}:{{.Tag}}  {{.ID}}  created {{.CreatedSince}}' 2>/dev/null | grep -E 'hatly-staging' || echo "  (none)"

sec "3. backend configuration — names and derived facts only (inspected inside the RUNNING backend container)"
dc exec -T backend node -e '
const e = process.env;
const names = ["NODE_ENV","PORT","API_PREFIX","TRUST_PROXY","ENABLE_API_DOCS","OTP_LOG_CODE_FOR_LOCAL_DEV","DATABASE_URL","DB_SSL","ALLOW_INSECURE_DB","REDIS_URL","ALLOW_UNAUTHENTICATED_REDIS","CORS_ALLOWED_ORIGINS","JWT_ACCESS_SECRET","JWT_REFRESH_SECRET","JWT_ACCESS_EXPIRES_IN","JWT_REFRESH_EXPIRES_IN","MFA_ENCRYPTION_KEY","DASHBOARD_ADMIN_MFA_REQUIRED","STORAGE_DRIVER","UPLOADS_LOCAL_DIR","UPLOADS_PUBLIC_URL_PREFIX","MAPS_PROVIDER","GOOGLE_MAPS_API_KEY","ALLOW_MISSING_SMS_PROVIDER","ALLOW_MISSING_PUSH_PROVIDER","FCM_PROJECT_ID","FCM_CLIENT_EMAIL","FCM_PRIVATE_KEY"];
const show = new Set(["NODE_ENV","PORT","API_PREFIX","TRUST_PROXY","ENABLE_API_DOCS","OTP_LOG_CODE_FOR_LOCAL_DEV","DB_SSL","ALLOW_INSECURE_DB","ALLOW_UNAUTHENTICATED_REDIS","CORS_ALLOWED_ORIGINS","DASHBOARD_ADMIN_MFA_REQUIRED","STORAGE_DRIVER","UPLOADS_PUBLIC_URL_PREFIX","MAPS_PROVIDER","ALLOW_MISSING_SMS_PROVIDER","ALLOW_MISSING_PUSH_PROVIDER","JWT_ACCESS_EXPIRES_IN","JWT_REFRESH_EXPIRES_IN"]);
for (const n of names) console.log("  " + n.padEnd(30) + (e[n] === undefined || e[n] === "" ? "MISSING" : show.has(n) ? "= " + e[n] : "set (value hidden)"));
try { const u = new URL(e.REDIS_URL); console.log("  [redis] scheme=" + u.protocol + "  password-in-url=" + (u.password ? "yes" : "NO") + "  tls=" + (u.protocol === "rediss:" ? "yes" : "no (plain redis:// — acceptable only on the private compose network)")); } catch { console.log("  [redis] REDIS_URL missing/unparseable"); }
try { const u = new URL(e.DATABASE_URL); console.log("  [database] scheme=" + u.protocol + "  host-is-compose-service=" + (u.hostname === "postgres") + "  db-name-matches-STAGING_DB_NAME=" + (u.pathname === "/" + e.STAGING_DB_NAME)); } catch { console.log("  [database] DATABASE_URL missing/unparseable"); }
const k = e.MFA_ENCRYPTION_KEY; console.log("  [mfa] MFA_ENCRYPTION_KEY " + (!k ? "MISSING" : Buffer.from(k, "base64").length === 32 ? "present, decodes to 32 bytes (valid)" : "present but NOT 32 bytes of base64 (invalid)"));
console.log("  [secrets] JWT secrets distinct from each other: " + (e.JWT_ACCESS_SECRET && e.JWT_REFRESH_SECRET ? e.JWT_ACCESS_SECRET !== e.JWT_REFRESH_SECRET : "n/a") + ", JWT_REFRESH_SECRET length>=32: " + ((e.JWT_REFRESH_SECRET || "").length >= 32));
' 2>&1 | cut -c1-220

sec "4. Redis authentication (unauthenticated probe from inside the redis container; must answer NOAUTH)"
dc exec -T redis redis-cli ping 2>&1 | head -1 | cut -c1-60
echo "published DB/Redis ports on the host (must be empty): $($SUDO ss -ltnp 2>/dev/null | grep -E ':(5432|6379)\b' | wc -l)"

sec "5. migration state — read from the database (SELECT only; independent of the image)"
dc exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from migrations"' 2>&1 | sed 's/^/applied count: /'
dc exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select name from migrations order by id desc limit 3"' 2>&1 | sed 's/^/  latest: /'
for m in CustomerNotifications1700005400000 SectorCustomRequests1700005500000 ProductOptionSelectionLimits1700005600000 AdminAuditLogs1700005700000 StaffMfaCredentials1700005800000; do
  n="$(dc exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -Atc \"select count(*) from migrations where name='$m'\"" 2>&1 | tr -d '\r')"
  echo "  $m: $([ "$n" = 1 ] && echo APPLIED || echo 'pending (not in table)')"
done
echo "expected before the 2026-10-16 deployment: 54 applied (last = OrderStatusCollected1700005300000), the five above pending."

sec "6. what the public edge serves right now (same requests any client can make)"
"$here/security-smoke.sh" --api "$(grep -E '^STAGING_PUBLIC_API_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)" --dashboard "https://sales.hatly.dev" 2>&1 | tail -40

echo; echo "== done (read-only; nothing was changed)"

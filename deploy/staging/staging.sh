#!/usr/bin/env bash
# Single entry point for the Sales Staging stack. Always pins the project name (-p hatly-staging) and the staging env file, so a
# mistyped command can never touch another compose project. Prints no secret values.
#   ./staging.sh <command>
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
export STAGING_ENV_FILE="${STAGING_ENV_FILE:-/opt/hatly-staging/.env.staging}"
[ -f "$STAGING_ENV_FILE" ] || { echo "missing $STAGING_ENV_FILE — run ./init-staging-env.sh first"; exit 1; }
perm="$(stat -c %a "$STAGING_ENV_FILE" 2>/dev/null || stat -f %Lp "$STAGING_ENV_FILE")"
[ "$perm" = "600" ] || { echo "$STAGING_ENV_FILE must be mode 600 (is $perm)"; exit 1; }
SUDO=""; docker info >/dev/null 2>&1 || SUDO="sudo -E"
dc() { $SUDO docker compose -p hatly-staging --env-file "$STAGING_ENV_FILE" -f "$here/docker-compose.staging.yml" "$@"; }
envval() { grep -E "^$1=" "$STAGING_ENV_FILE" | head -1 | cut -d= -f2-; }

# Hard guard: the one-off tools below must target the staging database service, nothing else.
target_check() {
  dc run --rm -T --no-deps backend node -e '
    const u = new URL(process.env.DATABASE_URL);
    const ok = u.hostname === "postgres" && u.pathname === "/" + process.env.STAGING_DB_NAME && ["staging","development"].includes(process.env.NODE_ENV);
    console.log("database target:", u.hostname + u.pathname, "| NODE_ENV=" + process.env.NODE_ENV, ok ? "| OK (isolated staging)" : "| REFUSED");
    process.exit(ok ? 0 : 3);'
}
typeorm() { dc run --rm -T --no-deps backend node /repo/node_modules/typeorm/cli.js -d dist/src/database/data-source.js "$@"; }

case "${1:-help}" in
  validate)   dc config --quiet && echo "compose + environment variables OK (values not printed)";;
  build)      dc build backend dashboard;;
  data)       dc up -d postgres redis; dc ps;;
  plan)       target_check; typeorm migration:show;;
  migrate)    target_check; typeorm migration:run;;
  apps)       dc up -d backend dashboard; dc ps;;
  edge)       dc up -d caddy; dc ps caddy;;
  status)     dc ps; echo; dc exec -T backend node -e 'fetch("http://127.0.0.1:3000/api/v1/health/ready").then(async r=>console.log("backend ready:",r.status,await r.text())).catch(e=>{console.log("backend not ready:",e.message);process.exit(1)})';;
  logs)       dc logs --tail=100 "${2:-backend}";;
  seed)
    # Realistic ISOLATED catalog (vendors, products, images, offers, zones) from the committed seed scripts — not a copy of any database.
    # Tester accounts (customer/vendor/manager/drivers/admin) get the password in TESTER_PASSWORD. The fixture default address goes to
    # the tester customer (+201070000001), which must exist first (register it through the API: RUNBOOK).
    : "${TESTER_PASSWORD:?export TESTER_PASSWORD (>= 8 chars)}"
    target_check
    media="$(cd "$here/../.." && pwd)/docs/assets/pack"
    run="dc run --rm -T --no-deps -v $media:/seed-media:ro -e SEED_MEDIA_DIR=/seed-media -e SEED_DEV_CUSTOMER_PHONE=+201070000001 -e TESTER_PASSWORD"
    $run backend node dist/src/scripts/seed-dev-marketplace.js
    $run backend node dist/src/scripts/seed-dev-delivery-zones.js;;
  bootstrap-admin)
    : "${BOOTSTRAP_ADMIN_PHONE:?export BOOTSTRAP_ADMIN_PHONE}" "${BOOTSTRAP_ADMIN_NAME:?export BOOTSTRAP_ADMIN_NAME}" "${BOOTSTRAP_ADMIN_PASSWORD:?export BOOTSTRAP_ADMIN_PASSWORD}"
    target_check
    dc run --rm -T --no-deps -e BOOTSTRAP_ADMIN_PHONE -e BOOTSTRAP_ADMIN_NAME -e BOOTSTRAP_ADMIN_PASSWORD backend node dist/src/scripts/bootstrap-admin.js;;
  otp-off)
    # Customer OTP stays OFF for Sales (no SMS provider): registration = phone + password, phone stays unverified.
    : "${ADMIN_PHONE:?export ADMIN_PHONE}" "${ADMIN_PASSWORD:?export ADMIN_PASSWORD}"
    dc exec -T -e ADMIN_PHONE -e ADMIN_PASSWORD backend node -e '
      const b="http://127.0.0.1:3000/api/v1", h={"content-type":"application/json"};
      (async()=>{
        const l=await fetch(b+"/auth/password/login",{method:"POST",headers:h,body:JSON.stringify({phone:process.env.ADMIN_PHONE,password:process.env.ADMIN_PASSWORD})});
        if(!l.ok){console.log("admin login failed:",l.status);process.exit(1)}
        const t=(await l.json()).data.accessToken;
        const r=await fetch(b+"/admin/business-config/CUSTOMER_OTP_ENABLED",{method:"PUT",headers:{...h,authorization:"Bearer "+t},body:JSON.stringify({value:false})});
        console.log("CUSTOMER_OTP_ENABLED=false ->",r.status);process.exit(r.ok?0:1)})()';;
  down)       echo "Stopping staging containers (volumes are KEPT)."; dc down;;
  help|*)     sed -n '2,3p' "$0"; echo "commands: validate build data plan migrate apps seed edge status logs [svc] bootstrap-admin otp-off down";;
esac

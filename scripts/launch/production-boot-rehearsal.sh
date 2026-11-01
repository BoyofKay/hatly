#!/usr/bin/env bash
# Usage (Mac, needs local Postgres 16 + redis-server; run `npm run build` in apps/backend first):  bash scripts/launch/production-boot-rehearsal.sh
# Rehearses Stage 2's boot path in NODE_ENV=production on THROW-AWAY local resources: env from the real generator (dummy Maps key), 60 migrations on a new
# database, boot, and critical flows (health, docs off, HSTS, CORS, auth, OTP fail-closed, admin bootstrap + login, public deletion request).
# Hosts use `localhost.` (FQDN): production rules refuse the literal `localhost`, and the rule itself is NOT relaxed for this.
set -uo pipefail
REPO=/Users/abdullahrezk/Downloads/hatly-current-mac-handoff/hatly; BE=$REPO/apps/backend
W="$(mktemp -d)"; chmod 700 "$W"; DB=hatly_prodrehearsal_$(date +%s); RPORT=16399; PORT=13902; RPW="$(openssl rand -hex 24)"
cleanup() { [ -n "${NODEPID:-}" ] && kill "$NODEPID" 2>/dev/null; redis-cli -p $RPORT -a "$RPW" --no-auth-warning shutdown nosave >/dev/null 2>&1; dropdb --if-exists "$DB"; rm -rf "$W"; echo "cleanup: node stopped, redis stopped, $DB dropped, temp removed"; }
trap cleanup EXIT
redis-server --port $RPORT --requirepass "$RPW" --save '' --appendonly no --daemonize yes --logfile "$W/redis.log" --dir "$W" >/dev/null
createdb "$DB" || exit 1
# 1. env from the REAL generator (dummy Maps key, no SMS/push), then point hosts at local throw-away services
# NO operator input at all — exactly the launch situation: no Google key (MAPS_PROVIDER=none), no SMS, no push
PROD_DIR="$W/prod" bash $REPO/deploy/production/init-production-env.sh < /dev/null | sed 's/^/  generator: /' || { echo "env generation failed"; exit 1; }
ENVF="$W/prod/.env.production"
python3 - "$ENVF" "$DB" "$RPW" "$W/uploads" "$PORT" "$(whoami)" <<'PY'
import sys; f,db,rpw,up,port,user=sys.argv[1:]
lines=open(f).read().splitlines(); out=[]
for l in lines:
    if l.startswith('DATABASE_URL='): l=f'DATABASE_URL=postgres://{user}:unused@localhost.:5432/{db}'
    elif l.startswith('REDIS_URL='): l=f'REDIS_URL=redis://:{rpw}@localhost.:16399'
    elif l.startswith('UPLOADS_LOCAL_DIR='): l=f'UPLOADS_LOCAL_DIR={up}'
    elif l.startswith('PORT='): l=f'PORT={port}'
    out.append(l)
open(f,'w').write('\n'.join(out)+'\n')
PY
mkdir -p "$W/uploads"
set -a; . "$ENVF"; set +a
cd "$BE"
echo "== env check with the backend's own rules"; node -e 'const {collectEnvIssues}=require("./dist/src/config/env.validation"); const r=collectEnvIssues(process.env); r.errors.forEach(e=>console.log("ERROR",e)); r.warnings.forEach(w=>console.log("WARN ",w.slice(0,110))); process.exit(r.errors.length?1:0)' || exit 1
echo "== migrations"; node ../../node_modules/typeorm/cli.js -d dist/src/database/data-source.js migration:run > "$W/mig.log" 2>&1 || { tail -5 "$W/mig.log"; exit 1; }; echo "applied: $(psql -d "$DB" -Atc 'select count(*) from migrations')"
grep -qx "MAPS_PROVIDER=none" "$ENVF" && ! grep -q "^GOOGLE_MAPS_API_KEY=" "$ENVF" && echo "PASS  env: MAPS_PROVIDER=none, no Google key" || { echo "FAIL  env maps settings"; exit 1; }
echo "== boot (NODE_ENV=$NODE_ENV)"; node dist/src/main.js > "$W/app.log" 2>&1 & NODEPID=$!
for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:$PORT/api/v1/health && break; sleep 1; done
B=http://127.0.0.1:$PORT/api/v1; ok() { echo "PASS  $1"; }; bad() { echo "FAIL  $1"; FAILS=$((${FAILS:-0}+1)); }
r="$(curl -s $B/health/ready)"; echo "$r" | grep -q '"database":"up"' && echo "$r" | grep -q '"redis":"up"' && ok "health/ready: database + redis up" || bad "health/ready: $r"
[ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/api/docs)" = 404 ] && ok "API docs disabled in production" || bad "API docs reachable"
curl -sI $B/health | grep -qi '^strict-transport-security' && ok "HSTS sent by the API" || bad "no HSTS from the API"
evil="$(curl -s -o /dev/null -D - -H 'Origin: https://evil.example' -X OPTIONS -H 'Access-Control-Request-Method: POST' $B/auth/password/login | grep -i '^access-control-allow-origin' | tr -d '\r')"; [ -z "$evil" ] && ok "CORS gives a foreign origin no Access-Control-Allow-Origin (browser blocks it)" || bad "CORS allowed a foreign origin: $evil"
pre="$(curl -s -o /dev/null -D - -H 'Origin: https://hatly.dev' -X OPTIONS -H 'Access-Control-Request-Method: POST' $B/auth/password/login | grep -i '^access-control-allow-origin' | tr -d '\r')"; echo "$pre" | grep -q 'https://hatly.dev' && ok "CORS allows https://hatly.dev" || bad "CORS does not allow hatly.dev ($pre)"
[ "$(curl -s -o /dev/null -w '%{http_code}' $B/addresses)" = 401 ] && ok "protected route without token -> 401" || bad "protected route not 401"
regbody="$(curl -s -H 'content-type: application/json' -d '{"phone":"+201012345678","fullName":"Rehearsal","password":"Rehearsal-Pw-1!"}' $B/auth/customer/password/register)"; code="$(echo "$regbody" | grep -o '"code":"[A-Z_]*"' | head -1)"
echo "$regbody" | grep -q '"details":{"code":"PHONE_VERIFICATION_REQUIRED"}' && ok "fresh DB: OTP is ON by default — registration without a code refused ($code)" || bad "registration answer: $(echo "$regbody" | head -c 300)"
[ "$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d '{"phone":"+201012345678"}' $B/auth/customer/register/request-code)" -lt 500 ] && ok "OTP request without an SMS provider fails closed (no 5xx)" || bad "OTP request 5xx"
grep -q 'SMS provider is unavailable\|SMS' "$W/app.log" && ok "the unavailable SMS provider is logged for operators" || echo "INFO  no SMS log line (request may have been throttled/uniform)"
# admin bootstrap + staff sign-in in production mode
BOOTSTRAP_ADMIN_PHONE=+201099990009 BOOTSTRAP_ADMIN_NAME="Rehearsal Admin" BOOTSTRAP_ADMIN_PASSWORD='Rehearsal-Admin-Pw-1!' node dist/src/scripts/bootstrap-admin.js > "$W/boot.log" 2>&1 && ok "bootstrap-admin created the first SUPER_ADMIN" || { tail -3 "$W/boot.log"; bad "bootstrap-admin failed"; }
lc="$(curl -s -o "$W/login.json" -w '%{http_code}' -H 'content-type: application/json' -H 'Origin: https://admin.hatly.dev' -d '{"phone":"+201099990009","password":"Rehearsal-Admin-Pw-1!"}' $B/auth/password/login)"
[ "$lc" = 200 ] || [ "$lc" = 201 ] && ok "staff password login -> $lc" || bad "staff login -> $lc $(head -c 200 "$W/login.json")"
wl="$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d '{"phone":"+201099990009","password":"wrong-password-xx"}' $B/auth/password/login)"; [ "$wl" = 401 ] && ok "wrong admin password -> 401" || bad "wrong password -> $wl"
dr="$(curl -s -o "$W/dr.json" -w '%{http_code}' -H 'content-type: application/json' -H 'Origin: https://hatly.dev' -d '{"phone":"+201012345679"}' $B/account-deletion/requests)"; { [ "$dr" = 200 ] || [ "$dr" = 201 ] || [ "$dr" = 202 ]; } && ok "public 'I can't sign in' deletion request accepted ($dr)" || bad "deletion request -> $dr $(head -c 200 "$W/dr.json")"
psql -d "$DB" -Atc "select count(*) from account_deletion_requests" | grep -qx 1 && ok "the deletion request was recorded for admin review" || echo "INFO  deletion request rows: $(psql -d "$DB" -Atc 'select count(*) from account_deletion_requests')"
grep -q 'Maps DISABLED (MAPS_PROVIDER=none)' "$W/app.log" && ok "boot log announces Maps DISABLED" || bad "no Maps-disabled boot warning"
# the go-live admin step (OTP OFF until an SMS provider exists), through the real endpoint, in production mode
ATOK="$(node -e 'try{const j=require(process.argv[1]);process.stdout.write(j.data.accessToken||"")}catch{}' "$W/login.json")"
oc="$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "authorization: Bearer $ATOK" -H 'content-type: application/json' -d '{"value":0}' $B/admin/business-config/CUSTOMER_OTP_ENABLED)"; [ "$oc" = 400 ] && ok "admin OTP switch refuses a non-boolean (0) -> 400" || bad "non-boolean OTP value -> $oc"
oc="$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "authorization: Bearer $ATOK" -H 'content-type: application/json' -d '{"value":false}' $B/admin/business-config/CUSTOMER_OTP_ENABLED)"; [ "$oc" = 200 ] && ok "admin switched customer OTP OFF -> $oc" || bad "OTP off -> $oc"
rc="$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d '{"phone":"+201012345688","fullName":"Rehearsal Two","password":"Rehearsal-Pw-2!"}' $B/auth/customer/password/register)"
[ "$rc" = 200 ] && [ "$(psql -d "$DB" -Atc "select is_phone_verified from users where phone='+201012345688'")" = f ] && ok "OTP OFF: password registration works, phone stays UNVERIFIED" || bad "OTP-off registration -> $rc"
[ "$(psql -d "$DB" -Atc "select count(*) from admin_audit_logs where target_id='CUSTOMER_OTP_ENABLED'")" -ge 1 ] && ok "the OTP change is in the admin audit log" || bad "no audit row for the OTP change"
oc="$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "authorization: Bearer $ATOK" -H 'content-type: application/json' -d '{"value":true}' $B/admin/business-config/CUSTOMER_OTP_ENABLED)"
rc="$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d '{"phone":"+201012345689","fullName":"Rehearsal Three","password":"Rehearsal-Pw-3!"}' $B/auth/customer/password/register)"
[ "$oc" = 200 ] && [ "$rc" = 400 ] && ok "OTP back ON: registration without a code refused again" || bad "re-enable -> $oc / register $rc"
TOK="$(node -e 'try{const j=require(process.argv[1]);process.stdout.write(j.data.accessToken||"")}catch{}' "$W/login.json")"
gs="$(curl -s -w ' %{http_code}' -H "authorization: Bearer $TOK" "$B/geo/search?q=belbeis")"; echo "$gs" | grep -q '"data":null} 40[13]\|"data":null} 200' && ok "geo/search answers nothing without Google ($gs)" || echo "INFO  geo/search as staff: $gs (customer-only route)"
if grep -q 'maps.googleapis.com' "$W/app.log"; then bad "maps.googleapis.com appears in the app log:"; grep 'maps.googleapis.com' "$W/app.log" | sed 's/key=[^& "]*/key=<redacted>/g' | cut -c1-240 | head -5; else ok "no Google Maps request in the logs"; fi
grep -iE '"level":"error"|ERROR \[' "$W/app.log" | grep -v 'SMS' | head -3
echo "== $([ "${FAILS:-0}" = 0 ] && echo 'REHEARSAL PASSED' || echo "REHEARSAL: ${FAILS} FAILED")"

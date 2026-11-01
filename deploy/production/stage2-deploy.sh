#!/usr/bin/env bash
# Hatly production — Stage 2: build and start the PRODUCTION stack on the shared VPS, privately. Run from the Mac (bash 3.2 compatible):
#   bash deploy/production/stage2-deploy.sh preflight <bundle-dir>   # READ-ONLY (local + remote); writes nothing on the VPS
#   bash deploy/production/stage2-deploy.sh apply     <bundle-dir>   # repeats the preflight, then the steps below; stops at the first failure
# <bundle-dir> comes from deploy/production/make-release-bundle.sh (hatly-prod-src.tar.gz + .sha256 + RELEASE).
# Operator inputs (OPTIONAL): ~/.hatly/production-inputs.env (mode 600; KEY=VALUE lines, see init-production-env.sh). Read by this script
# only to pipe it over SSH into init-production-env.sh on the host — never printed, never stored anywhere else, never passed as an argument.
# Without it: MAPS_PROVIDER=none (PD-009 G), no SMS (customer OTP must then be switched off by an admin), no push.
#
# EVERYTHING HERE IS ADDITIVE and PRIVATE: a new /opt/hatly-prod, new images (hatly-prod-*), the new network hatly-edge, new volumes
# (hatly-prod_*), new containers (hatly-prod-*). Nothing publishes a host port; the shared Caddy is NOT touched, so the production hostnames
# keep answering the Stage 1 "coming soon" 503 until Stage 3. Staging, its containers, its Caddy and the port-3100 process are fingerprinted
# before and after and must be identical. Failure handling: stop and report; nothing public depends on Stage 2, so there is no live rollback —
# `prod.sh stop-apps` stops it, and a failed FIRST deploy can be removed completely (commands printed on failure).
set -Eeuo pipefail
MODE="${1:-}"; BUNDLE_DIR="${2:-}"
[[ "$MODE" == preflight || "$MODE" == apply ]] && [[ -n "$BUNDLE_DIR" ]] || { echo "usage: $0 preflight|apply <bundle-dir>"; exit 2; }
H=ubuntu@152.228.240.4
PD=/opt/hatly-prod
INPUTS="${HATLY_PROD_INPUTS:-$HOME/.hatly/production-inputs.env}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=8 "$H")
L="$(mktemp -d)"; chmod 700 "$L"; trap 'rm -rf "$L"' EXIT
q() { printf '%q ' "$@"; }
log() { printf '\n== %s\n' "$*"; }
STEP="preflight"
fail() {
  trap - ERR
  echo "STOP at step '$STEP': $*" >&2
  if [[ "$MODE" == apply && "$STEP" != preflight ]]; then
    cat >&2 <<EOT
Nothing public changed (the shared Caddy was not touched). State is left for inspection. On the host:
  status         : $PD/current/deploy/production/prod.sh status
  stop the apps  : $PD/current/deploy/production/prod.sh stop-apps
  remove a failed FIRST deploy completely (empty database — only with intent):
                   sudo docker compose -p hatly-prod -f $PD/current/deploy/production/docker-compose.production.yml --env-file $PD/.env.production down
                   sudo docker volume rm hatly-prod_pgdata hatly-prod_redisdata hatly-prod_uploads; sudo docker network rm hatly-edge
EOT
  fi
  exit 1
}
trap 'fail "unexpected error at line $LINENO"' ERR

# ------------------------------------------------------------------------------------------------- local checks
log "0. local checks (bundle, inputs, tools)"
for t in ssh shasum curl node openssl; do command -v "$t" >/dev/null || fail "local tool missing: $t"; done
TAR="$BUNDLE_DIR/hatly-prod-src.tar.gz"; [[ -f "$TAR" && -f "$TAR.sha256" && -f "$BUNDLE_DIR/RELEASE" ]] || fail "bundle dir incomplete (run make-release-bundle.sh)"
SHA="$(shasum -a 256 "$TAR" | cut -d' ' -f1)"; [[ "$SHA" == "$(cut -d' ' -f1 "$TAR.sha256")" ]] || fail "bundle hash does not match its .sha256"
REL="$(cat "$BUNDLE_DIR/RELEASE")"; [[ "$REL" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$ && "${REL##*-}" == "${SHA:0:12}" ]] || fail "release id does not match the bundle hash"
# Operator inputs are OPTIONAL (PD-009 G): no file / no Maps key -> MAPS_PROVIDER=none; no Unifonic -> no SMS; no FCM -> no push.
if [[ -f "$INPUTS" ]]; then
  [[ "$(stat -f %Lp "$INPUTS")" == 600 ]] || fail "$INPUTS must be mode 600"
  ! grep -vE '^$|^#|^(GOOGLE_MAPS_API_KEY|UNIFONIC_APP_SID|UNIFONIC_SENDER_ID|FCM_PROJECT_ID|FCM_CLIENT_EMAIL|FCM_PRIVATE_KEY)=' "$INPUTS" | grep -q . \
    || fail "$INPUTS contains a key that is not allowed (keys only: GOOGLE_MAPS_API_KEY, UNIFONIC_*, FCM_*)"
  ! grep -q '^GOOGLE_MAPS_API_KEY=' "$INPUTS" || grep -qE '^GOOGLE_MAPS_API_KEY=[A-Za-z0-9_-]{30,60}$' "$INPUTS" \
    || fail "$INPUTS has a malformed GOOGLE_MAPS_API_KEY line (value not shown)"
  MAPS_MODE="$(grep -q '^GOOGLE_MAPS_API_KEY=' "$INPUTS" && echo google || echo none)"
  INPUT_SRC="$INPUTS"; INPUT_NOTE="inputs file present, mode 600, keys allowed (values not read)"
else
  MAPS_MODE=none; INPUT_SRC=/dev/null; INPUT_NOTE="no inputs file: Maps deferred (MAPS_PROVIDER=none), no SMS, no push"
fi
echo "OK  bundle $REL ($(wc -c < "$TAR" | tr -d ' ') bytes, sha256 ${SHA:0:12}…); $INPUT_NOTE; maps mode: $MAPS_MODE"

# ------------------------------------------------------------------------------------------------- staging baseline
staging_snapshot() {
  local s a fp afp smoke=FAILED
  s="$(curl -sS -o /dev/null -m 20 -w '%{http_code}' https://sales.hatly.dev/ 2>/dev/null || echo ERR)"
  a="$(curl -sS -o /dev/null -m 20 -w '%{http_code}' https://api-sales.hatly.dev/api/v1/health 2>/dev/null || echo ERR)"
  fp="$( (openssl s_client -servername sales.hatly.dev -connect sales.hatly.dev:443 </dev/null 2>/dev/null | openssl x509 -noout -fingerprint -sha256 2>/dev/null) || true)"
  afp="$( (openssl s_client -servername api-sales.hatly.dev -connect api-sales.hatly.dev:443 </dev/null 2>/dev/null | openssl x509 -noout -fingerprint -sha256 2>/dev/null) || true)"
  (cd "$REPO" && node deploy/staging/smoke.mjs --read-only --api https://api-sales.hatly.dev/api/v1 --dashboard https://sales.hatly.dev) > "$L/smoke-$1.txt" 2>&1 && smoke=PASSED || true
  printf 'sales=%s api-sales=%s sales-cert=%s api-sales-cert=%s smoke=%s\n' "$s" "$a" "${fp:-NONE}" "${afp:-NONE}" "$smoke"
}
prod_public() {   # the four production names through Cloudflare: must stay the Stage 1 503 during Stage 2
  local h out=""; for h in hatly.dev www.hatly.dev admin.hatly.dev api.hatly.dev; do
    out="$out $h=$(curl -sS -m 20 -o "$L/p.body" -w '%{http_code}' "https://$h/" 2>/dev/null || echo ERR)$(grep -q 'Hatly is coming soon' "$L/p.body" 2>/dev/null && echo +soon)"
  done; echo "prod-public:$out"
}
remote_fingerprint() {   # staging containers (id + start time + restarts), the Caddy config hash, the port-3100 process
  "${SSH[@]}" "bash -s" <<'EOF'
set -euo pipefail
for c in $(sudo -n docker ps -aq --filter label=com.docker.compose.project=hatly-staging); do
  sudo -n docker inspect --format '{{.Name}} {{.Id}} {{.State.StartedAt}} restarts={{.RestartCount}} {{.State.Status}}' "$c"; done | sort
echo "caddyfile $(sudo -n docker exec hatly-staging-caddy-1 sha256sum /etc/caddy/Caddyfile | cut -c1-16)"
echo "port3100 $(sudo -n ss -ltnp 2>/dev/null | grep ':3100 ' | grep -oE 'pid=[0-9]+' | head -1 || echo none)"
EOF
}
log "1. staging + public baseline"
staging_snapshot baseline > "$L/staging-before.txt"; cat "$L/staging-before.txt"
grep -q 'sales=307 api-sales=200 ' "$L/staging-before.txt" && grep -q 'smoke=PASSED' "$L/staging-before.txt" || fail "staging is not healthy before Stage 2"
prod_public > "$L/public-before.txt"; cat "$L/public-before.txt"
[[ "$(grep -o '=503+soon' "$L/public-before.txt" | wc -l | tr -d ' ')" == 4 ]] || fail "the production names are not all in the Stage 1 state"
remote_fingerprint > "$L/fp-before.txt" || fail "could not fingerprint staging"; echo "staging fingerprint recorded ($(wc -l < "$L/fp-before.txt" | tr -d ' ') lines)"

# ------------------------------------------------------------------------------------------------- remote preflight (read-only)
log "2. remote preflight (read-only)"
"${SSH[@]}" "bash -s -- $(q "$PD" "$REL")" <<'EOF' | tee "$L/remote-preflight.txt" || fail "remote preflight failed"
set -euo pipefail; PD=$1 REL=$2
no() { echo "PREFLIGHT FAILED: $*"; exit 1; }
sudo -n true 2>/dev/null || no "sudo would prompt"
sudo -n docker info >/dev/null 2>&1 || no "docker not usable via sudo"
sudo -n docker compose version >/dev/null 2>&1 || no "docker compose plugin missing"
avail_gb=$(( $(df -Pk / | awk 'NR==2{print $4}') / 1048576 )); [ "$avail_gb" -ge 15 ] || no "less than 15 GB free on / ($avail_gb GB)"
mem_mb=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo); [ "$mem_mb" -ge 3000 ] || no "less than 3 GB memory available ($mem_mb MB)"
# nothing of a production stack may be running already, and the old /opt/hatly-git compose (own Caddy!) must not be running
[ -z "$(sudo -n docker ps -q --filter label=com.docker.compose.project=hatly-git)" ] || no "containers of the old hatly-git compose are running"
[ -z "$(sudo -n docker ps -q --filter label=com.docker.compose.project=hatly)" ] || no "containers of a compose project 'hatly' are running"
running="$(sudo -n docker ps -q --filter label=com.docker.compose.project=hatly-prod)"
# the staging Caddy owns 80/443 and must keep owning them
[ "$(sudo -n docker inspect -f '{{.State.Running}}' hatly-staging-caddy-1)" = true ] || no "the staging Caddy is not running"
sudo -n ss -ltnp | grep -E ':(80|443) ' | grep -q docker-proxy || no "ports 80/443 are not held by Docker (the staging Caddy)"
# state of earlier runs (a re-run after a stop is allowed; a different layout is not)
if [ -e "$PD" ]; then
  [ "$(stat -c '%U %a' "$PD")" = "ubuntu 700" ] || no "$PD exists with unexpected owner/mode"
  [ ! -e "$PD/releases/$REL" ] || echo "note: release $REL already extracted (re-run)"
  [ ! -e "$PD/.env.production" ] || { [ "$(stat -c %a "$PD/.env.production")" = 600 ] || no ".env.production is not mode 600"; echo "note: .env.production exists (kept, not regenerated)"; }
else echo "note: $PD absent (first deploy)"; fi
for v in hatly-prod_pgdata hatly-prod_redisdata hatly-prod_uploads; do sudo -n docker volume inspect "$v" >/dev/null 2>&1 && echo "note: volume $v exists (re-run)"; done
sudo -n docker network inspect hatly-edge >/dev/null 2>&1 && echo "note: network hatly-edge exists" || true
[ -z "$running" ] || echo "note: hatly-prod containers already running: $(echo $running | wc -w)"
echo "OK  remote preflight: docker/compose usable, ${avail_gb} GB free, ${mem_mb} MB available, no conflicting stack, staging Caddy owns 80/443"
EOF
if [[ "$MODE" == preflight ]]; then log "PREFLIGHT PASSED — nothing was changed on the VPS. Release that apply would deploy: $REL"; exit 0; fi

# ================================================================================================= APPLY
STEP="layout+upload"; log "3. create $PD, upload + verify + extract the bundle"
"${SSH[@]}" "sudo -n sh -c $(q "test -d $PD || { mkdir -m 700 $PD && chown ubuntu:ubuntu $PD; }") && mkdir -p -m 700 $(q "$PD/releases" "$PD/backups" "$PD/incoming" "$PD/logs")" || fail "could not create $PD"
if [[ "$("${SSH[@]}" "sha256sum $(q "$PD/incoming/$REL.tar.gz") 2>/dev/null | cut -d' ' -f1" </dev/null || true)" == "$SHA" ]]; then echo "bundle already uploaded (hash matches)"
else "${SSH[@]}" "rm -f $(q "$PD/incoming/$REL.tar.gz.partial"); set -C; cat > $(q "$PD/incoming/$REL.tar.gz.partial") && mv -n $(q "$PD/incoming/$REL.tar.gz.partial") $(q "$PD/incoming/$REL.tar.gz")" < "$TAR" || fail "upload failed"; fi
"${SSH[@]}" "bash -s -- $(q "$PD" "$REL" "$SHA")" <<'EOF' || fail "bundle verification/extraction failed"
set -euo pipefail; PD=$1 REL=$2 SHA=$3
[ "$(sha256sum "$PD/incoming/$REL.tar.gz" | cut -d' ' -f1)" = "$SHA" ] || { echo "uploaded bundle hash mismatch"; exit 1; }
if [ ! -e "$PD/releases/$REL" ]; then mkdir -m 700 "$PD/releases/$REL.partial"; tar -xzf "$PD/incoming/$REL.tar.gz" -C "$PD/releases/$REL.partial"; mv -T "$PD/releases/$REL.partial" "$PD/releases/$REL"; fi
[ "$(ls "$PD/releases/$REL/apps/backend/src/database/migrations/"*.ts | wc -l)" -ge 60 ] || { echo "extracted tree has fewer than 60 migrations"; exit 1; }
ln -sfn "releases/$REL" "$PD/current"; echo "$REL" > "$PD/RELEASE"
chmod 755 "$PD/releases/$REL/deploy/production/"*.sh
echo "OK  release $REL extracted; $PD/current -> releases/$REL"
EOF

STEP="env"; log "4. production env file (generated on the host; values never printed)"
if "${SSH[@]}" "test -e $(q "$PD/.env.production")"; then echo "kept the existing $PD/.env.production (secrets are never regenerated)"
else "${SSH[@]}" "PROD_DIR=$(q "$PD") bash $(q "$PD/current/deploy/production/init-production-env.sh")" < "$INPUT_SRC" || fail "env generation refused"; fi

P="$PD/current/deploy/production/prod.sh"
run() { "${SSH[@]}" "$(q "$P") $*" </dev/null; }
STEP="network";  log "5. edge network (external to the production compose; compose run/up need it to exist)"
"${SSH[@]}" "sudo -n docker network inspect hatly-edge >/dev/null 2>&1 || sudo -n docker network create --driver bridge --label hatly.purpose=edge hatly-edge >/dev/null; sudo -n docker network inspect -f '{{.Name}} {{.Driver}}' hatly-edge" || fail "could not create hatly-edge"
STEP="validate"; log "5b. compose validation";            run validate || fail "compose validation failed"
STEP="build";    log "6. build images (backend + dashboard; staging keeps serving)"
"${SSH[@]}" "$(q "$P") build > $(q "$PD/logs/build-$REL.log") 2>&1; rc=\$?; tail -5 $(q "$PD/logs/build-$REL.log"); exit \$rc" </dev/null || fail "image build failed (log: $PD/logs/build-$REL.log)"
STEP="env-check"; log "7. env file checked by the built backend image's own boot rules"; run env-check || fail "the backend refuses this env file"
STEP="data";     log "9. data stores";                     run data || fail "postgres/redis did not start"
wait_healthy() {   # $1 container
  "${SSH[@]}" "for i in \$(seq 1 60); do s=\$(sudo -n docker inspect -f '{{.State.Health.Status}}' $(q "$1") 2>/dev/null || echo missing); [ \"\$s\" = healthy ] && { echo '$1 healthy'; exit 0; }; sleep 5; done; echo '$1 NOT healthy:' \$s; exit 1" </dev/null
}
wait_healthy hatly-prod-postgres-1 || fail "postgres not healthy"; wait_healthy hatly-prod-redis-1 || fail "redis not healthy"
STEP="migrate";  log "10. migrations (guarded: target check, backup-before when tables exist, re-count)"
run plan | tail -3 || fail "migration plan failed"
"${SSH[@]}" "CONFIRM_MIGRATE=hatly_prod $(q "$P") migrate" </dev/null | tail -6 || fail "migrations failed"
STEP="apps";     log "11. backend + dashboard"
# One-time upgrade (2026-10-25): the app services were renamed backend/dashboard -> prod-backend/prod-dashboard (name isolation on
# hatly-edge) but keep their container names, so containers still running under the OLD service names must go first. Only those two
# stateless app containers of THIS project are removed (state lives in the volumes and the database, which are not touched).
"${SSH[@]}" "bash -s" <<'EOF' || fail "could not retire the old-named app containers"
set -euo pipefail
for svc in backend dashboard; do
  for cid in $(sudo -n docker ps -aq --filter label=com.docker.compose.project=hatly-prod --filter label=com.docker.compose.service=$svc); do
    echo "retiring old-named production container $(sudo -n docker inspect -f '{{.Name}}' "$cid") (service '$svc')"
    sudo -n docker stop -t 20 "$cid" >/dev/null && sudo -n docker rm "$cid" >/dev/null
  done
done
EOF
run apps | tail -3 || fail "apps did not start"
wait_healthy hatly-prod-backend-1 || fail "backend not healthy (see: $P logs backend)"; wait_healthy hatly-prod-dashboard-1 || fail "dashboard not healthy (see: $P logs dashboard)"

STEP="verify";   log "12. private verification (inside the host; nothing public yet)"
"${SSH[@]}" "bash -s" <<'EOF' || fail "private verification failed"
set -euo pipefail
X() { sudo -n docker exec "$@" </dev/null; }
r="$(X hatly-prod-backend-1 curl -fsS -m 5 http://127.0.0.1:3000/api/v1/health/ready)"; echo "$r" | grep -q '"database":"up"' && echo "$r" | grep -q '"redis":"up"' || { echo "backend not ready: $r"; exit 1; }
echo "OK  backend ready (database + redis up)"
# the edge aliases resolve across the hatly-edge network (exactly how the shared Caddy will reach them in Stage 3)
[ "$(X hatly-prod-dashboard-1 curl -fsS -m 5 -o /dev/null -w '%{http_code}' http://hatly-prod-backend:3000/api/v1/health)" = 200 ] || { echo "backend not reachable as hatly-prod-backend on hatly-edge"; exit 1; }
for p in /privacy /account-deletion /login; do c="$(X hatly-prod-backend-1 curl -sS -m 10 -o /dev/null -w '%{http_code}' "http://hatly-prod-dashboard:3001$p")"; [ "$c" = 200 ] || { echo "dashboard $p -> $c"; exit 1; }; done
X hatly-prod-backend-1 curl -fsS -m 10 http://hatly-prod-dashboard:3001/privacy | grep -q 'Amrrizk1111@gmail.com' || { echo "/privacy does not show the approved contact"; exit 1; }
! X hatly-prod-backend-1 curl -fsS -m 10 http://hatly-prod-dashboard:3001/privacy | grep -q 'data-legal-draft' || { echo "/privacy is still a DRAFT"; exit 1; }
echo "OK  hatly-edge aliases resolve; dashboard /privacy /account-deletion /login 200; policy final (not draft)"
[ -z "$(sudo -n docker ps --filter label=com.docker.compose.project=hatly-prod --format '{{.Ports}}' | grep -E '0\.0\.0\.0|\[::\]|127\.0\.0\.1' || true)" ] || { echo "a production container publishes a host port"; exit 1; }
echo "OK  no production container publishes a host port"
# name isolation on hatly-edge: no production container may answer to a hostname the staging Caddy proxies to
ups="$(sudo -n docker exec hatly-staging-caddy-1 cat /etc/caddy/Caddyfile | grep -oE 'reverse_proxy[[:space:]]+[A-Za-z0-9._-]+:[0-9]+' | awk '{print $2}' | cut -d: -f1 | grep -v '^hatly-prod-' | sort -u)"
[ -n "$ups" ] || { echo "could not read the staging upstream hostnames"; exit 1; }
for c in hatly-prod-backend-1 hatly-prod-dashboard-1; do
  names=" $(sudo -n docker inspect -f '{{json (index .NetworkSettings.Networks "hatly-edge").DNSNames}}' "$c" | tr -d '[]"' | tr ',' ' ') "
  for u in $ups; do case "$names" in *" $u "*) echo "$c answers to '$u' on hatly-edge (staging upstream name)"; exit 1;; esac; done
done
echo "OK  hatly-edge name isolation: no production container answers to a staging upstream name ($(echo $ups))"
EOF

STEP="backup";   log "13. first backup (database + uploads) and a real restore drill on this host"
run backup | tail -3 || fail "backup failed"
"${SSH[@]}" "bash -s -- $(q "$PD")" <<'EOF' || fail "restore drill failed"
set -euo pipefail; PD=$1
d="$(ls -1t "$PD"/backups/hatly-prod-*.dump | head -1)"
HATLY_COMPOSE_FILE="$PD/current/deploy/production/docker-compose.production.yml" HATLY_COMPOSE_PROJECT=hatly-prod HATLY_ENV_FILE="$PD/.env.production" \
  PROD_RELEASE="$(cat "$PD/RELEASE")" PROD_ENV_FILE="$PD/.env.production" bash "$PD/current/deploy/production/restore-drill.sh" "$d" | tail -3
EOF

STEP="post-checks"; log "14. staging + public state unchanged"
staging_snapshot after > "$L/staging-after.txt"; diff -u "$L/staging-before.txt" "$L/staging-after.txt" || fail "staging changed during Stage 2"
remote_fingerprint > "$L/fp-after.txt"; diff -u "$L/fp-before.txt" "$L/fp-after.txt" || fail "staging containers / Caddy config / port-3100 changed"
prod_public > "$L/public-after.txt"; diff -u "$L/public-before.txt" "$L/public-after.txt" || fail "the public production names changed (Caddy must not be touched in Stage 2)"
echo "OK  staging identical (responses, certificates, smoke, containers, Caddy config, port-3100); production names still the Stage 1 503"
log "STAGE 2 COMPLETE — release $REL running privately (backend + dashboard healthy, 60 migrations, first backup + restore drill passed). Next: Stage 3 (edge switch)."

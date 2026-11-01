#!/usr/bin/env bash
# Phase 6 of the staging update, one explicit step per invocation (so there is a stop point between steps). Run ON THE VPS, piped over SSH:
#   ssh ubuntu@152.228.240.4 'bash -s -- <step>' < phase6-switch.sh
# Steps:  check | retag | swap | backend | dashboard | verify | rollback-apps | rollback-tree
# Only the `backend` and `dashboard` steps recreate containers, ONE service per step, with `--no-deps --force-recreate` and the service named
# explicitly: postgres, redis and caddy are never named, never recreated, never restarted. `check` and `verify` are read-only.
set -uo pipefail
D="${D:-20261017}"; ENVF=/opt/hatly-staging/.env.staging; ACTIVE=/opt/hatly-staging/hatly; NEW=/opt/hatly-staging/hatly-$D; OLD=/opt/hatly-staging/hatly.pre-$D
B="$(ls -1dt /opt/hatly-staging/backups/pre-update-* | head -1)"
dc() { sudo docker compose -p hatly-staging --env-file "$ENVF" -f "$ACTIVE/deploy/staging/docker-compose.staging.yml" "$@"; }
hashes() { dc config --hash '*' </dev/null 2>/dev/null | sort; }
id_of() { sudo docker inspect -f '{{.Id}}' "hatly-staging-$1-1" </dev/null | cut -c1-12; }
before_id() { awk -v n="hatly-staging-$1-1" '$1==n{print $2}' "$B/containers-before.txt"; }
migrations() { sudo docker exec -e PGOPTIONS='-c default_transaction_read_only=on' hatly-staging-postgres-1 sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -Atc "select count(*) from migrations"' </dev/null; }
wait_healthy() { for i in $(seq 1 30); do s=$(sudo docker inspect -f '{{.State.Health.Status}}' "hatly-staging-$1-1" </dev/null 2>/dev/null); echo "  $1 health: $s ($((i*5))s)"; [ "$s" = healthy ] && return 0; sleep 5; done; return 1; }
# Caddy bind-mounts a single FILE and is never recreated here, so after the rename it keeps reading the OLD tree's copy, while its next start
# (crash, daemon restart, reboot) loads the ACTIVE path. Both must therefore hold exactly what Caddy runs (see caddy-config-guard.sh).
caddy_same() { [ -f "$1" ] && [ "$(sudo docker exec hatly-staging-caddy-1 sha256sum /etc/caddy/Caddyfile </dev/null | cut -d' ' -f1)" = "$(sha256sum "$1" | cut -d' ' -f1)" ]; }
need_untouched() { for c in postgres redis caddy; do [ "$(id_of $c)" = "$(before_id $c)" ] || { echo "STOP: $c container changed unexpectedly"; exit 1; }; done; }
case "${1:-}" in
check)
  [ "$(migrations)" = 59 ] && echo "OK    59 migrations applied (phase 5 done)" || { echo "STOP: migrations=$(migrations), phase 5 has not completed"; exit 1; }
  for t in backend dashboard; do sudo docker image inspect hatly-staging-$t:candidate-$D hatly-staging-$t:rollback-$D >/dev/null 2>&1 || { echo "STOP: image tag missing for $t"; exit 1; }; done; echo "OK    candidate + rollback images present"
  [ -d "$NEW" ] && [ -d "$ACTIVE" ] && [ ! -e "$OLD" ] && echo "OK    trees ready" || { echo "STOP: tree layout unexpected"; exit 1; }
  caddy_same "$NEW/deploy/staging/Caddyfile.staging" && echo "OK    new tree's Caddyfile.staging == what Caddy runs" || { echo "STOP: the new tree's Caddyfile.staging differs from the running Caddy config (would apply on Caddy's next restart)"; exit 1; }
  need_untouched; echo "OK    postgres/redis/caddy containers are the original ones"
  echo "OK    running backend image = $(sudo docker inspect -f '{{.Config.Image}}' hatly-staging-backend-1 </dev/null) (id $(id_of backend))";;
retag)
  sudo docker tag hatly-staging-backend:candidate-$D hatly-staging-backend:local && sudo docker tag hatly-staging-dashboard:candidate-$D hatly-staging-dashboard:local \
  && echo "tags moved: :local now points at the candidates; the running containers are NOT affected until recreated; old images remain as :rollback-$D";;
swap)
  [ -d "$NEW" ] && [ ! -e "$OLD" ] || { echo "STOP: layout unexpected"; exit 1; }
  caddy_same "$NEW/deploy/staging/Caddyfile.staging" || { echo "STOP: the new tree's Caddyfile.staging differs from the running Caddy config — not swapping"; exit 1; }
  before="$(hashes)"; mv "$ACTIVE" "$OLD" || { echo "STOP: could not move the active tree"; exit 1; }; if ! mv "$NEW" "$ACTIVE"; then mv "$OLD" "$ACTIVE"; echo "STOP: second rename failed — the active tree was put back"; exit 1; fi; echo "swapped: $ACTIVE is now the new tree, the previous tree is $OLD"
  after="$(hashes)"; if [ "$before" = "$after" ]; then echo "OK    compose config hashes identical before/after the swap (all five services)"; else echo "WARNING: hashes differ after the swap — NOT recreating anything; roll the tree back with rollback-tree"; exit 1; fi
  # and equal to the running containers' labels => compose sees no drift in postgres/redis/caddy
  hashes | while read svc h; do lab=$(sudo docker inspect -f '{{index .Config.Labels "com.docker.compose.config-hash"}}' hatly-staging-$svc-1 </dev/null); [ "$h" = "$lab" ] && echo "  $svc: matches running container label" || echo "  $svc: label differs"; done;;
backend|dashboard)
  svc="$1"; need_untouched; echo "recreating ONLY $svc (id before: $(id_of $svc))"
  dc up -d --no-deps --force-recreate "$svc" </dev/null; echo "id after: $(id_of $svc)"
  wait_healthy "$svc" || { echo "STOP: $svc did not become healthy — run rollback-apps (and see: docker logs hatly-staging-$svc-1 --tail 50)"; exit 1; }
  need_untouched; echo "postgres/redis/caddy still the original containers";;
verify)
  echo "containers now:"; sudo docker ps --format '  {{.Names}} {{.ID}} {{.Image}} {{.Status}}'
  need_untouched && echo "OK    postgres, redis and caddy are the ORIGINAL containers (same ids as before the update)"
  caddy_same "$ACTIVE/deploy/staging/Caddyfile.staging" && echo "OK    active Caddyfile.staging == what Caddy runs (a Caddy restart keeps the same config)" || echo "WARNING: active Caddyfile.staging differs from the running Caddy config — a Caddy restart would change the edge"
  echo "  caddy started: $(sudo docker inspect -f '{{.State.StartedAt}}' hatly-staging-caddy-1 </dev/null)  restarts: $(sudo docker inspect -f '{{.RestartCount}}' hatly-staging-caddy-1 </dev/null)"
  echo "  api  : $(curl -s -m 8 -o /dev/null -w '%{http_code}' https://api-sales.hatly.dev/api/v1/health/ready)   dashboard: $(curl -s -m 8 -o /dev/null -w '%{http_code}' https://sales.hatly.dev/login)"
  echo "  migrations: $(migrations)";;
rollback-apps)
  echo "re-tagging the old images as :local and recreating ONLY backend and dashboard"
  sudo docker tag hatly-staging-backend:rollback-$D hatly-staging-backend:local && sudo docker tag hatly-staging-dashboard:rollback-$D hatly-staging-dashboard:local || exit 1
  for svc in backend dashboard; do dc up -d --no-deps --force-recreate $svc </dev/null; wait_healthy $svc || echo "WARNING: $svc not healthy yet"; done;;
rollback-tree)
  [ -d "$OLD" ] || { echo "STOP: $OLD does not exist"; exit 1; }
  mv "$ACTIVE" "/opt/hatly-staging/hatly.failed-$D" && mv "$OLD" "$ACTIVE" && echo "tree restored from $OLD; the new tree is kept as hatly.failed-$D";;
*) echo "usage: bash -s -- check|retag|swap|backend|dashboard|verify|rollback-apps|rollback-tree"; exit 2;;
esac

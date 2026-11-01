#!/usr/bin/env bash
# READ-ONLY inspection of the VPS before anything is deployed. Prints no secret values (names/ports/sizes only).
#   sudo ./preflight.sh
set -uo pipefail
echo "== host =="; uname -srm; . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"
echo "== capacity =="; nproc | sed 's/^/cpus: /'; free -m | awk 'NR==2{print "mem total/used/avail MB: "$2"/"$3"/"$7}'; df -h / /var/lib/docker /opt 2>/dev/null | awk 'NR==1||!seen[$6]++'
echo "== docker =="; docker --version; docker compose version 2>&1 | head -1
echo "-- containers (name image status ports) --"; docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
echo "-- compose projects --"; docker compose ls -a 2>&1 | head -20
echo "-- networks --"; docker network ls --format '{{.Name}}\t{{.Driver}}'
echo "-- volumes --"; docker volume ls --format '{{.Name}}'
echo "-- name collisions with staging (must print nothing) --"
docker volume ls --format '{{.Name}}' | grep -E '^hatly-staging_' ; docker network ls --format '{{.Name}}' | grep -E '^hatly-staging_'; docker ps -a --format '{{.Names}}' | grep -E '^hatly-staging-'
echo "== listening ports (13000/13001 must be free) =="; ss -ltnH 2>/dev/null | awk '{print $4}' | sort -u
echo "== reverse proxy =="; (systemctl is-active caddy 2>&1; systemctl is-active nginx 2>&1) | paste -sd' '; ls /etc/caddy 2>/dev/null; docker ps --format '{{.Names}}' | grep -i -E 'caddy|nginx|traefik'
echo "== repository =="; for d in /opt/hatly-git /opt/hatly-staging; do [ -d "$d" ] && { echo "$d:"; (cd "$d" && git log --oneline -1 2>/dev/null; git status --short 2>/dev/null | wc -l | sed 's/^/uncommitted files: /'); }; done
echo "== DNS as seen from this host =="; for h in sales.hatly.dev api-sales.hatly.dev; do printf '%s -> ' "$h"; getent hosts "$h" | awk '{print $1}' | paste -sd' ' ; echo; done
echo "== public IP =="; curl -fsS -m 5 https://ifconfig.me 2>/dev/null; echo

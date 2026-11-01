#!/usr/bin/env bash
# READ-ONLY: are the Cloudflare address ranges in the production Caddy block still exactly Cloudflare's published list?
#   bash deploy/production/cloudflare-ranges-check.sh [block-file]      exit 0 = identical, 1 = differs (update the block), 2 = could not fetch
# Why it matters: the production hostnames answer ONLY Cloudflare's ranges (everything else gets 403). If Cloudflare adds a range, visitors
# routed through it would be refused — run this weekly (cron next to ops-watch.sh) and before every edge change.
set -uo pipefail
BLOCK="${1:-$(cd "$(dirname "$0")" && pwd)/Caddyfile.production-block}"
pub="$( { curl -fsS -m 20 https://www.cloudflare.com/ips-v4 && echo && curl -fsS -m 20 https://www.cloudflare.com/ips-v6; } 2>/dev/null | tr -s ' \n' '\n' | grep -E '^[0-9a-f:.]+/[0-9]+$' | sort -u)"
[ "$(printf '%s\n' "$pub" | grep -c .)" -ge 10 ] || { echo "could not fetch Cloudflare's published ranges"; exit 2; }
ours="$(grep -m1 '@not_cloudflare not remote_ip' "$BLOCK" | sed 's/.*remote_ip //' | tr ' ' '\n' | grep -E '/[0-9]+$' | sort -u)"
if [ "$pub" = "$ours" ]; then echo "OK    Cloudflare ranges in $(basename "$BLOCK") match the published list ($(printf '%s\n' "$ours" | wc -l | tr -d ' ') ranges)"; exit 0; fi
echo "DIFFERS — published vs block:"; diff <(printf '%s\n' "$pub") <(printf '%s\n' "$ours") | sed 's/^</  published only:/; s/^>/  block only:    /' | grep -v '^---\|^[0-9]'
exit 1

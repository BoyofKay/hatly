#!/usr/bin/env bash
# Creates the Sales Staging env file with freshly generated secrets. Prints NO secret values.
#   API_HOST=api-sales.hatly.dev DASHBOARD_HOST=sales.hatly.dev [GOOGLE_MAPS_API_KEY=...] ./init-staging-env.sh
# Refuses to overwrite an existing file.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dir="${STAGING_DIR:-/opt/hatly-staging}"
out="$dir/.env.staging"
api="${API_HOST:-api-sales.hatly.dev}"
dash="${DASHBOARD_HOST:-sales.hatly.dev}"
maps="${GOOGLE_MAPS_API_KEY:-}"
# No staging Maps key -> explicit fallback (RUNBOOK 'Maps decision'): NODE_ENV=development + MAPS_PROVIDER=deterministic (straight-line
# distances, no external calls). With a key: strict NODE_ENV=staging + Google Maps.
if [ -n "$maps" ]; then nodeenv=staging; provider=google; else nodeenv=development; provider=deterministic; fi

[ -e "$out" ] && { echo "REFUSING: $out already exists (delete it deliberately if you really want new secrets)."; exit 1; }
command -v openssl >/dev/null || { echo "openssl is required"; exit 1; }
case "$api$dash" in *[!A-Za-z0-9.-]*) echo "host names may contain only letters, digits, dots and dashes"; exit 1;; esac

umask 077
mkdir -p "$dir"
chmod 700 "$dir"
gen() { openssl rand -hex "$1"; }
dbpw="$(gen 24)"; redispw="$(gen 24)"; ja="$(gen 32)"; jr="$(gen 32)"
mfakey="$(openssl rand -base64 32)" # 32 random bytes, base64 (alphabet A-Za-z0-9+/=, safe inside the | sed delimiter)
tmp="$(mktemp "$dir/.env.XXXXXX")"
sed -e "s|@@DB_PASSWORD@@|$dbpw|g" -e "s|@@REDIS_PASSWORD@@|$redispw|g" \
    -e "s|@@API_HOST@@|$api|g" -e "s|@@DASHBOARD_HOST@@|$dash|g" -e "s|@@MAPS_KEY@@|$maps|g" -e "s|@@NODE_ENV@@|$nodeenv|g" -e "s|@@MAPS_PROVIDER@@|$provider|g" -e "s|@@MFA_KEY@@|$mfakey|g" "$here/env.staging.template" > "$tmp"
# the four remaining @@GENERATE@@ markers, in file order: db password, redis password, jwt access, jwt refresh
awk -v a="$dbpw" -v b="$redispw" -v c="$ja" -v d="$jr" 'BEGIN{n=0} /@@GENERATE@@/{n++; v=(n==1?a:(n==2?b:(n==3?c:d))); sub(/@@GENERATE@@/, v)} {print}' "$tmp" > "$out"
rm -f "$tmp"
chmod 600 "$out"
unset dbpw redispw ja jr mfakey
if grep -q '@@' "$out"; then echo "template markers left unresolved — aborting"; rm -f "$out"; exit 1; fi
echo "Wrote $out (mode $(stat -c %a "$out" 2>/dev/null || stat -f %Lp "$out")). Secrets were generated locally and not printed."
[ -z "$maps" ] && echo "NOTE: no GOOGLE_MAPS_API_KEY -> FALLBACK mode (NODE_ENV=development, MAPS_PROVIDER=deterministic). Set a key and re-generate to run strict staging."
exit 0

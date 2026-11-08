#!/usr/bin/env bash
# One-time setup of Admin Web Push (VAPID) for production — P0 Admin alerts, 2026-11-08.
#
# Run ON THE SERVER as the deploy user:   bash setup-web-push-keys.sh <contact>
#   <contact> = mailto:someone@your-domain or https://your-site — sent to browser push services (Google, Mozilla, Microsoft, Apple)
#               inside each signed request so they can reach the sender if something is wrong. Choose an address you are happy to share.
#
# What it does:
#   - generates a fresh P-256 key pair with openssl (no third-party service, nothing leaves the server),
#   - appends WEB_PUSH_VAPID_PUBLIC_KEY / WEB_PUSH_VAPID_PRIVATE_KEY / WEB_PUSH_SUBJECT to /opt/hatly-prod/.env.production (kept mode 600),
#     after a timestamped copy of the file,
#   - prints ONLY the public key. The private key is never printed or logged.
# It refuses to run if any WEB_PUSH_* setting already exists (rotating keys would silently orphan every registered device).
# Afterwards recreate the backend container so it reads the file:  deploy/production/prod.sh up -d --no-deps backend
set -euo pipefail
ENV_FILE="${PROD_ENV_FILE:-/opt/hatly-prod/.env.production}"
SUBJECT="${1:-}"
case "$SUBJECT" in
  mailto:?*@?*|https://?*) ;;
  *) echo "Usage: $0 <mailto:address | https://url>" >&2; exit 2 ;;
esac
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE" >&2; exit 1; }
if grep -q '^WEB_PUSH_' "$ENV_FILE"; then echo "WEB_PUSH_* settings already exist in $ENV_FILE — not changing them." >&2; exit 1; fi
command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 1; }

umask 077
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
openssl ecparam -name prime256v1 -genkey -noout -out "$work/k.pem" 2>/dev/null
if base64 -w0 </dev/null >/dev/null 2>&1; then B64="base64 -w0"; else B64="base64"; fi
b64url() { $B64 | tr -d '\n' | tr '+/' '-_' | tr -d '='; }
# Raw 32-byte private scalar and 65-byte uncompressed public point, base64url — the format the web-push library and browsers use.
PRIV="$(openssl ec -in "$work/k.pem" -outform DER 2>/dev/null | tail -c +8 | head -c 32 | b64url)"
PUB="$(openssl ec -in "$work/k.pem" -pubout -outform DER 2>/dev/null | tail -c 65 | b64url)"
[ "${#PRIV}" -eq 43 ] && [ "${#PUB}" -eq 87 ] || { echo "Key generation produced an unexpected format; nothing was changed." >&2; exit 1; }

cp -p "$ENV_FILE" "$ENV_FILE.bak-$(date -u +%Y%m%dT%H%M%SZ)"
{
  printf '\n# Admin Web Push (VAPID), added %s by setup-web-push-keys.sh\n' "$(date -u +%FT%TZ)"
  printf 'WEB_PUSH_VAPID_PUBLIC_KEY=%s\n' "$PUB"
  printf 'WEB_PUSH_VAPID_PRIVATE_KEY=%s\n' "$PRIV"
  printf 'WEB_PUSH_SUBJECT=%s\n' "$SUBJECT"
} >> "$ENV_FILE"
chmod 600 "$ENV_FILE"
unset PRIV
echo "Web Push keys added to $ENV_FILE (private key not shown)."
echo "Public key: $PUB"
echo "Next: recreate the backend container so it reads the new settings."

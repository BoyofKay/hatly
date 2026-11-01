#!/usr/bin/env bash
# READ-ONLY security smoke test for a deployed stack (Staging). Sends only GET / OPTIONS requests and one unauthenticated GET that the auth
# guard refuses (401). Creates, changes and deletes nothing, uses no credentials, prints no secrets. Run it from any machine:
#   ./security-smoke.sh --api https://api-sales.hatly.dev/api/v1 --dashboard https://sales.hatly.dev [--origin https://sales.hatly.dev]
# Local rehearsal over plain http: add --allow-http (the HTTPS-only checks then report SKIP).
# What it cannot check (needs credentials, an operator, or a browser — see docs/security/staging-readiness-checklist.md): the cookie
# flags after a real sign-in, CSRF with a signed-in session, refresh/logout/revocation, MFA, rate-limit exhaustion, Redis NOAUTH, client IP.
set -uo pipefail

api=""; dash=""; origin=""; allow_http=0
while [ $# -gt 0 ]; do
  case "$1" in
    --api) api="${2%/}"; shift 2;;
    --dashboard) dash="${2%/}"; shift 2;;
    --origin) origin="$2"; shift 2;;
    --allow-http) allow_http=1; shift;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
done
[ -n "$api" ] || { echo "usage: $0 --api <https://host/api/v1> [--dashboard <https://host>] [--origin <https://host>] [--allow-http]" >&2; exit 2; }
case "$api" in https://api.hatly.dev*|https://hatly.dev*|https://www.hatly.dev*|https://admin.hatly.dev*) echo "REFUSING: that looks like production." >&2; exit 2;; esac
[ -n "$origin" ] || origin="${dash:-$(printf '%s' "$api" | sed -E 's#^(https?://[^/]+).*#\1#')}"
api_origin="$(printf '%s' "$api" | sed -E 's#^(https?://[^/]+).*#\1#')"

fail=0; warn=0
pass() { echo "PASS  $1${2:+  — $2}"; }
bad()  { echo "FAIL  $1${2:+  — $2}"; fail=$((fail+1)); }
note() { echo "WARN  $1${2:+  — $2}"; warn=$((warn+1)); }
skip() { echo "SKIP  $1${2:+  — $2}"; }
check() { if [ "$2" = 1 ]; then pass "$1" "${3:-}"; else bad "$1" "${3:-}"; fi; }
hdr()  { curl -sS -m 15 -D - -o /dev/null "$@" 2>/dev/null | tr -d '\r'; }                 # response headers only
code() { curl -sS -m 15 -o /dev/null -w '%{http_code}' "$@" 2>/dev/null; }
has()  { printf '%s\n' "$1" | grep -qiE "$2" && echo 1 || echo 0; }

echo "== transport"
if [ "${api#https://}" != "$api" ]; then pass "API URL is HTTPS"; elif [ "$allow_http" = 1 ]; then skip "API URL is HTTPS" "--allow-http"; else bad "API URL is HTTPS"; fi

echo "== API health"
check "GET /health = 200" "$([ "$(code "$api/health")" = 200 ] && echo 1 || echo 0)"
ready="$(curl -sS -m 15 "$api/health/ready" 2>/dev/null)"
check "GET /health/ready reports database + redis up" "$(printf '%s' "$ready" | grep -q '"database":"up"' && printf '%s' "$ready" | grep -q '"redis":"up"' && echo 1 || echo 0)" "$(printf '%s' "$ready" | cut -c1-120)"

echo "== API security headers"
h="$(hdr "$api/health")"
check "x-content-type-options: nosniff" "$(has "$h" '^x-content-type-options: *nosniff')"
check "x-frame-options: DENY" "$(has "$h" '^x-frame-options: *deny')"
check "cache-control: no-store (no caching of API responses)" "$(has "$h" '^cache-control:.*no-store')"
check "content-security-policy: default-src 'none'" "$(has "$h" "^content-security-policy:.*default-src 'none'")"
check "rate-limit headers are emitted (x-ratelimit-limit)" "$(has "$h" '^x-ratelimit-limit:')"
if [ "${api#https://}" != "$api" ]; then
  if [ "$(has "$h" '^strict-transport-security:')" = 1 ]; then pass "strict-transport-security present"; else note "strict-transport-security missing on the API response" "the edge (Caddy) may add it; confirm in a browser"; fi
fi

echo "== CORS (credentialed, exact origin)"
h="$(hdr -H "Origin: $origin" "$api/health")"
check "approved origin is echoed in access-control-allow-origin" "$([ "$(printf '%s\n' "$h" | grep -i '^access-control-allow-origin:' | sed -E 's/^[^:]+: *//' | tr -d ' ')" = "$origin" ] && echo 1 || echo 0)" "$origin"
check "approved origin gets access-control-allow-credentials: true" "$(has "$h" '^access-control-allow-credentials: *true')" "absent on a build that predates the cookie sessions"
h="$(hdr -H "Origin: https://evil.example" "$api/health")"
check "a foreign origin gets NO access-control-allow-origin" "$([ "$(has "$h" '^access-control-allow-origin:')" = 0 ] && echo 1 || echo 0)"
h="$(hdr -X OPTIONS -H "Origin: $origin" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type,x-csrf-token" "$api/auth/dashboard/login")"
check "preflight from the approved origin allows X-CSRF-Token" "$(has "$h" '^access-control-allow-headers:.*x-csrf-token')"

echo "== non-production endpoints"
for p in "$api_origin/docs" "$api/docs" "$api_origin/api/docs"; do
  check "Swagger/API docs not served: $p" "$([ "$(code "$p")" = 404 ] && echo 1 || echo 0)" "$(code "$p")"
done

echo "== dashboard session routes (unauthenticated)"
c="$(code "$api/auth/dashboard/me")"
if [ "$c" = 401 ]; then pass "GET /auth/dashboard/me refuses an anonymous caller" "401"
elif [ "$c" = 404 ]; then bad "GET /auth/dashboard/me is 404" "the deployed API predates the cookie-session milestone (an up-to-date build answers 401)"
else bad "GET /auth/dashboard/me" "unexpected status $c"; fi

if [ -n "$dash" ]; then
  echo "== dashboard"
  h="$(hdr "$dash/login")"
  check "dashboard /login = 200" "$(has "$h" '^HTTP/[0-9.]+ 200')"
  check "x-frame-options: DENY" "$(has "$h" '^x-frame-options: *deny')"
  check "x-content-type-options: nosniff" "$(has "$h" '^x-content-type-options: *nosniff')"
  check "referrer-policy present" "$(has "$h" '^referrer-policy:')"
  check "CSP forbids framing (frame-ancestors 'none')" "$(has "$h" "^content-security-policy:.*frame-ancestors 'none'")"
  check "CSP connect-src allows exactly the API origin" "$(has "$h" "^content-security-policy:.*connect-src 'self' ${api_origin//./\\.}")" "$api_origin"
  html="$(curl -sS -m 15 "$dash/login" 2>/dev/null)"
  css="$(printf '%s' "$html" | grep -oE '/_next/static/css/[A-Za-z0-9._-]+\.css' | head -1)"
  if [ -n "$css" ]; then
    body="$(curl -sS -m 15 "$dash$css" 2>/dev/null)"; size=${#body}
    check "stylesheet is compiled Tailwind (no raw @tailwind directives, > 5 KB)" "$([ "$size" -gt 5000 ] && ! printf '%s' "$body" | grep -q '@tailwind' && echo 1 || echo 0)" "$size bytes"
  else bad "stylesheet link found on /login"; fi
  check "next/image optimizer is off (/_next/image = 404)" "$([ "$(code "$dash/_next/image?url=%2Fx.png&w=64&q=75")" = 404 ] && echo 1 || echo 0)"
fi

echo
if [ "$fail" -gt 0 ]; then echo "$fail check(s) FAILED, $warn warning(s)"; exit 1; fi
echo "All checks passed ($warn warning(s))"

#!/usr/bin/env bash
# OWNER-RUN, Staging only: the sign-in and authorization checks that a password is needed for, after the 2026-10-17 update.
# Run it ON THE VPS as the user that owns /opt/hatly-staging (it reads the Staging sales credentials from that server-side file; they never
# leave the machine and are never printed — the output is HTTP statuses and counts only):
#   ssh ubuntu@152.228.240.4 'bash -s' < deploy/staging/post-update-auth-checks.sh
# What it writes on Staging (and nothing else): one dashboard sign-in/sign-out of the existing Staging admin. That creates one refresh session
# (revoked again by the logout step) and, by design, two rows in the append-only admin_audit_logs table (DASHBOARD_LOGIN / DASHBOARD_LOGOUT).
# No orders, no notifications, no data of any customer is touched: the two customer-route probes below are refused by the guards before any
# handler runs, and the delete-account probe carries no password, so it could not delete anything even if a guard were missing.
# Refuses to run against anything but the Staging API.
#
# Status contract this script checks (verified against the backend by apps/backend/test/e2e/92-dashboard-session-mfa-audit and 102-owner-auth-checks-script):
#   401 = no valid session at all;  403 = signed in but not allowed (wrong role, or the CSRF check refused a cookie-authenticated write).
#   Dashboard cookie writes need  X-CSRF-Token  (HMAC of the session id, returned by login / me);  /auth/dashboard/logout and /refresh instead
#   need  X-Requested-With: hatly-dashboard  so they still work when the CSRF token was lost.
set -uo pipefail
CRED=/opt/hatly-staging/.sales-credentials
API="${STAGING_API:-https://api-sales.hatly.dev/api/v1}"; ORIGIN="${STAGING_ORIGIN:-https://sales.hatly.dev}"
# The only targets: the Staging API, or — for the automated rehearsal against a local test backend (apps/backend/test/e2e/102-…) — a loopback
# URL, and only when AUTH_CHECKS_LOCAL_REHEARSAL=1 is set (then the credentials file may be overridden too). Anything else is refused.
if [ "${AUTH_CHECKS_LOCAL_REHEARSAL:-}" = 1 ]; then
  if [[ "$API" =~ ^http://127\.0\.0\.1:[0-9]+/api/v1$ ]]; then CRED="${AUTH_CHECKS_CREDENTIALS_FILE:-$CRED}"; ORIGIN="${STAGING_ORIGIN:-http://127.0.0.1}"
  else echo "REFUSING: local rehearsal only talks to http://127.0.0.1:<port>/api/v1"; exit 2; fi
else
  case "$API" in https://api-sales.hatly.dev/*) ;; *) echo "REFUSING: not the Staging API"; exit 2;; esac
fi
[ -r "$CRED" ] || { echo "STOP: $CRED not readable"; exit 1; }
PHONE="$(grep -E '^SALES_ADMIN_PHONE=' "$CRED" | cut -d= -f2-)"; PASS="$(grep -E '^SALES_ADMIN_PASSWORD=' "$CRED" | cut -d= -f2-)"
[ -n "$PHONE" ] && [ -n "$PASS" ] || { echo "STOP: SALES_ADMIN_PHONE / SALES_ADMIN_PASSWORD missing in the credentials file"; exit 1; }
JAR="$(mktemp)"; PRE_LOGOUT_JAR="$(mktemp)"; trap 'rm -f "$JAR" "$PRE_LOGOUT_JAR"' EXIT
fail=0; ok() { echo "PASS  $1"; }; bad() { echo "FAIL  $1"; fail=$((fail+1)); }
chk() { if [ "$2" = "$3" ]; then ok "$1 = $2"; else bad "$1 = $2 (expected $3)"; fi; }
REQUESTED_WITH='X-Requested-With: hatly-dashboard'
req() { curl -s -m 20 -b "$JAR" -c "$JAR" -H "Origin: $ORIGIN" "$@"; }
code() { req -o /dev/null -w '%{http_code}' "$@"; }
# call <curl args…>  → sets STATUS and BODY (the body is only ever parsed for the error code, never printed)
call() { local out; out="$(req -w '\n%{http_code}' "$@")"; STATUS="${out##*$'\n'}"; BODY="${out%$'\n'*}"; }
errcode() { printf '%s' "$BODY" | python3 -c 'import sys,json;print((json.load(sys.stdin).get("error") or {}).get("details",{}).get("code",""))' 2>/dev/null; }

echo "== dashboard sign-in (cookie session, as the dashboard does it)"
body="$(PHONE="$PHONE" PASS="$PASS" python3 -c 'import json,os;print(json.dumps({"phone":os.environ["PHONE"],"password":os.environ["PASS"]}))')"
call -H 'Content-Type: application/json' -d "$body" "$API/auth/dashboard/login"; status="$STATUS"; json="$BODY"
chk "POST /auth/dashboard/login" "$status" 200
CSRF="$(printf '%s' "$json" | python3 -c 'import sys,json;d=json.load(sys.stdin)["data"];print(d.get("csrfToken",""))' 2>/dev/null)"
printf '%s' "$json" | python3 -c 'import sys,json;d=json.load(sys.stdin)["data"];print("      role:",d["user"]["role"]," mfa enabled:",d["mfa"]["enabled"]," enrollmentRequired:",d["mfa"]["enrollmentRequired"])' 2>/dev/null
[ "$status" = 200 ] && [ -n "$CSRF" ] || { echo "STOP: sign-in failed (or no CSRF token returned); the remaining checks need a session"; exit 1; }
chk "GET /auth/dashboard/me (session)" "$(code "$API/auth/dashboard/me")" 200

echo "== new endpoints with the staff session"
chk "GET /admin/audit-logs?limit=5 (VIEW_AUDIT_LOG, SUPER_ADMIN bypass)" "$(code "$API/admin/audit-logs?limit=5")" 200
n="$(req "$API/admin/audit-logs?limit=5" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["meta"]["total"])' 2>/dev/null)"; echo "      audit rows in total: $n (the sign-in above is one of them)"
chk "GET /admin/audit-logs?limit=5000 (an oversized page is clamped, not an error)" "$(code "$API/admin/audit-logs?limit=5000")" 200
chk "GET /admin/audit-logs?limit=0 (invalid page size is rejected)" "$(code "$API/admin/audit-logs?limit=0")" 400
chk "GET /sectors carries customRequestsEnabled" "$(req "$API/sectors" | grep -c customRequestsEnabled | sed 's/^[1-9][0-9]*$/yes/;s/^0$/no/')" yes

echo "== customer-only routes: anonymous = 401, a signed-in STAFF session = 403 (authenticated but wrong role)"
chk "GET /customer/notifications, no session" "$(curl -s -m 20 -o /dev/null -w '%{http_code}' -H "Origin: $ORIGIN" "$API/customer/notifications")" 401
call "$API/customer/notifications"; chk "GET /customer/notifications, staff session" "$STATUS" 403
# the write without the CSRF token is stopped by the CSRF check first …
call -X POST -H 'Content-Type: application/json' -d '{}' "$API/auth/customer/delete-account"
chk "POST /auth/customer/delete-account, staff cookie WITHOUT X-CSRF-Token" "$STATUS" 403; chk "      … refused for" "$(errcode)" CSRF_TOKEN_INVALID
# … and with a valid token it gets past CSRF and is stopped by the role check (so the role rule, not only CSRF, is what is tested)
call -X POST -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" -d '{}' "$API/auth/customer/delete-account"
chk "POST /auth/customer/delete-account, staff cookie WITH a valid X-CSRF-Token" "$STATUS" 403
case "$(errcode)" in CSRF_*) bad "      … refused by the CSRF check ($(errcode)) although the token was valid";; *) ok "      … refused by the role check, not by CSRF";; esac

echo "== sign-out revokes the session"
call -X POST -H "X-CSRF-Token: $CSRF" "$API/auth/dashboard/logout"
chk "POST /auth/dashboard/logout with ONLY X-CSRF-Token (logout wants the custom header instead)" "$STATUS" 403; chk "      … refused for" "$(errcode)" CSRF_HEADER_REQUIRED
chk "GET /auth/dashboard/me (the refused logout changed nothing)" "$(code "$API/auth/dashboard/me")" 200
cp "$JAR" "$PRE_LOGOUT_JAR"   # keep the pre-logout cookies (access, refresh, session id) to prove the refresh token is dead afterwards
chk "POST /auth/dashboard/logout with X-Requested-With" "$(code -X POST -H "$REQUESTED_WITH" "$API/auth/dashboard/logout")" 200
chk "GET /auth/dashboard/me after logout (cookies cleared)" "$(code "$API/auth/dashboard/me")" 401
chk "POST /auth/dashboard/refresh with the PRE-logout refresh cookie (server-side revocation)" \
  "$(curl -s -m 20 -o /dev/null -w '%{http_code}' -b "$PRE_LOGOUT_JAR" -X POST -H "Origin: $ORIGIN" -H "$REQUESTED_WITH" "$API/auth/dashboard/refresh")" 401

echo; [ "$fail" -eq 0 ] && echo "ALL AUTH CHECKS PASSED" || { echo "$fail check(s) FAILED"; exit 1; }

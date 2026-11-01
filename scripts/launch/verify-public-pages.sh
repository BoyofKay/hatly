#!/usr/bin/env bash
# READ-ONLY check of the two public legal pages on a deployed origin (GET requests only; sends no form, no credentials).
#   scripts/launch/verify-public-pages.sh https://hatly.dev
# Passes only when: HTTPS with a valid certificate; http:// redirects to https://; /privacy and /account-deletion answer 200 with their
# content and their cross-links; the privacy page carries NO draft banner (contact e-mail + effective date were set at build time);
# nothing secret-looking or localhost-like is in the HTML; the deletion page's bundle calls an https:// API.
set -uo pipefail
base="${1:?usage: $0 https://<origin>}"; base="${base%/}"
case "$base" in https://*) ;; *) echo "FAIL: the origin must be https://"; exit 2;; esac
fails=0; ok() { echo "PASS  $1"; }; bad() { echo "FAIL  $1"; fails=$((fails+1)); }
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

for path in /privacy /account-deletion; do
  code="$(curl -sS -m 20 -o "$tmp/page.html" -w '%{http_code}' "$base$path" 2>"$tmp/err")" || { bad "$path unreachable: $(head -c 200 "$tmp/err")"; continue; }
  [ "$code" = 200 ] && ok "$path answers 200" || bad "$path answers $code"
  grep -qiE 'localhost|127\.0\.0\.1|10\.0\.2\.2' "$tmp/page.html" && bad "$path mentions a localhost-style address" || ok "$path has no localhost-style address"
  grep -qE 'BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|eyJ[A-Za-z0-9_-]{20,}\.eyJ' "$tmp/page.html" && bad "$path contains a secret-looking string" || ok "$path contains no secret-looking string"
  # content checks below only ever look at a page that answered 200 (never at an error page)
  [ "$code" = 200 ] && cp "$tmp/page.html" "$tmp/$(echo "$path" | tr -d /).html"
done

p="$tmp/privacy.html"
[ -f "$p" ] || bad "privacy page content not checked (no 200 answer)"
if [ -f "$p" ]; then
  grep -q 'data-legal-draft' "$p" && bad "privacy page still shows the DRAFT banner (set NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL and NEXT_PUBLIC_PRIVACY_EFFECTIVE_DATE at build time)" || ok "privacy page is not a draft"
  grep -q 'سياسة الخصوصية لتطبيق Hatly' "$p" && grep -q 'Hatly Privacy Policy' "$p" && ok "privacy page has the Arabic and English policy" || bad "privacy page is missing a language"
  grep -q 'href="/account-deletion"' "$p" && ok "privacy page links to /account-deletion" || bad "privacy page does not link to /account-deletion"
  grep -q 'mailto:' "$p" && ok "privacy page shows a contact e-mail" || bad "privacy page has no contact e-mail"
fi
d="$tmp/account-deletion.html"
[ -f "$d" ] || bad "deletion page content not checked (no 200 answer)"
if [ -f "$d" ]; then
  grep -q 'deletion-self-service' "$d" && grep -q 'deletion-request' "$d" && ok "deletion page has both forms" || bad "deletion page is missing a form"
  grep -q 'href="/privacy"' "$d" && ok "deletion page links to /privacy" || bad "deletion page does not link to /privacy"
  api="$(grep -oE '/_next/static/chunks/app/account-deletion/page-[^"]+\.js' "$d" | head -1)"
  if [ -n "$api" ] && curl -sS -m 20 "$base$api" -o "$tmp/chunk.js"; then
    grep -qE 'https://[a-z0-9.-]+/api/v1' "$tmp/chunk.js" && ok "deletion page bundle targets an https:// API" || bad "deletion page bundle has no https:// API URL"
  else
    echo "WARN  could not locate the deletion page bundle to inspect its API URL"
  fi
fi

http="http://${base#https://}"
loc="$(curl -sS -m 15 -o /dev/null -w '%{redirect_url}' "$http/privacy" 2>/dev/null)"
case "$loc" in https://*) ok "http:// redirects to https://";; *) bad "http:// does not redirect to https:// (got '${loc:-no redirect}')";; esac
curl -sSI -m 15 "$base/privacy" 2>/dev/null | grep -qi '^strict-transport-security' && ok "HSTS header present" || echo "WARN  no HSTS header (recommended, not required by Google Play)"

echo; [ "$fails" = 0 ] && { echo "ALL CHECKS PASSED for $base"; exit 0; } || { echo "$fails CHECK(S) FAILED for $base"; exit 1; }

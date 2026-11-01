#!/usr/bin/env bash
# Creates the PRODUCTION env file from env.production.template with secrets generated HERE (openssl). Prints NO secret value.
# Operator inputs (external-service credentials) arrive on STDIN as KEY=VALUE lines — never as arguments, so they never appear in `ps`,
# shell history or logs. Allowed keys only:
#   GOOGLE_MAPS_API_KEY            optional: given -> MAPS_PROVIDER=google; absent -> MAPS_PROVIDER=none (PD-009 G: Maps deferred)
#   UNIFONIC_APP_SID, UNIFONIC_SENDER_ID              both, or neither -> ALLOW_MISSING_SMS_PROVIDER=true (no SMS/OTP)
#   FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY all three, or none -> ALLOW_MISSING_PUSH_PROVIDER=true (no push)
# Usage on the host:   PROD_DIR=/opt/hatly-prod ./init-production-env.sh < operator-inputs      (from the Mac: piped over ssh)
# Refuses to overwrite an existing file (new secrets would orphan the database password and every MFA enrolment).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dir="${PROD_DIR:-/opt/hatly-prod}"; out="$dir/.env.production"; tpl="${TEMPLATE:-$here/env.production.template}"
die() { echo "REFUSING: $*" >&2; exit 1; }
[ -e "$out" ] && die "$out already exists (new secrets would orphan the database and MFA enrolments; remove it deliberately if you must)"
[ -f "$tpl" ] || die "template $tpl not found"
command -v openssl >/dev/null || die "openssl is required"

# ---- read + validate operator input (values are never echoed) ----
allowed=" GOOGLE_MAPS_API_KEY UNIFONIC_APP_SID UNIFONIC_SENDER_ID FCM_PROJECT_ID FCM_CLIENT_EMAIL FCM_PRIVATE_KEY "
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  case "$line" in ''|'#'*) continue;; esac
  k="${line%%=*}"; v="${line#*=}"
  [ "$k" != "$line" ] || die "input line without '=' (key not shown)"
  case "$allowed" in *" $k "*) ;; *) die "input key '$k' is not allowed";; esac
  eval "seen=\${IN_$k+x}"; [ -z "$seen" ] || die "input key '$k' given twice"
  [ -n "$v" ] || die "input key '$k' is empty"
  case "$v" in *[[:cntrl:]]*) die "input '$k' contains control characters (FCM_PRIVATE_KEY must keep its newlines as the two characters \\n)";; esac
  printf -v "IN_$k" '%s' "$v"   # $k is allow-listed above, so the variable name is safe
done
if [ -n "${IN_GOOGLE_MAPS_API_KEY:-}" ]; then
  [[ "${IN_GOOGLE_MAPS_API_KEY}" =~ ^[A-Za-z0-9_-]{30,60}$ ]] || die "GOOGLE_MAPS_API_KEY does not look like a Google API key"
fi
sms=0; for k in UNIFONIC_APP_SID UNIFONIC_SENDER_ID; do [ -n "$(eval "printf %s \"\${IN_$k:-}\"")" ] && sms=$((sms+1)); done
[ "$sms" = 0 ] || [ "$sms" = 2 ] || die "give both UNIFONIC_APP_SID and UNIFONIC_SENDER_ID, or neither"
fcm=0; for k in FCM_PROJECT_ID FCM_CLIENT_EMAIL FCM_PRIVATE_KEY; do [ -n "$(eval "printf %s \"\${IN_$k:-}\"")" ] && fcm=$((fcm+1)); done
[ "$fcm" = 0 ] || [ "$fcm" = 3 ] || die "give all three FCM_* values, or none"
if [ "$fcm" = 3 ]; then
  [[ "${IN_FCM_CLIENT_EMAIL}" == *@*.iam.gserviceaccount.com ]] || die "FCM_CLIENT_EMAIL is not a service-account address"
  [[ "${IN_FCM_PRIVATE_KEY}" == *"BEGIN PRIVATE KEY"* ]] || die "FCM_PRIVATE_KEY is not a PEM private key (keep the \\n escapes)"
fi

# ---- generate + render ----
umask 077; mkdir -p "$dir"; chmod 700 "$dir"
dbpw="$(openssl rand -hex 24)"; redispw="$(openssl rand -hex 24)"; ja="$(openssl rand -hex 32)"; jr="$(openssl rand -hex 32)"
mfakey="$(openssl rand -base64 32)"   # alphabet A-Za-z0-9+/= : safe inside the | sed delimiter
tmp="$(mktemp "$dir/.env.production.XXXXXX")"; trap 'rm -f "$tmp"' EXIT
sed -e "s|@@DB_PASSWORD@@|$dbpw|g" -e "s|@@REDIS_PASSWORD@@|$redispw|g" -e "s|@@JWT_ACCESS@@|$ja|g" -e "s|@@JWT_REFRESH@@|$jr|g" \
    -e "s|@@MFA_KEY@@|$mfakey|g" "$tpl" > "$tmp"
unset dbpw redispw ja jr mfakey
{
  echo; echo "# --- operator input (written by init-production-env.sh $(date -u +%FT%TZ)) ---"
  if [ -n "${IN_GOOGLE_MAPS_API_KEY:-}" ]; then printf 'MAPS_PROVIDER=google\nGOOGLE_MAPS_API_KEY=%s\n' "${IN_GOOGLE_MAPS_API_KEY}"
  else echo "# no Google Maps key: Maps deferred (PD-009 G) — zone pricing, straight-line dispatch ranking, no address search"; echo "MAPS_PROVIDER=none"; fi
  if [ "$sms" = 2 ]; then printf 'UNIFONIC_APP_SID=%s\nUNIFONIC_SENDER_ID=%s\n' "${IN_UNIFONIC_APP_SID}" "${IN_UNIFONIC_SENDER_ID}"
  else echo "# no SMS provider: OTP/phone verification messages cannot be sent (decision recorded in docs/launch/CRITICAL_PATH.md)"; echo "ALLOW_MISSING_SMS_PROVIDER=true"; fi
  if [ "$fcm" = 3 ]; then printf 'FCM_PROJECT_ID=%s\nFCM_CLIENT_EMAIL=%s\nFCM_PRIVATE_KEY=%s\n' "${IN_FCM_PROJECT_ID}" "${IN_FCM_CLIENT_EMAIL}" "${IN_FCM_PRIVATE_KEY}"
  else echo "# no push provider: push notifications are disabled"; echo "ALLOW_MISSING_PUSH_PROVIDER=true"; fi
} >> "$tmp"
maps_set="${IN_GOOGLE_MAPS_API_KEY:+1}"
unset IN_GOOGLE_MAPS_API_KEY IN_UNIFONIC_APP_SID IN_UNIFONIC_SENDER_ID IN_FCM_PROJECT_ID IN_FCM_CLIENT_EMAIL IN_FCM_PRIVATE_KEY
! grep -q '@@' "$tmp" || die "template markers left unresolved"
[ "$(grep -cE '^[A-Z][A-Z0-9_]*=' "$tmp")" = "$(grep -E '^[A-Z][A-Z0-9_]*=' "$tmp" | cut -d= -f1 | sort -u | wc -l | tr -d ' ')" ] || die "duplicate keys in the rendered file"
chmod 600 "$tmp"; mv -n "$tmp" "$out"; trap - EXIT
[ -f "$out" ] && [ ! -e "$tmp" ] || die "could not place $out (another file appeared?)"
echo "Wrote $out (mode $(stat -c %a "$out" 2>/dev/null || stat -f %Lp "$out"), $(grep -cE '^[A-Z]' "$out") variables). Secrets generated here, not printed."
echo "Maps: $([ -n "${maps_set:-}" ] && echo 'google (key configured)' || echo 'none (deferred)') · SMS: $([ "$sms" = 2 ] && echo configured || echo 'NOT configured (ALLOW_MISSING_SMS_PROVIDER=true)') · push: $([ "$fcm" = 3 ] && echo configured || echo 'NOT configured (ALLOW_MISSING_PUSH_PROVIDER=true)')"

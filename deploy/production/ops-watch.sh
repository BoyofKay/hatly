#!/usr/bin/env bash
# Minimal self-contained watchdog — no cloud account, no cost. Run every 5 minutes from cron on the host (or from a SECOND machine for the
# external checks, which is better: a host cannot report its own death). Checks: API ready (database + redis up), dashboard answers, TLS
# certificate days left, newest backup age, disk usage, unhealthy containers. Prints one line per check; exits 1 if anything failed.
#   API_URL=https://api.hatly.dev/api/v1 DASHBOARD_URL=https://hatly.dev BACKUP_DIR=/var/backups/hatly ALERT_WEBHOOK_URL=… ./ops-watch.sh
# Alerts: if ALERT_WEBHOOK_URL is set, a failure (or a recovery) is POSTed as JSON — ALERT_WEBHOOK_FORMAT=slack (default, {"text":…}; also
# Mattermost/Rocket.Chat) or discord ({"content":…}). It alerts when the state CHANGES and re-alerts every ALERT_REPEAT_HOURS (default 6) while
# still failing, so a 5-minute cron does not flood a phone. The webhook URL is a secret: keep it in the cron environment, not in this file.
set -uo pipefail
API_URL="${API_URL:-}"; DASHBOARD_URL="${DASHBOARD_URL:-}"; BACKUP_DIR="${BACKUP_DIR:-}"; DISK_PATH="${DISK_PATH:-/}"
CERT_WARN_DAYS="${CERT_WARN_DAYS:-14}"; BACKUP_MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-30}"; DISK_MAX_PERCENT="${DISK_MAX_PERCENT:-85}"
STATE_FILE="${STATE_FILE:-${TMPDIR:-/tmp}/hatly-ops-watch.state}"; REPEAT_H="${ALERT_REPEAT_HOURS:-6}"
fails=(); lines=()
ok()   { lines+=("OK    $1"); }
bad()  { lines+=("FAIL  $1"); fails+=("$1"); }
host_of() { printf '%s' "$1" | sed -E 's#^https?://([^/:]+).*#\1#'; }

if [ -n "$API_URL" ]; then
  body="$(curl -sS -m 10 "$API_URL/health/ready" 2>&1)"; code="$(curl -sS -m 10 -o /dev/null -w '%{http_code}' "$API_URL/health/ready" 2>/dev/null)"
  if [ "$code" = 200 ] && printf '%s' "$body" | grep -q '"database":"up"' && printf '%s' "$body" | grep -q '"redis":"up"'; then ok "API ready (database + redis up)"; else bad "API not ready: HTTP $code $(printf '%s' "$body" | head -c 120)"; fi
fi
if [ -n "$DASHBOARD_URL" ]; then
  code="$(curl -sS -m 10 -o /dev/null -w '%{http_code}' -L "$DASHBOARD_URL/login" 2>/dev/null)"; [ "$code" = 200 ] && ok "dashboard answers" || bad "dashboard HTTP $code"
fi
for u in "$API_URL" "$DASHBOARD_URL"; do
  case "$u" in https://*) h="$(host_of "$u")"
    end="$(echo | openssl s_client -servername "$h" -connect "$h:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
    if [ -z "$end" ]; then bad "TLS certificate for $h unreadable"; else
      endts="$(date -j -f '%b %e %T %Y %Z' "$end" +%s 2>/dev/null || date -d "$end" +%s 2>/dev/null)"; days=$(( (endts - $(date +%s)) / 86400 ))
      [ "$days" -ge "$CERT_WARN_DAYS" ] && ok "TLS $h valid ${days} more days" || bad "TLS certificate for $h expires in ${days} days";
    fi;; esac
done
if [ -n "$BACKUP_DIR" ]; then
  newest="$(ls -1t "$BACKUP_DIR"/*.dump 2>/dev/null | head -1)"
  if [ -z "$newest" ]; then bad "no backup found in $BACKUP_DIR"; else
    age_h=$(( ($(date +%s) - $(stat -c %Y "$newest" 2>/dev/null || stat -f %m "$newest")) / 3600 ))
    [ "$age_h" -le "$BACKUP_MAX_AGE_HOURS" ] && ok "newest backup ${age_h} h old" || bad "newest backup is ${age_h} h old (limit ${BACKUP_MAX_AGE_HOURS})"
  fi
fi
pct="$(df -P "$DISK_PATH" | awk 'NR==2{gsub("%","",$5); print $5}')"; [ "${pct:-0}" -lt "$DISK_MAX_PERCENT" ] && ok "disk ${pct}% used" || bad "disk ${pct}% used (limit ${DISK_MAX_PERCENT}%)"
if command -v docker >/dev/null 2>&1 && { docker info >/dev/null 2>&1 || sudo -n docker info >/dev/null 2>&1; }; then
  D="docker"; docker info >/dev/null 2>&1 || D="sudo -n docker"
  unhealthy="$($D ps --filter health=unhealthy --format '{{.Names}}' 2>/dev/null | tr '\n' ' ')"; [ -z "$unhealthy" ] && ok "no unhealthy containers" || bad "unhealthy containers: $unhealthy"
fi

printf '%s\n' "${lines[@]}"
state="OK"; [ ${#fails[@]} -gt 0 ] && state="FAIL"; summary="${fails[*]:-}"
now=$(date +%s); prev_state="OK"; prev_ts=0; [ -f "$STATE_FILE" ] && read -r prev_state prev_ts < "$STATE_FILE"
send=0
[ "$state" != "$prev_state" ] && send=1
[ "$state" = "FAIL" ] && [ $(( now - ${prev_ts:-0} )) -ge $(( REPEAT_H * 3600 )) ] && send=1
if [ "$send" = 1 ] && [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
  if [ "$state" = FAIL ]; then msg="Hatly ALERT ($(hostname -s)): ${fails[*]}"; else msg="Hatly recovered ($(hostname -s)): all checks pass"; fi
  key="text"; [ "${ALERT_WEBHOOK_FORMAT:-slack}" = discord ] && key="content"
  esc="$(printf '%s' "$msg" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  curl -sS -m 10 -o /dev/null -H 'content-type: application/json' -d "{\"$key\":\"$esc\"}" "$ALERT_WEBHOOK_URL" || echo "WARN  alert delivery failed" >&2
  echo "$state $now" > "$STATE_FILE"
elif [ "$state" != "$prev_state" ] || [ ! -f "$STATE_FILE" ]; then echo "$state $now" > "$STATE_FILE"; fi
[ "$state" = OK ]

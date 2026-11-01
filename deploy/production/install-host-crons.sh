#!/usr/bin/env bash
# Installs (or shows / removes) the production host jobs in the deploy user's crontab, inside ONE marked block — idempotent; nothing outside
# the block is touched. Run ON THE HOST as the deploy user (ubuntu):
#   install-host-crons.sh show      # READ-ONLY: prints the block it would install and the current crontab's Hatly block (if any)
#   install-host-crons.sh apply     # ⛔ approval: replaces/creates the block
#   install-host-crons.sh remove    # removes the block only
# Jobs: daily verified backup (database + uploads), ops-watch every 5 minutes, Cloudflare-ranges check weekly. Logs: /opt/hatly-prod/logs/.
# Alert webhook (optional, a secret): put the URL alone in /opt/hatly-prod/.alert-webhook (mode 600); it is read at run time, never written
# into the crontab. Off-site backup command (optional): /opt/hatly-prod/.offsite-cmd (mode 600), e.g.  rclone copy "$1" remote:hatly-backups/
set -euo pipefail
PD="${PROD_DIR:-/opt/hatly-prod}"; P="$PD/current/deploy/production"; LOGS="$PD/logs"
BEGIN="# BEGIN hatly-prod (managed by install-host-crons.sh — edit there, not here)"; END="# END hatly-prod"
block() {
cat <<EOF
$BEGIN
SHELL=/bin/bash
30 2 * * * OFFSITE_CMD="\$(cat $PD/.offsite-cmd 2>/dev/null)" $P/prod.sh backup >> $LOGS/backup.log 2>&1
*/5 * * * * ALERT_WEBHOOK_URL="\$(cat $PD/.alert-webhook 2>/dev/null)" API_URL=https://api.hatly.dev/api/v1 DASHBOARD_URL=https://hatly.dev BACKUP_DIR=$PD/backups STATE_FILE=$LOGS/ops-watch.state bash $P/ops-watch.sh >> $LOGS/ops-watch.log 2>&1
15 3 * * 1 bash $P/cloudflare-ranges-check.sh >> $LOGS/cloudflare-ranges.log 2>&1 || ALERT_WEBHOOK_URL="\$(cat $PD/.alert-webhook 2>/dev/null)" bash -c '[ -n "\$ALERT_WEBHOOK_URL" ] && curl -fsS -m 10 -H "content-type: application/json" -d "{\"text\":\"Hatly: Cloudflare ranges changed — update deploy/production/Caddyfile.production-block\"}" "\$ALERT_WEBHOOK_URL" >/dev/null'
$END
EOF
}
current() { crontab -l 2>/dev/null || true; }
without_block() { printf '%s\n' "$1" | awk -v b="$BEGIN" -v e="$END" '$0==b{skip=1; next} $0==e{skip=0; next} !skip' | grep -v '^$' || true; }
count_jobs() { crontab -l 2>/dev/null | awk -v b="$BEGIN" -v e="$END" '$0==b{p=1; next} $0==e{p=0} p && /^[0-9*]/' | wc -l | tr -d ' '; }
case "${1:-show}" in
  show)   echo "--- block that 'apply' would install:"; block; echo "--- current Hatly block in the crontab:"; current | awk -v b="$BEGIN" -v e="$END" '$0==b{p=1} p; $0==e{p=0}' | grep . || echo "(none)";;
  apply)  [ -x "$P/prod.sh" ] && [ -f "$P/ops-watch.sh" ] || { echo "release scripts not found under $P"; exit 1; }
          mkdir -p -m 700 "$LOGS"
          cur="$(current)"                      # read the WHOLE crontab before writing anything
          { without_block "$cur"; block; } | crontab -
          echo "installed: $(count_jobs) job lines in the hatly-prod block";;
  remove) cur="$(current)"; without_block "$cur" | crontab -; echo "hatly-prod block removed";;
  *)      echo "usage: $0 show|apply|remove"; exit 2;;
esac

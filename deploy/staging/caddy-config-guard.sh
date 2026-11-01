#!/usr/bin/env bash
# READ-ONLY: would the staging Caddy load the SAME configuration after a restart, reboot or recreate as it runs now? Run on the VPS:
#   ssh ubuntu@152.228.240.4 'bash -s' < deploy/staging/caddy-config-guard.sh
#   ssh ubuntu@152.228.240.4 'bash -s -- /opt/hatly-staging/hatly-<date>/deploy/staging/Caddyfile.staging' < deploy/staging/caddy-config-guard.sh
# The optional argument is a Caddyfile about to become the mount source (the new tree's copy, BEFORE a tree swap); it must be
# byte-identical to what Caddy runs now.
# Why: the container bind-mounts a single FILE. A running bind mount follows the inode, so after `mv hatly hatly.pre-<date>` Caddy keeps
# reading the renamed-away file, while every container START (crash restart, `docker restart`, Docker daemon restart, host reboot) and every
# recreate (`compose up` with a changed config) re-resolves the PATH that `docker inspect` shows. If the two differ, the next restart silently
# changes the edge configuration — e.g. drops the production block, and hatly.dev/www/admin/api return Cloudflare 525.
# Changes nothing: docker inspect, `docker exec` of read-only commands (awk, stat, sha256sum, test), host stat/sha256sum.
set -uo pipefail
C=hatly-staging-caddy-1; CAND="${1:-}"; fail=0
ok() { echo "OK    $*"; }; warn() { echo "WARN  $*"; }; bad() { echo "FAIL  $*"; fail=1; }
sha() { sha256sum "$1" | cut -d' ' -f1; }
X() { sudo -n docker exec "$C" "$@" </dev/null; }

[ "$(sudo -n docker inspect -f '{{.State.Running}}' "$C" 2>/dev/null)" = true ] || { echo "FAIL  $C is not running"; exit 1; }
SRC="$(sudo -n docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}' "$C")"
NOW="$(X awk '$5=="/etc/caddy/Caddyfile"{print $4}' /proc/self/mountinfo)"
echo "info  restart policy: $(sudo -n docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$C") · daemon live-restore: $(sudo -n docker info -f '{{.LiveRestoreEnabled}}')"
echo "info  start command : $(sudo -n docker inspect -f '{{join .Config.Cmd " "}}' "$C")"
echo "info  a restart/recreate mounts: $SRC"
echo "info  Caddy reads now          : $NOW"
case "$(sudo -n docker inspect -f '{{join .Config.Cmd " "}}' "$C")" in
  *--resume*) warn "Caddy starts with --resume: after a restart it loads /config autosave, not the Caddyfile";;
  *"--config /etc/caddy/Caddyfile"*) ok "Caddy (re)starts from /etc/caddy/Caddyfile (no --resume)";;
  *) warn "unexpected start command";;
esac

RUN_SHA="$(X sha256sum /etc/caddy/Caddyfile | cut -d' ' -f1)"
if [ -z "$SRC" ] || [ ! -f "$SRC" ]; then
  bad "mount source '$SRC' is missing or not a file — the next start would fail (Docker creates a DIRECTORY at a missing bind path)"
else
  if [ "$(X stat -c '%d %i' /etc/caddy/Caddyfile)" = "$(stat -c '%d %i' "$SRC")" ]; then
    ok "Caddy reads the mount source itself (same device/inode) — no stale mount"
  else
    warn "STALE MOUNT: Caddy reads a different file (inode) than a restart would mount (cause: the tree was renamed after Caddy started)"
  fi
  if [ "$(sha "$SRC")" = "$RUN_SHA" ]; then ok "content Caddy reads now == content a restart would load (${RUN_SHA:0:16})"
  else bad "a restart/reboot/recreate would load DIFFERENT content: now ${RUN_SHA:0:16}, after restart $(sha "$SRC" | cut -c1-16)"; fi
  # every certificate/key file the restart config names must be readable inside the container, or Caddy refuses to start
  for p in $(awk '$1=="tls" && NF>=3 && $2 ~ /^\// {print $2; print $3}' "$SRC"); do
    X test -r "$p" && ok "tls file present in the container: $p" || bad "tls file missing in the container: $p (a restart would fail)"
  done
  echo "info  production block (hatly-origin certificate) in: now=$(X grep -c '/data/tls/hatly-origin' /etc/caddy/Caddyfile) restart-source=$(grep -c '/data/tls/hatly-origin' "$SRC")"
fi

if [ -n "$CAND" ]; then
  if [ -f "$CAND" ] && [ "$(sha "$CAND")" = "$RUN_SHA" ]; then ok "candidate $CAND is byte-identical to what Caddy runs"
  else bad "candidate $CAND differs from what Caddy runs (or is missing) — do NOT swap trees until it carries the same Caddyfile"; fi
fi

[ "$fail" = 0 ] && echo "CADDY CONFIG GUARD PASSED" || { echo "CADDY CONFIG GUARD FAILED"; exit 1; }

#!/usr/bin/env bash
# Hatly production — Stage 3: switch the four production hostnames from the Stage 1 "coming soon" 503 to the running production apps.
# Run from the Mac (bash 3.2 compatible), only after Stage 2 completed:
#   bash deploy/production/stage3-edge-switch.sh preflight   # READ-ONLY; writes nothing on the VPS
#   bash deploy/production/stage3-edge-switch.sh apply       # repeats the preflight; backup -> edge network -> candidate -> checks -> apply -> post-checks
# What changes: (1) the shared Caddy (hatly-staging-caddy-1) joins the network hatly-edge — `docker network connect`, no restart;
# (2) in BOTH Caddyfiles (the inode the running container reads, and the active-path copy a restart would load) the Stage 1 block is replaced
# by deploy/production/Caddyfile.production-block; (3) ONE Caddy reload. Staging's site blocks, certificates and containers do not change.
# Rollback (automatic on any failure after the first live write, incl. Ctrl-C): both Caddyfiles back to the Stage 1 content (validated,
# reloaded); the network connection is removed again if this run made it. Never touches Cloudflare, DNS, the production containers or data.
set -Eeuo pipefail
MODE="${1:-}"; [[ "$MODE" == preflight || "$MODE" == apply ]] || { echo "usage: $0 preflight|apply"; exit 2; }

H=ubuntu@152.228.240.4
ORIGIN_IP=152.228.240.4
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
C=hatly-staging-caddy-1
F=/opt/hatly-staging/hatly.pre-20261017/deploy/staging/Caddyfile.staging   # the inode the RUNNING Caddy reads (proved below)
EXPECTED_INODE=1839134
F_TREE=/opt/hatly-staging/hatly/deploy/staging/Caddyfile.staging          # what a restart/recreate mounts
TREE_INODE=2438005
D=/var/lib/docker/volumes/hatly-staging_caddy_data/_data
TLSDIR="$D/tls/hatly-origin-exact"
CERT="$HOME/Downloads/origin-exact.pem"; KEY="$HOME/Downloads/origin-exact-key.pem"
BACKUPS=/opt/hatly-staging/backups
STAGE1_SHA16=4de9ae87dc8ff368          # both Caddyfiles after Stage 1 (verified 2026-10-23 19:32Z)
PREFIX_BYTES=248; PREFIX_SHA16=318847d4683dcaf8   # the staging-only part: the original Caddyfile before Stage 1
PROD_HOSTS="hatly.dev www.hatly.dev admin.hatly.dev api.hatly.dev"
BLOCK_FILE="$REPO/deploy/production/Caddyfile.production-block"
TS="$(date -u +%Y%m%dT%H%M%SZ)"; B="$BACKUPS/caddy-stage3-$TS"; CAND_DIR="$D/stage3-$TS"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 "$H")
L="$(mktemp -d)"; chmod 700 "$L"
CHANGED=0; EDGE_MADE=0
# The Stage 1 block, byte for byte as Stage 1 appended it (see stage1-origin-tls.sh BLOCK) — the live file must END with exactly this.
STAGE1_BLOCK=$'\n# --- PRODUCTION, Stage 1: TLS only (no production services yet) ---\nhatly.dev, www.hatly.dev, admin.hatly.dev, api.hatly.dev {\n\ttls /data/tls/hatly-origin-exact/origin.pem /data/tls/hatly-origin-exact/origin-key.pem\n\theader Cache-Control "no-store"\n\trespond "Hatly is coming soon." 503\n}\n'
q() { printf '%q ' "$@"; }
log() { printf '\n== %s\n' "$*"; }

# ---------------------------------------------------------------------------------------------------- failure handling
rollback() {
  log "ROLLBACK: both Caddyfiles back to the Stage 1 content from $B (in place, validated before reload)"
  if "${SSH[@]}" "bash -s -- $(q "$C" "$F" "$B" "$EXPECTED_INODE" "$F_TREE" "$TREE_INODE")" <<'EOF'
set -euo pipefail; C=$1 F=$2 B=$3 INODE=$4 FT=$5 TINODE=$6
test -f "$B/Caddyfile.stage1" || { echo "backup file missing"; exit 1; }
want="$(cut -d' ' -f1 "$B/stage1.sha256")"
[ "$(sha256sum "$B/Caddyfile.stage1" | cut -d' ' -f1)" = "$want" ] || { echo "backup does not match its recorded hash"; exit 1; }
for pair in "$F:$INODE" "$FT:$TINODE"; do
  p="${pair%:*}" i="${pair##*:}"
  [ "$(sha256sum "$p" | cut -d' ' -f1)" = "$want" ] && continue
  sudo -n sh -c "cat '$B/Caddyfile.stage1' > '$p'"
  [ "$(stat -c %i "$p")" = "$i" ] || { echo "inode changed during restore of $p"; exit 1; }
  [ "$(sha256sum "$p" | cut -d' ' -f1)" = "$want" ] || { echo "restored $p differs from the backup"; exit 1; }
done
[ "$(sudo -n docker exec "$C" sha256sum /etc/caddy/Caddyfile | cut -d' ' -f1)" = "$want" ] || { echo "container does not see the restored file"; exit 1; }
sudo -n docker exec "$C" caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile >/dev/null
sudo -n docker exec "$C" caddy reload --adapter caddyfile --config /etc/caddy/Caddyfile --address 127.0.0.1:2019
echo "Stage 1 Caddyfile restored, validated and reloaded"
EOF
  then CHANGED=0
    edge_undo   # leave hatly-edge BEFORE judging staging: while Caddy is on both networks, DNS could still answer from hatly-edge
    staging_check after-rollback && echo "staging matches its baseline after rollback" || echo "WARNING: staging differs after rollback — investigate (backup: $B)"
  else echo "ROLLBACK FAILED — manual action needed. The Stage 1 Caddyfile is at $B/Caddyfile.stage1 on the VPS."; fi
}
edge_undo() {
  [[ "$EDGE_MADE" == 1 ]] || return 0
  "${SSH[@]}" "sudo -n docker network disconnect hatly-edge $(q "$C")" && EDGE_MADE=0 && echo "Caddy disconnected from hatly-edge again" \
    || echo "WARNING: could not disconnect Caddy from hatly-edge (harmless while the Stage 1 block is active)"
}
fail() {
  if (( BASH_SUBSHELL > 0 )); then exit 1; fi
  trap - ERR; trap "" INT TERM HUP
  echo "STOP: $*" >&2
  if [[ "$CHANGED" == 1 ]]; then rollback; fi
  if [[ "$CHANGED" == 0 ]]; then edge_undo; else echo "Caddy stays on hatly-edge: the Caddyfiles are not proven restored"; fi
  exit 1
}
trap 'fail "unexpected error at line $LINENO"' ERR
trap 'fail "interrupted (signal)"' INT TERM HUP
trap 'rm -rf "$L"' EXIT

# ---------------------------------------------------------------------------------------------------- observations
staging_snapshot() {   # identical to Stage 1's
  local s loc a fp afp smoke=FAILED
  s="$(curl -sS -o /dev/null -m 20 -w '%{http_code}' https://sales.hatly.dev/ 2>/dev/null || echo ERR)"
  loc="$(curl -sS -o /dev/null -m 20 -w '%{redirect_url}' https://sales.hatly.dev/ 2>/dev/null || echo ERR)"
  a="$(curl -sS -o /dev/null -m 20 -w '%{http_code}' https://api-sales.hatly.dev/api/v1/health 2>/dev/null || echo ERR)"
  fp="$( (openssl s_client -servername sales.hatly.dev -connect sales.hatly.dev:443 </dev/null 2>/dev/null | openssl x509 -noout -fingerprint -sha256 -issuer 2>/dev/null) | tr '\n' ' ' || true)"
  afp="$( (openssl s_client -servername api-sales.hatly.dev -connect api-sales.hatly.dev:443 </dev/null 2>/dev/null | openssl x509 -noout -fingerprint -sha256 -issuer 2>/dev/null) | tr '\n' ' ' || true)"
  (cd "$REPO" && node deploy/staging/smoke.mjs --read-only --api https://api-sales.hatly.dev/api/v1 --dashboard https://sales.hatly.dev) > "$L/smoke-$1.txt" 2>&1 && smoke=PASSED || true
  printf 'sales=%s location=%s api-sales-health=%s cert=%s api-sales-cert=%s smoke=%s\n' "$s" "$loc" "$a" "${fp:-NONE}" "${afp:-NONE}" "$smoke"
}
staging_check() {   # strict (byte-identical snapshot), but given a settling window: right after a Caddy reload the first seconds of
  # downloads from this Mac were seen to fail (2026-10-25, also after the rollback's own reload) — up to 4 attempts over ~30 s.
  local attempt
  for attempt in 1 2 3 4; do
    staging_snapshot "$1" > "$L/staging-$1.txt" || true
    if diff -q "$L/staging-baseline.txt" "$L/staging-$1.txt" >/dev/null; then echo "OK  staging identical to baseline ($1, attempt $attempt)"; return 0; fi
    echo "  staging snapshot differs ($1, attempt $attempt):"; diff -u "$L/staging-baseline.txt" "$L/staging-$1.txt" | grep '^[-+][^-+]' | cut -c1-220
    grep -E '^FAIL' "$L/smoke-$1.txt" 2>/dev/null | sed 's/^/    smoke: /' || true
    chunk_diag
    [ "$attempt" = 4 ] || sleep 8
  done
  return 1
}
chunk_diag() {   # evidence for a bundle-check failure: every staging /login chunk with status, size, encoding and whether it holds the API URL
  node -e '
    const d = "https://sales.hatly.dev", api = "https://api-sales.hatly.dev/api/v1";
    (async () => {
      try {
        const h = await (await fetch(d + "/login", { signal: AbortSignal.timeout(15000) })).text();
        for (const c of [...h.matchAll(/\/_next\/static\/[^"\x27]+\.js/g)].map((m) => m[0]).slice(0, 40)) {
          try { const r = await fetch(d + c, { signal: AbortSignal.timeout(15000) }); const t = await r.text();
                console.log(`    chunk ${r.status} ${t.length}B enc=${r.headers.get("content-encoding") || "-"} api=${t.includes(api)} ${c}`); }
          catch (e) { console.log(`    chunk ERR ${e.name} ${c}`); }
        }
      } catch (e) { console.log(`    /login ERR ${e.name}`); }
    })();' 2>&1 | head -45 || true
}
remote_fingerprint() {   # staging + production containers (id, start, restarts), the port-3100 process
  "${SSH[@]}" "bash -s" <<'EOF'
set -euo pipefail
for p in hatly-staging hatly-prod; do for c in $(sudo -n docker ps -aq --filter label=com.docker.compose.project=$p); do
  sudo -n docker inspect --format '{{.Name}} {{.Id}} {{.State.StartedAt}} restarts={{.RestartCount}} {{.State.Status}}' "$c"; done; done | sort
echo "port3100 $(sudo -n ss -ltnp 2>/dev/null | grep ':3100 ' | grep -oE 'pid=[0-9]+' | head -1 || echo none)"
EOF
}
cf_get() {   # $1 url -> "<code>" ; body in $L/last.body, headers in $L/last.hdr
  curl -sS -m 20 -o "$L/last.body" -D "$L/last.hdr" -w '%{http_code}' "$1" 2>/dev/null || echo ERR
}

# ---------------------------------------------------------------------------------------------------- structural check (fail closed)
structural_check() {   # $1 current (Stage 1) adapted JSON, $2 candidate adapted JSON, $3 block file
  python3 - "$1" "$2" "$3" <<'PY'
import json, re, sys
PROD = ["hatly.dev", "www.hatly.dev", "admin.hatly.dev", "api.hatly.dev"]
block = open(sys.argv[3]).read()
CF = re.search(r"@not_cloudflare not remote_ip (.+)", block).group(1).split()
XFF = {"set": {"X-Forwarded-For": ["{http.request.header.CF-Connecting-IP}"]}}
def is_prod(r): return sorted(h for m in r.get("match", []) for h in m.get("host", [])) == sorted(PROD)
def flatten(handlers, matchers):
    out = []
    for h in handlers:
        if h.get("handler") == "subroute":
            for r in h["routes"]: out += flatten(r.get("handle", []), matchers + [r.get("match")] if r.get("match") else matchers)
        else: out.append((json.dumps(matchers, sort_keys=True), h))
    return out
def check(o, c):
    for k in set(o) | set(c):
        if k != "apps" and o.get(k) != c.get(k): return f"top-level key '{k}' differs"
    for k in set(o["apps"]) | set(c["apps"]):
        if k != "http" and o["apps"].get(k) != c["apps"].get(k): return f"app '{k}' differs (the tls app must be identical)"
    so, sc = o["apps"]["http"]["servers"], c["apps"]["http"]["servers"]
    if set(so) != set(sc) or len(sc) != 1: return "servers differ"
    n = next(iter(sc)); a, b = so[n], sc[n]
    for k in set(a) | set(b):
        if k != "routes" and a.get(k) != b.get(k): return f"server key '{k}' differs (TLS policies / auto-HTTPS must be identical)"
    ra, rb = a["routes"], b["routes"]
    if [r for r in ra if not is_prod(r)] != [r for r in rb if not is_prod(r)]: return "a staging route changed"
    pa, pb = [r for r in ra if is_prod(r)], [r for r in rb if is_prod(r)]
    if len(pa) != 1 or len(pb) != 1 or len(rb) != len(ra): return "expected exactly one production route before and after"
    if [h for m in pb[0]["match"] for h in m["host"]] and len(pb[0]["match"]) != 1: return "production route matcher unexpected"
    flat = flatten(pb[0]["handle"], [])
    api = [{"host": ["api.hatly.dev"]}]; not_api = [{"not": [{"host": ["api.hatly.dev"]}]}]; not_cf = [{"not": [{"remote_ip": {"ranges": CF}}]}]
    want = [
        (json.dumps([not_api], sort_keys=True), {"handler": "headers", "response": {"set": {"Strict-Transport-Security": ["max-age=15552000"]}}}),
        (json.dumps([not_cf], sort_keys=True), {"handler": "static_response", "status_code": 403, "body": "Forbidden"}),
        (json.dumps([], sort_keys=True), {"handler": "encode", "encodings": {"gzip": {}, "zstd": {}}, "prefer": ["zstd", "gzip"]}),
        (json.dumps([api], sort_keys=True), {"handler": "reverse_proxy", "headers": {"request": XFF}, "upstreams": [{"dial": "hatly-prod-backend:3000"}]}),
        (json.dumps([], sort_keys=True), {"handler": "reverse_proxy", "headers": {"request": XFF}, "upstreams": [{"dial": "hatly-prod-dashboard:3001"}]}),
    ]
    if len(flat) != len(want): return f"production route has {len(flat)} handlers, expected {len(want)}: {[h.get('handler') for _, h in flat]}"
    for i, ((gm, gh), (wm, wh)) in enumerate(zip(flat, want)):
        if gm != wm or gh != wh: return f"production handler {i + 1} unexpected: matchers={gm} handler={json.dumps(gh)[:300]}"
    if len(CF) != 22: return f"expected 22 Cloudflare ranges in the block, found {len(CF)}"
    return None
try:
    o, c = (json.load(open(f)) for f in sys.argv[1:3]); err = check(o, c)
except Exception as e:
    err = f"could not parse/check the adapted JSON: {e!r}"
if err: print("STRUCTURE FAILED:", err); sys.exit(1)
print("OK  structure: staging routes, TLS app, TLS policies and server settings identical; production route = HSTS(dashboard) -> 403 for non-Cloudflare -> encode -> api: backend / else: dashboard, X-Forwarded-For = CF-Connecting-IP")
PY
}

# ======================================================================================================= PREFLIGHT
log "0. local checks"
for t in ssh openssl curl node python3 base64 shasum diff; do command -v "$t" >/dev/null || fail "local tool missing: $t"; done
[[ -f "$BLOCK_FILE" && -f "$CERT" && -f "$KEY" ]] || fail "block file or the exact-name certificate files are missing"
SHA_CERT="$(shasum -a 256 "$CERT" | cut -d' ' -f1)"; SHA_KEY="$(shasum -a 256 "$KEY" | cut -d' ' -f1)"
BLOCK_B64="$(base64 < "$BLOCK_FILE" | tr -d '\n')"; S1_B64="$(printf '%s' "$STAGE1_BLOCK" | base64 | tr -d '\n')"
echo "OK  Stage 3 block $(shasum -a 256 "$BLOCK_FILE" | cut -c1-16) ($(wc -l < "$BLOCK_FILE" | tr -d ' ') lines); certificate files present (hashes only)"

log "1. baselines: staging, public production names (expect the Stage 1 503), Stage 2 health"
staging_snapshot baseline > "$L/staging-baseline.txt"; cat "$L/staging-baseline.txt"
grep -q 'sales=307 ' "$L/staging-baseline.txt" && grep -q 'api-sales-health=200 ' "$L/staging-baseline.txt" && grep -q 'smoke=PASSED' "$L/staging-baseline.txt" \
  && [ "$(grep -o "O=Let's Encrypt" "$L/staging-baseline.txt" | wc -l | tr -d ' ')" = 2 ] || fail "staging is not healthy before the change"
for h in $PROD_HOSTS; do c="$(cf_get "https://$h/")"; grep -q 'Hatly is coming soon' "$L/last.body" && [ "$c" = 503 ] || fail "$h is not in the Stage 1 state ($c)"; done
echo "OK  all four production names answer the Stage 1 503 via Cloudflare"
"${SSH[@]}" "bash -s" <<'EOF' || fail "Stage 2 is not healthy — complete Stage 2 first"
set -euo pipefail
for c in hatly-prod-postgres-1 hatly-prod-redis-1 hatly-prod-backend-1 hatly-prod-dashboard-1; do
  [ "$(sudo -n docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null)" = healthy ] || { echo "$c is not healthy"; exit 1; }; done
for c in hatly-prod-backend-1 hatly-prod-dashboard-1; do sudo -n docker inspect -f '{{json .NetworkSettings.Networks}}' "$c" | grep -q '"hatly-edge"' || { echo "$c is not on hatly-edge"; exit 1; }; done
r="$(sudo -n docker exec hatly-prod-backend-1 curl -fsS -m 5 http://127.0.0.1:3000/api/v1/health/ready </dev/null)"; echo "$r" | grep -q '"database":"up"' && echo "$r" | grep -q '"redis":"up"' || { echo "backend not ready"; exit 1; }
echo "OK  Stage 2 healthy: 4 production containers healthy; backend + dashboard on hatly-edge; backend ready (database + redis up)"
EOF
remote_fingerprint > "$L/fp-before.txt" || fail "could not fingerprint"; echo "fingerprint recorded ($(wc -l < "$L/fp-before.txt" | tr -d ' ') lines)"

log "2. remote preflight (read-only)"
"${SSH[@]}" "bash -s -- $(q "$C" "$F" "$EXPECTED_INODE" "$F_TREE" "$TREE_INODE" "$STAGE1_SHA16" "$PREFIX_BYTES" "$PREFIX_SHA16" "$S1_B64" "$TLSDIR" "$SHA_CERT" "$SHA_KEY" "$B" "$CAND_DIR" "$BACKUPS")" <<'EOF' | tee "$L/remote-preflight.txt" || fail "remote preflight failed"
set -euo pipefail
C=$1 F=$2 INODE=$3 FT=$4 TINODE=$5 S1=$6 PB=$7 PS=$8 S1B64=$9 TLS=${10} SC=${11} SK=${12} B=${13} CAND=${14} BACKUPS=${15}
no() { echo "PREFLIGHT FAILED: $*"; exit 1; }
sudo -n true 2>/dev/null || no "sudo would prompt"
[ -d "$BACKUPS" ] && [ -w "$BACKUPS" ] || no "$BACKUPS not writable"
for f in "$F" "$FT"; do sudo -n test -w "$f" || no "cannot write $f"; done
[ "$(sudo -n docker inspect -f '{{.State.Running}}' "$C")" = true ] || no "Caddy is not running"
mroot="$(sudo -n docker exec "$C" awk '$5=="/etc/caddy/Caddyfile"{print $4}' /proc/self/mountinfo)"; [ "$mroot" = "$F" ] || no "the container mounts '$mroot', not $F"
[ "$(sudo -n docker exec "$C" stat -c '%d %i' /etc/caddy/Caddyfile)" = "$(stat -c '%d %i' "$F")" ] || no "container file and $F are not the same inode"
[ "$(stat -c %i "$F")" = "$INODE" ] && [ "$(stat -c %i "$FT")" = "$TINODE" ] || no "Caddyfile inodes changed"
for f in "$F" "$FT"; do [ "$(sha256sum "$f" | cut -c1-16)" = "$S1" ] || no "$f is not the Stage 1 content"; done
[ "$(sudo -n docker exec "$C" sha256sum /etc/caddy/Caddyfile | cut -c1-16)" = "$S1" ] || no "the container does not see the Stage 1 content"
# byte proof: live = staging prefix (unchanged since before Stage 1) + exactly the Stage 1 block
[ "$(head -c "$PB" "$F" | sha256sum | cut -c1-16)" = "$PS" ] || no "the staging part of the Caddyfile changed"
printf '%s' "$S1B64" | base64 -d | cmp -s - <(tail -c +"$((PB+1))" "$F") || no "the live file does not end with exactly the Stage 1 block"
# certificate folder: exactly the exact-name pair, root-only
[ "$(sudo -n stat -c '%F %a %U %G' "$TLS")" = "directory 700 root root" ] || no "$TLS type/permissions unexpected"
[ "$(sudo -n ls -A "$TLS" | sort | tr '\n' ' ')" = "origin-key.pem origin.pem " ] || no "$TLS holds unexpected files"
[ "$(sudo -n sha256sum "$TLS/origin.pem" | cut -d' ' -f1)" = "$SC" ] && [ "$(sudo -n sha256sum "$TLS/origin-key.pem" | cut -d' ' -f1)" = "$SK" ] || no "installed certificate differs from the local exact-name pair"
for p in "$B" "$CAND"; do sudo -n test ! -e "$p" || no "$p already exists"; done
sudo -n docker network inspect hatly-edge >/dev/null 2>&1 || no "network hatly-edge missing (Stage 2 not done)"
# NAME ISOLATION (2026-10-25): once Caddy joins hatly-edge, Docker DNS answers from BOTH networks. No container on hatly-edge may answer
# to a hostname the STAGING sites proxy to (e.g. `backend`, `dashboard` — Compose service names are DNS aliases on every network), or
# staging traffic would reach production. Only the two production apps may be on hatly-edge (plus Caddy itself once connected).
upstreams="$(head -c "$PB" "$F" | grep -oE 'reverse_proxy[[:space:]]+[A-Za-z0-9._-]+:[0-9]+' | awk '{print $2}' | cut -d: -f1 | sort -u | tr '\n' ' ')"
[ -n "$upstreams" ] || no "could not read the staging upstream hostnames"
for cid in $(sudo -n docker network inspect -f '{{range $id, $c := .Containers}}{{$id}} {{end}}' hatly-edge); do
  cname="$(sudo -n docker inspect -f '{{.Name}}' "$cid" | tr -d /)"
  case "$cname" in hatly-prod-backend-1|hatly-prod-dashboard-1|"$C") ;; *) no "unexpected container on hatly-edge: $cname";; esac
  [ "$cname" = "$C" ] && continue
  names=" $(sudo -n docker inspect -f '{{json (index .NetworkSettings.Networks "hatly-edge").DNSNames}}' "$cid" | tr -d '[]"' | tr ',' ' ') "
  for u in $upstreams; do case "$names" in *" $u "*) no "$cname answers to '$u' on hatly-edge — a staging upstream name (staging traffic would reach production)";; esac; done
done
echo "OK  hatly-edge name isolation: staging upstreams [${upstreams% }] resolve to no production container"
if sudo -n docker inspect -f '{{json .NetworkSettings.Networks}}' "$C" | grep -q '"hatly-edge"'; then echo "EDGE_STATE=connected"; else echo "EDGE_STATE=absent"; fi
sudo -n docker exec "$C" caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile >/dev/null 2>&1 || no "current config does not validate"
sudo -n docker exec "$C" wget -qO- http://127.0.0.1:2019/config/ >/dev/null 2>&1 || no "Caddy admin API unreachable"
echo "OK  Caddy reads $F (inode proved); both files = Stage 1 ($S1); staging part unchanged; certificate pair verified; no target path exists"
EOF
EDGE_STATE="$(sed -n 's/^EDGE_STATE=//p' "$L/remote-preflight.txt")"; [[ "$EDGE_STATE" == connected || "$EDGE_STATE" == absent ]] || fail "could not read the Caddy network state"
if [[ "$MODE" == preflight ]]; then log "PREFLIGHT PASSED — nothing was changed on the VPS. Caddy on hatly-edge: $EDGE_STATE. Backup path apply would use: $B"; exit 0; fi

# ======================================================================================================= APPLY
log "3. backup (creates $B)"
"${SSH[@]}" "bash -s -- $(q "$C" "$F" "$B")" <<'EOF' || fail "backup failed"
set -euo pipefail; C=$1 F=$2 B=$3
mkdir -m 700 "$B"; cp -p "$F" "$B/Caddyfile.stage1"; cmp -s "$F" "$B/Caddyfile.stage1"
sha256sum "$F" > "$B/stage1.sha256"; sudo -n docker exec "$C" wget -qO- http://127.0.0.1:2019/config/ > "$B/active-config.json"
echo "OK  backup at $B"
EOF

log "4. connect the shared Caddy to hatly-edge (no restart) and prove it reaches both production apps"
if [[ "$EDGE_STATE" == absent ]]; then EDGE_MADE=1; "${SSH[@]}" "sudo -n docker network connect hatly-edge $(q "$C")" || fail "network connect failed"; fi
"${SSH[@]}" "bash -s -- $(q "$C")" <<'EOF' || fail "Caddy cannot reach the production apps over hatly-edge"
set -euo pipefail; C=$1
sudo -n docker exec "$C" wget -qO- -T 5 http://hatly-prod-backend:3000/api/v1/health/ready | grep -q '"database":"up"' || { echo "backend unreachable from Caddy"; exit 1; }
sudo -n docker exec "$C" wget -qO /dev/null -T 5 http://hatly-prod-dashboard:3001/privacy || { echo "dashboard unreachable from Caddy"; exit 1; }
echo "OK  Caddy reaches hatly-prod-backend:3000 (ready) and hatly-prod-dashboard:3001 (/privacy)"
EOF

log "5. build + validate the candidate (live files untouched)"
"${SSH[@]}" "bash -s -- $(q "$C" "$F" "$B" "$CAND_DIR" "$PREFIX_BYTES" "$PREFIX_SHA16" "$BLOCK_B64")" <<'EOF' || fail "candidate check failed — live config untouched"
set -euo pipefail; C=$1 F=$2 B=$3 CAND=$4 PB=$5 PS=$6 B64=$7
( set -C; printf '%s' "$B64" | base64 -d > "$B/block3.caddy" )
( set -C; { head -c "$PB" "$B/Caddyfile.stage1"; cat "$B/block3.caddy"; } > "$B/Caddyfile.candidate" )
[ "$(head -c "$PB" "$B/Caddyfile.candidate" | sha256sum | cut -c1-16)" = "$PS" ] || { echo "candidate prefix is not the staging part"; exit 1; }
tail -c +"$((PB+1))" "$B/Caddyfile.candidate" | cmp -s - "$B/block3.caddy" || { echo "candidate tail is not exactly the Stage 3 block"; exit 1; }
sha256sum "$B/Caddyfile.candidate" > "$B/candidate.sha256"
sudo -n mkdir -m 700 -- "$CAND"; sudo -n install -m 600 -o root -g root "$B/Caddyfile.candidate" "$CAND/Caddyfile"
V="$B/validate.log"
sudo -n docker exec "$C" caddy validate --adapter caddyfile --config "/data/$(basename "$CAND")/Caddyfile" > "$V" 2>&1 || { cat "$V"; exit 1; }
[ "$(grep -cx 'Valid configuration' "$V")" = 1 ] || { echo "no single 'Valid configuration'"; exit 1; }
[ -z "$(grep -vx 'Valid configuration' "$V" | grep -v '^{"level":"' || true)" ] || { echo "unrecognised (non-JSON) validate output"; exit 1; }
! grep -qE '"level":"(error|panic|fatal)"' "$V" || { echo "validate logged an error"; exit 1; }
unknown="$(grep '^{' "$V" | grep -vE '"msg":"(using config from file|adapted config to JSON|started background certificate maintenance|stopped background certificate maintenance|stapling OCSP|skipping automatic certificate management because one or more matching certificates are already loaded|enabling automatic HTTP->HTTPS redirects|servers shutting down with eternal grace period|server is listening only on the HTTPS port but has no TLS connection policies; adding one to enable TLS)"' || true)"
[ -z "$unknown" ] || { echo "unrecognised validate messages:"; printf '%s\n' "$unknown" | cut -c1-240; exit 1; }
! grep -qF 'sales.hatly.dev' "$V" || { echo "validate output mentions a staging name"; exit 1; }
skipped="$(grep '"msg":"skipping automatic certificate management' "$V" | grep -oE '"domain":"[^"]+"' | sed 's/"domain":"//; s/"$//' | sort | tr '\n' ' ' | sed 's/ $//')"
[ "$(grep -c '"msg":"skipping automatic certificate management' "$V")" = 4 ] && [ "$skipped" = "admin.hatly.dev api.hatly.dev hatly.dev www.hatly.dev" ] \
  || { echo "certificate management would change for: '$skipped'"; exit 1; }
echo "OK  candidate = staging part + Stage 3 block; validated by the running Caddy; manual certificate still affects only the 4 production names"
EOF
"${SSH[@]}" "sudo -n docker exec $(q "$C") caddy adapt --adapter caddyfile --config /etc/caddy/Caddyfile 2>/dev/null" > "$L/adapt-now.json" || fail "could not adapt the live config"
"${SSH[@]}" "sudo -n docker exec $(q "$C") caddy adapt --adapter caddyfile --config $(q "/data/$(basename "$CAND_DIR")/Caddyfile") 2>/dev/null" > "$L/adapt-cand.json" || fail "could not adapt the candidate"
structural_check "$L/adapt-now.json" "$L/adapt-cand.json" "$BLOCK_FILE" || fail "structural check failed — live config untouched"

log "6. apply in place (live file + mirror) + reload (rollback armed from here)"
CHANGED=1
"${SSH[@]}" "bash -s -- $(q "$C" "$F" "$B" "$EXPECTED_INODE" "$F_TREE" "$TREE_INODE")" <<'EOF' || fail "apply/reload failed"
set -euo pipefail; C=$1 F=$2 B=$3 INODE=$4 FT=$5 TINODE=$6
want="$(cut -d' ' -f1 "$B/candidate.sha256")"
for pair in "$F:$INODE" "$FT:$TINODE"; do p="${pair%:*}" i="${pair##*:}"
  sudo -n sh -c "cat '$B/Caddyfile.candidate' > '$p'"
  [ "$(stat -c %i "$p")" = "$i" ] && [ "$(sha256sum "$p" | cut -d' ' -f1)" = "$want" ] || { echo "$p is not the candidate (or its inode changed)"; exit 1; }
done
[ "$(sudo -n docker exec "$C" sha256sum /etc/caddy/Caddyfile | cut -d' ' -f1)" = "$want" ] || { echo "container does not see the candidate"; exit 1; }
sudo -n docker exec "$C" caddy reload --adapter caddyfile --config /etc/caddy/Caddyfile --address 127.0.0.1:2019
echo "OK  applied to both files and reloaded"
EOF

log "7. post-change checks"
staging_check after || fail "staging differs from its baseline after the change"
remote_fingerprint > "$L/fp-after.txt"; diff -u "$L/fp-before.txt" "$L/fp-after.txt" || fail "a staging/production container or the port-3100 process changed"
echo "OK  no container restarted or recreated (Caddy reloaded only); port-3100 unchanged"
ok_or_retry() {   # $1 url, $2 expected code, $3 grep pattern ('' = none); Cloudflare may need a moment
  local c=""; for i in 1 2 3 4; do c="$(cf_get "$1")"; [[ "$c" == "$2" ]] && { [[ -z "$3" ]] || grep -q "$3" "$L/last.body"; } && return 0; sleep 4; done
  echo "  $1 -> $c"; return 1
}
ok_or_retry https://api.hatly.dev/api/v1/health/ready 200 '"database":"up"' || fail "API not ready through Cloudflare"
grep -q '"redis":"up"' "$L/last.body" || fail "API ready but redis not up"
ok_or_retry https://hatly.dev/privacy 200 'Amrrizk1111@gmail.com' || fail "/privacy not served with the approved contact"
! grep -q 'data-legal-draft' "$L/last.body" || fail "/privacy is still a draft"
grep -qi '^strict-transport-security:' "$L/last.hdr" || fail "dashboard response lacks HSTS"
ok_or_retry https://hatly.dev/account-deletion 200 '' || fail "/account-deletion not served"
ok_or_retry https://admin.hatly.dev/login 200 '' || fail "admin.hatly.dev/login not served"
ok_or_retry https://www.hatly.dev/privacy 200 '' || fail "www.hatly.dev not served"
echo "OK  through Cloudflare: API ready (db + redis), /privacy (final, approved contact, HSTS), /account-deletion, admin /login, www"
for h in $PROD_HOSTS; do   # direct to the origin, i.e. NOT from Cloudflare: must be refused
  c="$(curl -sS -k -m 20 --resolve "$h:443:$ORIGIN_IP" -o "$L/o.body" -w '%{http_code}' "https://$h/" 2>/dev/null || echo ERR)"
  [[ "$c" == 403 ]] && grep -q 'Forbidden' "$L/o.body" || fail "$h answered $c directly at the origin (expected 403 for non-Cloudflare peers)"
done
echo "OK  direct (non-Cloudflare) requests to the origin are refused with 403 for all four names"
# real client IP: the address Cloudflare sees for this Mac must be the address the backend logs for our deliberately unauthenticated probe
mine="$(curl -sS -m 10 https://hatly.dev/cdn-cgi/trace | sed -n 's/^ip=//p')"; since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
probe="$(cf_get https://api.hatly.dev/api/v1/addresses)"; [[ "$probe" == 401 ]] || fail "unauthenticated probe returned $probe (expected 401)"
sleep 2
seen="$("${SSH[@]}" "sudo -n docker logs --since $(q "$since") hatly-prod-backend-1 2>&1 | grep 'security.auth_failed' | grep -o '\"ip\":\"[^\"]*\"' | tail -1" </dev/null || true)"
[[ -n "$mine" && "$seen" == "\"ip\":\"$mine\"" || "$seen" == "\"ip\":\"::ffff:$mine\"" ]] || fail "backend logged ${seen:-no ip} for our probe, Cloudflare saw this client as ${mine:-unknown}"
echo "OK  the backend sees the real client IP (it logged the same address Cloudflare reports for this machine)"
(cd "$REPO" && bash scripts/launch/verify-public-pages.sh https://hatly.dev) > "$L/public-pages.txt" 2>&1 || { cat "$L/public-pages.txt"; fail "public-pages verification failed"; }
tail -2 "$L/public-pages.txt"
CHANGED=0; EDGE_MADE=0
log "STAGE 3 COMPLETE — production is live behind Cloudflare. Backup: $B · candidate: $CAND_DIR · live: $F · mirror: $F_TREE."

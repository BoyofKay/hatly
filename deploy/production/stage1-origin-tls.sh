#!/usr/bin/env bash
# Hatly production HTTPS — Stage 1 (TLS only; NO production services). Run from the Mac (bash 3.2 compatible):
# The Caddy admin API listens on 127.0.0.1:2019 ONLY (inside the container `localhost` resolves to ::1 first) — every admin call
# and every `caddy reload` addresses 127.0.0.1:2019 explicitly.
#   bash stage1.sh preflight   # READ-ONLY: local + remote permission/state checks; writes nothing on the VPS     (approval A)
#   bash stage1.sh apply       # repeats the preflight, then backup → cert install → candidate → apply → checks,
#                              # with automatic rollback of the Caddyfile on any failure after it changed         (approval B)
# Never prints key contents. Never touches Cloudflare/DNS, the production compose, migrations, secrets, the port-3100
# process, or any container (Caddy is RELOADED, never recreated).
set -Eeuo pipefail
MODE="${1:-}"; [[ "$MODE" == preflight || "$MODE" == apply ]] || { echo "usage: $0 preflight|apply"; exit 2; }

# ---------------------------------------------------------------------------------------------------- constants
H=ubuntu@152.228.240.4
ORIGIN_IP=152.228.240.4
# Origin certificate for EXACTLY the four production names — no wildcard: a `*.hatly.dev` certificate loaded into this shared Caddy also
# matches sales/api-sales, and Caddy then stops managing their Let's Encrypt certificates (Stage 1 apply 2, rolled back 2026-10-23).
CERT="$HOME/Downloads/origin-exact.pem"
KEY="$HOME/Downloads/origin-exact-key.pem"
EXPECTED_SANS="DNS:admin.hatly.dev DNS:api.hatly.dev DNS:hatly.dev DNS:www.hatly.dev"   # sorted; nothing more, nothing less
REPO=/Users/abdullahrezk/Downloads/hatly-current-mac-handoff/hatly
C=hatly-staging-caddy-1
# The Caddy container (started 2026-10-12) bind-mounts a single FILE. A bind mount follows the inode, not the path: when the checkout was
# renamed to hatly.pre-20261017 on 2026-10-17, the mount went with it. `docker inspect` still reports the original path string (now a NEW
# file, F_TREE), so the file Caddy really reads is F (proved in the preflight from /proc/self/mountinfo + device/inode of both sides).
F=/opt/hatly-staging/hatly.pre-20261017/deploy/staging/Caddyfile.staging   # the file the RUNNING container sees at /etc/caddy/Caddyfile
EXPECTED_INODE=1839134
F_TREE=/opt/hatly-staging/hatly/deploy/staging/Caddyfile.staging          # what docker inspect / the next `compose up` would mount
TREE_INODE=2438005
D=/var/lib/docker/volumes/hatly-staging_caddy_data/_data            # mounted read-write at /data
BACKUPS=/opt/hatly-staging/backups
EXPECTED_SHA16=318847d4683dcaf8                                     # both files hold this same content today
PROD_HOSTS="hatly.dev www.hatly.dev admin.hatly.dev api.hatly.dev"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
B="$BACKUPS/caddy-stage1-$TS"                                       # the ONE backup path, passed to every remote call
TLSDIR="$D/tls/hatly-origin-exact"                                  # = /data/tls/hatly-origin-exact in the container
TMPD="$D/tls/.hatly-origin-exact-incoming-$TS"                      # incoming certificate folder (renamed into place)
OLD_TLSDIR="$D/tls/hatly-origin"                                    # wildcard pair from the earlier runs: NEVER touched by this script
                                                                    # (its stat is part of the fingerprint that must stay identical)
CAND_DIR="$D/stage1-$TS"                                            # = /data/stage1-$TS in the container
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 "$H")
L="$(mktemp -d)"; chmod 700 "$L"
CHANGED=0        # 1 once the live Caddyfile (or its mirror) may differ from the backup
TMPD_MADE=0      # 1 while the incoming certificate folder may exist on the VPS
TLS_STATE=absent # set by the preflight: absent | present-verified (left by an earlier run of this script, hashes re-checked)
TLS_MADE=0       # 1 once THIS run may have created $TLSDIR — removed again on any failure (after the Caddyfiles are restored)

BLOCK=$'\n# --- PRODUCTION, Stage 1: TLS only (no production services yet) ---\nhatly.dev, www.hatly.dev, admin.hatly.dev, api.hatly.dev {\n\ttls /data/tls/hatly-origin-exact/origin.pem /data/tls/hatly-origin-exact/origin-key.pem\n\theader Cache-Control "no-store"\n\trespond "Hatly is coming soon." 503\n}\n'
BLOCK_B64="$(printf '%s' "$BLOCK" | base64 | tr -d '\n')"
q() { printf '%q ' "$@"; }                                          # safe quoting of remote arguments
log() { printf '\n== %s\n' "$*"; }

# ---------------------------------------------------------------------------------------------------- failure handling
cleanup_incoming() {   # never leaves the incoming certificate folder behind
  [[ "$TMPD_MADE" == 1 ]] || return 0
  "${SSH[@]}" "sudo -n rm -rf -- $(q "$TMPD")" && TMPD_MADE=0 && echo "incoming certificate folder removed" \
    || echo "WARNING: could not remove $TMPD on the VPS — remove it manually (root-only, mode 700)"
}

rollback() {
  log "ROLLBACK: restoring the original Caddyfile (live + mirror) from $B (in place, validated before reload)"
  if "${SSH[@]}" "bash -s -- $(q "$C" "$F" "$B" "$EXPECTED_INODE" "$F_TREE" "$TREE_INODE")" <<'EOF'
set -euo pipefail; C=$1 F=$2 B=$3 INODE=$4 FT=$5 TINODE=$6
test -f "$B/Caddyfile.staging.orig" || { echo "backup file missing: $B/Caddyfile.staging.orig"; exit 1; }
want="$(cut -d' ' -f1 "$B/orig.sha256")"
[ "$(sha256sum "$B/Caddyfile.staging.orig" | cut -d' ' -f1)" = "$want" ] || { echo "backup file does not match its recorded hash"; exit 1; }
for pair in "$F:$INODE" "$FT:$TINODE"; do                  # both files held the same original content
  p="${pair%:*}" i="${pair##*:}"
  [ "$(sha256sum "$p" | cut -d' ' -f1)" = "$want" ] && continue
  sudo -n sh -c "cat '$B/Caddyfile.staging.orig' > '$p'"
  [ "$(stat -c %i "$p")" = "$i" ] || { echo "inode changed during restore of $p"; exit 1; }
  [ "$(sha256sum "$p" | cut -d' ' -f1)" = "$want" ] || { echo "restored $p differs from the backup"; exit 1; }
done
[ "$(sudo -n docker exec "$C" sha256sum /etc/caddy/Caddyfile | cut -d' ' -f1)" = "$want" ] || { echo "container does not see the restored file"; exit 1; }
sudo -n docker exec "$C" caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile >/dev/null   # validate BEFORE reload
sudo -n docker exec "$C" caddy reload --adapter caddyfile --config /etc/caddy/Caddyfile --address 127.0.0.1:2019
echo "original Caddyfile restored, validated and reloaded"
EOF
  then
    CHANGED=0
    staging_check after-rollback && echo "staging matches its baseline after rollback" \
      || echo "WARNING: staging differs from its baseline after rollback — investigate (backup: $B)"
    remote_fingerprint > "$L/fingerprint-rollback.txt" 2>/dev/null && diff -u "$L/fingerprint-before.txt" "$L/fingerprint-rollback.txt" \
      && echo "staging containers, port-3100 process and the old wildcard folder identical after rollback" \
      || echo "WARNING: container/port-3100/old-folder fingerprint differs after rollback — investigate"
  else
    echo "ROLLBACK FAILED — manual action needed. The original Caddyfile is at $B/Caddyfile.staging.orig on the VPS."
  fi
}

fail() {
  # In a command substitution / subshell: only end that subshell — rollback runs exactly once, in the main shell.
  if (( BASH_SUBSHELL > 0 )); then exit 1; fi
  trap - ERR; trap "" INT TERM HUP     # the cleanup/rollback below must not itself be interrupted
  echo "STOP: $*" >&2
  cleanup_incoming
  if [[ "$CHANGED" == 1 ]]; then rollback; fi
  # certificate state: only once BOTH Caddyfiles are proven original (CHANGED back to 0) — never pull a certificate a live config might use
  if [[ "$CHANGED" == 0 ]]; then remove_new_tls; else echo "certificate folder $TLSDIR kept: the Caddyfiles are not proven restored"; fi
  exit 1
}

remove_new_tls() {   # undoes this run's certificate install; touches nothing it cannot prove it created
  [[ "$TLS_MADE" == 1 ]] || return 0
  log "ROLLBACK: removing the certificate folder this run installed ($TLSDIR)"
  "${SSH[@]}" "bash -s -- $(q "$TLSDIR" "$F" "$F_TREE" "$C" "$SHA_CERT" "$SHA_KEY")" <<'EOF' \
    && TLS_MADE=0 || echo "WARNING: $TLSDIR was NOT removed (see above) — it is root-only and unused; remove it after checking"
set -euo pipefail; T=$1 F=$2 FT=$3 C=$4 SC=$5 SK=$6
sudo -n test -e "$T" || { echo "nothing to remove ($T absent)"; exit 0; }
[ "$(sudo -n stat -c '%F %a %U %G' "$T")" = "directory 700 root root" ] || { echo "$T has unexpected type/permissions — not removing"; exit 1; }
[ "$(sudo -n ls -A "$T" | sort | tr '\n' ' ')" = "origin-key.pem origin.pem " ] || { echo "$T holds unexpected files — not removing"; exit 1; }
[ "$(sudo -n sha256sum "$T/origin.pem" | cut -d' ' -f1)" = "$SC" ] && [ "$(sudo -n sha256sum "$T/origin-key.pem" | cut -d' ' -f1)" = "$SK" ] \
  || { echo "$T is not this run's certificate pair — not removing"; exit 1; }
for f in "$F" "$FT"; do ! grep -qF "${T#*/_data}/" "$f" || { echo "$f still references the folder — not removing"; exit 1; }; done
! sudo -n docker exec "$C" wget -qO- http://127.0.0.1:2019/config/ | grep -qF "${T#*/_data}/" || { echo "the running config references the folder — not removing"; exit 1; }
sudo -n rm -rf -- "$T"; sudo -n test ! -e "$T" && echo "OK  removed $T — certificate state is back to before this run"
EOF
}
trap 'fail "unexpected error at line $LINENO"' ERR
trap 'fail "interrupted (signal) — cleaning up / rolling back"' INT TERM HUP   # Ctrl-C or a closed terminal still restores the Caddyfile
trap 'rm -rf "$L"' EXIT

# ---------------------------------------------------------------------------------------------------- local checks
local_tools() {
  log "0. local tools"
  for t in ssh openssl curl node python3 base64 shasum stat awk grep diff; do command -v "$t" >/dev/null || fail "local tool missing: $t"; done
  [[ -f "$REPO/deploy/staging/smoke.mjs" ]] || fail "smoke.mjs not found in the repository"
  echo "OK  local tools present"
}

local_cert_checks() {
  log "1. local certificate/key checks (key contents are never printed)"
  [[ -f "$CERT" && -f "$KEY" ]] || fail "certificate or key file missing"
  [[ "$(stat -f %Lp "$KEY")" == 600 ]] || fail "key file is not mode 600"
  openssl x509 -in "$CERT" -noout -checkend 2592000 >/dev/null || fail "certificate invalid or expiring within 30 days"
  local san; san="$(openssl x509 -in "$CERT" -noout -ext subjectAltName)"
  local sans; sans="$(grep -oE '(DNS|IP Address):[^, ]+' <<<"$san" | sort | tr '\n' ' ' | sed 's/ $//')"
  [[ "$sans" == "$EXPECTED_SANS" ]] || fail "certificate names must be exactly: $EXPECTED_SANS (found: ${sans:-none}) — no wildcard"
  openssl x509 -in "$CERT" -noout -issuer | grep -q 'CloudFlare Origin SSL' || fail "certificate is not issued by the Cloudflare Origin CA"
  openssl x509 -in "$CERT" -noout -subject | grep -q 'CloudFlare Origin Certificate' || fail "unexpected certificate subject (post-checks expect the Origin certificate subject)"
  [[ "$(openssl x509 -in "$CERT" -noout -sha256 -fingerprint | cut -d= -f2)" != "$(openssl x509 -in "$HOME/Downloads/origin.pem" -noout -sha256 -fingerprint 2>/dev/null | cut -d= -f2)" ]] \
    || fail "this is the old wildcard certificate"
  [[ "$(grep -c 'BEGIN CERTIFICATE' "$CERT" || true)" == 1 && "$(grep -c 'PRIVATE KEY' "$CERT" || true)" == 0 ]] || fail "unexpected certificate file contents"
  FP_CERT="$(openssl x509 -in "$CERT" -noout -pubkey | openssl pkey -pubin -pubout | openssl sha256 | awk '{print $NF}')"
  FP_KEY="$( (openssl pkey -in "$KEY" -passin pass: -pubout 2>/dev/null || true) | openssl sha256 | awk '{print $NF}')"
  EMPTY_FP="$(printf '' | openssl sha256 | awk '{print $NF}')"
  [[ -n "$FP_CERT" && "$FP_KEY" == "$FP_CERT" && "$FP_KEY" != "$EMPTY_FP" ]] || fail "private key does not match the certificate"
  SHA_CERT="$(shasum -a 256 "$CERT" | awk '{print $1}')"; SHA_KEY="$(shasum -a 256 "$KEY" | awk '{print $1}')"
  echo "OK  certificate names exactly hatly.dev, www, admin, api (no wildcard); key matches (public-key fingerprint ${FP_CERT:0:16}…)"
}

# ---------------------------------------------------------------------------------------------------- structural check (fail closed)
# The candidate's adapted JSON must equal the original's except for: one added route for exactly the four production hosts, one TLS
# connection policy pinning those SNI names to the loaded certificate (tag cert0) followed by the default policy, and a tls app loading
# exactly the one certificate pair. No staging name may appear in the tls app; auto-HTTPS settings, listeners and every other app/key
# must be identical. Any other difference — or any parse problem — fails.
structural_check() {   # $1 original JSON, $2 candidate JSON
  python3 - "$1" "$2" <<'PY'
import json, sys
PROD = sorted(["hatly.dev", "www.hatly.dev", "admin.hatly.dev", "api.hatly.dev"])
CERT = {"load_files": [{"certificate": "/data/tls/hatly-origin-exact/origin.pem", "key": "/data/tls/hatly-origin-exact/origin-key.pem", "tags": ["cert0"]}]}
def check(o, c):
    for k in set(o) | set(c):
        if k != "apps" and o.get(k) != c.get(k): return f"top-level key '{k}' differs"
    oa, ca = o.get("apps", {}), c.get("apps", {})
    for k in set(oa) | set(ca):
        if k not in ("http", "tls") and oa.get(k) != ca.get(k): return f"app '{k}' differs"
    if "tls" in oa: return "the original already has a tls app — unexpected"
    os_, cs = oa["http"]["servers"], ca["http"]["servers"]
    if set(os_) != set(cs) or len(cs) != 1: return f"servers differ: {sorted(os_)} vs {sorted(cs)}"
    name = next(iter(cs)); so, sc = os_[name], cs[name]
    for k in set(so) | set(sc):
        if k not in ("routes", "tls_connection_policies") and so.get(k) != sc.get(k): return f"server key '{k}' differs (e.g. automatic_https)"
    ro, rc = so.get("routes", []), sc.get("routes", [])
    if any(r not in rc for r in ro): return "an original route changed or disappeared"
    new = [r for r in rc if r not in ro]
    if len(new) != 1 or len(rc) != len(ro) + 1: return f"expected exactly one new route, got {len(new)}"
    hosts = [h for m in new[0].get("match", []) for h in m.get("host", [])]
    if sorted(hosts) != PROD or len(new[0].get("match", [])) != 1: return f"new route hosts unexpected: {hosts}"
    if so.get("tls_connection_policies") is not None: return "the original has explicit TLS connection policies — unexpected"
    pols = sc.get("tls_connection_policies") or []
    if len(pols) != 2 or pols[1] != {}: return f"connection policies unexpected: {pols}"
    p = pols[0]
    if set(p) != {"match", "certificate_selection"} or set(p["match"]) != {"sni"} or sorted(p["match"]["sni"]) != PROD \
       or p["certificate_selection"] != {"any_tag": ["cert0"]}: return f"production connection policy unexpected: {p}"
    t = ca.get("tls", {})
    if set(t) - {"certificates", "automation"}: return f"tls app has unexpected keys: {sorted(t)}"
    if t.get("certificates") != CERT: return f"loaded certificates unexpected: {t.get('certificates')}"
    for pol in (t.get("automation") or {}).get("policies", []):
        if not set(pol.get("subjects", [])) <= set(PROD) or set(pol) - {"subjects"}: return f"automation policy unexpected: {pol}"
    if "sales.hatly.dev" in json.dumps(t): return "a staging name appears in the tls app"
    return None
try:
    o, c = (json.load(open(f)) for f in sys.argv[1:3])
    err = check(o, c)
except Exception as e:
    err = f"could not parse/check the adapted JSON: {e!r}"
if err: print("STRUCTURE FAILED:", err); sys.exit(1)
print("OK  structure: original + one route for the 4 production hosts + SNI policy pinned to cert0 + one loaded pair; staging untouched")
PY
}

# ---------------------------------------------------------------------------------------------------- staging baseline
# Records EXACT observable staging behaviour; after the change it must be byte-identical.
staging_snapshot() {   # prints the snapshot; $1 = label (for the smoke log)
  local s loc a fp
  s="$(curl -sS -o /dev/null -m 20 -w '%{http_code}' https://sales.hatly.dev/ 2>/dev/null || echo ERR)"
  loc="$(curl -sS -o /dev/null -m 20 -w '%{redirect_url}' https://sales.hatly.dev/ 2>/dev/null || echo ERR)"
  a="$(curl -sS -o /dev/null -m 20 -w '%{http_code}' https://api-sales.hatly.dev/api/v1/health 2>/dev/null || echo ERR)"
  fp="$( (openssl s_client -servername sales.hatly.dev -connect sales.hatly.dev:443 </dev/null 2>/dev/null | openssl x509 -noout -fingerprint -sha256 -issuer 2>/dev/null) | tr '\n' ' ' || true)"
  local afp; afp="$( (openssl s_client -servername api-sales.hatly.dev -connect api-sales.hatly.dev:443 </dev/null 2>/dev/null | openssl x509 -noout -fingerprint -sha256 -issuer 2>/dev/null) | tr '\n' ' ' || true)"
  local smoke=FAILED
  (cd "$REPO" && node deploy/staging/smoke.mjs --read-only --api https://api-sales.hatly.dev/api/v1 --dashboard https://sales.hatly.dev) > "$L/smoke-$1.txt" 2>&1 && smoke=PASSED || true
  printf 'sales=%s location=%s api-sales-health=%s cert=%s api-sales-cert=%s smoke=%s\n' "$s" "$loc" "$a" "${fp:-NONE}" "${afp:-NONE}" "$smoke"
}

staging_check() {   # $1 = label; compares with the recorded baseline
  staging_snapshot "$1" > "$L/staging-$1.txt" || true
  if diff -u "$L/staging-baseline.txt" "$L/staging-$1.txt"; then echo "OK  staging identical to baseline ($1)"; return 0; fi
  echo "staging differs from baseline ($1) — smoke output tail:"; tail -15 "$L/smoke-$1.txt" 2>/dev/null || true
  return 1
}

remote_fingerprint() {   # staging containers + port-3100 process + the untouched wildcard folder; must be identical before and after
  "${SSH[@]}" "bash -s -- $(q "$OLD_TLSDIR")" <<'EOF'
set -euo pipefail; O=$1
# metadata only (inode, size, mode, owner, mtime, ctime) — any change, even chmod/chown, alters ctime; contents are never read or printed
if sudo -n test -e "$O"; then sudo -n find "$O" -maxdepth 1 -exec stat -c 'oldtls %n %F %i %s %a %U:%G %Y %Z' {} + | sort; else echo "oldtls absent"; fi   # root-only folder: list it as root
ids="$(sudo -n docker ps -aq --filter label=com.docker.compose.project=hatly-staging)"
[ -n "$ids" ] || { echo "no staging containers found"; exit 1; }
for c in $ids; do sudo -n docker inspect --format '{{.Name}} {{.Id}} {{.State.StartedAt}} restarts={{.RestartCount}} {{.State.Status}}' "$c"; done | sort
p="$(sudo -n ss -ltnp 2>/dev/null | grep ':3100 ' | grep -oE 'pid=[0-9]+' | head -1 || true)"
echo "port3100 ${p:-none}"
EOF
}

# ---------------------------------------------------------------------------------------------------- production classification
# ORIGIN layer  : TLS handshake to the VPS with SNI → ORIGIN_TLS_FAILED | WRONG_CERT:<subject> | ORIGIN_CERT_OK
#                 then HTTP over that TLS (no Cloudflare) → status + whether the body is our 503 text
# CLOUDFLARE    : request through Cloudflare → CF_ORIGIN_ERROR:<52x> | CF_INTENDED_503 | CF_503_OTHER_BODY | CF_OTHER:<code>
classify_origin() {   # $1 host
  local h=$1 subj code
  subj="$( (openssl s_client -servername "$h" -connect "$ORIGIN_IP:443" </dev/null 2>/dev/null | openssl x509 -noout -subject 2>/dev/null) || true)"
  if [[ -z "$subj" ]]; then echo "ORIGIN_TLS_FAILED"; return 0; fi
  grep -q 'CloudFlare Origin Certificate' <<<"$subj" || { echo "WRONG_CERT:${subj}"; return 0; }
  # -k only here: the Origin CA is trusted by Cloudflare, not by public clients; identity was just checked above
  code="$(curl -sS -k -m 20 --resolve "$h:443:$ORIGIN_IP" -o "$L/origin-$h.body" -D "$L/origin-$h.hdr" -w '%{http_code}' "https://$h/" 2>/dev/null || echo ERR)"
  if [[ "$code" == 503 ]] && grep -q 'Hatly is coming soon' "$L/origin-$h.body" && ! grep -qi '^server: cloudflare' "$L/origin-$h.hdr"; then echo "ORIGIN_CERT_OK ORIGIN_INTENDED_503"
  else echo "ORIGIN_CERT_OK ORIGIN_HTTP:$code"; fi
}
classify_cloudflare() {   # $1 host
  local h=$1 code
  code="$(curl -sS -m 20 -o "$L/cf-$h.body" -D "$L/cf-$h.hdr" -w '%{http_code}' "https://$h/" 2>/dev/null || echo ERR)"
  grep -qi '^server: cloudflare' "$L/cf-$h.hdr" 2>/dev/null || { echo "NOT_VIA_CLOUDFLARE:$code"; return 0; }
  case "$code" in
    52[0-9]) echo "CF_ORIGIN_ERROR:$code" ;;
    503) if grep -q 'Hatly is coming soon' "$L/cf-$h.body"; then echo "CF_INTENDED_503"; else echo "CF_503_OTHER_BODY"; fi ;;
    *) echo "CF_OTHER:$code" ;;
  esac
}

# ---------------------------------------------------------------------------------------------------- remote preflight (read-only)
remote_preflight() {
  log "2. remote permissions + state (read-only)"
  "${SSH[@]}" "bash -s -- $(q "$C" "$F" "$D" "$TLSDIR" "$TMPD" "$CAND_DIR" "$B" "$BACKUPS" "$EXPECTED_INODE" "$EXPECTED_SHA16" "$F_TREE" "$TREE_INODE" "$SHA_CERT" "$SHA_KEY")" <<'EOF' | tee "$L/remote-preflight.txt" || return 1
set -euo pipefail
C=$1 F=$2 D=$3 TLSDIR=$4 TMPD=$5 CAND=$6 B=$7 BACKUPS=$8 INODE=$9 SHA16=${10} FT=${11} TINODE=${12} SC=${13} SK=${14}
no() { echo "PREFLIGHT FAILED: $*"; exit 1; }
# permissions (non-destructive)
sudo -n true 2>/dev/null || no "sudo would prompt for a password"
sudo -n docker info >/dev/null 2>&1 || no "cannot run docker via sudo"
sudo -n docker exec "$C" true 2>/dev/null || no "cannot docker exec into $C"
[ -d "$BACKUPS" ] && [ -w "$BACKUPS" ] && [ -x "$BACKUPS" ] || no "$BACKUPS not writable by $(id -un)"
sudo -n test -d "$D" || no "$D missing"
sudo -n test -w "$F" || no "cannot write $F even with sudo"
sudo -n test -w "$FT" || no "cannot write $FT even with sudo"
for t in install mkdir mv rm cmp head tail base64 sha256sum stat openssl ss awk cut sort findmnt; do command -v "$t" >/dev/null || no "host tool missing: $t"; done
mv --help 2>/dev/null | grep -q -- '--no-target-directory' || no "mv lacks -T (GNU mv required)"
avail_kb="$(df -Pk / | awk 'NR==2{print $4}')"; [ "$avail_kb" -gt 102400 ] || no "less than 100 MB free on /"
# state exactly as inspected
[ "$(sudo -n docker inspect -f '{{.State.Running}}' "$C")" = true ] || no "Caddy is not running"
M="$(sudo -n docker inspect -f '{{range .Mounts}}{{.Source}}|{{.Destination}}|{{.RW}}{{"\n"}}{{end}}' "$C")"
grep -qx "$FT|/etc/caddy/Caddyfile|false" <<<"$M" || no "docker inspect Caddyfile mount differs from inspection"
grep -qx "$D|/data|true" <<<"$M" || no "/data mount differs from inspection"
# the file the container REALLY reads: mountinfo root path (host / is the same filesystem), then the same device AND inode on both sides
[ "$(findmnt -n -o SOURCE,TARGET / | tr -s ' ')" = "/dev/sda1 /" ] || no "host root filesystem differs from inspection"
mroot="$(sudo -n docker exec "$C" awk '$5=="/etc/caddy/Caddyfile"{print $4}' /proc/self/mountinfo)"
[ "$mroot" = "$F" ] || no "the container mounts '$mroot', not $F"
[ "$(sudo -n docker exec "$C" stat -c '%d %i' /etc/caddy/Caddyfile)" = "$(stat -c '%d %i' "$F")" ] || no "container file and $F are not the same device/inode"
[ "$(stat -c %i "$F")" = "$INODE" ] || no "live Caddyfile inode changed since inspection"
[ "$(stat -c %i "$FT")" = "$TINODE" ] || no "mirror Caddyfile inode changed since inspection"
[ "$(sha256sum "$F" | cut -c1-16)" = "$SHA16" ] || no "live Caddyfile content changed since inspection"
[ "$(sha256sum "$FT" | cut -c1-16)" = "$SHA16" ] || no "mirror Caddyfile content changed since inspection"
[ "$(sudo -n docker exec "$C" sha256sum /etc/caddy/Caddyfile | cut -c1-16)" = "$SHA16" ] || no "container sees a different Caddyfile"
for f in "$F" "$FT"; do if grep -qE '(^|[ ,])(www\.|admin\.)?hatly\.dev[ ,{]|^api\.hatly\.dev' "$f"; then no "a production block already exists in $f"; fi; done
for p in "$TMPD" "$CAND" "$B"; do sudo -n test ! -e "$p" || no "$p already exists (will not overwrite)"; done
# certificate folder: absent, or EXACTLY what an earlier run of this script installed (two files, hashes, 700/600 root:root) — else stop
if sudo -n test ! -e "$TLSDIR"; then echo "TLS_STATE=absent"
else
  [ "$(sudo -n stat -c '%F %a %U %G' "$TLSDIR")" = "directory 700 root root" ] || no "$TLSDIR exists with unexpected type/permissions"
  [ "$(sudo -n ls -A "$TLSDIR" | sort | tr '\n' ' ')" = "origin-key.pem origin.pem " ] || no "$TLSDIR holds unexpected files"
  for f in origin.pem origin-key.pem; do [ "$(sudo -n stat -c '%F %a %U %G' "$TLSDIR/$f")" = "regular file 600 root root" ] || no "$TLSDIR/$f permissions unexpected"; done
  [ "$(sudo -n sha256sum "$TLSDIR/origin.pem" | cut -d' ' -f1)" = "$SC" ] || no "installed certificate differs from the local one"
  [ "$(sudo -n sha256sum "$TLSDIR/origin-key.pem" | cut -d' ' -f1)" = "$SK" ] || no "installed key differs from the local one"
  echo "TLS_STATE=present-verified"
fi
sudo -n docker exec "$C" caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile >/dev/null 2>&1 || no "current config does not validate"
sudo -n docker exec "$C" wget -qO- http://127.0.0.1:2019/config/ >/dev/null 2>&1 || no "Caddy admin API unreachable inside the container"
echo "OK  permissions, tools and state as inspected; container reads $F (device/inode proved); no target path exists"
EOF
  TLS_STATE="$(sed -n 's/^TLS_STATE=//p' "$L/remote-preflight.txt")"
  [[ "$TLS_STATE" == absent || "$TLS_STATE" == present-verified ]] || fail "could not determine the certificate folder state"
}

# ======================================================================================================= RUN
local_tools
local_cert_checks
log "staging baseline"
staging_snapshot baseline > "$L/staging-baseline.txt" || true
cat "$L/staging-baseline.txt"
grep -q 'sales=307 ' "$L/staging-baseline.txt" && grep -q 'api-sales-health=200 ' "$L/staging-baseline.txt" && grep -q 'smoke=PASSED' "$L/staging-baseline.txt" \
  && [ "$(grep -o "O=Let's Encrypt" "$L/staging-baseline.txt" | wc -l | tr -d ' ')" = 2 ] || fail "staging is not healthy before the change (see baseline above)"
remote_preflight || fail "remote preflight failed"
remote_fingerprint > "$L/fingerprint-before.txt" || fail "could not record the staging fingerprint"
echo "staging container/port-3100 fingerprint recorded ($(wc -l < "$L/fingerprint-before.txt" | tr -d ' ') lines)"
log "production names, current state (expected before Stage 1: ORIGIN_TLS_FAILED + CF_ORIGIN_ERROR:525)"
for h in $PROD_HOSTS; do
  o="$(classify_origin "$h")"; c="$(classify_cloudflare "$h")"; echo "  $h: origin=$o cloudflare=$c"
  [[ "$o" == ORIGIN_TLS_FAILED && "$c" == CF_ORIGIN_ERROR:525 ]] || fail "$h is not in the inspected state — stop and review"
done
if [[ "$MODE" == preflight ]]; then log "PREFLIGHT PASSED — nothing was changed on the VPS. Backup path that apply would use: $B"; exit 0; fi

# ======================================================================================================= APPLY (approval B)
log "3. backup (creates $B)"
"${SSH[@]}" "bash -s -- $(q "$C" "$F" "$B" "$F_TREE")" <<'EOF' || fail "backup failed"
set -euo pipefail; C=$1 F=$2 B=$3 FT=$4
mkdir -m 700 "$B"                                     # fails if it already exists
cp -p "$F" "$B/Caddyfile.staging.orig"
cmp -s "$F" "$B/Caddyfile.staging.orig"
cmp -s "$FT" "$B/Caddyfile.staging.orig"              # the mirror holds the same original (preflight-proved; re-checked)
sha256sum "$F" > "$B/orig.sha256"; stat -c %i "$F" > "$B/orig.inode"; stat -c %i "$FT" > "$B/tree.inode"
sudo -n docker exec "$C" wget -qO- http://127.0.0.1:2019/config/ > "$B/active-config.json"
echo "OK  backup at $B"
EOF

if [[ "$TLS_STATE" == present-verified ]]; then
log "4. certificate + key: already installed at $TLSDIR by the earlier run — hashes, files and 700/600 root:root re-verified in the preflight; not re-uploaded"
else
log "4. install certificate + key (no-clobber, root-only, verified before activation)"
# $D/tls: created (root, 700) only if absent — an existing folder's owner/mode are never changed.
# TMPD_MADE is set BEFORE the call: the path carries this run's timestamp and the preflight proved it did not exist, so cleanup can never
# delete anything this run did not create, and a connection drop right after mkdir still gets cleaned up.
TMPD_MADE=1
"${SSH[@]}" "sudo -n test -d $(q "$D/tls") || sudo -n mkdir -m 700 -- $(q "$D/tls"); sudo -n mkdir -m 700 -- $(q "$TMPD")" || fail "could not create the incoming folder"
"${SSH[@]}" "sudo -n sh -c $(q "umask 077; set -C; cat > '$TMPD/origin.pem'")" < "$CERT" || fail "certificate upload failed"
"${SSH[@]}" "sudo -n sh -c $(q "umask 077; set -C; cat > '$TMPD/origin-key.pem'")" < "$KEY" || fail "key upload failed"
TLS_MADE=1   # set BEFORE the call (as TMPD_MADE): the path did not exist (preflight), so a failure from here removes only what this run made
"${SSH[@]}" "bash -s -- $(q "$TMPD" "$TLSDIR" "$SHA_CERT" "$SHA_KEY" "$FP_CERT")" <<'EOF' || fail "certificate verification/activation failed"
set -euo pipefail; T=$1 TLS=$2 SC=$3 SK=$4 FP=$5
[ "$(sudo -n sha256sum "$T/origin.pem" | cut -d' ' -f1)" = "$SC" ] || { echo "certificate hash mismatch"; exit 1; }
[ "$(sudo -n sha256sum "$T/origin-key.pem" | cut -d' ' -f1)" = "$SK" ] || { echo "key hash mismatch"; exit 1; }
kfp="$(sudo -n openssl pkey -in "$T/origin-key.pem" -pubout 2>/dev/null | openssl sha256 | awk '{print $NF}')"
cfp="$(sudo -n openssl x509 -in "$T/origin.pem" -noout -pubkey | openssl pkey -pubin -pubout | openssl sha256 | awk '{print $NF}')"
[ "$kfp" = "$FP" ] && [ "$cfp" = "$FP" ] || { echo "key/certificate mismatch on the host"; exit 1; }
sudo -n chown root:root "$T" "$T/origin.pem" "$T/origin-key.pem"
sudo -n chmod 700 "$T"; sudo -n chmod 600 "$T/origin.pem" "$T/origin-key.pem"
sudo -n test ! -e "$TLS" || { echo "$TLS appeared meanwhile — not overwriting"; exit 1; }
sudo -n mv -T -n -- "$T" "$TLS"                         # rename; never moves INTO an existing directory
sudo -n test ! -e "$T" || { echo "incoming folder still present after rename"; exit 1; }
[ "$(sudo -n stat -c '%a %U %G' "$TLS")" = "700 root root" ] || { echo "folder permissions wrong"; exit 1; }
for f in origin.pem origin-key.pem; do [ "$(sudo -n stat -c '%a %U %G' "$TLS/$f")" = "600 root root" ] || { echo "$f permissions wrong"; exit 1; }; done
[ "$(sudo -n ls -A "$TLS" | wc -l)" = 2 ] || { echo "unexpected files in $TLS"; exit 1; }
echo "OK  certificate + key installed at $TLS (hashes match, key matches, 700/600 root:root)"
EOF
TMPD_MADE=0
fi

log "5. build + validate the candidate (live file untouched)"
"${SSH[@]}" "bash -s -- $(q "$C" "$B" "$CAND_DIR" "$BLOCK_B64" "$(basename "$CAND_DIR")")" <<'EOF' || fail "candidate check failed — live config untouched"
set -euo pipefail; C=$1 B=$2 CAND=$3 B64=$4 CANDNAME=$5
( set -C; printf '%s' "$B64" | base64 -d > "$B/block.caddy" )
( set -C; cat "$B/Caddyfile.staging.orig" "$B/block.caddy" > "$B/Caddyfile.candidate" )
n=$(stat -c %s "$B/Caddyfile.staging.orig")
head -c "$n" "$B/Caddyfile.candidate" | cmp -s - "$B/Caddyfile.staging.orig" || { echo "candidate does not start with the original"; exit 1; }
tail -c +"$((n+1))" "$B/Caddyfile.candidate" | cmp -s - "$B/block.caddy" || { echo "candidate tail is not exactly the production block"; exit 1; }
grep -c 'hatly-origin-exact/origin' "$B/block.caddy" | grep -qx 1 || { echo "block content unexpected"; exit 1; }
sha256sum "$B/Caddyfile.candidate" > "$B/candidate.sha256"
sudo -n mkdir -m 700 -- "$CAND"                                     # fails if it exists
sudo -n install -m 600 -o root -g root "$B/Caddyfile.candidate" "$CAND/Caddyfile"
sudo -n docker exec "$C" caddy validate --adapter caddyfile --config "/data/$CANDNAME/Caddyfile" > "$B/validate.log" 2>&1 || { cat "$B/validate.log"; exit 1; }
# FAIL CLOSED: every line of the validate output must be understood, else stop before any live write.
# A manually loaded certificate makes Caddy stop managing EVERY name it matches; a staging name listed here would lose its Let's Encrypt
# certificate on reload (the cause of apply 2's rollback).
V="$B/validate.log"
[ "$(grep -cx 'Valid configuration' "$V")" = 1 ] || { echo "validate did not report exactly one 'Valid configuration'"; exit 1; }
[ -z "$(grep -vx 'Valid configuration' "$V" | grep -v '^{"level":"' || true)" ] || { echo "unrecognised (non-JSON) validate output — stopping"; exit 1; }
! grep -qE '"level":"(error|panic|fatal)"' "$V" || { echo "validate logged an error — stopping"; exit 1; }
unknown="$(grep '^{' "$V" | grep -vE '"msg":"(using config from file|adapted config to JSON|started background certificate maintenance|stopped background certificate maintenance|stapling OCSP|skipping automatic certificate management because one or more matching certificates are already loaded|enabling automatic HTTP->HTTPS redirects|servers shutting down with eternal grace period|server is listening only on the HTTPS port but has no TLS connection policies; adding one to enable TLS)"' || true)"
[ -z "$unknown" ] || { echo "unrecognised validate messages — stopping:"; printf '%s\n' "$unknown" | cut -c1-240; exit 1; }
! grep -qF 'sales.hatly.dev' "$V" || { echo "validate output mentions a staging name (sales/api-sales) — stopping"; exit 1; }
nskip="$(grep -c '"msg":"skipping automatic certificate management' "$V" || true)"
skipped="$(grep '"msg":"skipping automatic certificate management' "$V" | grep -oE '"domain":"[^"]+"' | sed 's/"domain":"//; s/"$//' | sort | tr '\n' ' ' | sed 's/ $//')"
[ "$nskip" = 4 ] && [ "$skipped" = "admin.hatly.dev api.hatly.dev hatly.dev www.hatly.dev" ] \
  || { echo "Caddy would stop managing certificates for: '${skipped}' (${nskip} lines) — only exactly the four production names are allowed"; exit 1; }
echo "OK  candidate = original + production block only; validated by the running Caddy (same /data, real cert paths)"
echo "OK  manual certificate affects only: $skipped (staging names keep Let's Encrypt)"
EOF

log "5b. structural check of the adapted configuration (original vs candidate; live file untouched)"
"${SSH[@]}" "sudo -n docker exec $(q "$C") caddy adapt --adapter caddyfile --config /etc/caddy/Caddyfile 2>/dev/null" > "$L/adapt-orig.json" \
  || fail "could not adapt the original configuration"
"${SSH[@]}" "sudo -n docker exec $(q "$C") caddy adapt --adapter caddyfile --config $(q "/data/$(basename "$CAND_DIR")/Caddyfile") 2>/dev/null" > "$L/adapt-cand.json" \
  || fail "could not adapt the candidate"
structural_check "$L/adapt-orig.json" "$L/adapt-cand.json" || fail "structural check failed — live config untouched"

log "6. apply in place (live file + mirror) + reload (rollback armed from here)"
CHANGED=1
"${SSH[@]}" "bash -s -- $(q "$C" "$F" "$B" "$EXPECTED_INODE" "$F_TREE" "$TREE_INODE")" <<'EOF' || fail "apply/reload failed"
set -euo pipefail; C=$1 F=$2 B=$3 INODE=$4 FT=$5 TINODE=$6
want="$(cut -d' ' -f1 "$B/candidate.sha256")"
sudo -n sh -c "cat '$B/Caddyfile.candidate' > '$F'"
[ "$(stat -c %i "$F")" = "$INODE" ] || { echo "inode changed"; exit 1; }
[ "$(sha256sum "$F" | cut -d' ' -f1)" = "$want" ] || { echo "host file is not the candidate"; exit 1; }
[ "$(sudo -n docker exec "$C" sha256sum /etc/caddy/Caddyfile | cut -d' ' -f1)" = "$want" ] || { echo "container does not see the candidate"; exit 1; }
# mirror: the file a future `compose up` of Caddy would mount — keeps the block across a container recreate (not read by Caddy now)
sudo -n sh -c "cat '$B/Caddyfile.candidate' > '$FT'"
[ "$(stat -c %i "$FT")" = "$TINODE" ] || { echo "mirror inode changed"; exit 1; }
[ "$(sha256sum "$FT" | cut -d' ' -f1)" = "$want" ] || { echo "mirror is not the candidate"; exit 1; }
sudo -n docker exec "$C" caddy reload --adapter caddyfile --config /etc/caddy/Caddyfile --address 127.0.0.1:2019
echo "OK  applied and reloaded"
EOF

log "7. post-change checks"
staging_check after || fail "staging differs from its baseline after the change"
remote_fingerprint > "$L/fingerprint-after.txt" || fail "could not record the staging fingerprint after"
diff -u "$L/fingerprint-before.txt" "$L/fingerprint-after.txt" || fail "staging containers or the port-3100 process changed"
echo "OK  staging containers and port-3100 process identical (Caddy reloaded, not recreated)"
for h in $PROD_HOSTS; do
  o="$(classify_origin "$h")"
  [[ "$o" == "ORIGIN_CERT_OK ORIGIN_INTENDED_503" ]] || fail "$h origin check: $o"
  c=""; for attempt in 1 2 3; do c="$(classify_cloudflare "$h")"; [[ "$c" == CF_INTENDED_503 ]] && break; sleep 5; done
  [[ "$c" == CF_INTENDED_503 ]] || fail "$h via Cloudflare: $c"
  echo "OK  $h: origin=$o cloudflare=$c"
done
CHANGED=0
TLS_MADE=0       # success: the new certificate stays installed; the old wildcard folder was never touched (fingerprint-checked)
log "STAGE 1 COMPLETE — backup: $B · certificate: $TLSDIR · candidate: $CAND_DIR · live: $F · mirror: $F_TREE. Production services not started; Cloudflare unchanged."

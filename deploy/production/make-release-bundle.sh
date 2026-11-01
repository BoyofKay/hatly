#!/usr/bin/env bash
# Builds the PRODUCTION source bundle on the Mac (bash 3.2 compatible) into a NEW folder, verifies it, and prints the release id.
#   bash deploy/production/make-release-bundle.sh [out-dir]     (default: ~/Library/Caches/hatly-releases/<release-id>/)
# Release id = <UTC timestamp>-<first 12 hex of the bundle's SHA-256>; prod.sh accepts only that shape.
# Refuses (and deletes the bundle) if it contains anything that must never leave the Mac: env files, keys/keystores/certificates, Firebase
# configs, node_modules, build output, macOS metadata (._*), or the mobile apps. Also requires what the production build needs.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
bundle="$work/hatly-prod-src.tar.gz"
COPYFILE_DISABLE=1 tar -czf "$bundle" \
  --exclude=node_modules --exclude=.git --exclude=.next --exclude='.next-*' --exclude=dist --exclude=.dart_tool --exclude=build \
  --exclude='.env' --exclude='.env.*' --exclude='*.keystore' --exclude='*.jks' --exclude=key.properties --exclude=local.properties \
  --exclude=google-services.json --exclude=GoogleService-Info.plist --exclude='*.p12' --exclude='*.p8' --exclude='*.pem' --exclude='*.key' \
  --exclude=apps/customer-app --exclude=apps/driver-app --exclude=apps/backend/uploads-storage --exclude=apps/backend/uploads \
  --exclude=apps/dashboard/test-results --exclude=apps/dashboard/playwright-report --exclude=apps/dashboard/e2e/.auth \
  --exclude=.DS_Store --exclude='._*' --exclude=Archive.zip --exclude='*.tsbuildinfo' --exclude=coverage --exclude=store --exclude=.claude --exclude=quarantine-trademark \
  -C "$REPO" .
list="$work/list.txt"; tar -tzf "$bundle" > "$list"
die() { echo "REFUSED: $*" >&2; exit 1; }
# --- must never be inside ---
bad="$(grep -E '(^|/)(\._[^/]*|\.env(\.[^/]*)?|key\.properties|local\.properties|google-services\.json|GoogleService-Info\.plist|[^/]*\.(keystore|jks|p12|p8|pem|key))$|(^|/)node_modules/|(^|/)\.next[^/]*/|(^|/)\.git/|(^|/)apps/(customer-app|driver-app)/' "$list" | grep -vE '(^|/)\.env\.(example|template)$|env\.(staging|production)\.template$' || true)"
[ -z "$bad" ] || { printf '%s\n' "$bad" | head -20 >&2; die "the bundle contains files that must not leave the Mac (above)"; }
# --- content scan for private-key material in text files (cheap, catches a key pasted into a doc) ---
mkdir "$work/x"; tar -xzf "$bundle" -C "$work/x"
hits="$(grep -rIl -- '-----BEGIN [A-Z ]*PRIVATE KEY-----' "$work/x" 2>/dev/null | sed "s|$work/x/||" | grep -Ev '^(\./)?(scripts/launch/test/|apps/backend/test/|apps/backend/src/.*\.spec\.ts$)' || true)"
[ -z "$hits" ] || { printf '%s\n' "$hits" >&2; die "private-key material found in the files above"; }
# --- must be inside ---
need=0; for f in deploy/staging/backend.Dockerfile deploy/staging/dashboard.Dockerfile deploy/production/docker-compose.production.yml \
  deploy/production/prod.sh deploy/production/init-production-env.sh deploy/production/env.production.template \
  deploy/production/backup-postgres.sh deploy/production/backup-uploads.sh deploy/production/restore-drill.sh \
  package.json package-lock.json apps/backend/package.json apps/dashboard/package.json apps/dashboard/postcss.config.js; do
  grep -qx "\./$f" "$list" || { echo "missing: $f" >&2; need=1; }
done
[ "$need" = 0 ] || die "required files missing"
mig="$(grep -cE '^\./apps/backend/src/database/migrations/[0-9]+-[A-Za-z0-9]+\.ts$' "$list")"
want="$(ls "$REPO"/apps/backend/src/database/migrations/*.ts | wc -l | tr -d ' ')"
[ "$mig" = "$want" ] || die "bundle has $mig migrations, the tree has $want"
sha="$(shasum -a 256 "$bundle" | cut -d' ' -f1)"; id="$ts-${sha:0:12}"
out="${1:-$HOME/Library/Caches/hatly-releases/$id}"
[ ! -e "$out" ] || die "$out already exists"
mkdir -p "$out"; chmod 700 "$out"
mv "$bundle" "$out/hatly-prod-src.tar.gz"; echo "$sha  hatly-prod-src.tar.gz" > "$out/hatly-prod-src.tar.gz.sha256"; echo "$id" > "$out/RELEASE"
echo "bundle OK: $out/hatly-prod-src.tar.gz  ($(wc -c < "$out/hatly-prod-src.tar.gz" | tr -d ' ') bytes, $(wc -l < "$list" | tr -d ' ') entries, $mig migrations)"
echo "release id: $id"

#!/usr/bin/env bash
# Builds ONE app's Android App Bundle for Google Play and then VERIFIES what came out, so a closed-test upload cannot go out debug-signed, aimed
# at the wrong backend, with a reused versionCode, debuggable, cleartext-enabled, backup-enabled, or carrying an advertising-ID permission.
# Local only: it never uploads, never contacts a server, never prints a secret (Gradle reads key.properties itself; this script only checks that
# its four fields exist and that the keystore lies OUTSIDE the repository).
#
#   scripts/launch/build-android-release.sh customer --api-url https://api-sales.hatly.dev/api/v1      # Staging pilot build (closed test while Production is not running)
#   scripts/launch/build-android-release.sh customer --api-url https://api.hatly.dev/api/v1            # Production build
#   scripts/launch/build-android-release.sh customer --api-url <url> --allow-debug-signed              # DRY RUN: debug key, NOT uploadable, never recorded
#   scripts/launch/build-android-release.sh record-upload customer closed-testing                      # after YOU uploaded it: records versionCode so the next build must be higher
#
# Only two API hosts are accepted (exact match): Staging https://api-sales.hatly.dev/api/v1 and Production https://api.hatly.dev/api/v1. A look-alike,
# a sub-domain, a different path or http:// is refused. The compiled app must contain the requested host, and a Production bundle must not contain
# the Staging host.
#
# The last lines name WHICH milestone this run reached — they are different things and are never conflated:
#   1 locally built and verified (dry run, debug key)   2 UPLOAD-SIGNED bundle built and verified   3 uploaded (only you can do it; `record-upload` notes it)
#   4 a test with eligible testers has started          5 eligibility to request production access   (4 and 5 live in the Play Console, not here)
#
# Public facts printed at the end: bundle path/size/SHA-256, package, versionCode/Name, SDK levels, permissions, and the SHA-1/SHA-256 fingerprints of the
# signing certificate (to register the Android app in Firebase and to restrict a Google Maps key). With Play App Signing Google re-signs what you
# upload with ITS key: register that key's fingerprints too (Play Console > Setup > App signing).
#
# Test seams (used by scripts/launch/test/build-android-release.test.sh, harmless otherwise): HATLY_JDK_BIN (directory holding keytool/jarsigner),
# HATLY_UPLOAD_LOG (path of the upload log), HATLY_REPO_ROOT (pretend repository root).
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="${HATLY_REPO_ROOT:-$(cd "$here/../.." && pwd)}"
log="${HATLY_UPLOAD_LOG:-$root/docs/launch/RELEASE_UPLOAD_LOG.tsv}"
PROD_API="https://api.hatly.dev/api/v1"; STAGING_API="https://api-sales.hatly.dev/api/v1"
PLAY_MIN_TARGET_SDK=36   # raise when Google raises it (each August)
fail=0
pass() { echo "PASS  $1"; }; bad() { echo "FAIL  $1"; fail=$((fail+1)); }; note() { echo "WARN  $1"; }

# --- JDK tools (the macOS /usr/bin/java stub is not a JDK; Flutter itself uses Android Studio's bundled one) ---------------------------------
find_jdk_bin() {
  if [ -n "${HATLY_JDK_BIN:-}" ]; then echo "$HATLY_JDK_BIN"; return; fi
  if /usr/bin/java -version >/dev/null 2>&1 && command -v keytool >/dev/null 2>&1; then dirname "$(command -v keytool)"; return; fi
  if [ -x "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool" ]; then echo "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin"; return; fi
  if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/keytool" ]; then echo "$JAVA_HOME/bin"; return; fi
}
need_jdk() { jdk_bin="$(find_jdk_bin)"; [ -n "$jdk_bin" ] && [ -x "$jdk_bin/keytool" ] || { echo "STOP: no JDK with keytool/jarsigner found (install Android Studio or set JAVA_HOME)"; exit 1; }; }

max_logged_code() { [ -f "$log" ] && awk -F'\t' -v a="$1" '$1==a && $3+0>m {m=$3+0} END{print m+0}' "$log" || echo 0; }

# --- record-upload: remember what was uploaded so the next build must carry a higher versionCode ------------------------------------------
if [ "${1:-}" = "record-upload" ]; then
  app="${2:-}"; track="${3:-}"
  case "$app" in customer|driver) ;; *) echo "usage: $0 record-upload <customer|driver> <internal-testing|closed-testing|production>" >&2; exit 2;; esac
  case "$track" in internal-testing|closed-testing|production) ;; *) echo "usage: $0 record-upload <customer|driver> <internal-testing|closed-testing|production>" >&2; exit 2;; esac
  need_jdk; d="$root/apps/$app-app"; aab="$d/build/app/outputs/bundle/release/app-release.aab"
  [ -f "$aab" ] || { echo "STOP: no bundle at $aab — build and verify it first"; exit 1; }
  "$jdk_bin/keytool" -printcert -jarfile "$aab" 2>/dev/null | grep -q "CN=Android Debug" && { echo "STOP: that bundle is debug-signed; nothing to record"; exit 1; }
  man="$(find "$d/build/app/intermediates" -path '*release*' -name AndroidManifest.xml 2>/dev/null | grep merged_manifest | head -1)"
  vc="$(grep -oE 'android:versionCode="[0-9]+"' "$man" | head -1 | cut -d'"' -f2)"; vn="$(grep -oE 'android:versionName="[^"]+"' "$man" | head -1 | cut -d'"' -f2)"
  [ -n "$vc" ] || { echo "STOP: cannot read the versionCode"; exit 1; }
  [ "$vc" -gt "$(max_logged_code "$app")" ] || { echo "STOP: versionCode $vc is already recorded for $app"; exit 1; }
  [ -f "$log" ] || printf 'app\tversion_name\tversion_code\tsha256\tdate_utc\ttrack\n' > "$log"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$app" "$vn" "$vc" "$(shasum -a 256 "$aab" | cut -d' ' -f1)" "$(date -u +%Y-%m-%dT%H:%MZ)" "$track" >> "$log"
  echo "recorded: $app $vn (versionCode $vc) -> $track  [$log]"; echo "The next build of $app must have a versionCode above $vc (bump the number after '+' in pubspec.yaml)."; exit 0
fi

app="${1:-}"; shift || true
api=""; allow_debug=0
while [ $# -gt 0 ]; do case "$1" in --api-url) api="${2:-}"; shift 2;; --allow-debug-signed) allow_debug=1; shift;; *) echo "unknown argument $1" >&2; exit 2;; esac; done
case "$app" in customer|driver) ;; *) echo "usage: $0 <customer|driver> --api-url <$STAGING_API | $PROD_API> [--allow-debug-signed]   |   $0 record-upload <app> <track>" >&2; exit 2;; esac
d="$root/apps/$app-app"
need_jdk

echo "== inputs"
case "$api" in
  "$STAGING_API") note "API is the STAGING host — right for a closed-test pilot while Production is not running; testers will create data on Staging";;
  "$PROD_API")    note "API is the PRODUCTION host — make sure Production is running and verified before testers install this";;
  "") bad "no --api-url";;
  *) bad "API URL '$api' is not one of the two accepted hosts ($STAGING_API, $PROD_API) — look-alikes, other paths and http:// are refused";;
esac

kp="$d/android/key.properties"; signed_ok=0; ks_problem=""
if [ -f "$kp" ]; then
  missing=""; for k in storeFile storePassword keyAlias keyPassword; do grep -Eq "^$k=.+" "$kp" || missing="$missing $k"; done
  sf="$(grep -E '^storeFile=' "$kp" | cut -d= -f2-)"
  case "$sf" in /*) f="$sf";; "") f="";; *) f="$d/android/app/$sf";; esac
  if [ -n "$missing" ]; then ks_problem="key.properties lacks:$missing"
  elif [ -z "$f" ] || [ ! -f "$f" ]; then ks_problem="key.properties names a keystore file that does not exist"
  else
    real="$(cd "$(dirname "$f")" 2>/dev/null && pwd -P)/$(basename "$f")"; reporoot="$(cd "$root" && pwd -P)"
    case "$real" in "$reporoot"/*) ks_problem="the keystore lies INSIDE the repository folder — move it outside (a zip, backup tool or git add would carry it)";; esac
    case "$f" in *debug*.keystore|*debug*.jks) ks_problem="the keystore is a debug keystore";; esac
  fi
  perm="$(stat -f '%Lp' "$kp" 2>/dev/null || stat -c '%a' "$kp" 2>/dev/null)"
  case "$perm" in *00|"") ;; *) note "key.properties is readable by other users (mode $perm) — run: chmod 600 apps/$app-app/android/key.properties";; esac
  if [ -z "$ks_problem" ]; then pass "android/key.properties is complete, the keystore exists and is outside the repository"; signed_ok=1; else bad "$ks_problem"; fi
fi
if [ "$signed_ok" = 0 ]; then
  if [ "$allow_debug" = 1 ]; then note "no usable release keystore — DRY RUN: the bundle will be DEBUG-signed, is NOT uploadable and will not be recorded"
  elif [ -z "$ks_problem" ]; then bad "android/key.properties is missing — no release keystore (docs/launch/RELEASE_SIGNING_AND_FIREBASE.md §A: scripts/launch/upload-keystore.sh create); --allow-debug-signed is for dry runs only"; fi
fi
[ "$allow_debug" = 1 ] && [ "$signed_ok" = 1 ] && note "--allow-debug-signed was given although a keystore exists; the keystore is still used (the flag only permits a debug signature, it does not force one)"
[ -f "$d/android/app/google-services.json" ] && pass "google-services.json present (push can work)" || note "google-services.json missing — the app builds and runs, push notifications stay OFF (add the file and rebuild with a higher versionCode to enable them)"

want_ver="$(grep -E '^version:' "$d/pubspec.yaml" | awk '{print $2}')"; want_code="${want_ver##*+}"
case "$want_ver" in [0-9]*.[0-9]*.[0-9]*+[1-9]*) ;; *) bad "pubspec version '$want_ver' is not MAJOR.MINOR.PATCH+BUILD";; esac
last="$(max_logged_code "$app")"
if [ "$allow_debug" = 0 ]; then
  if [ "${want_code:-0}" -le "$last" ] 2>/dev/null; then bad "versionCode $want_code was already uploaded for $app (log says up to $last) — bump it: edit pubspec.yaml to ${want_ver%+*}+$((last+1)) or higher"; else pass "versionCode $want_code is above the last recorded upload ($last)"; fi
fi
[ "$fail" -eq 0 ] || { echo; echo "STOP: $fail blocking input(s); nothing was built"; exit 1; }

# --- build: remove every artifact a previous run could have left, so only what THIS build produces can be verified -------------------------------
echo; echo "== build (flutter build appbundle --release)"
aab="$d/build/app/outputs/bundle/release/app-release.aab"
marker="$(mktemp)"; w="$(mktemp -d)"; trap 'rm -rf "$w" "$marker"' EXIT
rm -f "$aab"; rm -rf "$d/build/app/intermediates/merged_manifest"
buildlog="${TMPDIR:-/tmp}/hatly-$app-aab-build.log"
if ( cd "$d" && flutter build appbundle --release --dart-define=API_BASE_URL="$api" ) > "$buildlog" 2>&1; then pass "flutter build appbundle succeeded (log: $buildlog)"; else bad "build failed — see $buildlog"; echo; echo "$fail check(s) FAILED — no bundle to use"; exit 1; fi
[ -f "$aab" ] || { echo "STOP: the build reported success but produced no bundle"; exit 1; }
# `find -newer` (nanosecond mtimes) rather than bash `-nt` (whole seconds on macOS bash 3.2)
[ -n "$(find "$aab" -newer "$marker" 2>/dev/null)" ] && pass "the bundle was produced by this run" || bad "the bundle is not newer than the start of this run (stale artifact)"

echo; echo "== verify the bundle"
"$jdk_bin/jarsigner" -verify "$aab" >/dev/null 2>&1 && pass "bundle signature verifies" || bad "bundle signature does not verify"
cert="$("$jdk_bin/keytool" -printcert -jarfile "$aab" 2>/dev/null)"
debug_signed=0; printf '%s' "$cert" | grep -q "CN=Android Debug" && debug_signed=1
if [ "$debug_signed" = 1 ]; then
  if [ "$allow_debug" = 1 ]; then note "signed with the Android DEBUG key (dry run) — NOT uploadable"; else bad "signed with the Android DEBUG key — Google Play rejects it (a keystore was configured but the build did not use it?)"; fi
elif [ -z "$cert" ]; then bad "no signing certificate found in the bundle"
else pass "signed with a non-debug key"; fi

man="$(find "$d/build/app/intermediates" -path '*release*' -name AndroidManifest.xml 2>/dev/null | grep merged_manifest | head -1)"
if [ -z "$man" ] || [ ! -f "$man" ]; then bad "merged release manifest not regenerated by this build"; else
  [ -n "$(find "$man" -newer "$marker" 2>/dev/null)" ] && pass "merged manifest was regenerated by this build" || bad "merged manifest is older than this run (stale)"
  g() { grep -oE "$1" "$man" | head -1; }
  pkg="$(g 'package="[^"]+"' | cut -d'"' -f2)"; vc="$(g 'android:versionCode="[0-9]+"' | cut -d'"' -f2)"; vn="$(g 'android:versionName="[^"]+"' | cut -d'"' -f2)"
  mn="$(g 'android:minSdkVersion="[0-9]+"' | cut -d'"' -f2)"; tg="$(g 'android:targetSdkVersion="[0-9]+"' | cut -d'"' -f2)"
  want_pkg="$(grep -E 'applicationId *=' "$d/android/app/build.gradle.kts" | sed -E 's/.*"([^"]+)".*/\1/')"
  [ "$pkg" = "$want_pkg" ] && pass "package $pkg" || bad "package '$pkg' != '$want_pkg'"
  [ "$vn+$vc" = "$want_ver" ] && pass "version $vn (versionCode $vc) matches pubspec" || bad "version $vn+$vc != pubspec $want_ver"
  # Google Play: new apps and updates must target API 36 (Android 16) from 31 Aug 2026 (support.google.com/googleplay/android-developer/answer/11926878, read 2026-10-19)
  [ "${tg:-0}" -ge "$PLAY_MIN_TARGET_SDK" ] 2>/dev/null && pass "targetSdk $tg (Play requires >= $PLAY_MIN_TARGET_SDK), minSdk $mn" || bad "targetSdk '$tg' is below Google Play's requirement of $PLAY_MIN_TARGET_SDK for new apps — check the Play policy page"
  grep -q 'android:debuggable="true"' "$man" && bad "manifest is debuggable" || pass "not debuggable"
  grep -q 'android:usesCleartextTraffic="false"' "$man" && pass "cleartext traffic disabled" || bad "cleartext traffic is not disabled"
  grep -q 'android:allowBackup="false"' "$man" && pass "auto-backup disabled (sign-in tokens never reach a cloud backup)" || bad "android:allowBackup is not false — the stored tokens could be backed up"
  grep -q 'com.google.android.gms.permission.AD_ID' "$man" && bad "AD_ID permission present (the Play ads declaration says no advertising ID)" || pass "no AD_ID permission"
  echo "      permissions: $(grep -oE 'uses-permission android:name="[^"]+"' "$man" | cut -d'"' -f2 | sed 's/^android.permission.//' | sort -u | tr '\n' ' ')"
fi

# strings -> file first: with `pipefail`, `strings | grep -q` reports failure whenever grep exits early (SIGPIPE) even though it matched
host="$(printf '%s' "$api" | sed -E 's#^https://([^/]+).*#\1#')"
if unzip -q -o "$aab" 'base/lib/arm64-v8a/libapp.so' -d "$w" 2>/dev/null && strings -a "$w/base/lib/arm64-v8a/libapp.so" > "$w/app.strings" 2>/dev/null; then
  grep -qF -- "$host" "$w/app.strings" && pass "the compiled app contains the API host $host" || bad "the compiled app does not contain the API host $host"
  if [ "$api" = "$PROD_API" ]; then grep -qF -- "api-sales.hatly.dev" "$w/app.strings" && bad "a PRODUCTION bundle contains the Staging host" || pass "the production bundle does not contain the Staging host"; fi
  grep -qE 'https?://(localhost|127\.0\.0\.1|10\.0\.2\.2)' "$w/app.strings" && note "the compiled app also mentions a localhost-style URL (usually a dev default; confirm it is not the API base)"
else bad "could not read the compiled app (libapp.so) from the bundle"; fi
# nothing secret may ride inside the bundle
unzip -l "$aab" 2>/dev/null | grep -iE '\.(jks|keystore|p12|pfx|pem|p8)$|key\.properties|service[-_]?account' > "$w/leaks.txt"
[ -s "$w/leaks.txt" ] && bad "the bundle contains key/credential-like files: $(awk '{print $NF}' "$w/leaks.txt" | tr '\n' ' ')" || pass "no key, keystore or credential files inside the bundle"
if [ -f "$buildlog" ] && [ "$signed_ok" = 1 ]; then
  # the build log must not echo the signing passwords (compared in memory; nothing is printed)
  leaked=0; for k in storePassword keyPassword; do v="$(grep -E "^$k=" "$kp" | cut -d= -f2-)"; [ ${#v} -ge 4 ] && grep -qF -- "$v" "$buildlog" && leaked=1; done
  [ "$leaked" = 0 ] && pass "the build log does not contain the signing passwords" || bad "the build log contains a signing password — delete $buildlog and report it"
fi

echo; echo "== bundle (public facts only)"
echo "      file:   $aab"
echo "      size:   $(du -h "$aab" | cut -f1)    sha256: $(shasum -a 256 "$aab" | cut -d' ' -f1)"
echo "      signer: $(printf '%s' "$cert" | grep -m1 'Owner:' | sed 's/^Owner: //')"
printf '%s' "$cert" | grep -E '^\s*(SHA1|SHA256):' | sed 's/^ */      /'
echo
if [ "$fail" -gt 0 ]; then echo "RESULT: $fail check(s) FAILED — this bundle is NOT verified; do not upload it."; exit 1; fi
if [ "$debug_signed" = 1 ]; then
  echo "RESULT: milestone 1 only — LOCALLY BUILT AND VERIFIED, DEBUG-SIGNED (dry run). Not uploadable. No upload-signed bundle exists."
else
  echo "RESULT: milestone 2 — UPLOAD-SIGNED BUNDLE BUILT AND VERIFIED. Not uploaded (milestone 3 is yours: Play Console > Testing > Closed testing)."
  echo "        After you upload it, run: scripts/launch/build-android-release.sh record-upload $app closed-testing"
fi

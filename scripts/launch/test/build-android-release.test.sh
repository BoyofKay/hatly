#!/usr/bin/env bash
# Tests for scripts/launch/build-android-release.sh and release-preflight.sh --android-only.
# Runs the REAL scripts against a throw-away fake repository: a stub `flutter` that writes whatever bundle/manifest each case asks for, and stub
# `keytool`/`jarsigner` that report whatever signer each case asks for. NO real key is created or read, nothing is built for real, nothing is
# uploaded, and no network is used. The "properly signed" path is therefore exercised with a stub certificate; it proves the script's decisions,
# not that a real keystore works (that is the owner's first real run, see docs/launch/RELEASE_SIGNING_AND_FIREBASE.md).
#   scripts/launch/test/build-android-release.test.sh        (exit 0 = every case behaved as required)
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; SCRIPT="$here/../build-android-release.sh"; PREFLIGHT="$here/../release-preflight.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
STAGING="https://api-sales.hatly.dev/api/v1"; PROD="https://api.hatly.dev/api/v1"; SECRET="Sup3r-Secret-Pass-123"
passed=0; failed=0

# ---- stubs ------------------------------------------------------------------------------------------------------------------------------
mkdir -p "$T/stubs/jdk"
cat > "$T/stubs/flutter" <<'EOF'
#!/usr/bin/env bash
# stub flutter: records the call, optionally fails / prints the signing password, then writes the bundle + merged manifest the case asked for
echo "$*" >> "$FAKE_CALLS"
[ -n "${FAKE_ECHO_PASSWORD:-}" ] && echo "signing with storePassword=$FAKE_ECHO_PASSWORD"
[ "${FAKE_FLUTTER_FAIL:-0}" = 1 ] && { echo "Gradle task failed"; exit 1; }
[ "${FAKE_NO_AAB:-0}" = 1 ] && exit 0
python3 - <<'PY'
import os, zipfile
e = os.environ.get
host = e("FAKE_HOST", "api-sales.hatly.dev")
d = "build/app/outputs/bundle/release"; os.makedirs(d, exist_ok=True)
with zipfile.ZipFile(d + "/app-release.aab", "w") as z:
    z.writestr("base/lib/arm64-v8a/libapp.so", b"\0\0\0padding https://%s/api/v1 more-text-here\0" % host.encode() + (b" https://api-sales.hatly.dev/api/v1 " if e("FAKE_EXTRA_STAGING") else b""))
    z.writestr("base/dex/classes.dex", b"dex")
    if e("FAKE_LEAK"): z.writestr(e("FAKE_LEAK"), b"secret")
m = "build/app/intermediates/merged_manifest/release/outputReleaseAppLinkSettings"; os.makedirs(m, exist_ok=True)
perm = '<uses-permission android:name="android.permission.INTERNET" />\n' + ('<uses-permission android:name="com.google.android.gms.permission.AD_ID" />\n' if e("FAKE_AD_ID") else "")
app = ' android:usesCleartextTraffic="%s"' % e("FAKE_CLEARTEXT", "false") + ('' if e("FAKE_NO_BACKUP_ATTR") else ' android:allowBackup="%s"' % e("FAKE_ALLOW_BACKUP", "false")) + (' android:debuggable="true"' if e("FAKE_DEBUGGABLE") else '')
open(m + "/AndroidManifest.xml", "w").write(
  '<manifest package="%s" android:versionCode="%s" android:versionName="%s">\n<uses-sdk android:minSdkVersion="24" android:targetSdkVersion="%s" />\n%s<application%s>\n</application></manifest>\n'
  % (e("FAKE_PACKAGE", "dev.hatly.customer"), e("FAKE_VERSION_CODE", e("FAKE_PUBSPEC_CODE", "1")), e("FAKE_VERSION_NAME", "1.0.0"), e("FAKE_TARGET_SDK", "36"), perm, app))
PY
EOF
cat > "$T/stubs/jdk/keytool" <<'EOF'
#!/usr/bin/env bash
# stub keytool: -printcert (signer of a bundle) / -genkeypair (creates the file, records argv and whether the password env var was set) / -list (keystore details)
echo "$*" >> "${FAKE_KT_ARGV:-/dev/null}"
case "$*" in
  *-printcert*) [ "${FAKE_NO_CERT:-0}" = 1 ] && exit 0
    printf 'Owner: %s\nSignature algorithm name: SHA256withRSA\nCertificate fingerprints:\n\t SHA1: AA:BB:CC\n\t SHA256: 11:22:33\n' "${FAKE_SIGNER:-CN=Hatly Upload, O=Hatly, C=EG}";;
  *-genkeypair*) [ -n "${HATLY_KS_PASS:-}" ] || { echo "no password in env" >&2; exit 1; }
    [ "${FAKE_KT_GEN_FAIL:-0}" = 1 ] && exit 1
    ks=""; prev=""; for a in "$@"; do [ "$prev" = "-keystore" ] && ks="$a"; prev="$a"; done; echo fake-keystore > "$ks"; echo "Generating 2,048 bit RSA key pair";;
  *-list*) [ "${FAKE_KT_WRONG_PASS:-0}" = 1 ] && { echo "keytool error: java.io.IOException: keystore password was incorrect"; exit 1; }
    printf 'Alias name: %s\nOwner: %s\nValid from: Mon Oct 19 19:00:00 EEST 2026 until: %s\nCertificate fingerprints:\n\t SHA1: AA:BB\n\t SHA256: DE:AD:BE:EF\nSubject Public Key Algorithm: %s-bit RSA key\n' "hatly-upload" "${FAKE_LIST_OWNER:-CN=Hatly Upload}" "${FAKE_LIST_UNTIL:-Fri Mar 06 19:00:00 EET 2054}" "${FAKE_LIST_BITS:-2048}";;
esac
EOF
cat > "$T/stubs/jdk/jarsigner" <<'EOF'
#!/usr/bin/env bash
[ "${FAKE_JARSIGNER_FAIL:-0}" = 1 ] && exit 1; echo "jar verified."
EOF
chmod +x "$T/stubs/flutter" "$T/stubs/jdk/keytool" "$T/stubs/jdk/jarsigner"

# ---- a fresh fake repository per case -----------------------------------------------------------------------------------------------------
new_repo() {   # new_repo <pubspec build number> [keyprops: none|ok|missing-field|bad-keystore|in-repo]
  R="$T/case-$RANDOM$RANDOM"; mkdir -p "$R/repo/apps/customer-app/android/app" "$R/repo/docs/launch" "$R/outside"
  printf 'name: customer_app\nversion: 1.0.0+%s\n' "$1" > "$R/repo/apps/customer-app/pubspec.yaml"
  printf 'android {\n  namespace = "com.hatly.customer"\n  defaultConfig { applicationId = "dev.hatly.customer" }\n}\n' > "$R/repo/apps/customer-app/android/app/build.gradle.kts"
  KP="$R/repo/apps/customer-app/android/key.properties"; : > "$R/calls"
  case "${2:-none}" in
    none) ;;
    ok) echo fake-keystore-bytes > "$R/outside/upload.jks"; printf 'storeFile=%s\nstorePassword=%s\nkeyAlias=upload\nkeyPassword=%s\n' "$R/outside/upload.jks" "$SECRET" "$SECRET" > "$KP"; chmod 600 "$KP";;
    missing-field) echo x > "$R/outside/upload.jks"; printf 'storeFile=%s\nkeyAlias=upload\nkeyPassword=%s\n' "$R/outside/upload.jks" "$SECRET" > "$KP";;
    bad-keystore) printf 'storeFile=%s/nope.jks\nstorePassword=%s\nkeyAlias=upload\nkeyPassword=%s\n' "$R/outside" "$SECRET" "$SECRET" > "$KP";;
    in-repo) echo x > "$R/repo/apps/customer-app/android/app/upload.jks"; printf 'storeFile=%s/repo/apps/customer-app/android/app/upload.jks\nstorePassword=%s\nkeyAlias=upload\nkeyPassword=%s\n' "$R" "$SECRET" "$SECRET" > "$KP";;
  esac
}
run() {   # run <args…>   (env vars in the caller's environment are the case's FAKE_* settings) → sets OUT and CODE
  OUT="$(HATLY_REPO_ROOT="$R/repo" HATLY_JDK_BIN="$T/stubs/jdk" FAKE_CALLS="$R/calls" TMPDIR="$R" PATH="$T/stubs:$PATH" bash "$SCRIPT" "$@" 2>&1)"; CODE=$?
}
expect() {   # expect <label> <exit code> <text that must appear> [text that must NOT appear]
  local ok=1; [ "$CODE" = "$2" ] || ok=0; printf '%s' "$OUT" | grep -qF -- "$3" || ok=0
  [ -n "${4:-}" ] && printf '%s' "$OUT" | grep -qF -- "$4" && ok=0
  if [ "$ok" = 1 ]; then passed=$((passed+1)); echo "ok    $1"; else failed=$((failed+1)); echo "FAIL  $1   (exit $CODE, wanted $2; wanted text: '$3'${4:+; forbidden: '$4'})"; printf '%s\n' "$OUT" | sed 's/^/        | /' | tail -12; fi
}
flutter_calls() { wc -l < "$R/calls" | tr -d ' '; }
no_flutter() { if [ "$(flutter_calls)" = 0 ]; then passed=$((passed+1)); echo "ok    $1 (nothing was built)"; else failed=$((failed+1)); echo "FAIL  $1 — flutter was invoked"; fi; }

echo "== refusals before anything is built"
new_repo 1 none;          run customer --api-url "$STAGING";                         expect "no key.properties and no dry-run flag is refused" 1 "key.properties is missing"; no_flutter "  "
new_repo 1 missing-field; run customer --api-url "$STAGING" --allow-debug-signed;    expect "malformed key.properties (no storePassword) is refused even for a dry run" 1 "lacks: storePassword"; no_flutter "  "
new_repo 1 bad-keystore;  run customer --api-url "$STAGING";                         expect "key.properties naming a missing keystore is refused" 1 "does not exist"; no_flutter "  "
new_repo 1 in-repo;       run customer --api-url "$STAGING";                         expect "a keystore inside the repository is refused" 1 "INSIDE the repository"; no_flutter "  "
for bad in "" "http://api-sales.hatly.dev/api/v1" "https://api.hatly.dev.evil.example/api/v1" "https://api-sales.hatly.dev@evil.example/api/v1" "https://api-sales.hatly.dev/api/v2" "https://api.hatly.dev/api/v1/" "https://staging.hatly.dev/api/v1" "https://10.0.2.2:3000/api/v1"; do
  new_repo 1 ok; run customer ${bad:+--api-url "$bad"};                              expect "API URL '${bad:-<none>}' is refused" 1 "FAIL"; no_flutter "  "
done
new_repo 1 ok; run admin --api-url "$STAGING";                                       expect "an unknown app is refused" 2 "usage:"

echo "== a correctly signed bundle (stub certificate)"
new_repo 1 ok; run customer --api-url "$STAGING"
expect "valid Staging pilot build is verified as milestone 2" 0 "milestone 2 — UPLOAD-SIGNED BUNDLE BUILT AND VERIFIED" "$SECRET"
expect "  … and says it is NOT uploaded" 0 "Not uploaded"
new_repo 1 ok; FAKE_HOST=api.hatly.dev run customer --api-url "$PROD"
expect "valid Production build (no Staging host inside) passes" 0 "the production bundle does not contain the Staging host"

echo "== dry run"
new_repo 1 none; FAKE_SIGNER="C=US, O=Android, CN=Android Debug" run customer --api-url "$STAGING" --allow-debug-signed
expect "dry run succeeds but is only milestone 1" 0 "milestone 1 only"; expect "  … and says nothing is uploadable" 0 "Not uploadable" "milestone 2"

echo "== signature problems"
new_repo 1 ok; FAKE_SIGNER="C=US, O=Android, CN=Android Debug" run customer --api-url "$STAGING"
expect "a keystore is configured but the bundle came out debug-signed → failure" 1 "signed with the Android DEBUG key" "milestone 2"
new_repo 1 ok; FAKE_JARSIGNER_FAIL=1 run customer --api-url "$STAGING";  expect "a signature that does not verify → failure" 1 "bundle signature does not verify" "milestone 2"
new_repo 1 ok; FAKE_NO_CERT=1 run customer --api-url "$STAGING";          expect "no certificate in the bundle → failure" 1 "no signing certificate"

echo "== wrong content"
new_repo 1 ok; FAKE_HOST=api.hatly.dev run customer --api-url "$STAGING";               expect "Staging requested but the app was built for another host" 1 "does not contain the API host api-sales.hatly.dev"
new_repo 1 ok; FAKE_HOST=api.hatly.dev FAKE_EXTRA_STAGING=1 run customer --api-url "$PROD"; expect "Production bundle carrying the Staging host is refused" 1 "PRODUCTION bundle contains the Staging host"
new_repo 1 ok; FAKE_DEBUGGABLE=1 run customer --api-url "$STAGING";                      expect "debuggable manifest" 1 "manifest is debuggable"
new_repo 1 ok; FAKE_CLEARTEXT=true run customer --api-url "$STAGING";                    expect "cleartext enabled" 1 "cleartext traffic is not disabled"
new_repo 1 ok; FAKE_NO_BACKUP_ATTR=1 run customer --api-url "$STAGING";                  expect "auto-backup not disabled (attribute missing)" 1 "allowBackup is not false"
new_repo 1 ok; FAKE_ALLOW_BACKUP=true run customer --api-url "$STAGING";                 expect "auto-backup enabled" 1 "allowBackup is not false"
new_repo 1 ok; FAKE_AD_ID=1 run customer --api-url "$STAGING";                           expect "advertising-ID permission" 1 "AD_ID permission present"
new_repo 1 ok; FAKE_TARGET_SDK=33 run customer --api-url "$STAGING";                     expect "target SDK too low" 1 "targetSdk '33'"
new_repo 1 ok; FAKE_TARGET_SDK=35 run customer --api-url "$STAGING";                     expect "target SDK 35 is no longer enough for a new app (Play requires 36 since 31 Aug 2026)" 1 "targetSdk '35'"
new_repo 1 ok; FAKE_PACKAGE=com.example.other run customer --api-url "$STAGING";         expect "wrong package" 1 "package 'com.example.other'"
new_repo 1 ok; FAKE_PACKAGE=com.hatly.customer run customer --api-url "$STAGING";          expect "the OLD id / the namespace is not accepted as the application id" 1 "package 'com.hatly.customer' != 'dev.hatly.customer'"
new_repo 1 ok; FAKE_VERSION_CODE=7 run customer --api-url "$STAGING";                    expect "bundle versionCode differs from pubspec" 1 "!= pubspec 1.0.0+1"
new_repo 1 ok; FAKE_LEAK=base/res/upload.jks run customer --api-url "$STAGING";          expect "keystore file inside the bundle" 1 "key/credential-like files"
new_repo 1 ok; FAKE_ECHO_PASSWORD="$SECRET" run customer --api-url "$STAGING";           expect "signing password echoed into the build log → failure, never printed" 1 "contains a signing password" "$SECRET"

echo "== a failed or stale build can never be reported as success"
new_repo 1 ok; FAKE_FLUTTER_FAIL=1 run customer --api-url "$STAGING";                    expect "flutter build fails" 1 "build failed" "milestone"
new_repo 1 ok; mkdir -p "$R/repo/apps/customer-app/build/app/outputs/bundle/release" && echo stale > "$R/repo/apps/customer-app/build/app/outputs/bundle/release/app-release.aab"
FAKE_NO_AAB=1 run customer --api-url "$STAGING";                                          expect "a stale bundle from an earlier run is not accepted when the build produced none" 1 "produced no bundle" "milestone"

echo "== version codes"
new_repo 1 ok; printf 'app\tversion_name\tversion_code\tsha256\tdate_utc\ttrack\ncustomer\t1.0.0\t1\tabc\t2026-10-20T10:00Z\tclosed-testing\n' > "$R/repo/docs/launch/RELEASE_UPLOAD_LOG.tsv"
run customer --api-url "$STAGING";                                                        expect "re-using an already uploaded versionCode is refused" 1 "already uploaded"; no_flutter "  "
new_repo 2 ok; printf 'app\tversion_name\tversion_code\tsha256\tdate_utc\ttrack\ncustomer\t1.0.0\t1\tabc\t2026-10-20T10:00Z\tclosed-testing\n' > "$R/repo/docs/launch/RELEASE_UPLOAD_LOG.tsv"
FAKE_PUBSPEC_CODE=2 run customer --api-url "$STAGING";                                    expect "a higher versionCode passes" 0 "milestone 2"
new_repo 5 ok; printf 'app\tversion_name\tversion_code\tsha256\tdate_utc\ttrack\ndriver\t1.0.0\t9\tabc\t2026-10-20T10:00Z\tclosed-testing\n' > "$R/repo/docs/launch/RELEASE_UPLOAD_LOG.tsv"
FAKE_PUBSPEC_CODE=5 run customer --api-url "$STAGING";                                    expect "another app's uploads do not block this app" 0 "milestone 2"

echo "== record-upload"
new_repo 1 ok; run customer --api-url "$STAGING"; run record-upload customer closed-testing
expect "a verified upload-signed bundle is recorded" 0 "recorded: customer 1.0.0 (versionCode 1)"; run record-upload customer closed-testing
expect "recording the same versionCode twice is refused" 1 "already recorded"
new_repo 1 none; FAKE_SIGNER="C=US, O=Android, CN=Android Debug" run customer --api-url "$STAGING" --allow-debug-signed >/dev/null; FAKE_SIGNER="C=US, O=Android, CN=Android Debug" run record-upload customer closed-testing
expect "a debug-signed bundle can never be recorded as uploaded" 1 "debug-signed"

echo "== preflight --android-only"
OUT="$(bash "$PREFLIGHT" --android-only ../x --api-url "$STAGING" 2>&1)"; CODE=$?; expect "an invalid scope is refused" 2 "takes customer or driver"
OUT="$(bash "$PREFLIGHT" --android-only customer --api-url "$STAGING" 2>&1)"; CODE=$?
printf '%s' "$OUT" | grep -q "== driver app" && { failed=$((failed+1)); echo "FAIL  the Android-only preflight also checked the driver app"; } || { passed=$((passed+1)); echo "ok    the Android-only preflight checks only the requested app"; }
printf '%s' "$OUT" | grep -q -- "-- iOS" && { failed=$((failed+1)); echo "FAIL  the Android-only preflight also checked iOS"; } || { passed=$((passed+1)); echo "ok    the Android-only preflight skips iOS"; }

echo "== upload-keystore.sh"
KS="$(dirname "$SCRIPT")/upload-keystore.sh"
kst() {   # kst <stdin passwords> <args…>  → OUT/CODE (creates a fake repo; HOME points into the case dir so ~/hatly-secrets stays inside the sandbox)
  new_repo 1 none; local pw="$1"; shift
  OUT="$(printf '%s' "$pw" | HATLY_TEST_STDIN_PASSWORDS=1 HOME="$R/home" HATLY_REPO_ROOT="$R/repo" HATLY_JDK_BIN="$T/stubs/jdk" FAKE_KT_ARGV="$R/kt-argv" bash "$KS" "$@" 2>&1)"; CODE=$?
}
GOOD="$(printf 'correct-horse-9\ncorrect-horse-9\n')"
kst "$GOOD" create customer --keystore "x/relative.jks"
expect "create refuses a relative keystore path" 1 "absolute path"
new_repo 1 none; KSP="$R/repo/apps/customer-app/up.jks"
OUT="$(printf '%s' "$GOOD" | HATLY_TEST_STDIN_PASSWORDS=1 HATLY_REPO_ROOT="$R/repo" HATLY_JDK_BIN="$T/stubs/jdk" bash "$KS" create customer --keystore "$KSP" 2>&1)"; CODE=$?
expect "create refuses a path inside the repository" 1 "inside the repository"
[ -e "$R/repo/apps/customer-app/up.jks" ] && { failed=$((failed+1)); echo "FAIL  a keystore appeared inside the repository"; } || { passed=$((passed+1)); echo "ok    …and created nothing there"; }
new_repo 1 none; echo x > "$R/outside/exists.jks"
OUT="$(printf '%s' "$GOOD" | HATLY_TEST_STDIN_PASSWORDS=1 HATLY_REPO_ROOT="$R/repo" HATLY_JDK_BIN="$T/stubs/jdk" bash "$KS" create customer --keystore "$R/outside/exists.jks" 2>&1)"; CODE=$?
expect "create never overwrites an existing keystore" 1 "already exists"
for pw in "$(printf 'short\nshort\n')" "$(printf 'correct-horse-9\ndifferent-horse-9\n')" "$(printf 'has\\backslash-123\nhas\\backslash-123\n')"; do
  new_repo 1 none; OUT="$(printf '%s' "$pw" | HATLY_TEST_STDIN_PASSWORDS=1 HATLY_REPO_ROOT="$R/repo" HATLY_JDK_BIN="$T/stubs/jdk" bash "$KS" create customer --keystore "$R/outside/p.jks" 2>&1)"; CODE=$?
  expect "create rejects a weak / mismatched / backslash password" 1 "nothing was created"
  [ -e "$R/outside/p.jks" ] && { failed=$((failed+1)); echo "FAIL  a keystore was created for a rejected password"; } || { passed=$((passed+1)); echo "ok    …and no keystore file exists"; }
done
new_repo 1 none; OUT="$(printf '%s' "$GOOD" | HATLY_TEST_STDIN_PASSWORDS=1 HOME="$R/home" HATLY_REPO_ROOT="$R/repo" HATLY_JDK_BIN="$T/stubs/jdk" FAKE_KT_ARGV="$R/kt-argv" bash "$KS" create customer --keystore "$R/outside/up.jks" 2>&1)"; CODE=$?
expect "create succeeds, validates what it made, and never prints the password" 0 "KEYSTORE VALID" "correct-horse-9"
KP="$R/repo/apps/customer-app/android/key.properties"
[ "$(stat -f '%Lp' "$KP" 2>/dev/null || stat -c '%a' "$KP")" = 600 ] && { passed=$((passed+1)); echo "ok    key.properties has mode 600"; } || { failed=$((failed+1)); echo "FAIL  key.properties is not mode 600"; }
grep -q '^storePassword=correct-horse-9$' "$KP" && grep -q "^storeFile=$R/outside/up.jks$" "$KP" && { passed=$((passed+1)); echo "ok    key.properties holds the four fields"; } || { failed=$((failed+1)); echo "FAIL  key.properties content"; }
grep -q 'correct-horse-9' "$R/kt-argv" && { failed=$((failed+1)); echo "FAIL  the password reached keytool's command line"; } || { passed=$((passed+1)); echo "ok    the password never appeared on keytool's command line (-storepass:env)"; }
grep -q 'storepass:env' "$R/kt-argv" && { passed=$((passed+1)); echo "ok    keytool was told to read the password from the environment"; } || { failed=$((failed+1)); echo "FAIL  keytool was not given -storepass:env"; }
OUT="$(printf '%s' "$GOOD" | HATLY_TEST_STDIN_PASSWORDS=1 HATLY_REPO_ROOT="$R/repo" HATLY_JDK_BIN="$T/stubs/jdk" bash "$KS" create customer --keystore "$R/outside/second.jks" 2>&1)"; CODE=$?
expect "create never overwrites an existing key.properties" 1 "already exists"
run_validate() { OUT="$(HATLY_REPO_ROOT="$R/repo" HATLY_JDK_BIN="$T/stubs/jdk" bash "$KS" validate customer 2>&1)"; CODE=$?; }
run_validate;                                  expect "validate accepts the keystore it just created" 0 "KEYSTORE VALID"
FAKE_KT_WRONG_PASS=1 run_validate;             expect "validate reports a password that does not open the keystore" 1 "does not open the keystore" "correct-horse-9"
FAKE_LIST_BITS=1024 run_validate;   expect "validate rejects a 1024-bit key" 1 "below 2048"
FAKE_LIST_UNTIL="Sat Jan 01 00:00:00 EET 2033" run_validate;   expect "validate rejects a key expiring before Play's 2033 minimum" 1 "beyond 2033"
FAKE_LIST_OWNER="C=US, O=Android, CN=Android Debug" run_validate; expect "validate rejects a debug key" 1 "DEBUG key"
chmod 644 "$KP"; run_validate;                 expect "validate flags a world-readable key.properties" 1 "readable by other users"
rm -f "$KP"; run_validate;                     expect "validate reports a missing key.properties" 1 "does not exist"

echo "== preflight: google-services.json validation (no value is ever printed)"
gs_case() {   # gs_case <json text>
  new_repo 1 none; printf '%s' "$1" > "$R/repo/apps/customer-app/android/app/google-services.json"
  OUT="$(HATLY_REPO_ROOT="$R/repo" bash "$PREFLIGHT" --android-only customer --api-url "$STAGING" 2>&1)"; CODE=$?
}
KEY="AIzaSy-FAKE-KEY-THAT-MUST-NEVER-BE-PRINTED"
gs_case '{"project_info":{"project_id":"hatly-test"},"client":[{"client_info":{"mobilesdk_app_id":"1:1:android:abc","android_client_info":{"package_name":"dev.hatly.customer"}},"api_key":[{"current_key":"'$KEY'"}]}]}'
expect "a complete google-services.json for the right package passes" 1 "has project_id, mobilesdk_app_id and an API key entry for dev.hatly.customer" "$KEY"
gs_case '{"project_info":{"project_id":"hatly-test"},"client":[{"client_info":{"mobilesdk_app_id":"1:1:android:abc","android_client_info":{"package_name":"com.hatly.driver"}},"api_key":[{"current_key":"'$KEY'"}]}]}'
expect "a google-services.json for the OTHER app is refused" 1 "is for package(s) 'com.hatly.driver', not dev.hatly.customer" "$KEY"
gs_case '{"project_info":{"project_id":"hatly-test"},"client":[{"client_info":{"mobilesdk_app_id":"1:1:android:abc","android_client_info":{"package_name":"dev.hatly.customer"}}}]}'
expect "a google-services.json without an API key entry is refused as incomplete" 1 "google-services.json is incomplete"
gs_case 'not json at all'
expect "a corrupt google-services.json is refused" 1 "FAIL"

echo; echo "$passed passed, $failed failed"; [ "$failed" -eq 0 ]

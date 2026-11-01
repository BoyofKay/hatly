#!/usr/bin/env bash
# Release preflight for the two Flutter apps. READ-ONLY: it checks that everything a signed, uploadable, push-capable store build needs is in
# place and says exactly what is missing. It never prints a secret (it reports "present"/"missing" and field NAMES only), never builds,
# never signs, never uploads. Exit code 1 while any FAIL remains.
#   scripts/launch/release-preflight.sh --api-url https://api.hatly.dev/api/v1
#   scripts/launch/release-preflight.sh --android-only customer --api-url <https URL>   # just what a Play closed-test AAB of ONE app needs (no iOS, no other app)
set -uo pipefail
root="${HATLY_REPO_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"; api=""; only=""   # HATLY_REPO_ROOT: test seam (scripts/launch/test/)
while [ $# -gt 0 ]; do case "$1" in --api-url) api="$2"; shift 2;; --android-only) only="$2"; shift 2;; *) echo "unknown argument $1" >&2; exit 2;; esac; done
case "$only" in ""|customer|driver) ;; *) echo "--android-only takes customer or driver" >&2; exit 2;; esac
fail=0; warn=0
pass() { echo "PASS  $1"; }; bad() { echo "FAIL  $1"; fail=$((fail+1)); }; note() { echo "WARN  $1"; warn=$((warn+1)); }
FLUTTER_DEFAULT_ICON_SHA="7b0546f32806"   # sha1 prefix of the stock Flutter 1024x1024 launcher icon (the driver app shipped it until replaced)
has_key() { grep -Eq "^$2=.+" "$1" 2>/dev/null; }

echo "== build inputs"
case "$api" in
  "") bad "no --api-url given (the production API base URL, https, ending /api/v1)";;
  http://*) bad "API URL is not https: $api";;
  https://*localhost*|https://*127.0.0.1*|https://*10.0.2.2*) bad "API URL points at this device/emulator: $api";;
  https://api-sales.hatly.dev*) note "API URL is the STAGING host ($api) — fine for a Sales/testing build, wrong for the store release";;
  https://*) pass "API URL is https ($api)";;
  *) bad "API URL is not a URL: $api";;
esac

for app in ${only:-customer driver}; do
  d="$root/apps/$app-app"; echo; echo "== $app app"
  id="$(grep -E 'applicationId *=' "$d/android/app/build.gradle.kts" | sed -E 's/.*"([^"]+)".*/\1/')"
  ver="$(grep -E '^version:' "$d/pubspec.yaml" | awk '{print $2}')"
  case "$ver" in 0.*) note "version $ver is still 0.x — the store release is 1.0.0 (docs/launch/RELEASE_VERSIONING.md)";; [0-9]*.[0-9]*.[0-9]*+[1-9]*) pass "version $ver";; *) bad "version '$ver' is not MAJOR.MINOR.PATCH+BUILD";; esac

  echo "-- Android signing and Firebase"
  kp="$d/android/key.properties"
  if [ ! -f "$kp" ]; then bad "android/key.properties missing — the release bundle would be signed with the DEBUG key and Google Play rejects it"; else
    missing=""; for k in storeFile storePassword keyAlias keyPassword; do has_key "$kp" "$k" || missing="$missing $k"; done
    [ -z "$missing" ] && pass "key.properties has storeFile/storePassword/keyAlias/keyPassword" || bad "key.properties lacks:$missing"
    sf="$(grep -E '^storeFile=' "$kp" | cut -d= -f2-)"; case "$sf" in "") ;; /*) f="$sf";; *) f="$d/android/app/$sf";; esac
    [ -n "${f:-}" ] && [ -f "$f" ] && pass "the keystore file exists" || bad "the keystore file named in key.properties does not exist"
    case "${f:-}" in "$root"/*) note "the keystore sits INSIDE the repository folder — keep it outside (it is git-ignored, but a backup tool or a zip would still carry it)";; esac
  fi
  gs="$d/android/app/google-services.json"
  if [ ! -f "$gs" ]; then bad "android/app/google-services.json missing — push cannot work on Android"; else
    pkg="$(python3 -c "import json,sys;print(','.join(c['client_info']['android_client_info']['package_name'] for c in json.load(open('$gs'))['client']))" 2>/dev/null)"
    case ",$pkg," in *",$id,"*) pass "google-services.json matches the package $id";; *) bad "google-services.json is for package(s) '$pkg', not $id";; esac
    # structure FCM needs (booleans only — the file holds an API key, nothing from it is printed)
    shape="$(python3 - "$gs" "$id" <<'PY' 2>/dev/null
import json, sys
d = json.load(open(sys.argv[1])); pid = sys.argv[2]
cl = [c for c in d.get("client", []) if c.get("client_info", {}).get("android_client_info", {}).get("package_name") == pid]
ok = bool(d.get("project_info", {}).get("project_id")) and bool(cl) and bool(cl[0].get("client_info", {}).get("mobilesdk_app_id")) and any(k.get("current_key") for k in cl[0].get("api_key", []))
print("ok" if ok else "bad")
PY
)"
    [ "$shape" = ok ] && pass "google-services.json has project_id, mobilesdk_app_id and an API key entry for $id" || bad "google-services.json is incomplete (needs project_info.project_id, and for $id a mobilesdk_app_id and an api_key) — download it again from the Firebase console"
  fi
  grep -q "com.google.gms.google-services" "$d/android/app/build.gradle.kts" && pass "Gradle applies the Google Services plugin when the file exists" || bad "Google Services plugin not wired"

  if [ -z "$only" ]; then
  echo "-- iOS"
  pb="$d/ios/Runner.xcodeproj/project.pbxproj"; bid="$(grep -E 'PRODUCT_BUNDLE_IDENTIFIER = [a-z.]+;' "$pb" | grep -v RunnerTests | head -1 | sed -E 's/.*= ([^;]+);.*/\1/')"
  grep -E 'DEVELOPMENT_TEAM = [A-Z0-9]{10};' "$pb" >/dev/null && pass "iOS DEVELOPMENT_TEAM is set" || bad "iOS DEVELOPMENT_TEAM is not set (Apple Developer team needed to sign and upload)"
  pl="$d/ios/Runner/GoogleService-Info.plist"
  if [ ! -f "$pl" ]; then bad "ios/Runner/GoogleService-Info.plist missing — push cannot work on iOS"; else
    pb2="$(/usr/libexec/PlistBuddy -c 'Print :BUNDLE_ID' "$pl" 2>/dev/null)"; [ "$pb2" = "$bid" ] && pass "GoogleService-Info.plist matches bundle id $bid" || bad "GoogleService-Info.plist is for '$pb2', not $bid"
  fi
  ls "$d"/ios/Runner/*.entitlements >/dev/null 2>&1 && grep -q "aps-environment" "$d"/ios/Runner/*.entitlements && pass "Push Notifications entitlement present" || bad "no Push Notifications entitlement (add the capability in Xcode > Runner > Signing & Capabilities once the team is set; APNs key must also be uploaded in the Firebase console)"
  [ -f "$d/ios/Runner/PrivacyInfo.xcprivacy" ] && pass "app-level privacy manifest present" || note "no app-level PrivacyInfo.xcprivacy (SDK manifests are bundled; the app-level one waits for the owner's data-collection confirmation — docs/launch/PRIVACY_AND_COMPLIANCE.md §6)"
  icon="$d/ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-1024x1024@1x.png"
  [ "$(shasum "$icon" | cut -c1-12)" = "$FLUTTER_DEFAULT_ICON_SHA" ] && bad "the app still uses the stock Flutter icon (proposal: docs/launch/store/icons/$app*)" || pass "launcher icon is not the stock Flutter icon"
  [ "$(sips -g hasAlpha "$icon" 2>/dev/null | awk '/hasAlpha/{print $2}')" = "no" ] && pass "App Store icon has no alpha channel" || bad "App Store icon has an alpha channel (rejected on upload)"
  for key in NSLocationWhenInUseUsageDescription; do /usr/libexec/PlistBuddy -c "Print :$key" "$d/ios/Runner/Info.plist" >/dev/null 2>&1 && pass "Info.plist has $key" || bad "Info.plist lacks $key"; done
  if grep -q "image_picker" "$d/pubspec.yaml"; then for key in NSPhotoLibraryUsageDescription NSCameraUsageDescription; do /usr/libexec/PlistBuddy -c "Print :$key" "$d/ios/Runner/Info.plist" >/dev/null 2>&1 && pass "Info.plist has $key" || bad "Info.plist lacks $key (image_picker is used)"; done; fi
  fi   # (iOS section is skipped with --android-only)
done

echo; echo "== repository hygiene"
git -C "$root" check-ignore -q apps/customer-app/android/key.properties && pass "key.properties is git-ignored" || bad "key.properties is NOT git-ignored"
git -C "$root" check-ignore -q apps/customer-app/android/app/google-services.json && pass "google-services.json is git-ignored" || bad "google-services.json is NOT git-ignored"
git -C "$root" check-ignore -q apps/customer-app/ios/Runner/GoogleService-Info.plist && pass "GoogleService-Info.plist is git-ignored" || bad "GoogleService-Info.plist is NOT git-ignored"
echo; if [ "$fail" -gt 0 ]; then echo "$fail blocking item(s), $warn warning(s) — NOT ready for a ${only:+$only Android }store build"; exit 1; fi; echo "no blocking items ($warn warning(s))"

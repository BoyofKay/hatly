#!/usr/bin/env bash
# Captures Google Play PHONE screenshots of the REAL customer app (Arabic, light theme) on a local emulator, driven by the existing on-device
# test integration_test/marketplace_assets_test.dart against the LOCAL development backend (seeded marketplace pack). Local only: no server,
# no Staging/Production data is touched (the test registers one throw-away customer in the local dev database).
#   bash scripts/launch/capture-store-screenshots.sh            → docs/launch/store/screenshots/phone/*.png (1080x1920)
# Play rules checked at the end: PNG/JPEG, each side 320–3840 px, the long side at most 2x the short side (a 1080x2400 phone fails that).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"; APP="$REPO/apps/customer-app"; OUT="$REPO/docs/launch/store/screenshots/phone"
SDK="${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}"; export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
ADB="$SDK/platform-tools/adb"; EMU="$SDK/emulator/emulator"; AVDM="$SDK/cmdline-tools/latest/bin/avdmanager"
IMG="system-images;android-35;google_apis;arm64-v8a"; AVD="hatly_store_shots"
die() { echo "STOP: $*" >&2; exit 1; }
[ -d "$SDK/system-images/android-35/google_apis/arm64-v8a" ] || die "emulator image missing: sdkmanager \"$IMG\""
curl -fsS -m 5 http://localhost:3000/api/v1/health >/dev/null || die "the local dev backend is not running on :3000"
[ "$(curl -fsS -m 5 http://localhost:3000/api/v1/sectors | grep -o '"slug":"restaurants"' | head -1)" ] || die "the local dev database is not seeded (npm run seed:dev-marketplace)"

# 1. a 1080x1920 (16:9) AVD — created once
if ! "$EMU" -list-avds | grep -qx "$AVD"; then
  echo no | "$AVDM" create avd -n "$AVD" -k "$IMG" -d pixel >/dev/null
  cfg="$HOME/.android/avd/$AVD.avd/config.ini"
  { echo "hw.lcd.width=1080"; echo "hw.lcd.height=1920"; echo "hw.lcd.density=420"; echo "hw.keyboard=no"; echo "hw.gpu.enabled=yes"; echo "hw.gpu.mode=host"; } >> "$cfg"
fi
# 2. boot headless (reuse a running one)
if ! "$ADB" devices | grep -q '^emulator-'; then
  "$EMU" -avd "$AVD" -no-window -no-audio -no-boot-anim -no-snapshot-save -netdelay none -netspeed full > "$HOME/Library/Logs/hatly/emulator-$AVD.log" 2>&1 &
fi
"$ADB" wait-for-device
for i in $(seq 1 120); do [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && break; sleep 2; done
[ "$("$ADB" shell getprop sys.boot_completed | tr -d '\r')" = 1 ] || die "emulator did not boot"
DEV="$("$ADB" devices | awk '/^emulator-/{print $1; exit}')"
A() {   # adb on that device, retried: the adb connection can drop for a moment (e.g. another adb server restarting)
  local i; for i in 1 2 3 4 5; do "$ADB" -s "$DEV" "$@" && return 0; sleep 2; "$ADB" wait-for-device >/dev/null 2>&1 || true; done; return 1
}
size="$(A shell wm size | tr -d '\r' | awk '{print $NF}')"; [ "$size" = 1080x1920 ] || die "emulator screen is $size, expected 1080x1920"
# 3. clean status bar (Android demo mode): 12:00, full battery, full signal, no notifications
A shell settings put global sysui_demo_allowed 1
d() { A shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null; }
d enter; d clock -e hhmm 1200; d battery -e level 100 -e plugged false; d network -e mobile show -e level 4 -e datatype none; d network -e wifi show -e level 4; d notifications -e visible false
# 4. local backend reachable from the device as localhost; run the real app's on-device test (it takes the screenshots)
A reverse tcp:3000 tcp:3000 >/dev/null
rm -rf "$APP/build/marketplace-screens"; mkdir -p "$APP/build/marketplace-screens"
(cd "$APP" && flutter drive -d "$DEV" --keep-app-running --driver=test_driver/integration_test.dart --target=integration_test/marketplace_assets_test.dart \
   --dart-define=API_BASE_URL=http://localhost:3000/api/v1 --android-project-arg=hatly.allowCleartext=true) \
   > "$HOME/Library/Logs/hatly/store-screenshots-drive.log" 2>&1 || true
grep -q 'All tests passed!' "$HOME/Library/Logs/hatly/store-screenshots-drive.log" || { tail -30 "$HOME/Library/Logs/hatly/store-screenshots-drive.log"; die "the on-device test failed"; }
# the test also wrote every screenshot into the app's code_cache (Directory.systemTemp on Android): pull them (debug build -> run-as works)
A exec-out "run-as dev.hatly.customer sh -c 'cd code_cache/store-shots && tar -cf - *.png'" | tar -xf - -C "$APP/build/marketplace-screens"
d exit
# 5. copy + check against Play's rules
mkdir -p "$OUT"; n=0
for f in "$APP"/build/marketplace-screens/*.png; do
  python3 - "$f" <<'PY' || die "$(basename "$f") breaks Play's screenshot rules"
import sys
from PIL import Image
w, h = Image.open(sys.argv[1]).size
ok = 320 <= min(w, h) and max(w, h) <= 3840 and max(w, h) <= 2 * min(w, h)
print(f"{sys.argv[1].rsplit('/',1)[-1]}: {w}x{h} {'OK' if ok else 'FAILS PLAY RULES'}"); sys.exit(0 if ok else 1)
PY
  cp "$f" "$OUT/"; n=$((n+1))
done
[ "$n" -ge 2 ] || die "only $n screenshots (Play needs at least 2)"
echo "OK  $n phone screenshots in $OUT (real app, Arabic, light theme, local seeded data)"

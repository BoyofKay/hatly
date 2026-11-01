#!/usr/bin/env bash
# OWNER-RUN. Creates and validates the Android UPLOAD keystore for Google Play without the password ever appearing on a command line (so not in
# `ps`, not in shell history), on screen, in a log, or in the repository. Claude never runs `create` and never sees the password or the keystore.
#
#   scripts/launch/upload-keystore.sh create   [customer|driver|both]   [--keystore /path/outside/the/repo/hatly-upload.jks]
#   scripts/launch/upload-keystore.sh validate [customer|driver|both]
#
# create   asks for the keystore password twice (hidden input), runs `keytool -genkeypair` (RSA 2048, 10000 days, alias hatly-upload; keytool itself asks
#          for your name/organisation), refuses to overwrite an existing keystore or key.properties, refuses any path inside the repository, writes
#          apps/<app>/android/key.properties (mode 600, git-ignored) and prints only PUBLIC facts (alias, validity, certificate SHA-256).
#          One keystore may sign both apps (`both`); Play App Signing makes either choice safe.
# validate checks key.properties + keystore WITHOUT printing a secret: all four fields present, keystore outside the repo and readable, password opens it,
#          alias exists, RSA >= 2048, valid beyond 22 Oct 2033 (Google Play's minimum), not a debug key, file permissions.
#
# AFTER create: back the keystore up TWICE (see docs/launch/RELEASE_SIGNING_AND_FIREBASE.md §A.2) and store the password in your password manager.
# Losing the upload key is recoverable through Google Play support (slow); never commit it, e-mail it, or paste it into chat.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="${HATLY_REPO_ROOT:-$(cd "$here/../.." && pwd)}"
reporoot="$(cd "$root" && pwd -P)"
cmd="${1:-}"; shift || true
which_apps="customer"; ks_path="${HOME}/hatly-secrets/hatly-upload.jks"; alias_name="hatly-upload"
while [ $# -gt 0 ]; do case "$1" in customer|driver|both) which_apps="$1"; shift;; --keystore) ks_path="${2:-}"; shift 2;; *) echo "unknown argument $1" >&2; exit 2;; esac; done
case "$cmd" in create|validate) ;; *) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2;; esac
apps() { [ "$which_apps" = both ] && echo "customer driver" || echo "$which_apps"; }

find_jdk_bin() {
  if [ -n "${HATLY_JDK_BIN:-}" ]; then echo "$HATLY_JDK_BIN"; return; fi
  if /usr/bin/java -version >/dev/null 2>&1 && command -v keytool >/dev/null 2>&1; then dirname "$(command -v keytool)"; return; fi
  if [ -x "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool" ]; then echo "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin"; return; fi
  if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/keytool" ]; then echo "$JAVA_HOME/bin"; return; fi
}
jdk_bin="$(find_jdk_bin)"; [ -n "$jdk_bin" ] && [ -x "$jdk_bin/keytool" ] || { echo "STOP: no JDK with keytool found (install Android Studio or set JAVA_HOME)"; exit 1; }
kt="$jdk_bin/keytool"
fail=0; pass() { echo "PASS  $1"; }; bad() { echo "FAIL  $1"; fail=$((fail+1)); }; note() { echo "WARN  $1"; }
# true if <path> (which may not exist yet) would resolve inside the repository; creates nothing
inside_repo() {
  local a="$1" tail="" real
  while [ ! -e "$a" ] && [ "$a" != "/" ]; do tail="/$(basename "$a")$tail"; a="$(dirname "$a")"; done
  if [ -d "$a" ]; then real="$(cd "$a" && pwd -P)"; else real="$(cd "$(dirname "$a")" && pwd -P)/$(basename "$a")"; fi
  case "$real$tail" in "$reporoot"|"$reporoot"/*) return 0;; esac
  return 1
}

# ------------------------------------------------------------------------------------------------------------------------------------------
if [ "$cmd" = create ]; then
  [ -t 0 ] || [ -n "${HATLY_TEST_STDIN_PASSWORDS:-}" ] || { echo "STOP: run this in an interactive Terminal (it asks for the password with hidden input)"; exit 1; }
  case "$ks_path" in /*) ;; *) echo "STOP: --keystore must be an absolute path"; exit 1;; esac
  inside_repo "$ks_path" && { echo "STOP: $ks_path is inside the repository folder. Choose a path outside it (default: ~/hatly-secrets/hatly-upload.jks)."; exit 1; }
  [ -e "$ks_path" ] && { echo "STOP: $ks_path already exists. This script never overwrites a keystore. To use it, run: $0 validate $which_apps"; exit 1; }
  for a in $(apps); do [ -e "$root/apps/$a-app/android/key.properties" ] && { echo "STOP: apps/$a-app/android/key.properties already exists; this script never overwrites it."; exit 1; }; done
  echo "Creating the Hatly Android UPLOAD keystore at: $ks_path"
  echo "Choose a strong password (12+ characters, no backslash, no leading/trailing space). It is typed hidden, kept only in this process, never printed."
  IFS= read -rs -p "Keystore password: " HATLY_KS_PASS; echo
  IFS= read -rs -p "Repeat password:   " HATLY_KS_PASS2; echo
  [ "$HATLY_KS_PASS" = "$HATLY_KS_PASS2" ] || { unset HATLY_KS_PASS HATLY_KS_PASS2; echo "STOP: the two entries differ; nothing was created."; exit 1; }
  unset HATLY_KS_PASS2
  if [ ${#HATLY_KS_PASS} -lt 12 ]; then unset HATLY_KS_PASS; echo "STOP: use at least 12 characters; nothing was created."; exit 1; fi
  case "$HATLY_KS_PASS" in *'\'*|*$'\n'*|\ *|*\ ) unset HATLY_KS_PASS; echo "STOP: the password must not contain a backslash or a newline, or start/end with a space (it is stored in a .properties file); nothing was created."; exit 1;; esac
  mkdir -p "$(dirname "$ks_path")" && chmod 700 "$(dirname "$ks_path")"
  export HATLY_KS_PASS
  # the password reaches keytool through the ENVIRONMENT (-storepass:env / -keypass:env), never through argv
  if ! "$kt" -genkeypair -v -keystore "$ks_path" -alias "$alias_name" -keyalg RSA -keysize 2048 -validity 10000 -storetype PKCS12 -storepass:env HATLY_KS_PASS -keypass:env HATLY_KS_PASS; then
    unset HATLY_KS_PASS; rm -f "$ks_path"; echo "STOP: keytool failed; nothing was kept."; exit 1
  fi
  chmod 600 "$ks_path"
  for a in $(apps); do
    kp="$root/apps/$a-app/android/key.properties"
    ( umask 077; printf 'storeFile=%s\nstorePassword=%s\nkeyAlias=%s\nkeyPassword=%s\n' "$ks_path" "$HATLY_KS_PASS" "$alias_name" "$HATLY_KS_PASS" > "$kp" )
    chmod 600 "$kp"; echo "wrote apps/$a-app/android/key.properties (mode 600, git-ignored)"
  done
  unset HATLY_KS_PASS
  echo; echo "DONE. Public facts only:"; bash "$0" validate "$which_apps" || exit 1
  cat <<EOF

NOW — before anything else:
  1. Copy the keystore to TWO places outside this Mac's repo folder: (a) your password manager as a file attachment, (b) an encrypted drive.
     Keystore: $ks_path       (store the PASSWORD in the password manager too; it is not written anywhere else except key.properties)
  2. Check a backup copy opens:   scripts/launch/upload-keystore.sh validate $which_apps   (re-run it after restoring from the backup)
  3. Never commit, e-mail or paste the keystore or password. Then continue with docs/launch/RELEASE_SIGNING_AND_FIREBASE.md.
EOF
  exit 0
fi

# ------------------------------------------------------------------------------------------------------------------------------------------
for a in $(apps); do
  echo "== $a app"
  kp="$root/apps/$a-app/android/key.properties"
  [ -f "$kp" ] || { bad "apps/$a-app/android/key.properties does not exist (create it with: $0 create $a)"; continue; }
  missing=""; for k in storeFile storePassword keyAlias keyPassword; do grep -Eq "^$k=.+" "$kp" || missing="$missing $k"; done
  [ -z "$missing" ] && pass "key.properties has storeFile, storePassword, keyAlias, keyPassword" || { bad "key.properties lacks:$missing"; continue; }
  perm="$(stat -f '%Lp' "$kp" 2>/dev/null || stat -c '%a' "$kp" 2>/dev/null)"; case "$perm" in *00) pass "key.properties permissions $perm";; *) bad "key.properties is readable by other users (mode $perm) — chmod 600 it";; esac
  f="$(grep -E '^storeFile=' "$kp" | cut -d= -f2-)"; case "$f" in /*) ;; *) f="$root/apps/$a-app/android/app/$f";; esac
  [ -f "$f" ] && pass "the keystore file exists" || { bad "the keystore file named in key.properties does not exist"; continue; }
  inside_repo "$f" && bad "the keystore lies INSIDE the repository folder — move it outside" || pass "the keystore is outside the repository"
  kperm="$(stat -f '%Lp' "$f" 2>/dev/null || stat -c '%a' "$f" 2>/dev/null)"; case "$kperm" in *00) ;; *) note "keystore permissions $kperm — chmod 600 it";; esac
  HATLY_KS_PASS="$(grep -E '^storePassword=' "$kp" | cut -d= -f2-)"; export HATLY_KS_PASS
  alias_name="$(grep -E '^keyAlias=' "$kp" | cut -d= -f2-)"
  info="$("$kt" -list -v -keystore "$f" -storepass:env HATLY_KS_PASS -alias "$alias_name" 2>&1)"; rc=$?
  unset HATLY_KS_PASS
  if [ $rc -ne 0 ]; then
    printf '%s' "$info" | grep -qi "password was incorrect\|keystore was tampered" && bad "the storePassword in key.properties does not open the keystore" || bad "keytool could not read alias '$alias_name' from the keystore (wrong alias or unreadable file)"
    continue
  fi
  pass "the password opens the keystore and alias '$alias_name' exists"
  printf '%s' "$info" | grep -q "CN=Android Debug" && bad "this is a DEBUG key — Google Play rejects it" || pass "not a debug key"
  size="$(printf '%s' "$info" | grep -oE 'Key size: *[0-9]+|[0-9]+-bit RSA key' | grep -oE '[0-9]+' | head -1)"
  [ "${size:-0}" -ge 2048 ] 2>/dev/null && pass "RSA key of $size bits" || bad "key size '${size:-unknown}' is below 2048 bits"
  until="$(printf '%s' "$info" | grep -oE 'until: .*' | head -1 | sed 's/until: //')"
  yr="$(printf '%s' "$until" | grep -oE '[0-9]{4}$' | head -1)"
  [ -n "$yr" ] && [ "$yr" -gt 2033 ] 2>/dev/null && pass "valid until $until (Google Play requires beyond 22 Oct 2033)" || bad "validity could not be confirmed beyond 2033 (until: ${until:-unknown})"
  echo "      alias:  $alias_name"
  echo "      SHA-256 (public — register it in Firebase / on the Maps key): $(printf '%s' "$info" | grep -m1 'SHA256:' | sed 's/.*SHA256: *//')"
  kpw="$(grep -E '^keyPassword=' "$kp" | cut -d= -f2-)"; spw="$(grep -E '^storePassword=' "$kp" | cut -d= -f2-)"
  [ "$kpw" = "$spw" ] && pass "keyPassword equals storePassword (required for a PKCS12 keystore)" || note "keyPassword differs from storePassword — fine for a legacy JKS keystore, wrong for PKCS12; the first signed build will tell"
done
echo; if [ "$fail" -gt 0 ]; then echo "$fail check(s) FAILED — signing is NOT ready"; exit 1; fi; echo "KEYSTORE VALID — still not a release: build with scripts/launch/build-android-release.sh and look for 'milestone 2'."

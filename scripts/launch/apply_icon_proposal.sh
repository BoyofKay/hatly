#!/usr/bin/env bash
# Applies a reviewed icon proposal from docs/launch/store/icons/ to an app. NOT run automatically: the owner approves the look first
# (open docs/launch/store/icons/<set>/preview.png). Every file it replaces is first copied to a timestamped folder next to it.
#   scripts/launch/apply_icon_proposal.sh customer-fixed   # -> apps/customer-app
#   scripts/launch/apply_icon_proposal.sh driver           # -> apps/driver-app
#   add --dry-run to only list what would change
set -euo pipefail
set_name="${1:-}"; dry=0; [ "${2:-}" = "--dry-run" ] && dry=1
root="$(cd "$(dirname "$0")/../.." && pwd)"
case "$set_name" in customer-fixed) app=customer-app;; driver) app=driver-app;; *) echo "usage: $0 customer-fixed|driver [--dry-run]" >&2; exit 2;; esac
src="$root/docs/launch/store/icons/$set_name"; [ -d "$src" ] || { echo "missing $src — run scripts/launch/generate_icon_proposals.py" >&2; exit 1; }
ios_dst="$root/apps/$app/ios/Runner/Assets.xcassets/AppIcon.appiconset"; res_dst="$root/apps/$app/android/app/src/main/res"
backup="$root/apps/$app/.icon-backup-$(date +%Y%m%d-%H%M%S)"
copy() { # copy <from> <to>
  if [ "$dry" = 1 ]; then [ -f "$2" ] && echo "replace $2" || echo "add     $2"; return; fi
  if [ -f "$2" ]; then mkdir -p "$backup/$(dirname "${2#$root/apps/$app/}")"; cp -p "$2" "$backup/${2#$root/apps/$app/}"; fi
  mkdir -p "$(dirname "$2")"; cp "$1" "$2"
}
for f in "$src"/ios/AppIcon.appiconset/*.png; do copy "$f" "$ios_dst/$(basename "$f")"; done
for d in "$src"/android/mipmap-*; do for f in "$d"/*; do copy "$f" "$res_dst/$(basename "$d")/$(basename "$f")"; done; done
[ "$dry" = 1 ] && echo "(dry run: nothing changed)" || echo "applied; replaced files are saved in $backup (delete it once you are happy)"

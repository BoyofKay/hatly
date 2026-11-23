# Delivery Zones → Neighborhoods/Villages (Release workflow)

Prepared 2026-11-23 for Hatly's existing GitHub Actions pipelines:
- Customer app build: push to `app-build` → creates direct-download testing APK + AAB artifact
- Driver app build: push to `driver-app-build` → creates direct-download testing APK + AAB artifact
- Production ops: push `ops/REQUEST` to `ops-request` with ACTION=deploy; deploy verifies bundle checksum, env, migration plan, backup and restore drill, then switches backend/Admin

Production inventory 2026-11-23 (read-only workflow): 11 parent delivery zones, 75 second-level names, 13 existing saved addresses linked to the special Unlisted Zone. Arabic children from `delivery_zones.areas` are preserved literally and mapped to separate bilingual rows in migration `1700009300000-DeliveryZoneNeighborhoods.ts`. New child fee: 1,500 piastres = **15 EGP**, editable independently through Admin.

Old parent rows and addresses are not deleted or reassigned. Original combined parents are retained with `is_selectable=false` after migration. Parent names and original `areas` array remain intact. Existing orders retain frozen fee snapshots; existing saved addresses remain serviceable and the edit flow requires choosing a precise child before update.

App versions are customer `1.1.0+11` and driver `1.1.0+15` (both above the latest workflow branch build numbers). No Android upload signing key is available, so expected APKs are DEBUG-signed and appropriate only for testing, not Play submission. Installing a debug-signed APK over an app with a different certificate may require uninstalling the old app, which can erase local app data.

The English names in the translation module are practical transliterations that Admin can edit. No real Arabic name may be dropped, merged, or translated by guessing a delimiter position.

Rollout gates: green CI, migration preflight validation, Production ops success and live service/price smoke tests, downloaded APK artifact and checksum. Do not label a release deployed without ops logs proving success.

# Hatly Customer — UI Recovery Rollout & Rollback (2026-11-23)

## Scope and provenance
- Recovered from `wip/customer-app-settings-locale` commit `fc782e158203b42f551aa0d777df315a4c08965b`.
- Integration branch: `fix/recover-two-column-sectors-hero-banners-20261123`, based on `app-build` commit `1bc63df2f53e334bca537b92a95079fc0d1567d2`.
- Restore **only** the approved two-column Home/Explore sector cards and full-width, dot-free Home hero banners, plus associated regression tests, the small `heroBanner` theme radius constant, and an optional per-pager animation override so unrelated pagers keep their existing behavior.
- Do not merge the recovered WIP branch wholesale: it predates the current address, delivery-zone, cart, checkout and vendor business logic.
- No backend, production dashboard, database, driver-app, or production operations change is needed for these Flutter presentation adjustments.

## Known-good baseline — preserved
- Customer version: **1.1.0+12**.
- Source commit: `1bc63df2f53e334bca537b92a95079fc0d1567d2`.
- GitHub release: https://github.com/BoyofKay/hatly/releases/tag/customer-app-v1.1.0-b12-run45159835953
- Release asset: `hatly-customer-1.1.0+12.apk`.
- Keep the previous release/tag and artifact available throughout the pilot.

## Pre-release gates (must all pass)
1. Confirm diff relative to source baseline touches only the reviewed Customer Flutter UI/theme/pager and regression-test files plus this runbook; no API models, cart, address, order, backend or driver files.
2. GitHub CI: Customer Flutter analyze and tests pass. Resolve failures on the recovery branch, not on Production.
3. Verify Home and Explore **exactly two cards per row**, including Arabic RTL, English LTR, long text at 2x font size, small phones, and odd counts.
4. Verify banner: full-width page-content alignment, 5-second auto-advance, swiping, correct tap target, reduced-motion behavior, zero indicator dots; confirm eligible Admin banners still win over offer-derived fallback.
5. Verify current release behavior unchanged: two dependent address dropdowns, fee by neighborhood, reason for inactive area, browse-only closed store and disabled Add-to-Cart with backend enforcement, orders/cart navigation.
6. Increase Android Customer versionCode from `12` to `13` on the final release branch before building; do not reuse an existing tag or release artifact.
7. Inspect APK/AAB build checksums, success and package ID/signature compatibility. Do not publish to Google Play without an upload signing key.

## Rollout procedure (no automatic Production deployment)
1. Merge only the reviewed recovery commits into `app-build` after a green CI and diff review. Keep `driver-app-build`, `ops-request`, and backend/DB untouched.
2. Run the existing **Customer app build** workflow. Verify a new APK is published under a unique `customer-app-v1.1.0-b13-run...` tag.
3. Install the candidate on a designated test device first. Test Home sectors, Explore categories, carousel, address editing, open/closed store menus, checkout, delivery fees, and order history.
4. Expand to a small set of invited testers after pilot signoff. Preserve the previous release and issue no backend migrations for this UI-only rollout.
5. Only then distribute the candidate more widely; monitor crashes, rendering, navigation and order/cart failures reported by testers.

## Rollback / containment
- **Before promotion**: no rollback needed; abandon/revise recovery branch; leave `app-build` and Customer 1.1.0+12 unchanged.
- **After a build but before distribution**: stop distributing the new APK; retain the 1.1.0+12 release and tag; do not move/force-reset a shared branch.
- **After APK distribution**: immediately pause further distribution. Revert **only the UI recovery commit(s)** on `app-build`; build the baseline appearance with a **higher versionCode than the affected build** (e.g., 14 if 13 was affected), publish a clearly labeled rollback APK, and give affected testers an explicit reinstall/update path. Android generally will not install an older versionCode over a newer one.
- **Do not roll back Production ops, the backend, migrations, addresses, delivery-zone data, or driver release**: this is a Flutter UI-only rollback.
- **If signing certificates differ**: warn that in-place upgrades may be impossible; do not silently ask testers to uninstall before explaining local-data loss risk.
- Collect screenshots, device type, app version, steps to reproduce and GitHub Actions run IDs for diagnosis.

## Go / no-go
**Go** only if all CI checks and the pilot pass. **No-go** on any UI overflow, clipped Arabic text, incorrect banner navigation, missing cards, crashes, broken address/cart behavior, or change outside approved presentation scope.

Current state at creation: implementation in a dedicated branch; no Customer APK release or Production deployment triggered by this recovery work.

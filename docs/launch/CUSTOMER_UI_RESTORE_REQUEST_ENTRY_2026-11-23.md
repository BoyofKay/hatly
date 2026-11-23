# Hatly Customer UI recovery + request-entry enhancements — 2026-11-23

## Scope and immutable baseline
- Known-good Customer APK: [1.1.0+13](https://github.com/BoyofKay/hatly/releases/tag/customer-app-v1.1.0-b13-run45177095116); source `9a08256d9fa33fd62afa563a58ada45dff17e63c`.
- Recovered UI source: `wip/customer-app-settings-locale` at `fc782e158203b42f551aa0d777df315a4c08965b`.
- Integration branch: `feature/customer-ui-safe-recovery-service-entry-20261123`, branched from Customer 1.1.0+13.
- **No reversion of Nov 22–23 fixes; no merge of the old WIP branch wholesale.**
- Only Customer UI code, localization, UI-only route entry context, tests, and iOS app metadata may change.
- No backend, API, database migration, Admin Panel, Driver App, cart/order/checkout workflow, pricing, settlement, delivery dispatch, or Hatly/Wasaly service model may change.

## Current behavior to protect
1. Vendor's menu loads the first 20 products, then pages 2+ on nearing the end (<600 px). `productListProvider` + `moreProductsProvider` cache by vendor/search/sort/filters and append unique product IDs; failed additional page is retryable. It is **in-memory provider state**, not guaranteed persistent disk caching. Baseline fix `107f50267133` on Nov 22; test `vendor_details_paging_test.dart`.
2. Closed stores remain browseable with closed indicators, greyscale and dialog; product, quick-add and vendor custom request cart additions remain disabled/rejected. Nov 23 service-side guards must remain.
3. Product details preserve quarter-kilogram weight options, product configuration, and the Nov 22 post-add navigation back to the correct store with feedback and View Cart CTA.
4. Addresses retain Service Area → Delivery Zone → Neighborhood/Village selection and fee, disabled zone handling, and saved-address compatibility.
5. Cart holds vendor-specific custom requests in that branch's `CATALOG` group; description and/or up to two images, vendor price pending, and normal checkout restrictions. The Admin sector `customRequestsEnabled` setting AND branch-open status gate the entry and the backend enforces them.
6. Hatly `BUY_FROM_PLACE` and Wasaly `DELIVER_TO_PLACE` already have established separate `AD_HOC_SERVICE` cart grouping and order/route/pricing/fulfillment handling. **Do not modify business logic; this work only constrains which UI choice is visible based on entry point.**

## Visual changes
- Home/Explore category two-column grid and hero banners were previously restored in 1.1.0+13 and remain untouched.
- Profile/Settings visual recovery, persisted Arabic/English locale switching, theme presentation; product-grid layout, product details visual treatment; vendor cards; search result filters; bottom navigation; order status/progress & detail section presentation; iOS privacy manifest and launch metadata.
- Screens with Nov 22–23 fixes (`product_details_screen`, `vendor_details_screen`, `vendor_card`, `vendor_cover_card`, search result vendor mapping) were adapted selectively rather than overwritten.
- The custom-request button at the bottom of a vendor menu is replaced with an edge-anchored, vertically draggable pill using the **existing** sheet/auth/upload/cart callback. The 20-page menu scroll remains under it and the bottom cart bar remains accessible.
- Sector-scoped store list `/vendors?sectorId=...` contains a sticky Hatly Service entry **even with zero vendors**; list remains fully scrollable above it. Sector entry goes to `/hatly-service?entry=sector`, preselects `BUY_FROM_PLACE`, does not offer Wasaly type selection, and must never transform an existing Wasaly group. If Wasaly exists in cart it shows a read-only explanation and View Cart link.
- Home/Explore `/hatly-service` still offers both service choices (unchanged). Vendor custom request is a separate service linked to a branch (unchanged).

## Regression/acceptance checklist
- [ ] GitHub CI green: Flutter analyze + full Customer test suite, Backend integration, Dashboard checks, Driver tests.
- [ ] Android: Arabic RTL & English LTR; language survives restart; Settings/Password/Delete Account still work.
- [ ] Home/Explore sectors remain two columns; banners remain wide/dotless; tab/navigation/deep-link behavior unchanged.
- [ ] Product grids: long names, prices, offers, closed-store disabled Quick Add; weighted/options products still use details.
- [ ] Store page: 20 → 40 → 60 etc; page cache/filter/search/sort reset and retry; no lost scroll on request sheet.
- [ ] Vendor request pill: visible only for enabled+open branches; drag within screen safe bounds; tap invokes existing sheet, same uploads and price-pending cart state.
- [ ] Sector card: fixed even with no stores, sector-only Hatly type; Home/Explore still both; Wasaly cart group is unchanged.
- [ ] Vendor cards: closed greyscale, hours, closed dialog/browse-only; ratings/favorites intact.
- [ ] Cart/checkout/order: CATALOG vs AD_HOC rules, pending-price restriction, payment, dispatch, order status and delivery fee invariants unchanged.
- [ ] iOS configuration verified separately. No iOS signing/TestFlight claim without a Mac and signing identity.

## Release and rollback
- Before any release: keep all code in this dedicated branch; no Production ops deploy. Review the diff against Customer 1.1.0+13 and wait for green CI.
- After green checks: increment only Customer Android version from 1.1.0+13 to **1.1.0+14**; push to `app-build` by fast-forward and use the existing **Customer app build** workflow. Confirm unique APK and AAB artifact and source commit.
- Test install on a pilot device before broad circulation. APK may use an ephemeral debug key until signing key configured; confirm compatibility before in-place update.
- If failed before release, leave `app-build` and 1.1.0+13 unchanged. If failed after b14 distribution, stop rollout, revert UI-only recovery commits, build unchanged b13 functionality as **b15 or higher** (Android versionCode cannot be downgraded in place). Do not revert Production ops or backend/DB.
- No background or automatic rollout. Capture reproducible device screenshots, locale, app version, GitHub Actions run, and error logs.

## Status
This runbook describes the intended single-iteration delivery and acceptance gates. Green CI, a generated APK, and distribution must be verified from the actual workflow outcome; merely committing UI code does **not** mark these as complete.

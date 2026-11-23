# Hatly — profiles, shift history and global branding (2026-11-23)

## Scope and explicit boundaries

- Customer name: shown and editable in **Profile**, saved as the current authenticated `users.full_name`. On login and session restore the app reads the backend, caching locally only for offline fallback. Name edits do not update account ID, phone, password, verification or orders.
- Driver name: Admin-only edit under **Admin → Drivers → Edit settings**. The driver sees the same backend name in the global heading of **Orders / History / Earnings / Profile**, and in Profile as a read-only field. No change to driver ID, phone, permissions, dispatch assignments, authentication or financial history. Renames use the existing MANAGE_DRIVERS permission and an admin audit event.
- Driver History: **Current shift** and **Previous** use the most recent **CLOSED** `driver_settlement_periods.period_end` boundary, the same source as Earnings. Delivery timestamp strictly later than that boundary belongs to Current; at or before belongs to Previous. On closure, the next history fetch naturally relocates the row without client-side migration. The `scope` query parameter is optional: older clients retain the original unfiltered delivered-orders response. Shift-duration displays use the existing earnings open-period `periodStart`, and are *elapsed period time*, **not GPS-tracked hours or working-time payroll**. Monetary amounts are never recalculated on the device.
- Customer header: brand logo, notification bell and favorites pinned above all customer routes except registration/login/splash. The Home address selector remains inside Home, without duplicate bell/heart.
- Driver header: genuine Hatly Driver app icon (copied from existing official store asset), app name, and Admin-maintained driver name, pinned above all authenticated driver routes, including delivery details.
- Hatly Service: independently routed Home promotional card displays approved Arabic/English copy with modern brand-gradient styling. Vendor-specific Custom Request CTA **label only** renamed to Hatly Service. Its `vendorBranchId`, product request, waiting-price, cart-grouping and checkout behavior are unchanged. The standalone sector entry remains separate with `هاتلي من مكان` only; this change does not introduce any new vendor routing. **No cart logos added.**

## Contract additions (backward compatible)

- `GET auth/customer/me` adds `fullName` to existing phone status response.
- `PATCH auth/customer/name` body `{fullName: string}`, authenticated CUSTOMER only.
- `GET driver/profile` returns `{data:{fullName}}`, authenticated DRIVER only; **no self-edit route**.
- `PATCH admin/drivers/:id/name` body `{fullName: string}`, permission MANAGE_DRIVERS, audit event `driver.name_updated`.
- `GET driver/transactions?scope=current|previous` adds optional shift filtering. Omitted scope returns the old full history.
- No new database columns/migrations required. All persistent names use existing `users.full_name`.

## Release / deployment status

**Source branch:** `feature/profile-shift-brand-20261123` (not automatically merged into the production source branch).

**App candidates:** Customer `1.2.0+8`, Driver `1.1.0+10` (versions independent). Added GitHub Actions **Customer app build** and **Driver app build** for QA APKs from this branch using `https://api-sales.hatly.dev/api/v1`; these are **debug-key signed test artifacts only**. They are **not** Google Play upload-signed and have no confidential Firebase files injected, so push needs a signed/configured device build later. Artifact existence and CI status must be confirmed from Actions, not assumed from YAML.

**No automated live deployment**: Production ops remains a manual, access-controlled runbook. Do not deploy live APIs/Admin without verified backup/restore, database migration checks, environment validation and smoke tests. App versions using the new endpoints must be installed **after** the corresponding backend deployment to the target environment. Backend/Admin can be deployed separately once source gates pass. The GitHub connection does not supply authorized production VPS credentials or original Android upload key.

## Regression checklist

1. Customer registration, logout/login, edit name in Profile, logout/login again; confirm displayed name persists and phone/account remain unchanged.
2. Admin renames driver; driver sees updated name on all four tabs after refresh/relogin; no edit button on driver Profile. Audit contains actor and driver reference. Other drivers' accounts unchanged.
3. Deliver an order; see it under Current shift. Close that shift using existing Operations flow. Refresh History: order appears in Previous, current list excludes it; Earnings shows closed record. Verify excluded/unresolved orders and financial settlement logic remain untouched.
4. Orders, History and Earnings show the same current-period elapsed duration; 0 or missing start does not crash. Confirm duration label is **not** presented as a payable timesheet.
5. Browse Home, Explore, vendor, cart, checkout, orders, account, notifications and nested details: the customer header stays visible and its buttons work. RTL and dark theme readable, no duplicated Home bell/heart.
6. Driver header stays on Orders, History, Earnings, Profile and delivery details; displays exact official app icon.
7. Vendor Custom Request bubble only renamed. Create a vendor-linked pending-price custom request, confirm the old cart group / blocking policy and price-confirmation behavior. Standalone Hatly Service continues its existing non-vendor `هاتلي من مكان` flow. No cart logo change.
8. Flutter analyze/tests, backend typecheck/unit/integration tests, Admin typecheck/unit; signed build + target-environment smoke before publishing/distribution.

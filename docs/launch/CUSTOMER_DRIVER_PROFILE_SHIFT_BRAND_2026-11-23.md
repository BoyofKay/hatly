# Hatly Customer + Driver UX, names and shift-scope release — 2026-11-23

## Approved scope
- Rename the in-store, vendor-specific floating request pill `Request item | اطلب صنف` to `Hatly Service | خدمة هاتلي` **label only**. Clicking still calls the existing vendor-specific custom request sheet and `CATALOG` pending-price cart flow. This must never be routed to independent `AD_HOC_SERVICE` Hatly/Wasaly.
- Customer name shown and editable **in Profile only**, using customer-role, token-scoped GET/PATCH `auth/customer/profile`. Name is persisted in `users.full_name` and cached only after the server confirms. The existing phone, role, auth, cart, checkout, order, and driver assignment records are untouched.
- Driver name shown in Driver Profile and the pinned header across Orders/History/Earnings/Profile; the GET `driver/profile` is read-only and driver-ownership checked. Name editing remains **Admin Panel only** at the existing `/admin/drivers/:id/profile` endpoint (audit and permissions unchanged).
- Driver History/Orders tab title `Today` → `Current shift`. `today` remains the API wire value for backward compatibility. Finished orders are shown in Current only while an active shift exists and their order timestamps are inside that shift, and move to Previous when it ends. Active assigned orders remain visible after supervisor force-end for safety. Settlements, financial calculations, fees and status transitions are not modified.
- Show elapsed current shift (hours and minutes) from server `driver/shift` start time on Orders current-shift tab, Earnings current-shift tab and the shift card. `Previous` earnings still uses existing server minutes worked.
- Pinned customer logo + notification bell + Favorites navigation on every customer route (Home duplication removed). Pinned driver logo and Admin-managed driver name on every Driver route; use bundled assets, not remote/new files.
- When a store/banner cover is absent, show its store logo without stretching, then Hatly brand logo if neither is present. This is presentation only. Closed-store greyed rules remain.
- When a sector has zero vendors, show the approved localized invitation to Hatly Service; distinguish empty filters/search from a genuinely empty sector. The existing fixed sector Hatly Service entry remains even when zero vendors.
- **Do not add store or Hatly logos to the cart** (owner explicitly canceled this change).

## Protected invariants
- No edits to cart/add-item compatibility, pricing, checkout, order creation, fulfillment, routing, assignment, settlement or payment code.
- Hatly `BUY_FROM_PLACE` and Wasaly `DELIVER_TO_PLACE` workflows are separate and unchanged.
- Store custom requests stay scoped to the original selected vendor and remain price-pending until vendor confirmation.
- 20-at-a-time product pagination, in-memory provider cache, next-page retry and closed-store disable/greyscale protections are untouched.
- The Admin driver-name editing permission/route is reused; no self-edit for drivers.
- Driver Orders view membership is read-only; it does not change stored order status, shift closure, or settlement data.

## Technical release sequence
1. Run feature-branch full CI: Customer Flutter analyze/tests; Driver Flutter analyze/tests; Backend typecheck/unit/build/integration; Dashboard checks. Fix all required failures.
2. Customer Android `1.1.0+15`, Driver Android `1.1.0+17` are **prepared but not released** until CI green. Fast-forward `app-build` and `driver-app-build` to the tested SHA; use only the pre-existing Customer app build / Driver app build GitHub Actions.
3. Confirm each release run is green, AAB artifact exists and a direct download APK is published. Capture GitHub release URLs and SHA256 in ops-log. Debug key/Google Play restrictions remain as previously documented.
4. Backend additions (`auth/customer/profile`, `driver/profile`, and shift-aware read-only `driver/orders/overview`) require the independent **Production ops** approval-gated workflow. Production is not deployed by mobile build runs. Verify actual production workflow result and health probes before claiming availability.
5. Real-phone QA: profile name round-trip / relogin; Admin edits driver's name, then driver reads it on all tabs; shift closes and finished orders appear in Previous; current shift timers; RTL/LTR, all customer/driver routes pinned header, login, overlays, notification & favorite navigation; empty sector, filters, logo fallback; vendor-specific request, pending-price cart, closed store and multi-page menu.

## Rollback
- Keep the previous Customer `1.1.0+14` and Driver `1.1.0+16` release assets. Android in-place downgrade is not supported: if distributed, revert UI code and publish versions with higher build numbers.
- Backend deployment must use the existing approved Production ops rollback, **not** manual SQL or ad hoc production commands. Restore prior read endpoints only after assessing newer app compatibility.
- Name editing and driver shift-history read behavior are additive/read-only to business state. All existing orders, settlement records and user identities remain authoritative.

## Acceptance state
Status is determined by actual CI, release and deployment records, not by the commits themselves. Do not mark backend deployed or mobile builds published until the respective workflow succeeds.

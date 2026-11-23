# Hatly delivery neighborhoods — Admin/API rollout + Customer 1.1.0+7

**Prepared 2026-11-23. Status: SOURCE RELEASE CANDIDATE, NOT DEPLOYED.**

The product owner approved:
- One bilingual parent delivery-zone name (one English + one Arabic).
- Multiple separately managed children, **one neighborhood/village per row** with one English + one Arabic name.
- Default **15.00 EGP = 1,500 piastres for every classified, selectable neighborhood/village**; subsequent Admin fee edits change only future quotes.
- Customer address label: `Zone | Neighborhood/Village` (localized).
- Preserve every existing name, fee history, row ID, saved address and order snapshot while disaggregating previously combined rows.
- Deliver the new Customer Android release and deploy the updated API/Admin dashboard via the normal host procedure.

## What is prepared in GitHub

1. Additive migration `1700008200000-DeliveryZoneNeighborhoods`.
2. Backend: parent zone names on existing priced child records; child-specific fee remains the checkout authority for manual addresses; client cannot submit multi-name entries.
3. Admin: bilingual Zone + Neighborhood/Village editor, initial 15.00 EGP, fee adjustment, legacy warning, and **Export Arabic / English neighborhoods (CSV)** button.
4. Customer 1.1.0+7: governorate → city → delivery zone → neighborhood/village, `Zone | Neighborhood/Village` in saved addresses, checkout and order details.
5. Driver: frozen destination label updated, with a fallback for legacy records.
6. Reconciliation script: `npm run delivery:neighborhood-reconcile` read-only inventory by default; an explicit bilingual mapping + exact database allowlist + apply flag required for a transaction. Creates children with 1500 minor units and changes all classified/selectable child fees to 1500 in that transaction.
7. Bilingual release notes: `docs/launch/store/release-notes/customer-1.1.0-7/{ar.txt,en-US.txt}`.

## Release order (do not skip)

1. **Source gates** — Admin TS/unit; backend TS/unit/integration; Flutter analyze/tests; delivery-zone e2e on migrated disposable database. Do not assume CI proves deployed behavior.
2. **Live source-of-truth inventory** — read production `delivery_zones` (old bilingual strings, fee, active, addresses count) and export it without any data modification. The GitHub source is *not* a substitute for current live data.
3. **Translation review** — confirm one-to-one Arabic/English pairs for ALL original combined rows. Never guess from comma positions or invent a village name. The exact mapping JSON is approved before applying.
4. **Backup** — take DB + uploads backup and verify a restore drill; retain off-host archive. Compare pre/post IDs, old text, row count, address count and frozen order fees.
5. **Backend/Admin deploy** — use the established `deploy/production/make-release-bundle.sh`, upload/hash-verify, `prod.sh build`, `env-check`, `plan`, `backup`, guarded migrate and `prod.sh apps`. Production service configuration/credentials live ONLY on the authorized VPS; do not put secrets into GitHub.
6. **Reconcile** — execute reviewed mapping with `DELIVERY_NEIGHBORHOOD_MAPPING_FILE`, `DELIVERY_NEIGHBORHOOD_ALLOW_DATABASE` and `DELIVERY_NEIGHBORHOOD_APPLY=YES_PRESERVE_LEGACY` in the approved environment. Existing combined rows are retained but excluded from NEW address choices after splitting; old saved addresses remain intact and can be corrected by customers when they edit.
7. **Smoke** — Admin: each child is a unique row and 15.00 EGP fee adjustable per child; Customer: parent → child selection, zone | child label, quote and re-quote accurate; pre-existing saved addresses and orders still open; GPS fee path unchanged; monitor backend errors.
8. **Build Customer** — on the authorized Mac with the existing release upload keystore, run `scripts/launch/build-android-release.sh customer --api-url https://api.hatly.dev/api/v1`. Verify Android application ID `dev.hatly.customer`, version `1.1.0+7`, signature, SHA-256 and release target. A DEBUG-signed build is not a distributable release.
9. **Distribution** — owner uploads the signed AAB to the existing Google Play closed-testing track (do not reset testers or move it to Production), optionally shares the verified signed APK for internal test installs, then records the real upload with `build-android-release.sh record-upload customer closed-testing`. Tag commit `customer-v1.1.0+7` only once submission occurs.

## Pending external requirements

- Exact combined live rows and their approved transliterations / bilingual mappings, **not present in this GitHub snapshot**.
- Production VPS SSH authorization and off-host backup path; no access is available through the GitHub connection.
- Android upload signing keystore, stored outside the repository on the authorized Mac; never print or copy private signing keys.
- Google Play account action for uploading to the closed track.
- Full migrated-environment end-to-end verification and successful install on a physical device.

Do not claim the Admin is deployed or a signed APK/AAB exists until those steps produce the artifacts and smoke-test evidence.

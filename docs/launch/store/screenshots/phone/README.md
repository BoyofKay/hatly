# Google Play phone screenshots — customer app (captured 2026-10-23, re-captured 2026-10-24)

Real app (debug build of the current source), Arabic, light theme, 1080×1920 (Play: each side 320–3840 px, long side ≤ 2× short side — checked),
driven by `apps/customer-app/integration_test/marketplace_assets_test.dart` on a local emulator against the LOCAL development backend seeded with
the owner-supplied marketplace asset pack (`docs/assets/`). Re-capture with `scripts/launch/capture-store-screenshots.sh`.

Upload order: `01-sign-in-logo.png`, `03-restaurant-vendors.png`, `04-vendor-products.png`, `05-product-details.png` (Play needs ≥ 2, allows 8).

**Held back — `not-for-store/02-home-sectors-placeholder.png`:** the Home promo banner features the soft-drink offer. Its photo carried the **Coca-Cola logo** (real trademark — Play IP policy, and the pack's own "no brand logos" rule), so the asset was quarantined on 2026-10-24 (`docs/assets/quarantine-trademark/`, excluded from the release bundle; the seed now withdraws seed-owned URLs whose asset left the pack). The banner now shows the app's placeholder, which looks unfinished — re-capture once an unbranded photo is supplied. Staging still serves the old photo (live data, not changed). **[OWNER]** supply `docs/assets/pack/products/{abu-aly-grills,beit-el-sharkia-restaurant}/soft-drink-can.webp` (unbranded) or remove the offer.

**[OWNER] before upload:** confirm that the demo vendors (Flatini Pizza, Abu Aly Grills, Beit El Sharkia Restaurant, …), their logos and the
prices may appear publicly, or swap in real partner vendors once Production has its catalogue.

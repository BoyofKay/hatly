# Hatly marketplace asset contract

Derived from the actual code and the seeded `hatly_dev` data (read-only). The machine-readable list is
`ASSET_MANIFEST.json` (regenerate with `npm run assets:manifest` in `apps/backend`; the run also validates the manifest
against the database and exits non-zero on any mismatch).

## Manifest format (one entry per unique asset file)

`assetKey`, `assetType`, `entityIds[]` + `entities[]` (id, table, English/Arabic name, sector, vendor, branch, category,
pricing unit), `sharedAcrossEntities`, `expectedFilename`, `mediaPackPath` (`<key>.webp`), `acceptedExtensions`,
`storedUrlPath` (`/uploads/files/marketplace/<key>.webp`, what the seed stores), `targetField`
(`table.column`), `dimensions` (`widthPx`, `heightPx`, `aspectRatio`, `displayedAs`), `usedBy`, `priority`
(1 = rendered by the app today, 2 = catalog, 3 = reserved), `generationBrief`, `hasUrlInDb`,
`deliveredInMediaDir`. The top-level `styleGuide` (look, must-nots, format, crop safety) applies to every asset.
Briefs are templated only from real entity data (names, Arabic names, category, vendor, sector, pricing unit, sibling
product names); nothing is invented.

## How media reaches the Customer app

- Every image is a **backend-served URL stored in an existing column**. No Flutter-bundled marketplace images are
  needed (`apps/customer-app/assets/images` is empty and stays empty); no schema change was required.
- The backend's existing upload architecture stores/serves media as a server-relative path `/uploads/files/<file>`
  (static route in `app.setup.ts`). A future object-storage/CDN provider returns absolute `https://` URLs instead.
- The Customer app resolves both shapes (`lib/core/media/media_url.dart`): relative paths resolve against the API
  **origin** (not `/api/v1`), absolute http(s) pass through, anything else (blank, `stub-upload://`, bare relative)
  falls back to the placeholder instead of issuing a doomed request.
- **Fallback when a column is null / the file 404s:** `HatlyImage` / `HatlySoftImage` show a themed placeholder (sector
  tiles show the slug's Material icon). Verified in `test/core/media/media_url_test.dart`.

## Asset pack layout (what the separate image-generation work must deliver)

One file per key: `<key>.webp` (`.png` / `.jpg` also accepted; webp preferred, quality ~80, < 150 KB for tiles,
< 300 KB for product heroes, sRGB, no text baked into the image). Keys derive from **natural keys** (slug / English
name), never UUIDs, so one pack applies to any database seeded from the same definitions.

| Category | Rows | Files needed | Key | DB column | Aspect | Recommended px | Rendered as |
|---|---|---|---|---|---|---|---|
| Sector | 7 | 7 | `sectors/<sector-slug>` | `marketplace_sectors.image_url` | 1:1 | 512×512 | rounded square tile (r16) on Home "Shop by category" and Explore featured row |
| Subcategory | 14 | 14 | `subcategories/<sector-slug>/<name-slug>` | `marketplace_subcategories.image_url` | 1:1 | 512×512 | **not rendered today** (chips are text) — column is parsed and reserved; lowest priority |
| Vendor logo | 15 | 15 | `vendors/<vendor-slug>/logo` | `vendors.logo_url` | 1:1 | 512×512, subject centred with ~10 % padding | circle: 64 dp (cards), 84 dp (details); also favorites, product-details vendor row, promo fallback |
| Product | 76 rows | 75 | `products/<vendor-slug>/<product-slug>` | `products.image_url` | 1.1:1 card; 1.85:1 hero; 1:1 list/order thumbs (all `BoxFit.cover`) | 1200×1090, **subject inside the central square** | product card, 72 dp list tile, details hero, offers, search results, order-item snapshot |
| Catalog product | 1 | 1 | `catalog-products/<product-slug>` | `catalog_products.image_url` | 1.85:1 hero | 1200×1090 | catalog product details |
| **Total** | **113 entity rows** | **112 files** | | | | | |

Slug = lowercase English name, `&` → `and`, non-alphanumerics → `-`. The 76 products collapse to 75 files because
"Sunflower Oil 1L" is sold by two branches of the same vendor (same picture, same key). Branch names are Arabic-only
in the data, so they are deliberately not part of any key.

### Sector slugs
`restaurants`, `groceries`, `pharmacy`, `bakery`, `meat-poultry`, `produce`, `household`.

### Promos / banners
The data model has **no banner or promo-image column**. The Home promo carousel and offer cards are derived from real
offers and reuse the **product image** (offers) or the **vendor logo** (vendor promotions). The Flutter-only
`Vendor.coverImageUrl` is never populated by the API (the backend has no such column). So there is no separate
promo/banner asset to produce today; a dedicated banner asset would need a deliberate backend model change and was not
made here.

## Applying the pack (dev / tester / sales demo)

The committed pack lives in **`docs/assets/pack/<key>.webp`** and is applied by the existing dev seed — by default, no
environment variable needed (`SEED_MEDIA_DIR` still overrides the location):

```bash
cd apps/backend
npm run seed:dev-marketplace        # Step 6 applies docs/assets/pack
```

Step 6 copies each pack file into the existing uploads directory (`UPLOADS_LOCAL_DIR`, default `./uploads-storage`)
under `marketplace/<key>.<ext>` and stores `/uploads/files/marketplace/<key>.<ext>` in the entity's image column.

**Reset-safe:** every run re-stages the files behind URLs the seed itself stored, so wiping the uploads directory (or
the whole database, then migrating and seeding again) and re-running restores every image. A seeded URL whose asset left
the pack is cleared (the app shows its placeholder) instead of pointing at nothing. A URL set any other way (a real admin
upload) is never touched, and no URL is ever invented for an asset that was not delivered. The run ends with a
broken-reference check (every stored `/uploads/files/...` URL must exist on disk) and exits non-zero if any is broken.
`npm run assets:manifest` reports delivered vs missing against the same pack.

## Source of the delivered assets (Tester & Sales Readiness)

`Hatly_Assets_Final.zip` (crops of a single contact sheet). Applied **byte-for-byte, unmodified** (no re-crop, no
re-encode), mapped by filename onto the keys above:

- **7 sector images** → `sectors/<slug>` (the supplied `produce.webp` is the "Fruits & Vegetables" sector, slug `produce`).
- **72 product photos → all 75 product keys**: `tomatoes`, `potatoes` and `soft-drink-can` are each the same product sold
  by two vendors (one photo, two keys); shortened filenames map to the full product (`eggs-30` → Baladi Eggs (30),
  `paracetamol-500mg` → Paracetamol 500mg (strip), `vitamin-c` → Vitamin C Effervescent, `vitamin-d` → Vitamin D Drops,
  `ibuprofen-400mg` → Ibuprofen 400mg (strip), `antiseptic` → Antiseptic Solution 250ml, `beef-bones` → Beef Bones (for
  stock), `chicken-shawarma` → Chicken Shawarma Sandwich, `croissant` → Cheese Croissant, `chicken-breast-2` → Chicken
  Breast, `dish-soap` → Dish Soap 1L, `kitchen-towels` → Kitchen Towels (pack of 6), `water-bottle` → Water Bottle 1L,
  `extension-cord` → Extension Cord 5m). Not used: `croissant-2` and `chicken-breast-1` (second shots of a product that
  has one image slot), `el-ghnoria` (matches no product).
- **Catalog product** `catalog-products/sunflower-oil-1l` ← `04_catalog/sunflower-oil-1l.webp` from
  `Hatly_Assets_Final_v2.zip` (the corrected 1200×1090 crop — byte-identical to the product photo of the same product).
- **15 vendor logos** ← `02_vendor_logos/*` from `Hatly_Assets_Final_v2.zip` (corrected 512×512 crops; the first package's
  logo files were mis-registered crops containing contact-sheet labels and were never applied). Three filenames differed from
  the vendor names in the data and map to the existing vendor records (no new vendors): `al-ahl-al-dahabi-bakery`,
  `al-gomhoria-grocery`, `beit-el-sharqie-restaurant` (spelling only); the other twelve match by name. For a coherent
  name/logo identity the two demo vendors were then **renamed in place to the name on their logo** (same vendor id; the
  seed renames a vendor still carrying its former name): "Al Forn Al Dahabi Bakery" → **Al Ahl Al Dahabi Bakery** /
  مخبز أهل الذهبي, "Al Gomhoria Greengrocer" → **Al Gomhoria Grocery** (Arabic name unchanged: the Arabic lettering on
  that logo is not legible). Their pack files moved to the new keys (`vendors|products/al-ahl-al-dahabi-bakery/...`,
  `vendors|products/al-gomhoria-grocery/...`).
- The **Hatly brand logo** is bundled in the Customer app (`apps/customer-app/assets/images/hatly-logo.jpg`, shown by
  `HatlyLogo` on the splash and sign-in screens) — app branding, not marketplace data.

## Status

| Present | Missing |
|---|---|
| 112 of 112 files (7 sector, 14 subcategory, 15 vendor logo, 75 product, 1 catalog product), all applied in `hatly_dev`. | — |

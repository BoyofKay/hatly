# Demonstration marketplace — how it works, how to run it, how to retire it

The owner must be able to open the customer app, browse categories, open vendors, add products and reach checkout **without entering 30 vendors by hand**. The
backend therefore ships a safe, reusable, idempotent **demonstration marketplace importer**. It creates 6 categories, 30 vendors (5 per category, one branch each),
221 products with demonstration prices, and 5 discovery banners.

> **Status.** Implemented, tested (24 end-to-end tests against a real PostgreSQL schema and the real customer API) and **executed against a fresh LOCAL database**
> (`hatly_demo_local`). It has **NOT been executed in the shared/Production environment** — see "Shared environment" below. Counts in this document are counts of
> what the importer created locally, not of what is published to customers.

## What is — and is not — in the demonstration data

* Every record is a **demonstration listing**: invented business names, **demonstration prices in EGP** (to be replaced by the owner), no real phone numbers, no real street
  addresses, no real coordinates, no opening hours. A branch's address text reads `عنوان تجريبي — قائمة عرض تجريبية (Demonstration listing)`; its map point is a
  **synthetic point around the centre of an existing service area** (different for every branch, always inside the radius) — it is a placeholder that keeps the branch
  serviceable and its delivery fee measurable, not a shop location.
* Vendors are not described as verified merchants; no medical claims, no prescription medicines (pharmacies list personal-care and first-aid items only).
* No discounts, offers, expiry dates or delivery promises are invented. The 5 banners are general "browse this category" banners (they open the category) on the category
  illustration; real campaign banners are created by the owner in Dashboard → Home Banners.
* The vendor model has **no** description, cover image, featured flag or display-order column, so none is created. The product catalogue uses the supported fields only
  (Arabic/English name, price in minor units, `PIECE`/`WEIGHT` unit, options with price changes, availability, picture).

## Safety guarantees

| Property | How |
|---|---|
| Nothing runs automatically | A standalone script (`npm run demo:marketplace`); never an HTTP endpoint, never imported by the app, never run at start-up. |
| Dry-run first | Default mode prints the full plan (create / exists / conflict per record) and the exact missing pictures; **writes nothing** (tested: no row, no file). |
| Explicit confirmation | A write needs `--execute` **and** `DEMO_IMPORT_CONFIRM_DATABASE=<the connected database's name>`; otherwise it refuses and names the database. |
| Idempotent | Every record has a stable `demo_key` in `demo_seed_records`. A re-run creates only what is missing (tested: zero rows created). |
| Never overwrites | An admin's rename / repricing / deactivation of a demo record survives a re-run; a demo vendor an admin **deleted** is not recreated. |
| Never touches real merchants | A vendor whose name exists but was not created by the importer is a `CONFLICT`: left as it is, its catalogue skipped. An existing sector with the same slug is reused untouched. |
| Same rules as the app | It writes through the application's entities and constraints; each vendor is one transaction (a failure leaves no half vendor; a re-run completes it). |
| Needs a real service area | The demo branches are placed inside an **existing, active** service area (`--service-area <name>` when there is more than one). With none, it stops and says to create it first. |
| Traceable | `demo_seed_records` lists exactly what was created (`--report`), with the batch id `demo-marketplace-v1`. |
| Removable at launch | `--deactivate-demo` deactivates **only** tracked demo vendors / branches / products / banners / sectors. It **deletes nothing** (order history stays intact) and is reversible in the Dashboard. Never automatic. |

## Commands

From `apps/backend` (local / any host with the source):

```bash
npm run demo:marketplace -- --dry-run                       # plan + report, writes nothing
DEMO_IMPORT_CONFIRM_DATABASE=<db> npm run demo:marketplace -- --execute --service-area "<name>" --manifest ./demo-manifest.json
npm run demo:marketplace -- --report                        # what exists now, per record type
DEMO_IMPORT_CONFIRM_DATABASE=<db> npm run demo:marketplace -- --deactivate-demo
```

Options: `--service-area <name|id>` · `--media-dir <dir>` (the asset pack; default `docs/assets/pack`) · `--uploads-dir <dir>` (default `UPLOADS_LOCAL_DIR`, the directory the app serves `/uploads/files/` from) · `--skip-images` · `--manifest <file>`.

On the Production host (inside the release container, after migrations): `deploy/production/prod.sh demo-marketplace --dry-run`, then
`DEMO_IMPORT_CONFIRM_DATABASE=<db> deploy/production/prod.sh demo-marketplace --execute --service-area "<name>"`. Pictures are copied through the local storage driver only; with
`STORAGE_DRIVER=s3` run with `--skip-images` and upload pictures in the Dashboard.

## Prerequisites in the target environment

1. Migrations applied, in order: `1700006000000-HomeBanners`, `1700006100000-AddressMode`, `1700006200000-AdHocRouteLabels`, `1700006300000-DemoSeedRecords`.
2. The real **service area** exists and is active (Dashboard → Service Areas). The owner enters it — the importer will not invent one.
3. For checkout to price a delivery: the delivery zone(s) and fees (Dashboard → Delivery Zones) and, for GPS addresses, the per-100 m rate + minimum fee and Maps (not before authorization).

## Retiring the demo content at commercial launch

1. Enter the real merchants in the Dashboard (or with the existing product import).
2. `--report` to review what is demo; `--deactivate-demo` to take it off the app. Rows are kept (orders reference them); delete individual demo records in the Dashboard if desired.
3. Replace the 5 discovery banners with campaign banners in Dashboard → Home Banners.

## Pictures

71 of 221 products have their own picture from the asset pack; 11 vendor logos come from the pack, 14 vendors use their category picture as a generic logo, 5 coffee/spices vendors have none
(the category itself has no picture). Everything else shows the app's themed placeholder — never a broken image. The exact missing keys are listed in
[DEMO_MARKETPLACE_MANIFEST.md](DEMO_MARKETPLACE_MANIFEST.md). The 5 banner images (`docs/assets/pack/banners/discover-*.webp`, 1200×600) were composed from the category illustrations and
carry no text; they are placeholders for real campaign artwork.

## Shared environment — what exists today (read-only probes, 2026-10-30) and why nothing was published

| Environment | Public API | Catalogue today | Build |
|---|---|---|---|
| **Production** (the release customer app's API) | `https://api.hatly.dev` | `GET /sectors` → `[]` (0 categories, 0 vendors) | `/home-banners` → 404, migrations `HomeBanners` + `AddressMode` pending |
| **Sales Staging** (sales / testers) | `https://api-sales.hatly.dev` | 7 categories, **16 vendors** (restaurants 3, groceries 3, pharmacy 2, bakery 2, meat-poultry 2, produce 2, household 2) — the 2026-10-12 development dataset, 4-6 products per vendor | `/home-banners` and `/addresses/capabilities` → 404 (the 2026-10-17 build) |

**Nothing was published to either environment by this work.** The importer is new code and needs the four new migrations, so publishing = deploying the new release first (backend → migrations)
and then running the importer — both are deployment actions this task is forbidden to perform, and the agent's own permission guard blocks writes to these hosts. No admin credentials are
available to the agent either (it never enters passwords on a remote system). **Minimum action**: approve the controlled deployment task for the chosen environment; the first post-deploy step is
`deploy/production/prod.sh demo-marketplace --dry-run` (plan reviewed by the owner), then `--execute`.

**Decision needed for Sales Staging** (it already has demo data): the importer leaves anything it did not create untouched. The 11 same-named vendors (Abu Aly Grills, Al Noor Pharmacy …) are reported
as `CONFLICT` and kept as they are (4-6 products each); the 19 new vendors are created, which brings restaurants, groceries, pharmacy, bakery and produce to 5+ vendors and adds `coffee-spices` with 5.
`meat-poultry` and `household` would remain at **2 vendors each** — below the "5 per category" target — so either deactivate those two categories in the Dashboard or add vendors to them. On
**Production** (empty catalogue) none of this applies: the importer creates exactly the 6 categories × 5 vendors.

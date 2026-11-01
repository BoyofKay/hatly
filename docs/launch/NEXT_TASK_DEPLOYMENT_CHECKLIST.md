# Next task — controlled deployment and publication (checklist)

The development and the demonstration-data tooling are finished locally. The next task is **only** deployment + publication + smoke tests. Nothing below has been
performed; every ⛔ step needs the owner's explicit approval and is a Production (or Sales Staging) write that the agent's permission guard blocks — a person runs it or lifts the guard.

## 0. What is what

| Class | Items |
|---|---|
| **1. Implemented and tested locally** | PD-011 address methods (GPS/manual) + Hatly/Wasally multiplier; PD-012 Hatly/Wasally route endpoints, Admin default points, quote/order route freezing; Home banners end to end (shape validation, preview, schedule); vendor logo upload; demo marketplace importer; customer app screens; dashboard pages. Test results: see `LAUNCH_PROGRESS.md` §3t. |
| **2. Created and published in the shared environment** | **Nothing.** The shared environments are empty/old (Production: 0 categories; Sales Staging: 7 categories / 16 vendors from the 2026-10-12 build, no banners). The demo marketplace exists only in the LOCAL database `hatly_demo_local` (30 vendors, 221 products, 5 banners). |
| **3. Production data/configuration still required** | Service area; delivery zones + fees; price per 100 m + minimum fee + additional-vendor fee; the three Hatly/Wasally default points; Maps provider (not before billing is authorized); real merchants/banners at commercial launch. |
| **4. Real business information awaiting owner verification** | Real merchant names/prices/phones/addresses/hours (the demo data invents none); real default-point coordinates; campaign banner artwork; vendor logos and product pictures not in the pack (list: `DEMO_MARKETPLACE_MANIFEST.md`). |
| **5. Actions requiring explicit approval** | Every ⛔ below. |

## 1. Release artifacts (built locally, not deployed)

* Backend + dashboard release bundle: `~/Library/Caches/hatly-releases/20261030T133417Z-d37d5469afb7/` (SHA-256 `d37d5469…80f6`) (sha256 beside it; 64 migrations).
* Customer Android AAB: `apps/customer-app/build/app/outputs/bundle/release/app-release.aab` — see §6.
* Driver app: **a new release is recommended** — it shows the Hatly/Wasally Route card (where to go first / where to deliver); `com.hatly.driver` 1.0.0+2 is built and verified (§6). The old driver build keeps working against the new backend (additive API only) but cannot show a route that differs from the customer's address.

## 2. Migration order (Production currently has 60 applied; the plan must list exactly these 4)

1. `1700006000000-HomeBanners`  2. `1700006100000-AddressMode`  3. `1700006200000-AdHocRouteLabels`  4. `1700006300000-DemoSeedRecords` → **64 total**. All four are **additive** (new table / nullable columns / constraints), so the old backend keeps running on the new schema until the switch; each has a reversible `down` (never run in Production — restore a verified dump into a NEW database instead).

## 3. Ordered steps (owner approves each ⛔)

1. Read-only: re-check Production health, migrations (`prod.sh plan` must list exactly the four above), disk, Caddy guard.
2. ⛔ Upload + extract the new release; ⛔ build images under the new tag (procedure and exact commands: `LAUNCH_PROGRESS.md` §3r, with the new release id).
3. ⛔ **Fresh verified backup** (`prod.sh backup`, DB + uploads) **and the restore drill on that dump**. There is no backup cron on the host (§3r) — install it in this task (`install-host-crons.sh`) or the owner accepts the gap.
4. ⛔ Guarded migration: `CONFIRM_MIGRATE=hatly_prod prod.sh migrate` (takes its own backup first).
5. ⛔ Switch the release and recreate backend, then dashboard (`prod.sh apps`); verify `/api/v1/health/ready`, `/api/v1/home-banners` → 200 `[]`, `/api/v1/addresses/capabilities` (customer token) → manual available / GPS `MAPS_DISABLED`, `/api/v1/hatly-service/route-defaults` → all null.
6. Owner enters configuration in the Dashboard (nothing is invented): **service area**; **delivery zones + fees**; **Settings**: price per 100 m, minimum fee, additional-vendor fee (needed for registered-vendor checkout), `HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER` (present, 1.5); **Settings → Hatly & Wasally default route points**: Hatly origin, Hatly destination, Wasally destination.
7. ⛔ Demo marketplace: `prod.sh demo-marketplace --dry-run` → the owner reads the plan (`CREATE` counts: 6/30/30/56/221/8/24/5; `missingImages` list) → `DEMO_IMPORT_CONFIRM_DATABASE=hatly_prod prod.sh demo-marketplace --execute --service-area "<name>" --manifest …`. On **Sales Staging** decide first what to do with its existing `meat-poultry` / `household` categories (2 vendors each) — see `DEMO_MARKETPLACE.md`.
8. Smoke tests (below). 9. ⛔ Customer AAB: only after the above; upload to the Play closed-testing track by the owner (account/tester steps are in `GOOGLE_PLAY_TESTING_PLAN.md`).

## 4. Environment configuration

No new environment variable was introduced by this work. Unchanged requirements: `MAPS_PROVIDER` (stays `none` in Production until the owner authorises Google Maps billing; then `google` + the server key), `UPLOADS_LOCAL_DIR` (absolute, persistent — the demo importer copies pictures there; with `STORAGE_DRIVER=s3` run the importer with `--skip-images`), the existing secrets. The Google **Maps billing** and the provider switch are owner-approval items; **GPS addresses are NOT available in Production while Maps is disabled** and the app says so.

## 5. Smoke tests after deployment

* Customer API: `/sectors` ≥ 5 categories; every category ≥ 5 vendors (`/vendors?sectorId=`); a vendor opens (`/vendor-branches/:id`) and lists products; `/search?q=`; `/products/:id`; `/home-banners` returns 5 with images and category targets.
* Customer app (release build against the shared API): Home banners swipe + tap opens the category; browse → vendor → product → cart → checkout quote (manual address with a zone); Hatly / Wasally request: default points shown (or "choose" if not configured), change each end, review, quote shows origin → destination; place an order (COD) and see the frozen route in order details; GPS option shows unavailable with the reason.
* Dashboard: login; Banners (create, image 1200×600, publish); Settings (route defaults, multiplier text says "both Hatly and Wasally"); Sectors/Vendors/Products; Delivery Zones; order details show the route and a GPS address's coordinates.
* Regression: existing orders open; wallet/payment unchanged; `verify-public-pages.sh`; Caddy guard; Sales Staging unchanged.

## 6. Customer AAB

`dev.hatly.customer` 1.0.0 (**versionCode 4**), 58 MB, SHA-256 `701145cb62c04b6a9ee2806369ea9d27c5c340f961b3f029bd080dd34c586334`, upload-signed (certificate SHA-256 `6E:9D:CF:06:3C:51:F2:BA:39:3E:29:55:4F:6F:43:2A:58:16:00:42:13:73:DD:BA:B4:BF:72:5C:3C:3D:4E:A8`), points at `https://api.hatly.dev/api/v1`, all `build-android-release.sh` checks PASS. Upload it only after the deployment is verified; then `build-android-release.sh record-upload customer closed-testing`. The earlier `1.0.0+3` bundle is obsolete (it predates the address methods and route endpoints). **Driver:** `com.hatly.driver` 1.0.0 (versionCode 2), 52 MB, SHA-256 `80f9b5c80bec53e3066500fb8e83d6ad7de75b73a4d0a43134c1024e86c05103` — it adds the Hatly/Wasally Route card; Hatly/Wasally orders are only fully usable by drivers on this build, so ship it with (not after) the customer build if drivers will take those orders.

## 7. Rollback

Application/dashboard: `echo <previous release id> > RELEASE && ln -sfn releases/<previous> current && prod.sh apps` (the previous images stay tagged; the migrations are additive). Data: restore the verified dump into a NEW database. The demo content: `--deactivate-demo` takes it off the app without deleting anything. Play: halt the track / publish the previous versionCode.

## 8. Owner actions still required

1. Approve the deployment task (and say which environment: Production, Sales Staging, or Staging first). 2. Enter the real service area, zones + fees, per-100 m rate / minimum fee, and the three default points. 3. Decide about Google Maps billing (GPS addresses stay unavailable without it). 4. Provide campaign banner artwork, vendor logos, product pictures (the exact list is in `DEMO_MARKETPLACE_MANIFEST.md`). 5. Play Console steps (account verification, testers, upload).

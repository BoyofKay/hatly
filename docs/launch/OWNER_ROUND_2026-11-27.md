# Owner round 2026-11-27: what changed, how it was tested, what is needed to release

Branch `feature/owner-round-20261127`, based on `main` (8866ead = the deployed release plus the policy files and the Arabic localization merge).
Nothing in this round has been deployed or built for distribution yet.

## 1. Items

| # | Request | Done | Where |
|---|---|---|---|
| 1 | Bulk item photos per branch, many photos in one upload, then choose which photo belongs to which item | Yes | Admin → catalog → "Add many photos". Each photo is matched to an item by its file name; you correct the match, mark the main photo, then save. |
| 2 | Notifications and actions of one order in one place | Yes | Bell and Notification Center: one entry per order, earlier updates listed under it, "mark read" for the whole group. Operations board: 🔔 count per order row. Opening the order marks its alerts read. |
| 3 | Push, Google sign-in and password saving in the customer app | **Deferred by the owner** (later, before go-live) | — |
| 4 | Voice notes on Hatly and Wasaly, up to 5 minutes; text, photos and voice each optional | Yes | Customer app: record, listen, delete; recording stops at 5:00. The note is uploaded with the request. Driver app: plays the note and shows the request photos. Admin and vendor order pages: audio player. Operations "note for the driver" on every order page, shown in the driver app. The existing workflow is unchanged: the driver enters the price, the customer confirms. |
| 5 | The manual-transfer order link showed the refund transfer | Fixed | The page now shows that order's own transfer status (paid / rejected / under review / waiting for the customer / none). The refund box is filled in only for a transfer that was actually paid. |
| 6 | iOS after every tested Android release | Procedure written | `docs/launch/IOS_RELEASE_TRACK.md`. iOS items for this round are already in the code (microphone text in Arabic and English, privacy manifest Audio Data). |
| 7 | General delivery-fee discount for a period (% or fixed fee) | Yes | Admin → Offers → Promotions, target "Delivery fee", with no code needed. Per campaign: who pays the discount, **Hatly or the driver**. |
| 8 | Promo codes managed and monitored in admin, applied in the customer app | Yes | Same page. Hatly-wide or per store/sector; dates, total budget, total uses, uses per customer, new customers only, minimum spend, maximum discount, combinable or not. Monitoring shows uses, discount given, budget left and a list of uses. |
| 9 | Branch coordinates from a Google Maps link | Yes | Branch page and the vendor's new-branch form: paste any Google or Apple Maps link (short share links too); lat/lng are read and shown with a "check on the map" link. |
| 10 | Hatly / Wasaly: choose places with Google Maps / Apple Maps, not only the current location | Yes | Route sheet: "Open the maps app" (Apple Maps on iPhone, Google Maps on Android), share the place, paste the link → the point is set. The in-app map turns on once an app Maps key is added (§4). |
| 11 | Sector page: store logos fill their space | Yes | No padding or frame when the store has no cover photo. |

### Promotion rules worth knowing (item 8)
- A wrong code counts as a failed attempt. After **10 failed attempts in an hour** the customer is asked to wait, which stops code guessing.
- One use per order is recorded. The uses limit and the budget are checked under a lock when the order is placed, so two customers placing orders
  at the same moment cannot exceed them. A cancelled order gives the use back.
- A non-combinable promotion is used alone and is never added to a store's own discount. The customer gets whichever option saves more, and is told when
  their code was not the better option.
- Store offers and store coupons work exactly as before. Promotions are a separate layer on top.
- **Driver settlement:** if Hatly pays a delivery discount, the driver's commission is still calculated on the full fee. If the driver pays it,
  the commission is calculated on the discounted fee.

## 2. Tests run (this environment)

| Area | Result |
|---|---|
| Backend unit tests | 2,517 passed (174 suites) |
| Backend end-to-end: promotions (157), voice notes (158), route authorization (99), cart (40), Hatly service (71, 81, 87), orders (60, 113, 114, 125, 130), isolation and search (96) | All passed |
| Backend migrations and schema integrity | 20 passed |
| Dashboard unit tests and typecheck | 71 passed, typecheck clean |
| Customer app tests | 1,226 passed (including 3 new voice-note tests and the updated Android permission guard) |
| Driver app tests | 118 passed (4 new) |

**Not verified here:**
- A real Android or iOS build with the new native plugins (`record`, `audioplayers`); there is no Android SDK in this environment, so the first native
  compile is the CI app build.
- Recording on a real phone.
- The in-app map with a real key.
- Production data.

## 3. Release plan (needs the owner's explicit "go")

1. **Backend + dashboard deploy** with `ACTION=deploy` on `ops-request`; you approve the run in GitHub.
   - Two new **additive** migrations: `1700010100000-Promotions` (new tables plus 4 nullable order columns) and
     `1700010200000-VoiceNotesAndDriverNote` (3 nullable columns).
   - The runbook takes a backup and a restore drill before migrating.
   - The previous app versions keep working: every new field is optional, and old apps simply do not send or show it.
2. **Customer app 1.2.0+22** (was 1.1.0+21) via the `app-build` branch.
3. **Driver app 1.2.0+24** (was 1.1.0+23) via the `driver-app-build` branch.
4. You test both APKs. Then `main` takes the release (merge), and iOS follows per `IOS_RELEASE_TRACK.md`.

**Cost note (AGENTS.md):** each app build is one Linux run on the private repository. Pushing this branch starts one normal CI run, and the merge to
`main` starts another. If you prefer to avoid private-repo minutes for the two app builds, say so before the builds and make the repository public
temporarily after the security review.

## 4. Owner actions

| Action | Why |
|---|---|
| Say "go" for the deploy and the two app builds | Production change and build minutes |
| Optional: add the GitHub secret `CUSTOMER_MAPS_API_KEY` (a Maps SDK key restricted to the Android package `dev.hatly.customer` with its signing certificate, and to the iOS bundle `com.hatly.customer`) | Turns on the in-app map in the customer app build. Without it the map stays off and link pasting still works. |
| Google Play Data safety: add **Audio** (voice notes, App functionality, not shared) | The customer app now records voice notes when the customer chooses to |
| Still open from earlier: default branch → `main`; delete the old merged branches; `PROD_GOOGLE_MAPS_API_KEY` | Single source of truth; server-side geocoding |

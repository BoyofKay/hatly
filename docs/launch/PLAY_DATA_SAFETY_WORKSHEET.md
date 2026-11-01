# Google Play Data safety — field-by-field worksheet (customer app `dev.hatly.customer`)

Prepared 2026-10-23 from the code and read-only checks; §0/§1 refreshed later on 2026-10-23 (Production HTTPS, build target, built-bundle permissions). **Nothing has been entered in or submitted to Play Console.** Status legend:
**[CODE]** verified from code/configuration · **[RUN]** verified in a running environment · **[COND]** conditional on the release
configuration · **[OWNER]** needs business/legal owner confirmation. Background audit: `PRIVACY_AND_COMPLIANCE.md`.

## 0. Release configuration the answers depend on

| Setting | Finding | Status |
|---|---|---|
| API host | the release script accepts exactly `https://api-sales.hatly.dev/api/v1` (Staging) or `https://api.hatly.dev/api/v1` (Production) — `scripts/launch/build-android-release.sh` (`PROD_API`/`STAGING_API`). **Decision 2026-10-23: the review/pilot build targets Production** (`PLAY_APP_CONTENT_ANSWERS.md` §4); upload-signed bundle rebuilt 2026-10-26 (phone-input fix), versionCode 2, sha256 `d9bde228…f4f1dc2a`, contains `api.hatly.dev` and not the Staging host | [CODE] + [RUN] |
| HTTPS / cleartext | release manifest `usesCleartextTraffic="false"` unless built with `-Phatly.allowCleartext=true` (never passed by the release script, which **fails the build** if the merged manifest allows cleartext); iOS has no ATS exceptions | [CODE] |
| Staging API transport | `api-sales.hatly.dev`: HTTPS 200, valid certificate, `http://` → 308 to `https://` (2026-10-23) | [RUN] |
| Production API transport | `api.hatly.dev`: HTTPS end to end since 2026-10-23 (Cloudflare **Full (strict)** + Cloudflare Origin certificate at the origin; `http://` → 308 `https://`); answers the Stage 1 "coming soon" 503 until Stage 3 puts the API behind it | [RUN] |
| Firebase / FCM | in the app as a dependency (`firebase_core`, `firebase_messaging`) but **inactive unless `android/app/google-services.json` is added** (absent today; `Firebase.initializeApp()` fails and no token is collected; the Gradle plugin is not applied) | [COND] |
| Google Maps SDK (in-app map) | bundled (`google_maps_flutter`) but **off**: shown only with `--dart-define=HATLY_MAPS_ENABLED=true`, which the release script never passes | [CODE] / [COND] |
| Google Maps Platform (server) | Production template `MAPS_PROVIDER=google` (geocoding + distance from the backend); Staging uses the deterministic provider | [CODE] |
| Google Fonts | fetched at runtime from Google (`HatlyTypography.useGoogleFonts = true`, no bundled font files) — Google receives IP/connection data, no account data | [CODE] |
| SMS / OTP (Unifonic) | Production template sets Unifonic; Staging `CUSTOMER_OTP_ENABLED` off | [CODE] / [COND] |
| Analytics, ads, crash reporting SDKs | none in `pubspec.yaml`; crash handling prints in debug builds only (`error_reporting.dart`) | [CODE] |
| Permissions in the built bundle (2026-10-23) | `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `POST_NOTIFICATIONS`, `WAKE_LOCK`, `c2dm.permission.RECEIVE` (the last three come from the Firebase Messaging plugin; with push off the app never shows the notification prompt — `FirebaseMessaging.requestPermission()` is only reached after a successful `Firebase.initializeApp()`); no `AD_ID` | [RUN] |

## 1. "Data collection and security" page

| Console question | Proposed answer | Evidence / status |
|---|---|---|
| Does your app collect or share any of the required user data types? | **Yes** | §2 · [CODE] |
| Is all of the user data collected by your app encrypted in transit? | **Yes** — the app only talks to `https://api.hatly.dev` (cleartext disabled in the release manifest, verified on the built bundle); answer once Stage 3 serves the API there | §0 · [CODE] + [RUN] · Production API pending Stage 3 |
| Do you provide a way for users to request that their data is deleted? | **Yes** — in the app (Profile → Delete my account) **and** the web page `/account-deletion` | in app [CODE] (e2e 101); web page [CODE] (e2e 103) **but not deployed** — blocker until its public URL works |
| Delete account URL | the published HTTPS address of `/account-deletion` (proposed `https://hatly.dev/account-deletion`) | **not live** — see `PRIVACY_AND_COMPLIANCE.md` §8 |
| Account creation (if asked) | users create accounts in the app with a phone number and password | [CODE] |
| Independent security review | No | [OWNER] |

## 2. Data types (Console categories). "Shared" = see §3 before answering

| Category → data type | Collected | Shared | Ephemeral | Required / optional | Purposes | Evidence | Status |
|---|---|---|---|---|---|---|---|
| Personal info → **Name** | Yes | see §3 | No | Required | App functionality; Account management | `users.full_name` | [CODE] |
| Personal info → **Phone number** | Yes | see §3 | No | Required | App functionality; Account management; Fraud prevention, security and compliance (sign-in brake) | `users.phone`; `login-attempt-limiter.ts` | [CODE] |
| Personal info → **User IDs** | Yes (account id) | No | No | Required | Account management; App functionality | `users.id` | [CODE] |
| Personal info → **Address** | Yes | see §3 | No | **Optional** (pickup orders and browsing need none) | App functionality | `addresses`, `orders.delivery_address_snapshot` | [CODE] + [OWNER] (required vs optional wording) |
| Personal info → Email address | **No** | — | — | — | — | no API writes `users.email` | [CODE] |
| Location → **Precise location** | Yes (only when the user taps "use my current location"; address/errand coordinates) | see §3 | No | Optional | App functionality | `device_location_service.dart`; coordinates on addresses and Hatly Service segments | [CODE] |
| Location → Approximate location | **No** (the manifest also lists `ACCESS_COARSE_LOCATION`, but the app requests precise only when the user asks) | — | — | — | — | `AndroidManifest.xml` | [CODE] + [OWNER] (Play may question the coarse permission) |
| Financial info → **Purchase history** | Yes (orders) | see §3 | No | Required (created by ordering) | App functionality | `orders`, `order_items` | [CODE] |
| Financial info → **Other financial info** | Yes (wallet and loyalty balances/ledgers) | No | No | Required | App functionality | `wallet_transactions`, `loyalty_points_transactions` | [CODE] |
| Financial info → User payment info | **No** (no card entry, no gateway) | — | — | — | — | — | [CODE] |
| Photos and videos → **Photos** | Yes (gallery, for custom requests / Hatly Service) | see §3 | No | Optional | App functionality | `image_picker` (`ImageSource.gallery`); `uploads` | [CODE] |
| Messages → any | **No** (support opens WhatsApp outside the app) | — | — | — | — | `whatsapp_helper.dart` | [CODE] |
| App activity → **Other user-generated content** | Yes (order notes, custom-request text, rating comments, cancellation reasons) | see §3 | No | Optional | App functionality | order/rating entities | [CODE] |
| App activity → **In-app search history** | Yes, **processed ephemerally** (not stored) | No | **Yes** | Optional | App functionality | `/search`; no search table; query strings are not logged | [CODE] |
| App activity → App interactions / Other actions | No (no analytics) | — | — | — | — | — | [CODE] |
| App info and performance → Crash logs / Diagnostics | **No** for Hatly's code. **If Firebase is enabled:** follow Google's published Data safety guidance for the Firebase SDKs actually included | — | — | — | — | `error_reporting.dart` | [CODE] / [COND] |
| Device or other IDs | **No** today. **Yes if `google-services.json` is added** (FCM registration token, stored in `device_tokens`; purpose App functionality; required for push) | if yes: No (Google acts as service provider) | No | Optional (push) | App functionality | `fcm_service.dart`, `device_token_api.dart` | [COND] |
| Contacts, Calendar, Audio, Files, Health, Web browsing | No | — | — | — | — | no such permission or plugin | [CODE] |

Server-side request logs hold the user id and, in security events, the IP address (not used to derive location) — covered by the
privacy policy; no separate Data safety type is proposed. [OWNER/legal confirm]

## 3. "Shared" — needs the owner's classification

Google counts a transfer as **sharing** unless an exception applies (service provider acting on your behalf; a transfer the user
initiates and would reasonably expect; legal; anonymised). Proposed, pending confirmation:

| Recipient | Data | Proposed classification | Why it needs the owner |
|---|---|---|---|
| Driver of the order | name, phone, delivery address, order | **Not "shared"**: delivering the order the user placed (user-initiated + Hatly's own delivery operation) | depends on whether drivers act for Hatly (employees/contractors) — **[OWNER]** |
| Shop/restaurant of the order | order contents, notes, custom-request text and photos (no name/phone/address) | **Not "shared"**: the user sends the order to that shop to fulfil it | contractual relationship with vendors — **[OWNER]** |
| Google Maps Platform, FCM, Unifonic, hosting provider | as in the privacy policy | **Not "shared"**: service providers processing for Hatly | data-processing terms with each provider — **[OWNER]** |
| Google Fonts | IP/connection data only | not user data in a Data safety category | **[OWNER]**; or bundle the fonts in the app to remove the connection |
| WhatsApp | only what the user sends themselves | user-initiated, outside the app — not "shared" | — |

If the owner classifies drivers or vendors as independent third parties, mark Name, Phone number, Address, Precise location, Purchase
history, Photos and Other user-generated content as **Shared** with purpose **App functionality**.

## 4. What changes with the release configuration

| Change | Answers that change |
|---|---|
| Add `google-services.json` (push on) | Device or other IDs → **collected** (FCM token, App functionality, optional); add the Firebase SDKs' own disclosures per Google's guidance; privacy policy already describes FCM conditionally |
| Build with `HATLY_MAPS_ENABLED=true` + a Maps key | add the **Google Maps SDK**'s own Data safety disclosures (Google's published guidance for the Maps SDK for Android) |
| Production API live over HTTPS | "Encrypted in transit: Yes" for the Production build becomes answerable |
| Deletion page published | "Delete account URL" becomes answerable |
| Fonts bundled instead of fetched | the Google Fonts connection disappears |

## 5. Entry guide (owner, in Play Console — do not submit until §6 is clear)

1. Play Console → the app → **Policy and programs → App content → Data safety → Start/Manage**.
2. **Overview** → Next. **Data collection and security**: answer per §1 (collect/share **Yes**; encrypted in transit per §1; deletion **Yes**; enter the Delete account URL).
3. **Data types**: tick exactly the "Collected" rows of §2 (Name, Phone number, User IDs, Address, Precise location, Purchase history, Other financial info, Photos, Other user-generated content, In-app search history; plus Device or other IDs only if push is on).
4. **Data usage and handling**: for each ticked type enter Collected/Shared (per §3), "processed ephemerally" (only In-app search history = Yes), required/optional and purposes per §2.
5. **Preview** → check the summary against the privacy policy page → **Save**. Submit only with the decisions in §6 made.
6. Separately, **App content → Privacy policy**: the published `/privacy` URL. **App access**: per `PLAY_REVIEWER_ACCESS.md` §6.

## 6. Open before submitting

1. Owner classification for §3 (drivers, vendors, providers). 2. Push on or off for the review build. 3. Address required vs optional
wording. 4. Production HTTPS (or submit for a Staging-targeting closed test only). 5. Published `/privacy` and `/account-deletion` URLs
verified with `scripts/launch/verify-public-pages.sh`. 6. ~~Approved contact e-mail and effective date for the policy~~ — set 2026-10-23 (`apps/dashboard/lib/legal/public-site.ts`).

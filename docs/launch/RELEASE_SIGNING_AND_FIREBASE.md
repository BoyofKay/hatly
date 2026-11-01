# Release signing and Firebase — exact remaining steps (prepared 2026-10-17)

**Rule for everything below:** private keys, keystores, `.p8` keys, service-account JSON and passwords are created and held by the owner. They are never generated, read, committed, pasted into chat or uploaded by Claude. The repository only contains the *places* they go (all git-ignored) and a checker, `scripts/launch/release-preflight.sh`, that reports present/missing without printing a value.

## Owner checklist — Android signing + Firebase (in order; ☐ = you; nothing here needs Google Play or Apple verification)

**Do today/tomorrow (independent of every account approval):**
- ☐ **1. Create the upload keystore** with `scripts/launch/upload-keystore.sh create customer` (§A; it also writes `key.properties` — step 3 below is done by the script) — you choose and keep the password. *Why now:* the first uploadable AAB cannot exist without it, and the closed-test clock cannot start without that AAB.
- ☐ **2. Back it up twice** (password manager attachment + an encrypted drive). Never in the repo, never in chat.
- ☐ **3. Fill `apps/customer-app/android/key.properties` and `apps/driver-app/android/key.properties`** from the `.example` files (git-ignored; the preflight checks they exist and name a real keystore file, and prints no value).
- ☐ **4. Create the Firebase project** (free Spark plan) and register **four apps**: Android **`dev.hatly.customer`** (changed from `com.hatly.customer` on 2026-10-19), Android `com.hatly.driver`, iOS `com.hatly.customer`, iOS `com.hatly.driver` (§B).
- ☐ **5. Download the two `google-services.json`** into `apps/<app>/android/app/` (git-ignored). The iOS plists wait for the Xcode step (Apple team).
- ☐ **6. (Server, later, gated)** service-account key → `FCM_*` in the server env file only.
- ☐ **7. Run** `scripts/launch/release-preflight.sh --api-url <https URL>` and tell Claude the result (it prints PASS/FAIL, never a secret).

**After Google identity verification completes:** create the two app records, enable **Play App Signing** at first upload, upload the first release-signed AAB to **Closed testing** (`GOOGLE_PLAY_TESTING_PLAN.md`). **After Apple approves you:** team in Xcode, Push capability, APNs key → Firebase, `GoogleService-Info.plist` into the Runner target (`APPLE_INDIVIDUAL_ENROLLMENT_CHECKLIST.md`).

**What Claude will and will not do:** build the AABs once you say go (the build reads `key.properties` locally; the secrets are never printed or copied), keep all checkers green, and prepare everything else. Claude will not create keys, read your keystore or passwords, create cloud resources, upload to a store, or spend money.

## What is already automated (done and verified)

| Item | State |
|---|---|
| Android release signing is read from `android/key.properties` (git-ignored); without it the build falls back to the debug key and says so | existing code; the 2026-10-16 bundles were debug-signed as designed — **not uploadable** |
| Google Services Gradle plugin is wired in **both** Android apps and applied **only if** `android/app/google-services.json` exists | added 2026-10-17. Verified: both bundles build without the file (customer 60.4 MB, driver rebuilt); with a **fake** config file Gradle ran `:app:processDebugGoogleServices` successfully (the fake file was deleted at once) |
| Firebase files are git-ignored (`google-services.json`, `GoogleService-Info.plist`, `key.properties`, `*.jks`, `*.keystore`) | verified by the preflight |
| iOS purpose strings, App Store icon without alpha, version `1.0.0+1` | done |
| Preflight (`scripts/launch/release-preflight.sh --api-url https://api.hatly.dev/api/v1`) | today: **11 blocking items** — every one is an account/credential item below, except the driver icon (decision in `store/icons/`) |

## A. Android release signing (owner, ~15 min) — rewritten 2026-10-19

**Why a script instead of a bare `keytool` line:** the password must never appear on a command line (visible in `ps` and saved in shell history), on screen, in a log or in the repository. `scripts/launch/upload-keystore.sh` takes it as hidden input, hands it to `keytool` through the environment (`-storepass:env`), refuses to overwrite anything, refuses any path inside the repository, and writes `key.properties` with mode 600. Claude never runs `create` and never sees the password or the file.

1. **Create** (interactive Terminal on your Mac; you will be asked for the password twice, then keytool asks for your name/organisation — answers are only certificate text):
   ```bash
   cd /Users/abdullahrezk/Downloads/hatly-current-mac-handoff/hatly
   scripts/launch/upload-keystore.sh create customer
   ```
   Default location `~/hatly-secrets/hatly-upload.jks` (outside the repository; `--keystore /absolute/path` to choose another). Use `both` instead of `customer` to sign both apps with one keystore — Play App Signing makes either choice safe. Password: 12+ characters, no backslash, no leading/trailing space; generate it in your password manager.
2. **Back it up TWICE, today.** (a) your password manager, as a file attachment on the same entry as the password; (b) an encrypted drive or an encrypted disk image (Disk Utility > New Image > Image from Folder > AES-256) kept somewhere other than this Mac. Never e-mail it, never put it in cloud-sync folders unencrypted, never commit it. **Prove a backup opens** (the password is typed at the prompt, not on the command line):
   ```bash
   "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool" -list -keystore /path/to/the/backup-copy.jks
   ```
3. **Validate** (prints only public facts; fails on a wrong password, a debug key, a key under 2048 bits, validity ending before Oct 2033, a keystore inside the repository, or loose file permissions):
   ```bash
   scripts/launch/upload-keystore.sh validate customer
   ```
4. **Enrol in Play App Signing** when creating the app in Play Console (default for new apps): Google holds the real app-signing key; you only ever use this upload key.
5. **Build and verify the bundle.** The wrapper builds it and checks the result; only its last line "milestone 2 — UPLOAD-SIGNED BUNDLE BUILT AND VERIFIED" means a real signed bundle exists:
   ```bash
   scripts/launch/build-android-release.sh customer --api-url https://api-sales.hatly.dev/api/v1   # Staging pilot; use https://api.hatly.dev/api/v1 only when Production is running
   ```
   After **you** upload it in Play Console, record it so the next build is forced to a higher versionCode: `scripts/launch/build-android-release.sh record-upload customer closed-testing` (writes `docs/launch/RELEASE_UPLOAD_LOG.tsv`; contains no secret). Every later upload needs the number after `+` in `apps/customer-app/pubspec.yaml` raised (`1.0.0+2`, …); the wrapper refuses a reused one.
6. **If the upload key is ever lost or leaked:** with Play App Signing enabled, Play Console > your app > Test and release > App signing offers a way to request an upload-key reset (Google verifies you and registers a new key) — **UNVERIFIED by me**; read the Console's own instructions. Without Play App Signing a lost key cannot be replaced, which is why step 4 matters.

**What is checked automatically and where:** `scripts/launch/test/build-android-release.test.sh` (85 cases — refusals, stale/failed builds, URL allow-list, versionCode, leaks; uses stubs, no real key), the Android-config guards in `apps/customer-app/test/core/config/android_release_config_test.dart`, and the real merged manifest of every build.

## B. Firebase (push notifications) — free (Spark plan), owner account

1. Create **one** Firebase project (for example "Hatly") with your Google account. Add four apps: Android **`dev.hatly.customer`**, Android `com.hatly.driver`, iOS `com.hatly.customer`, iOS `com.hatly.driver` (these ids are in the projects today; changing them later is painful — confirm them now).
2. Download `google-services.json` for each Android app → `apps/<app>/android/app/google-services.json`; `GoogleService-Info.plist` for each iOS app → `apps/<app>/ios/Runner/` **and add it to the Runner target in Xcode** (drag it in with "Add to targets: Runner" ticked; a file merely sitting in the folder is not bundled).
3. Server side: Project settings → Service accounts → *Generate new private key* → from that JSON set **only on the server**: `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` in `.env.production` (and `.env.staging` if staging should push). All three or none; never commit the JSON.
4. iOS push needs an **APNs authentication key** (`.p8`) created in the Apple Developer account (Keys → "+" → Apple Push Notifications service) and uploaded in Firebase → Project settings → Cloud Messaging → Apple app configuration (Key ID + Team ID). One key serves both apps.
5. In Xcode (after the team is set, section C): Runner → Signing & Capabilities → **+ Capability → Push Notifications**. (Xcode creates `Runner.entitlements` with `aps-environment`; it flips to `production` automatically for App Store/TestFlight builds. Hand-editing the project file was deliberately avoided.)
6. Verify with the controlled push procedure in `docs/security/staging-readiness-checklist.md` §6 (tester account, one real push, no credential exposure).
7. **Privacy consequence:** Firebase Messaging/Installations (and Crashlytics, if chosen) are data processors — the store forms in `PRIVACY_AND_COMPLIANCE.md` §3–§5 already list the SDK data; add Crashlytics' only if you enable it.

### B-android. Customer Android only — the minimum, and what happens without it (audited 2026-10-19)

**Required for a push on a tester's phone: BOTH halves.** (1) the app half — `apps/customer-app/android/app/google-services.json`; (2) the server half — `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` in the backend env file. **Staging has no FCM credentials today** (its log says `fcm … not_configured`), so even with the app file, pushes will not arrive in a Staging-backed pilot until you approve adding them to `.env.staging` (a Staging change — Claude will not do it without your explicit go).
**Not required for the closed test:** neither half. Without the file the Gradle plugin is simply not applied, the app starts, signs in and restores sessions normally (`FcmService` is wrapped at startup and at login; proven by `apps/customer-app/test/core/push/push_unconfigured_test.dart`, mutation-checked), and the in-app Notifications screen still works because notifications are stored by the backend. Adding the file later = a new build with a higher versionCode.
Steps for the app half: Firebase console > your project > Add app > Android > package name **`dev.hatly.customer`** (exact — NOT the old `com.hatly.customer`) > download `google-services.json` > put it in `apps/customer-app/android/app/` (git-ignored) > `scripts/launch/release-preflight.sh --android-only customer --api-url <URL>` must show "has project_id, mobilesdk_app_id and an API key entry for com.hatly.customer" (it checks the structure and prints no value) > rebuild with a higher versionCode. A SHA-1/SHA-256 is **not** needed for FCM; the bundle's signer fingerprints are printed by the build wrapper and are only needed if you later restrict a Maps key or add sign-in-with-Google.
**Google Maps (mobile):** optional. The map is compiled in only with `--dart-define=HATLY_MAPS_ENABLED=true`; by default the address picker uses GPS and manual entry. If you enable it later: a *restricted* Android key (package `dev.hatly.customer` + the **Play App Signing** certificate SHA-1 shown in Play Console, plus the upload-key SHA-1 for local installs) in `android/local.properties` as `MAPS_API_KEY=` (git-ignored) or the `MAPS_API_KEY` environment variable. The backend's own *server* key is a separate key and is required for Production, not for this build.

## C. iOS signing and App Store Connect (owner)

1. Enrol in the Apple Developer Program (individual: ID verification; **organisation: needs a D-U-N-S number — Apple states up to 5 business days from the request plus about 2 days for Apple to receive it**). US$99/year.
2. Developer portal → Identifiers: register `com.hatly.customer` and `com.hatly.driver` (Push Notifications enabled). Xcode automatic signing can do this once the team is selected.
3. Xcode → open `apps/<app>/ios/Runner.xcworkspace` → Runner target → Signing & Capabilities → select the Team (this fills `DEVELOPMENT_TEAM`, which the preflight checks).
4. App Store Connect → My Apps → "+" New App for each (name, bundle id, SKU, language Arabic).
5. Build and upload: `flutter build ipa --release --dart-define=API_BASE_URL=<production URL>` then upload with Xcode Organizer or Transporter; first internal TestFlight, then external TestFlight (Beta App Review), then submit for App Review with the **demo credentials** and the privacy answers (`PRIVACY_AND_COMPLIANCE.md` §4).

## D. Google Play Console (owner)

1. Create the developer account (US$25 one-time; identity verification). **Account type decides the schedule** — see `CRITICAL_PATH.md`.
2. Create two apps; enable Play App Signing; upload the first bundle to **Internal testing**.
3. Fill: store listing (`store/STORE_LISTINGS.md`), content rating, target audience, **Data safety** (`PRIVACY_AND_COMPLIANCE.md` §5), **account-deletion URL**, privacy-policy URL.
4. If the account is a *new personal* account: run **Closed testing** with at least 12 testers opted in for 14 continuous days, then apply for production access.
5. Release with a **staged rollout** (for example 20 % → 50 % → 100 %) so a bad build can be halted.

## E. Things that need money or an account (nothing created)

Apple Developer US$99/yr · Google Play US$25 once · Firebase Spark free · D-U-N-S free (organisation) · off-site backup storage (owner's choice) · SMS provider per-message cost (Unifonic) · Google Maps Platform usage (the server key is already required by the backend; the *mobile* map key is **optional** — the app works without it via GPS plus server-side address search, so it is not a launch blocker).

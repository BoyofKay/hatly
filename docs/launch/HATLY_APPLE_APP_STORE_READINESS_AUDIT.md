# Hatly Customer App — Apple App Store & TestFlight Readiness Audit

**Date:** 2026-11-13 (updated the same day after the app-side fixes — §4 and §13) · **Scope:** audit and planning, then the approved small iOS fixes. Nothing was created, bought, signed, uploaded or submitted, and no source file, bundle id
or signing setting was changed. The only thing produced besides this report is an unsigned local build in `build/` (evidence that the app compiles
for a real iPhone).

**Evidence labels:** **[Apple]** = stated on an official Apple page (sources at the end) · **[Observed]** = checked on this Mac / in the project on
2026-11-13 · **[Estimate]** = experience-based, not promised by Apple · **[Owner]** = only the owner can provide or decide it.

This builds on (and supersedes where it differs) `docs/launch/APPLE_INDIVIDUAL_ENROLLMENT_CHECKLIST.md` (2026-10-17), `PRIVACY_AND_COMPLIANCE.md`
and `store/STORE_LISTINGS.md` in the main checkout.

---

## 1. Executive summary

- **The app itself is technically close to ready for iOS.** It builds and runs on the iPhone simulator (Arabic, RTL, live production data), and an
  unsigned **Release** build for real iPhones compiles today: `com.hatly.customer` 1.0.0 (12), iOS 26.5 SDK, Xcode 26.6, minimum iOS 15, production API
  compiled in, 24 SDK privacy manifests bundled. Apple's current upload rule (Xcode 26 / iOS 26 SDK since 28 Apr 2026) is already met **[Apple][Observed]**.
- **The blocker is the account.** Without the paid Apple Developer Program there is no distribution certificate, no App Store Connect record, no
  TestFlight and no push (APNs). Enrolment costs **US$99 per year** (shown in local currency at checkout where Apple offers it) **[Apple]**.
- **Recommendation: enrol as an Individual now** (the owner's legal name appears as the seller). An Organization account needs a registered legal
  entity, a D-U-N-S number, a public website and a domain e-mail — none of which are confirmed today. You can move to an organization later.
- **A handful of app-side items should be fixed before the first TestFlight build** (all small, none done in this audit): iPad support is switched on
  (forces iPad screenshots and iPad review), iPhone landscape is allowed, permission prompts are English-only and the app does not declare Arabic to the
  App Store, the export-compliance key is missing, there is no app-level privacy manifest, and push is not configured for iOS.
- **Biggest App Review risks:** a reviewer outside Egypt cannot complete an order without a prepared demo account and address (guideline 2.1), the
  pharmacy category (guideline 1.4.3), and the privacy-policy retention gaps.
- **Realistic timeline after the owner pays:** first internal TestFlight build in **2–4 working days**, public release in **about 1–2 weeks** if nothing
  is rejected **[Estimate]**.

---

## 1a. Status after the owner's device-scope decision (2026-11-13)

### Owner-approved product decision — initial iOS release
- **iPhone only** and **portrait only** for the first release; **iPad and landscape are deferred** to a later release.
- This is **reversible** and not an architectural limit: it is set only in iOS configuration (no Dart/Flutter layout code was removed or changed).
  To add iPad later: set `TARGETED_DEVICE_FAMILY = "1,2"` in `Runner.xcodeproj` (3 build configurations); to add landscape: add the landscape
  values back to `UISupportedInterfaceOrientations` in `Info.plist`. The iPad orientation list (`UISupportedInterfaceOrientations~ipad`) was kept
  on purpose for that future release. iPad and landscape then need their own layout testing and screenshots.

### Verified implementation (uncommitted in the main working copy)
| Change | Where | Verified |
|---|---|---|
| iPhone only | `TARGETED_DEVICE_FAMILY = 1` in the project's Debug/Release/Profile configurations | Built app has `UIDeviceFamily = [1]` |
| Portrait only | `Info.plist` → `UISupportedInterfaceOrientations = [Portrait]` | Built app shows only Portrait; on the simulator the device was turned to landscape and the app stayed upright in portrait |
| Arabic + English declared | `CFBundleLocalizations = ar, en`; project `knownRegions` + `ar` | In the built app |
| Arabic permission prompts | `Runner/ar.lproj/InfoPlist.strings` (location, camera, photos), in Runner's resources | Bundled at `Runner.app/ar.lproj/InfoPlist.strings`; English strings in `Info.plist` unchanged |
| Encryption declaration | `ITSAppUsesNonExemptEncryption = false` | Evidence: only HTTPS (Dio) and Keychain (`flutter_secure_storage`); the app's code imports no crypto library — `crypto` is only a transitive hashing dependency of `google_fonts`/`uuid` (hashing is not encryption) |
| App privacy manifest | `Runner/PrivacyInfo.xcprivacy`, in Runner's resources | Bundled at the app root; valid plist; no tracking, no tracking domains, no required-reason APIs; 9 data types |
| Bundle id, signing, team, provisioning | — | **Unchanged** (`com.hatly.customer`, automatic signing, no team) |

**Privacy manifest — evidence per declared data type** (what the app's own code sends to Hatly's server; all linked to the user, purpose App
Functionality, no tracking): Name and Phone Number (registration/sign-in); **Physical Address** (saved delivery addresses —
`features/addresses/data/addresses_api.dart`); Precise Location (GPS coordinates of an address — `core/location/device_location_service.dart`,
when in use only); Photos or Videos (custom-request / Hatly Service pictures — `custom_request_action.dart`, `hatly_service_screen.dart`); Other User
Content (order notes, custom-request text, ratings — `features/ratings/data/rating_api.dart`); Purchase History (orders); User ID; Device ID (push
token — `features/notifications/data/device_token_api.dart`, sent only once push is configured). Not collected by the app: e-mail, contacts, payment
card data, health, analytics/crash data (no analytics or crash SDK). The Support screen only reads Hatly's contact details.

**What the app manifest does NOT cover (deliberately):** data collected by third-party SDKs. Those SDKs ship their own manifests — 24 are in the
build (Flutter, Firebase Core/Installations/Messaging, GoogleUtilities, GoogleDataTransport, nanopb, Promises, Google Maps, flutter_secure_storage,
geolocator, image_picker, shared_preferences, sqflite, url_launcher). Two frameworks carry none: Flutter's compiled `App` framework (the app's own
Dart code, covered by the app manifest) and `objective_c` (a Dart FFI helper, not on Apple's listed-SDK list) — **watch the warnings after the first
upload**. Apple's App Privacy answers in App Store Connect must still include what the SDKs collect (e.g. the Firebase installation/device ID)
— `PRIVACY_AND_COMPLIANCE.md` §4 lists those; the manifest alone is not the full declaration.

**New finding (no change made):** `google_fonts` downloads the font files from Google's servers the first time the app runs, so the user's IP address
reaches Google. It is not "collected data" in Apple's definition, but the privacy policy should mention it; alternatively the fonts can be bundled
in a later release (removes the network dependency).

**Checks on 2026-11-13:** iPhone simulator build ✓, launch ✓ (Arabic Home with production data), portrait enforced ✓, unsigned release build for
iPhone ✓; `flutter analyze` 0 errors / 0 warnings (31 style notes, unchanged); `flutter test` **1,205 passed, 2 skipped, 0 failed**.

### Remaining Apple Developer enrolment requirements (owner)
Apple Account with 2FA and legal name → card that can pay US$99 → enrol as Individual → then Xcode team sign-in, App Store Connect record, (optional)
APNs key for push. Signing, upload, TestFlight and App Review stay **BLOCKED** until then.

### Remaining App Store review and privacy tasks
Confirm the App Privacy answers in App Store Connect (now including **Physical Address** and the SDK-collected device ID); support URL with real
contact data; privacy-policy controller identity, retention periods and the Google Fonts note; pharmacy licensing confirmation (guideline 1.4.3);
category and territories (Egypt only recommended); iPhone 6.9" screenshots; demo account with an address in an active zone and review notes;
real-iPhone test (possible now with a free Personal Team).

## 2. Apple enrolment from Egypt

### Individual account
| Topic | What Apple says / what applies |
|---|---|
| Eligibility | An Apple Account with **two-factor authentication**, of legal age in your region **[Apple]**. |
| Identity | Use your **legal first and last name** in the Apple Account (no nickname, no "Hatly") — an alias delays approval **[Apple]**. Apple verifies legal name, phone and address; **P.O. boxes are not accepted** **[Apple]**. Apple may ask for a **government photo ID**, e.g. when the card holder's name differs **[Apple]**. |
| Fee | **US$99 per membership year**, listed **in local currency during enrolment** where available; prices may vary by region **[Apple]**. Auto-renews yearly. |
| Payment | A card in **your own name**; another person's card delays enrolment **[Apple]**. Whether an Egyptian card is enabled for this foreign online payment is a bank question **[Owner]**. |
| Seller name shown on the App Store | **Your personal legal name** **[Apple]**. Individuals cannot set a different developer name **[Apple]**. |
| D-U-N-S | **Not needed** for individuals **[Apple]**. |
| How | Website (developer.apple.com/programs/enroll) or the **Apple Developer app** on an iPhone/iPad/Mac **[Apple]**. |
| Egypt | Egypt is an App Store storefront (EGP) **[Apple]**, but Apple publishes **no list of countries where enrolment works** and warns some regions may not be supported. **[Unverified]** — the enrolment flow itself is the test. If it refuses Egypt or the card, stop and report; that is the only scenario that changes this plan. |

### Organization account
| Topic | What applies |
|---|---|
| Legal entity | The organization must be a **legal entity able to contract with Apple**; **DBAs, trade names, fictitious names and branches are not accepted** **[Apple]**. In Egypt this means a company registered in the commercial registry (e.g. an LLC or a one-person company) — **[Owner]** whether Hatly is registered. A sole trader using the name "Hatly" does not qualify as an organization. |
| D-U-N-S Number | **Required**; **free in most jurisdictions** **[Apple]**. Look it up / request it through Apple's D-U-N-S tool; after D&B issues it, allow **up to 2 business days** for Apple to receive it **[Apple]**. D&B's own processing time for an Egyptian company is **[Unverified]** (often days to a few weeks **[Estimate]**). The legal name and address must match the registration exactly. |
| Authority | The person enrolling must have **legal authority to bind the organization** **[Apple]**; Apple may call to verify. |
| Website & e-mail | A **publicly available website** on the organization's domain and a **work e-mail on that domain** **[Apple]**. **[Observed]** `hatly.dev` currently redirects to the Admin login — it is **not** a public company website yet. |
| Fee | Same **US$99/year** **[Apple]** (fee waivers exist only for non-profits, accredited educational institutions and government entities — not for individuals or small businesses **[Apple]**). |
| Seller name | The **legal entity name** **[Apple]**; a registered trade name can be set as developer name **once**, when the first app is created **[Apple]**. |

### Recommendation (section 3 of the brief)
**Enrol as an Individual now.** It is the only route that does not depend on documents that do not exist yet (company registration, D-U-N-S, public
website, domain e-mail). The trade-off: the App Store will show the owner's legal name as seller. When Hatly becomes a registered company, enrol a
separate Organization account and use Apple's **app transfer** to move the app (reviews and ratings move with it) **[Apple, app transfer]**.
Choose Organization first only if showing "Hatly" as the seller at launch matters more than speed and the company documents already exist.

---

## 3. Exact costs

| Item | Cost | Status |
|---|---|---|
| Apple Developer Program | **US$99 / year**, charged in local currency where Apple offers it **[Apple]** | Mandatory |
| Bank foreign-currency / card fees, and any tax Apple adds at checkout in Egypt | Depends on the bank and on Apple's local price **[Unverified]** — the exact EGP amount appears only on the checkout screen | Mandatory, amount unknown |
| D-U-N-S | **Free** in most jurisdictions **[Apple]** — only for an Organization account | Not needed (Individual) |
| Xcode, Flutter, CocoaPods, TestFlight, App Store Connect | Free **[Apple][Observed]** | — |
| Mac | Already available **[Observed]** | — |
| Firebase Cloud Messaging (push) | Free tier **[Estimate]** | Only if iOS push is wanted |
| Google Maps key | The in-app map is **off** in builds today **[Observed]**; no cost unless enabled | Optional |
| Hosting | No new cost: the production API is already running | — |
| Apple's commission | **None** for Hatly orders: physical goods and services are paid outside Apple (no In-App Purchase) **[Apple 3.1.3(e)]** | — |

---

## 4. Existing Mac and iOS project status (observed 2026-11-13)

| Item | Finding | Classification |
|---|---|---|
| macOS | 26.5.1 | READY |
| Xcode | 26.6 (17F113), iOS SDK **26.5** device + simulator | READY (meets the Xcode 26 / iOS 26 SDK upload rule **[Apple]**) |
| Flutter / Dart | Flutter 3.47.3 stable, Dart 3.13.3 | READY |
| CocoaPods | 1.17.0 (plugins mostly via Swift Package Manager; `Podfile.lock` holds only Google Maps) | READY (terminal shows a UTF-8 locale warning only) |
| Bundle identifier | `com.hatly.customer` (Android uses `dev.hatly.customer` — different but harmless) | READY — must be registered in the Apple account first |
| Display name | "Hatly" (`CFBundleName` is `hatly_customer`, not shown to users) | READY |
| Version | 1.0.0 (12) from `pubspec.yaml` | READY |
| Deployment target | iOS 15.0 | READY |
| Devices | **iPhone only** (owner-approved for the first release, 2026-11-13; `TARGETED_DEVICE_FAMILY = 1`, was iPhone + iPad) | READY — no iPad screenshots needed; iPads run it in iPhone mode; iPad deferred, reversible |
| Orientation | iPhone **portrait only** (owner-approved, 2026-11-13; landscape deferred, reversible) | READY — verified on the simulator |
| App icon | Full set incl. 1024×1024, no transparency | READY |
| Launch screen | Flutter default storyboard with a 1×1 placeholder image (white screen) | READY (acceptable), optional branding |
| Permissions | Location When-In-Use, Camera, Photo Library — English in `Info.plist`, **Arabic in `ar.lproj/InfoPlist.strings`** (2026-11-13) | READY |
| Languages | `CFBundleLocalizations = ar, en` (2026-11-13) | READY |
| Export compliance | `ITSAppUsesNonExemptEncryption = false` (2026-11-13: standard iOS encryption only — HTTPS, Keychain) | READY — owner to answer the same in App Store Connect if asked |
| Production API | `--dart-define=API_BASE_URL=https://api.hatly.dev/api/v1` at build time; release build checked: host present | READY |
| Push | `firebase_messaging` included, but **no `GoogleService-Info.plist`, no Push entitlement, no background mode** | BLOCKED (needs APNs key ⇒ paid membership) |
| Maps | Map widget compiled out unless `HATLY_MAPS_ENABLED=true`; iOS key empty | READY (map stays off, manual/GPS address works) |
| Signing | `CODE_SIGN_STYLE = Automatic`, **no `DEVELOPMENT_TEAM`**, **0 signing identities**, **0 provisioning profiles** on this Mac | BLOCKED (membership) |
| Simulator | Built and ran on iPhone 17e (iOS 26.5) on 11 and 13 Nov with production data | READY |
| Real-iPhone release build | `flutter build ios --release --no-codesign` succeeded (42.8 MB app) | READY (unsigned) |
| App-level privacy manifest | `Runner/PrivacyInfo.xcprivacy` added 2026-11-13 (no tracking; data the app sends to Hatly) + 24 SDK manifests | READY — must match the App Privacy answers |

**Can it run without paid membership?** Yes — on the **simulator** (done) and, with any free Apple Account added to Xcode, on the **owner's own iPhone**
using a free "Personal Team" development profile (expires after about 7 days, no push, no TestFlight) **[Apple, Xcode free provisioning — Estimate on
the exact limits]**. Everything that leaves the owner's hands — TestFlight, the App Store, push — needs the paid membership.

---

## 5. Signing and build readiness

| Capability | Without paid membership | With membership |
|---|---|---|
| Simulator builds | Yes | Yes |
| Run on the owner's own iPhone | Yes, free Personal Team, short-lived profile | Yes |
| **Apple Distribution certificate** | No | Created by Xcode (automatic signing) or in Certificates, IDs & Profiles |
| **App Store provisioning profile** | No | Created automatically by Xcode for `com.hatly.customer` |
| App ID registration + capabilities (Push) | No | Yes |
| APNs key (.p8) for push via Firebase | No | Yes (Keys → Apple Push Notifications service) |
| **Archive for distribution** (`flutter build ipa`) | Unsigned only | Signed `.ipa` |
| **Upload to App Store Connect** (Xcode Organizer / Transporter) | No | Yes — must be built with Xcode 26 / iOS 26 SDK **[Apple]** |

Steps once enrolled (owner clicks; Claude can prepare everything else): add the Apple Account in Xcode → select the Team in `Runner` → keep
automatic signing → (if push) add Push Notifications + Background Modes "Remote notifications" → `flutter build ipa --release
--dart-define=API_BASE_URL=https://api.hatly.dev/api/v1` → upload. Nothing is signed or uploaded without the owner's explicit go.

---

## 6. App Store Connect checklist

| Item | Status | Notes |
|---|---|---|
| App record (name, bundle id `com.hatly.customer`, SKU, primary language **Arabic**) | NEEDS MEMBERSHIP | Name availability is checked at creation |
| App name / subtitle (30 characters each) | READY (draft) | `store/STORE_LISTINGS.md` (Arabic + English) |
| Category | NEEDS OWNER INPUT | Recommended primary **Food & Drink**, secondary **Shopping** |
| Description, keywords (100 characters), promotional text | READY (draft) | `store/STORE_LISTINGS.md`; keywords to be cut to 100 characters |
| **Support URL** | MISSING | Must lead to real contact information **[Apple 1.5]** — e.g. a public `/support` page with WhatsApp/phone/e-mail **[Owner]** |
| **Privacy Policy URL** | READY (live) | `https://admin.hatly.dev/privacy` (Arabic + English, effective 2026-10-23) — retention gaps in §8 |
| Marketing URL | Optional | `hatly.dev` is not public yet |
| Screenshots | MISSING | iPhone: **one size is required (6.9" or 6.5")** **[Apple]**; **iPad 13" required if iPad stays supported** **[Apple]**. Capture from the simulator (iPhone 17 Pro Max = 6.9") with real data |
| App preview video | Optional | Not needed for launch |
| Age rating questionnaire | NEEDS OWNER INPUT | Answer truthfully; confirm what vendors may list (medicines, tobacco?) |
| **App Privacy** ("nutrition label") | READY (draft) → NEEDS OWNER CONFIRMATION | `PRIVACY_AND_COMPLIANCE.md` §4: Contact Info, Precise Location, User Content, Purchases, User ID/Device ID, Diagnostics; **no tracking** |
| Export compliance | NEEDS OWNER CONFIRMATION | App uses only standard HTTPS/Keychain encryption ⇒ normally "exempt" |
| Content rights | NEEDS OWNER INPUT | Vendor photos/logos: confirm Hatly has the right to show them |
| Review contact (name, phone, e-mail) | NEEDS OWNER INPUT | — |
| **Review notes + demo account** | PARTLY READY | A Play reviewer customer account exists (credentials in `~/hatly-secrets`, never shown); add a **saved delivery address inside a served zone**, a store that is open, and notes explaining cash on delivery and that service is in Egypt only |
| Availability (territories) | NEEDS OWNER INPUT | Recommend **Egypt only** (also avoids the EU trader-status requirement — **[Unverified]**, check what App Store Connect asks) |
| Price | READY | Free |
| Agreements, tax, banking | Not needed for a free app without In-App Purchase **[Estimate]** | The Free Apps agreement is accepted at enrolment |

---

## 7. App Review risks (Hatly's actual model)

**Physical vs digital.** Everything Hatly sells is a **physical good or a real-world service** (restaurant meals, groceries, vegetables, pharmacy and
care products, sweets/coffee, Hatly Service errands, delivery). Apple's rule for these is **3.1.3(e): use payment methods other than In-App Purchase**
(e.g. cash, cards, Apple Pay) **[Apple]**. Hatly's cash, InstaPay/manual transfer and wallet flows are therefore allowed, and **no In-App Purchase or
Apple commission applies**. There are **no digital goods** (no subscriptions, paid features or digital content); the wallet and loyalty points are spent
only on physical orders. Keep it that way: if a digital feature is ever sold, IAP rules would apply **[Apple 3.1.1]**.

| Risk | Guideline | Level | Mitigation (no business-rule change) |
|---|---|---|---|
| Reviewer (often outside Egypt) cannot order: "no stores near you" | 2.1 App completeness | **High** | Demo account with a saved address in an active zone, an open test-friendly store, step-by-step review notes; explain cash on delivery |
| Pharmacy / care products | 1.4.3 (controlled substances only via licensed pharmacies) | **Medium** | **[Owner]** confirm pharmacy partners are licensed and no prescription-only medicines are sold through the app; say so in review notes |
| iPad layout if iPad stays enabled | 2.4.1 / 4.x | Medium | Make the app iPhone-only, or test and screenshot on iPad |
| Landscape on iPhone | 4.x design | Low–Medium | Lock to portrait |
| Account deletion | 5.1.1(v) | **Low — met** | In-app: Profile → "Delete my account" (password confirmation, explains what is kept) **[Observed]**; mention it in review notes |
| Login wall | 5.1.1 | Low — met | Guest browsing exists; login only to order **[Observed]** |
| Location | 5.1.1 / 5.1.5 | Low — met | When-in-use only, clear purpose string, manual address alternative **[Observed]**; add the Arabic string |
| Push | 4.5.4 | Low | Use push only for order updates; no marketing without opt-in. Not configured yet |
| Privacy policy content | 5.1.1(i) / 5.1.2 | Medium | Policy is live; add the missing **retention periods** and contact details (§8) |
| Support / contact | 1.5 | Medium | Publish a support URL with real contact data |
| Sign in with Apple | 4.8 | Not applicable | Only phone + password, no third-party login **[Observed]** |
| Third-party SDK manifests | Privacy requirement (ITMS-91061) | Low | SDKs ship manifests **[Observed]**; watch upload warnings |
| Disputes / refunds | 3.1.3(e), 5.x | Low | Describe in support page how order problems are handled (existing operations process) |

---

## 8. Privacy and legal gaps

| Item | Status | What to do |
|---|---|---|
| Privacy Policy (public, Arabic + English) | READY | Live at `/privacy` **[Observed]** |
| Data controller identity & contact in the policy | **NEEDS OWNER INPUT** | The legal name (the individual or the company), address/contact for privacy requests — do not invent |
| Retention periods (orders/payments, proof-of-delivery photos, backups, logs) | **MISSING** | Open decisions 1–5 in `PRIVACY_AND_COMPLIANCE.md` §2 — owner/legal |
| In-app account deletion | READY | **[Observed]** |
| Web deletion page | READY | `https://admin.hatly.dev/account-deletion` **[Observed]** |
| Data collected | READY (evidence-based list) | Name, phone, addresses, precise location (when in use), photos for custom requests, order history, device identifiers via SDKs |
| Tracking / ATT | READY | No ad SDKs, no tracking ⇒ no App Tracking Transparency prompt needed |
| Notification permission | READY in code (Android); iOS needs APNs setup | — |
| App-level `PrivacyInfo.xcprivacy` | READY (2026-11-13) | Declares Name, Phone, **Physical Address** (newly added to the draft), Precise Location, Photos, Other User Content, Purchase History, User ID, Device ID — owner confirms the same answers in App Store Connect |
| App Privacy questionnaire | READY (draft) | Owner confirms, then enters it in App Store Connect |
| Arabic permission prompts | READY (2026-11-13) | `ar.lproj/InfoPlist.strings` |

---

## 9. TestFlight plan

| Stage | Needs membership | Plan |
|---|---|---|
| Prepare (screenshots, notes, demo account, app-side fixes) | No | Do now (roadmap §11 step 1) |
| Upload build | Yes | `flutter build ipa` → Organizer/Transporter; processing usually minutes to an hour **[Estimate]** |
| **Internal testing** | Yes | Up to **100** App Store Connect users, **no review needed** **[Apple]** — owner, operations staff, 2–3 trusted people with iPhones |
| **External testing** | Yes | Up to **10,000** testers by e-mail or public link **[Apple]**; the **first build needs Beta App Review** **[Apple]** (same demo account/notes as App Review) |
| Test instructions | No | Short Arabic script: register/login → set address → order from a test store (cash) → track → cancel/complete → delete a test account |
| Feedback | Yes | Screenshots + comments via the TestFlight app **[Apple]**; plus the team's WhatsApp group |
| Crash monitoring | Yes | TestFlight crash reports and Xcode Organizer crashes (no extra SDK) |
| Release candidate check | Yes | Same build number as submitted; verify production API, Arabic, ordering, deletion, permissions; builds **expire after 90 days** **[Apple]** |

---

## 10. Android / iOS feature parity

| Area | Android (Play closed test, 1.0.0+12) | iOS today | Gap |
|---|---|---|---|
| Ordering, cart, checkout, tracking, wallet, loyalty | Ready | Same Flutter code, runs on simulator | iOS device testing |
| Payments (cash, manual transfer/InstaPay, wallet) | Ready | Same; allowed by 3.1.3(e) | None |
| Arabic / RTL | Ready | Ready in-app (verified on iPhone 17e) | Arabic permission prompts + `CFBundleLocalizations` |
| Push notifications | Code present, **off** (no `google-services.json`) | Code present, **off** (no `GoogleService-Info.plist`, no APNs key, no Push capability) | Both need Firebase config; iOS also the APNs key (membership) |
| Location | Fine/coarse location | When-in-use string | None |
| Camera / photos | Supported | Purpose strings present | None |
| Map pin picker | Off unless enabled | Off unless enabled (iOS key empty) | Only if the map is turned on |
| Account deletion | In app + web | Same code | None |
| Android-only dependencies | None found in `pubspec.yaml` | — | — |
| Device classes | Phones (tablets allowed) | iPhone **and iPad** enabled | Decide iPhone-only |
| Testing needed | Done on emulator | Simulator done; **real iPhone not yet** | Real iPhone (free Personal Team is enough before enrolment) |

---

## 11. Prioritised roadmap

| # | Task | Why | Who | Paid membership? | Depends on |
|---|---|---|---|---|---|
| **1. Without membership** |||||
| 1.1 | Decide iPhone-only vs iPhone + iPad | Avoids iPad screenshots/review | Owner decides, Claude changes | No | — |
| 1.2 | Lock iPhone to portrait | Prevents broken landscape layouts | Claude | No | approval |
| 1.3 | Add Arabic permission prompts + declare Arabic/English | Arabic users, store language list | Claude | No | — |
| 1.4 | Add `ITSAppUsesNonExemptEncryption = false` | Skips the encryption question per upload | Claude after owner confirms | No | 1.4 answer |
| 1.5 | App-level privacy manifest | Matches the App Privacy label | Claude after owner confirms §4 answers | No | owner confirmation |
| 1.6 | Support page with contact data; privacy-policy retention + controller details | Guidelines 1.5 / 5.1 | Owner provides text, Claude publishes | No | owner/legal input |
| 1.7 | Screenshots 6.9" iPhone (and 13" iPad if kept), Arabic first | Required for submission | Claude | No | 1.1–1.3 |
| 1.8 | Demo account with an address in an active zone + review notes | Biggest rejection risk | Claude prepares, owner approves | No | an open store in that zone |
| 1.9 | Test on the owner's iPhone with a free Personal Team | First real-device check | Owner (Apple ID in Xcode) + Claude | No | — |
| 1.10 | Confirm pharmacy licensing / product rules | Guideline 1.4.3 | Owner | No | — |
| **2. Enrolment** |||||
| 2.1 | Apple Account with 2FA, legal name, own card; ask the bank to allow the foreign payment | Avoids enrolment delays | Owner | — | — |
| 2.2 | Enrol as Individual and pay US$99 | Unlocks everything below | Owner | **Yes** | 2.1 |
| **3. Signing & distribution prep** |||||
| 3.1 | Add Apple Account in Xcode, select Team, automatic signing | Distribution certificate + profile | Owner signs in, Claude configures | Yes | 2.2 |
| 3.2 | (If push) APNs key → Firebase; Firebase iOS app + `GoogleService-Info.plist`; Push capability | iOS push | Owner downloads key, Claude wires the app | Yes | 2.2 |
| 3.3 | Create the App Store Connect record | Needed for upload | Owner | Yes | 2.2 |
| 4 | **First iOS release build**: `flutter build ipa` with the production API, then upload | Gets a signed build to Apple | Claude builds, owner approves the upload | Yes | 3.1, 3.3 |
| 5 | **Internal TestFlight** | Team testing, no review needed | Owner invites, team tests | Yes | 4 |
| 6 | **External TestFlight** (optional) | Wider beta; the first build is reviewed | Owner | Yes | 5 |
| 7 | **App Store submission**: metadata, privacy label, age rating, notes, demo account | Required for public release | Owner submits, Claude prepares all text | Yes | 1.x, 5 |
| 8 | **Public release**: manual release after approval, Egypt only | Go live | Owner | Yes | 7 |

**Timeline [Estimate]:** enrolment approval 1–2 days (Apple gives no individual SLA; contact support if no confirmation within 24 hours of purchase
**[Apple]**); first internal TestFlight 1–2 days after approval; Beta/App Review often within a day or two, but a rejection adds 1–3 days per round.
Total from payment to public: **about 1–2 weeks** if section 1 is done first.

---

## 12. Exact actions required from the owner

1. Decide: **Individual now** (recommended) or Organization later/now (only if Hatly is a registered company with D-U-N-S, public website and domain e-mail).
2. Prepare an **Apple Account** with two-factor authentication, your **legal name exactly as on your ID**, a real street address and phone.
3. Ask your bank that your card (in **your own name**) can pay **US$99 to Apple** online in a foreign currency.
4. Decide **iPhone-only** or iPhone + iPad, and confirm **portrait-only**.
5. Confirm the **App Privacy** answers (`PRIVACY_AND_COMPLIANCE.md` §4) and that the app uses **no encryption beyond HTTPS** (export compliance).
6. Provide **support contact details** (phone/WhatsApp/e-mail) and the **legal name/contact for the privacy policy**; decide the **retention periods**.
7. Confirm **pharmacy partners are licensed** and what products vendors may list (age rating, guideline 1.4.3).
8. Choose the **store category** (recommended Food & Drink, secondary Shopping) and **territories** (recommended Egypt only).
9. Approve a **demo account and address** for Apple's reviewers, and keep one test store open during review.
10. After enrolment: sign in to Xcode on this Mac, create the App Store Connect record, (optional) create the APNs key, and give the go for each upload/submission.

---

## 13. Final classification

| Area | Status |
|---|---|
| Mac, Xcode 26.6, iOS 26.5 SDK, Flutter, CocoaPods | **READY** |
| App builds for simulator and (unsigned) real iPhone, production API | **READY** |
| Bundle id, version 1.0.0 (12), icon, display name, launch screen | **READY** |
| In-app account deletion, public privacy policy and deletion page | **READY** |
| Payment model under Apple rules (physical goods, no IAP) | **READY** |
| Store texts, App Privacy draft | **READY (draft) — NEEDS OWNER INPUT** to confirm |
| iPad support / orientation | **READY** (iPhone-only, portrait) |
| Arabic permission prompts, language declaration, export-compliance key, app privacy manifest, iPhone-only, portrait-only | **READY** (done 2026-11-13, not yet committed) |
| Support URL, privacy controller/retention details, pharmacy confirmation, category, territories | **NEEDS OWNER INPUT** |
| Screenshots, demo address + review notes | **MISSING** (can be done before enrolment) |
| Apple Developer membership | **BLOCKED** (owner enrolment and payment) |
| Signing certificate, provisioning profile, App Store Connect record, TestFlight, upload | **BLOCKED** (needs membership) |
| iOS push notifications | **BLOCKED** (needs membership for the APNs key; also Firebase config) |
| Real-iPhone test | **MISSING** (possible now with a free Personal Team) |

---

## Sources (official Apple pages)
- [Apple Developer Program — Become a member](https://developer.apple.com/programs/enroll/) — fee, individual vs organization, requirements
- [Enrollment help](https://developer.apple.com/help/account/membership/program-enrollment/) and [Enrollment support](https://developer.apple.com/support/enrollment/)
- [Identity verification](https://developer.apple.com/help/account/membership/identity-verification/)
- [Enrolling with the Apple Developer app](https://developer.apple.com/help/account/membership/enrolling-in-the-app/)
- [D-U-N-S Number](https://developer.apple.com/help/account/membership/D-U-N-S/)
- [Fee waivers](https://developer.apple.com/help/account/membership/fee-waivers/)
- [Membership details](https://developer.apple.com/programs/whats-included/)
- [Set your developer name](https://developer.apple.com/help/app-store-connect/create-an-app-record/set-your-developer-name/)
- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) — 1.4.3, 1.5, 2.1, 3.1.1, 3.1.3(e), 4.8, 5.1.1
- [Upcoming requirements — Xcode 26 / iOS 26 SDK from 28 Apr 2026](https://developer.apple.com/news/upcoming-requirements/)
- [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/) and [App Store Connect release notes](https://developer.apple.com/help/app-store-connect/release-notes/)
- [TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview), [Add internal testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/), [Invite external testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/), [Build statuses (90-day expiry)](https://developer.apple.com/help/app-store-connect/reference/app-uploads/app-build-statuses/)
- [Privacy updates for App Store submissions (privacy manifests, required-reason APIs)](https://developer.apple.com/news/?id=3d8a9yyh) and [App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/)
- [Auto-renewable subscription price thresholds (Egypt storefront, EGP)](https://developer.apple.com/help/app-store-connect/reference/in-app-purchases-and-subscriptions/auto-renewable-subscription-price-increase-thresholds/)

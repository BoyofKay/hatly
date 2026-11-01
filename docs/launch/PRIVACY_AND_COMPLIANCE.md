# Privacy disclosures and store compliance — DRAFT for owner confirmation and legal review

Prepared 2026-10-17. **Nothing here has been submitted, published or declared to any store.** Each row says where the fact comes from; anything marked **CONFIRM** needs the owner's factual confirmation and **LEGAL** needs legal review before it is repeated in a store form or a privacy policy. These are engineering facts about the code, not legal advice.

## 1. What the apps and the backend actually collect (evidence-based inventory)

| Data | Customer app | Driver app | Purpose | Linked to the person | Shared with | Evidence |
|---|---|---|---|---|---|---|
| Name | yes (registration) | no (created by Hatly) | account, order handoff | yes | the **driver** of the order and Hatly admins (vendors do **not** see the customer's name, phone or address — `VendorOrderView`) | `users.full_name`; auth DTOs |
| Phone number | yes | yes (account login id) | sign-in, delivery contact, optional SMS verification | yes | vendors/drivers for the order; SMS provider when verification is on (**CONFIRM provider and whether OTP is on at launch**) | `users.phone` |
| Password | yes (stored only as a bcrypt hash on the server) | yes | sign-in | yes | nobody | `password_hash` select:false; bcrypt |
| Saved addresses incl. coordinates | yes (map picker) | no | delivery | yes | the vendor/driver of that order (snapshot on the order) | `addresses`, `orders.delivery_address_snapshot` |
| Precise device location | yes — only when the customer taps to use their location | yes — every 20 s **while online**, app in the foreground only | find the delivery address; assign and run deliveries | customer: used to fill an address; driver: stored as the driver's **last** position | Google Maps Platform (geocoding/distance via the backend) | `device_location_service.dart`; `driver_location_service.dart` (interval 20 s); `drivers.last_latitude`; Android manifest has no background-location permission |
| Photos | yes — only photos the customer chooses for a custom request / Hatly Service | yes — delivery photo (proof of delivery) | fulfil the request / prove delivery | linked to the order | the vendor/Hatly; stored on the server (local disk or S3-compatible storage) | `image_picker` use; `uploads` table; customer photos are **erased on account deletion** (rows + files); proof-of-delivery photos are kept — **retention LEGAL/CONFIRM** (section 2) |
| Orders, order notes, ratings (stars + optional comment), favourites | yes | deliveries and cash-collection records | the service itself, accounting, disputes | yes | vendors/drivers as needed | entities `orders`, `*_ratings`, `favorites` |
| Payments | choice of method, manual-transfer proof sent **outside the app** via WhatsApp | cash collected amount | accounting | yes | — | no card number is ever entered or stored; no online gateway exists |
| Wallet and loyalty ledgers | yes | no | accounting | yes | — | `wallet_transactions`, `loyalty_points_transactions` |
| Push token | yes | yes | order/delivery notifications | yes | Google (Firebase Cloud Messaging) | `device_tokens`; `firebase_messaging` |
| Device/installation identifiers and SDK diagnostics | via Firebase and the Google Maps SDK | same | push delivery; the SDKs' own analytics/diagnostics | per the SDKs | Google | **bundled SDK privacy manifests** (section 3) |
| Advertising ID, tracking, analytics SDKs of our own, crash reporter | **none** | **none** | — | — | — | no such dependency in either `pubspec.yaml`; no `NSUserTrackingUsageDescription`; no ATT prompt |
| Server logs | request metadata (route, status, correlation id, client IP); query strings and bodies are not logged; phone numbers are not logged | same | security and operations | partly (IP) | the host/hosting provider | `docs/security/security-milestone-2026-10-16.md` §8; **retention of logs — CONFIRM** |

## 2. Account deletion (a store requirement) — in app 2026-10-17; without the app + wider erase 2026-10-23

**Three ways to delete, one erase** (`apps/backend/src/modules/auth/account-deletion.service.ts`):

| Way | Who / proof | Endpoint | Result |
|---|---|---|---|
| In the customer app | Profile → "Delete my account", password re-entered | `POST /auth/customer/delete-account` (signed-in customer) | deleted at once |
| **Public web page, self-service** (no app needed) | phone number + password — the same proof as signing in; one generic answer for every non-match (no account-existence oracle); the per-account failed-attempt brake (10 failures / 15 min, then 429 even with the right password); 3 requests/min per IP | `POST /account-deletion/delete` (public) — page `/account-deletion` of the dashboard app | deleted at once |
| **Public web page, "I can't sign in"** | phone number only; **deletes nothing by itself**; the same answer for any number; at most one open request per number | `POST /account-deletion/requests` (public, 3/min per IP) | a SUPER_ADMIN verifies the requester controls the number (**call-back to that number, or a WhatsApp message FROM that number**; never asks for a password), then completes it (`POST /admin/account-deletion-requests/:id/complete`, records the verification method) or rejects it with a reason. Dashboard: **Deletion requests** |

* **Erased (all three ways):** name, e-mail, password, phone (replaced by a placeholder, which also frees the number), saved addresses, push tokens, notifications, favourites, open cart, review comments; on the customer's finished orders: delivery-address snapshot, order note, **cancellation reason, notes to the vendor and per item, custom-request descriptions and photo references, Hatly Service pickup/destination coordinates**; and **the customer's uploaded photos themselves — the `uploads` rows and the stored files** (local disk or object storage; removed after the database commit, failures counted in the audit entry as `filesNotRemoved` for an operator retry).
* **Kept without identity:** order, payment, wallet, loyalty-ledger and refund records (amounts, items/product names, timestamps, order numbers), rating stars, **the Hatly Service place name**, and the **driver's proof-of-delivery record and photo** (uploaded by the driver, not the customer). **LEGAL/CONFIRM** each of these below.
* **Refused (409):** while an order is in progress, or while the wallet balance is not zero (settled with support first). A web request then stays pending. Loyalty points are forfeited (the page and the app say so). **CONFIRM** forfeiting points is intended.
* **Request records hold only the phone number while pending**; on completion or rejection it is replaced by `***` + last three digits, so the request log cannot re-identify a deleted account. The deletion itself is in `admin_audit_logs` by user id (no phone, no name).
* **Driver accounts** are not self-service (created and removed by Hatly); state this in the driver listing and the policy.
* **Tests:** e2e `101-customer-account-deletion` (in app) and `103-account-deletion-web` (web self-service, brake, 409s, wider erase incl. the stored file, request flow, SUPER_ADMIN-only review); unit `upload-removal.spec.ts` (only generated files are ever removed; signed S3 delete).

### Open decisions (not decided in code — **LEGAL / PRODUCT**)
1. **Retention period for the kept accounting records** (orders, payments, wallet/loyalty ledgers). Egyptian tax/commercial rules may require a period; then a purge or further anonymisation job is needed — none exists.
2. **Proof-of-delivery photos** (they may show the customer's door or the recipient) and the recipient name: kept with the order today for disputes; decide a retention period and whether to erase them on account deletion.
3. **Hatly Service place name**: kept as part of the purchase record; it is usually a shop, but it is free text the customer typed.
4. **Backups**: database dumps (`deploy/production/backup-postgres.sh`) are not encrypted and have **no rotation**; a deleted account stays in older dumps until they are deleted. Decide a backup retention period (e.g. 30 days) and state it in the policy; consider encrypting the dumps.
5. **Logs**: request logs carry paths with record ids, and security events carry user id/role/IP; no rotation is configured on the hosts. Decide a log retention period and configure rotation.
6. **Who reviews web requests and how fast** (an owner and a response time to publish on the page), and which official WhatsApp/phone number staff use to verify.

## 3. Third-party SDK disclosures that **must** be reflected in the store forms

Both apps' built iOS bundles contain these SDK privacy manifests (read from `build/ios/iphoneos/Runner.app`, 2026-10-16). Apple's App Privacy answers and Google's Data safety form must include data the SDKs collect, so the claim "we collect no diagnostics/analytics data" would be **wrong**:

| SDK (manifest) | Declares collecting | Purposes | Linked to user | Tracking |
|---|---|---|---|---|
| Firebase Installations | Other diagnostic data | Analytics | no | no |
| Firebase Messaging | Device ID; other data; other diagnostic data | App functionality; Analytics | no | no |
| Google Data Transport | Other diagnostic data | Analytics | no | no |
| Google Maps (SDK + Flutter plugin) | Crash data, Performance data, Product interaction, Device ID, other data, User ID | Analytics / App functionality | partly **yes** (Device ID, User ID, other) | no |

The same SDKs, plus `flutter_secure_storage`, `shared_preferences`, `geolocator`, `image_picker`, `url_launcher`, `sqflite` and Flutter itself, also ship manifests declaring "required reason" API use (UserDefaults, file timestamp, disk space, system boot time). None of the manifests declares tracking.

## 4. Apple — draft App Privacy answers (App Store Connect) — **CONFIRM + LEGAL**

*Customer app* — Data **linked to the user**: Contact Info (Name, Phone Number) · Location (Precise Location) · User Content (Photos or Videos; Other User Content = notes, custom-request text, ratings/comments) · Purchases (Purchase History = orders) · Identifiers (User ID; Device ID — Firebase/Google Maps) · Diagnostics/Usage (Crash Data, Performance Data, Product Interaction — Google Maps SDK). Purposes: App Functionality (all), Analytics (SDK items only). **Used to track you: none** (no ad SDK, no ATT, manifests say no tracking).
*Driver app* — same, minus Purchases, plus the driver's location while online and delivery photos; Contact Info (Name, Phone Number) only as the account Hatly created.
**Open point:** Apple lets you omit data collected only on-device and not transmitted; everything above is transmitted to Hatly's server or to Google's SDK endpoints, so it is declared.

## 5. Google Play — draft Data safety answers — **CONFIRM + LEGAL**

**Superseded in detail by `PLAY_DATA_SAFETY_WORKSHEET.md` (2026-10-23: field-by-field, with evidence and status per answer). Reviewer sign-in: `PLAY_REVIEWER_ACCESS.md`.**

* *Does the app collect or share required data types?* **Yes.** Collected: Personal info (name, phone number, user IDs), Location (precise — customer on request; driver while online), Photos, App activity/orders, Device or other IDs (FCM token, SDK identifiers), App info and performance / Crash logs (Google Maps SDK). Shared with third parties: Google (FCM, Maps) acting as service providers — **CONFIRM how Google's own disclosure for each SDK should be mapped**.
* *Encrypted in transit:* yes **once production is served only over HTTPS** (the apps refuse non-HTTPS release builds only for localhost; Android release builds forbid cleartext by default — verified in the 2026-10-16 AAB). **CONFIRM** production TLS before answering.
* *Users can request deletion:* yes — in the app, and **without the app at `/account-deletion` (implemented, NOT yet published — see section 8)**; driver accounts through Hatly. *Deletion URL for the Play Console:* the published HTTPS address of that page.
* *Not sold; no ads; not for children.*
* Permissions to justify in the Play listing: precise location (customer address picker; driver deliveries), camera (driver proof of delivery), photos (customer attachments). The Android manifests declare `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `INTERNET` (both), `CAMERA` (driver). No background location.

## 6. iOS privacy manifests (`PrivacyInfo.xcprivacy`)

* **Plugins and SDKs already ship their own** (24 manifests inside the customer build, 22 in the driver build) — so the "missing SDK privacy manifest" rejection class does not apply. One framework in the customer build (`objective_c`) carries none; it is a Dart FFI helper, not a listed "required SDK" — **watch the App Store Connect upload warnings** after the first upload.
* **An app-level manifest is not present.** What it would contain: `NSPrivacyTracking = false`, no tracking domains, the collected-data types from section 4, and required-reason entries only for APIs the **app's own code** calls (Dart code does not call UserDefaults/file-timestamp APIs directly; plugins do, and they declare them). Because the collected-data declaration is a legal statement, the file is **proposed, not added**: once the owner confirms section 4, it can be added in one step to each `ios/Runner/` (Xcode target membership included). Apple still requires the answers in App Store Connect either way.

## 7. Privacy policy — public page `/privacy` (2026-10-23) and its outline — **LEGAL**

The policy now exists as a public bilingual page (`apps/dashboard/app/privacy/page.tsx`; Arabic first, RTL; English, LTR), written from the audited behaviour. No earlier PDF/HTML draft existed in the repository or the owner's Downloads/Desktop/Documents (searched 2026-10-23), so there is no PDF to keep in step — print the page to PDF if a document is needed. The owner-approved contact e-mail and effective date (2026-10-23) are set in `apps/dashboard/lib/legal/public-site.ts` (`APPROVED_PRIVACY_CONTACT_EMAIL`, `APPROVED_PRIVACY_EFFECTIVE_DATE`), overridable at build time by `NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL` / `NEXT_PUBLIC_PRIVACY_EFFECTIVE_DATE`; a missing or invalid value shows a DRAFT banner and `scripts/launch/verify-public-pages.sh` refuses it. Tests: `npm run test:unit` in `apps/dashboard`. Outline it follows:

Who we are and contact · what we collect (section 1) and why · who receives it (drivers for an order — name, phone, delivery address; vendors — the order contents and the customer's notes/photos for it, **not** name/phone/address; Google for maps/push; the SMS provider if used; hosting provider) · location (when, how often, foreground only) · retention (accounts until deleted; order/payment records retained for accounting — **state the period**; proof-of-delivery photos — **state the period**; backups — **state the period**; logs — **state the period**) · **deletion and how to request it: in the app, or at the public deletion page with the phone number and password, or — if you cannot sign in — by request, after Hatly confirms with a call or WhatsApp message to/from your number (we never ask for your password); what is erased and what is kept without identity (section 2); the 409 conditions** · security measures (HTTPS, hashed passwords, role-based access, audit log) · children (not directed at them) · international processing (Google; hosting location — **CONFIRM where the VPS is**) · changes and effective date · Egyptian personal-data-protection law (Law 151 of 2020) obligations — **LEGAL to advise**.

## 8. Publishing the deletion and privacy pages (NOT done — nothing is live)

The page is part of the dashboard app (`apps/dashboard/app/account-deletion/page.tsx`); it needs no sign-in and calls the API with credentials omitted. Checked 2026-10-23 (read-only): `https://sales.hatly.dev` serves HTTPS with a valid Let's Encrypt certificate (to 2027-01-10) and `/account-deletion` answers 404 there today (the current Staging build predates the page); `hatly.dev`, `www.hatly.dev` and `admin.hatly.dev` are behind Cloudflare with a valid edge certificate but answer **525** (Cloudflare cannot reach a TLS origin) — no production origin serves them yet. The dashboard does not send HSTS. See the report of this milestone for the publishing steps.

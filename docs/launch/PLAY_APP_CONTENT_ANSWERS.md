# Google Play — "App content" declarations for the customer app (`dev.hatly.customer`) — evidence-based answers

Prepared 2026-10-23 from the code (paths below). **Nothing has been entered in Play Console.** Each row: the proposed answer, the evidence, and
**[OWNER]** where a business/legal fact decides it. Data safety has its own worksheet (`PLAY_DATA_SAFETY_WORKSHEET.md`); App access has
`PLAY_REVIEWER_ACCESS.md` §6. Status lives on the one board: `CRITICAL_PATH.md` §0.

## 1. Simple declarations

| Play Console section | Proposed answer | Evidence |
|---|---|---|
| **Ads** — does the app contain ads? | **No** | no ad SDK in `apps/customer-app/pubspec.yaml`; no `AD_ID` permission (the release wrapper refuses one: `build-android-release.sh`) |
| **App access** | **All or some functionality is restricted** → sign-in details | ordering needs an account (`auth_gate.dart` `requireSignIn`); text + procedure: `PLAY_REVIEWER_ACCESS.md` §6; no reviewer account exists yet |
| **Government app** | **No** | — |
| **News app** | **No** | — |
| **Health apps** | **No** health features | pharmacies may appear as vendors, but the app has no health/medical functionality of its own **[OWNER: confirm vendors' pharmacy listings are ordinary retail]** |
| **Financial features** | Proposed: **"My app doesn't provide any financial features"** | the Hatly wallet is **closed-loop store credit**: credits only from loyalty redemption, refunds, admin credits and cash change (`WalletTransactionType` in `apps/backend/src/modules/wallet`); it is spent only on Hatly orders; **no top-up, no transfer to other users, no withdrawal** (the customer API has only `GET /wallet` and `GET /wallet/transactions`); card payment is not offered; manual transfer = the customer pays Hatly outside the app (InstaPay/mobile wallet) and uploads a proof **[OWNER/legal: confirm this reading; if Hatly ever adds top-ups/withdrawals, re-declare]** |
| **Data safety** | see `PLAY_DATA_SAFETY_WORKSHEET.md` | — |
| **Privacy policy URL** | `https://hatly.dev/privacy` | page implemented + configured; **live after Stage 3** (`deploy/production/stage3-edge-switch.sh` verifies it) |
| **Account deletion URL** (Data safety) | `https://hatly.dev/account-deletion` | page + backend implemented (e2e 101/103); **live after Stage 3**; deletes accounts on the **Production** backend — so the review/pilot build must point at Production (decision 2026-10-23, below) |

## 2. Target audience and content

| Item | Proposed answer | Evidence / reason |
|---|---|---|
| Target age groups | **18 and over** only | a commerce/delivery app with cash payment, addresses and an account; nothing designed for children; selecting under-13 brings the Families policy (no such design work exists) **[OWNER: confirm; 13–17 can be added later only with a review of the Families/teen requirements]** |
| Appeals to children? | **No** | no child-oriented content or design; Arabic retail/food catalogue |
| Store listing — "contains ads" | No | as above |

## 3. Content rating (IARC questionnaire) — category and the facts behind each topic

Recommended category: **Consumer store / commerce (an app whose main purpose is selling physical goods)** — Hatly sells and delivers vendors'
physical goods; it streams nothing and sells no digital content. Answer each topic from these facts:

| Topic in the questionnaire | Fact | Evidence |
|---|---|---|
| Violence, fear, sexual content, nudity, crude humour, profanity | **None** in the app itself | the app's own UI/strings (`lib/core/localization/l10n/app_ar.arb`); vendor catalogue images are vendors' product photos |
| Gambling, simulated gambling, contests | **None** | no such feature; loyalty points are earned on orders only (`loyalty`) |
| Alcohol, tobacco, drugs | the app has no such feature of its own; **vendors' catalogues decide** | **[OWNER: can vendors list tobacco/cigarettes? If yes, answer that the app sells/references tobacco products]** |
| Users interact or exchange content with each other | **No** | no chat, no forum, no public reviews: ratings are visible only as each store's average/count and the customer's own rating (`ratings.controller.ts`/`order-rating-state.controller.ts`: `@Roles(CUSTOMER)`, own ratings only); custom-request text/photos go to the one store fulfilling it; support opens WhatsApp **outside** the app (`whatsapp_helper.dart`) |
| Shares the user's location with other users | **No** live location sharing | the delivery address/coordinates go to Hatly's assigned driver to deliver the order the user placed; nothing is shown to other customers; precise location is read only when the user taps "use my current location" (`device_location_service.dart`) |
| Digital purchases | **No** | physical goods only; no in-app purchases/subscriptions (no billing library in `pubspec.yaml`) |
| Unrestricted web access | **No** | no web browser feature; links open WhatsApp/maps externally |

## 4. Decision recorded 2026-10-23 — the review/pilot build targets **Production**

`scripts/launch/build-android-release.sh customer --api-url https://api.hatly.dev/api/v1`. Reasons: (1) the closed test is the real pilot with
real customers, and Staging runs a development fallback (deterministic maps, no MFA key, no FCM) that is not meant for real customer data;
(2) the public deletion URL acts on the Production backend, and "encrypted in transit" must describe the backend the app actually uses;
(3) the reviewer account must live where the build points. A Staging-targeting build remains possible for an internal test before Production
is live (the wrapper accepts both hosts; never upload both to the same track).

# Apple Developer Program — individual enrolment checklist (decision recorded 2026-10-17)

Nothing here has been done: no enrolment, no payment, no App Store Connect record. Sources: [Apple — Enrollment support](https://developer.apple.com/support/enrollment/) (read 2026-10-17; marked **[Apple]**), Apple's D-U-N-S page (only for organisations — **not needed** for an individual), and this repository (**[Observed]**). **[Unverified]** = not stated by Apple on the pages read.

## 1. Before you start (10 minutes, free)

- [ ] An **Apple Account** with **two-factor authentication on**, and you are of legal age in your region **[Apple]**.
- [ ] **Your personal legal name exactly as on your ID** in the Apple Account's name fields — no nickname, alias or "Hatly". **[Apple]**: a wrong legal name "will cause a delay in the approval of your enrollment", and **your legal name is shown as the seller on the App Store**. (To show "Hatly" as the seller later you would need an organisation account and an app transfer — decide whether that matters to you before launch.)
- [ ] A **payment card in your own name** that can be charged **US$99/year** (local currency where Apple offers it; otherwise a card chargeable in USD) **[Apple]**. **[Apple]**: paying with someone else's card delays enrolment and triggers a request for a copy of your government photo ID. **[Unverified]** whether your Egyptian card is enabled for international online payments — ask the bank first; a declined first attempt costs days.
- [ ] A recent iPhone/iPad/Mac with the **Apple Developer app** (enrolment works there and on the web **[Apple]**).
- [ ] Decide the auto-renewal: **[Apple]** membership is an auto-renewing yearly subscription until cancelled.

## 2. Enrol (you)

1. developer.apple.com/programs/enroll → individual → sign in → accept the Apple Developer Program License Agreement → pay.
2. **[Apple]** If no membership confirmation arrives within **24 hours** of purchase, contact Apple Developer Support with your Enrollment ID. **[Unverified]** end-to-end approval time for individuals (Apple states none); plan 1–2 days.
3. **Egypt availability: [Unverified]** — Apple's page does not list countries ("enrollment may not be supported in certain regions"). If the flow refuses Egypt or your card, that is the one scenario that would change the iOS plan; tell me immediately.

## 3. After approval — App Store Connect (you click, Claude has everything pre-written)

- [ ] Accept any agreements shown. Free apps do not need the Paid Applications agreement or banking/tax forms (hatly takes no in-app purchases: orders are physical goods/services paid outside Apple's system — **[Observed]** no StoreKit use).
- [ ] Register two app records (My Apps → +): **Hatly** (customer) bundle id `com.hatly.customer` and **Hatly Driver** bundle id `com.hatly.driver` (**[Observed]** these are the ids in the projects; name availability is checked at creation). Primary language Arabic. SKU any (e.g. `hatly-customer`).
- [ ] **Availability: select only Egypt** if that is where you operate. **[Unverified/know-how]** this avoids the EU "trader status" declaration (which would publish an individual's address/phone in EU storefronts); confirm what App Store Connect asks when you pick territories.
- [ ] **Xcode** → each `apps/<app>/ios/Runner.xcworkspace` → Runner → Signing & Capabilities → select your **Team** (fills `DEVELOPMENT_TEAM`, which `scripts/launch/release-preflight.sh` checks), keep *Automatically manage signing*, add **Push Notifications** capability (if push will be used).
- [ ] **APNs key** (`.p8`): Developer portal → Keys → + → Apple Push Notifications service; download once; upload to Firebase (project settings → Cloud Messaging) with Key ID + Team ID. You keep the file; I never see it.
- [ ] **Firebase iOS apps** and `GoogleService-Info.plist` placed in `apps/<app>/ios/Runner/` and **added to the Runner target** (`RELEASE_SIGNING_AND_FIREBASE.md` §B).
- [ ] Build and upload: `flutter build ipa --release --dart-define=API_BASE_URL=<production URL>` then **Transporter/Xcode Organizer** (upload = an irreversible-ish account action: needs your explicit go).
- [ ] **TestFlight**: internal testers (your team) immediately after processing; **external** testers (up to 10,000 by public link **[Unverified]**) need **Beta App Review** for the first build of each version.
- [ ] App record content: description/keywords/subtitle (`store/STORE_LISTINGS.md`), screenshots (6.9"/6.5" iPhone — taken from the real app after the staging deploy), **App Privacy** answers (`PRIVACY_AND_COMPLIANCE.md` §4), **privacy policy URL**, support URL, age-rating questionnaire, **export compliance** (the app only uses HTTPS/Keychain: you will be asked whether it uses encryption beyond that — owner's declaration; answering once avoids a prompt on every upload), **review information**: contact details and **demo account** (customer: reviewer can register with phone + password; **driver app: a prepared driver account on a reachable backend is mandatory**), review notes explaining that accounts for drivers are created by Hatly.
- [ ] **Account deletion** is in the customer app (**[Observed]** since 2026-10-17); mention the path in the review notes.

## 4. What can be done before Apple approves you

Everything in `store/`, the privacy drafts, the signing/Firebase prep, the staging deployment (gated), screenshots, and the demo accounts. **Not possible without the paid membership:** signing a distributable build, App Store Connect records, TestFlight, APNs key.

## 5. Dated scenarios (today = Saturday 17 Oct; target Sunday 1 Nov; review durations are **[Unverified]**)

| Scenario | Enrolled | First build uploaded | TestFlight external | App Review submitted | **Public on App Store** |
|---|---|---|---|---|---|
| Fast | Sun 18 – Mon 19 Oct | Thu 22 Oct (needs staging/production backend + privacy URL) | ~Fri 23 – Mon 26 Oct | Mon 26 Oct | **~Wed 28 – Fri 30 Oct (possible before 1 Nov)** |
| Realistic | Wed 21 Oct | Tue 27 Oct | ~Thu 29 Oct | Wed 28 Oct | **~Fri 30 Oct – Wed 4 Nov (50/50 for 1 Nov)** |
| Slow (enrolment hiccup, one rejection) | Tue 27 Oct | Fri 30 Oct | Mon 2 Nov | Mon 2 Nov | **~Nov 6–10** |

Rule of thumb: to have a realistic chance on 1 Nov, the App Review submission must be in by **Monday 26 – Tuesday 27 Oct**, which needs a working backend, the privacy-policy URL and the demo accounts by then.

## 6. Driver app on iOS (decision for you)

Drivers are few and managed by Hatly. Options: **TestFlight** (builds expire after 90 days **[Unverified from Apple pages read]**, external testers need Beta App Review), a **public listing** (needs the demo driver account; no benefit to the public), or Apple's **unlisted app distribution** (a request form; **[Unverified]** whether available to individual accounts). Recommended for launch: TestFlight; revisit unlisted distribution afterwards.

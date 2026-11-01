# Google Play testing plan — personal account created after 13 Nov 2023 (decision recorded 2026-10-17)

Facts below are labelled **[Google]** (read from Google's Play Console Help page [App testing requirements for new personal developer accounts](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en) on 2026-10-17), **[Guides]** (third-party articles — interpretation, not Google), **[Observed]** (checked in this repository) or **[Unverified]**. Nothing in this plan has been done: no account created, no build uploaded, no money spent.


> **Update 2026-10-19 — read this before the tables below.** (1) The live status of every Android step is the board in `CRITICAL_PATH.md` §0; this plan is the *explanation*, not a second checklist. (2) Re-read on Google's pages today: the 12-testers / 14-continuous-days closed-test rule for personal accounts created after 13 Nov 2023 is unchanged (apply from Dashboard > Apply for production; "usually" ≤ 7 days; Google still does not say whether each app needs its own test); **new apps must target API 36 from 31 Aug 2026** — the customer bundle does (verified). (3) The dates in §5 were written on 17 Oct and assumed an immediate start; they have moved and are **not a promise** — nothing is scheduled until milestone 3 (upload) exists. (4) Keep four things apart: *a locally built bundle* (done, debug-signed) ≠ *an upload-signed bundle* (needs your keystore) ≠ *an uploaded release* ≠ *a test that has started with 12 opted-in testers* ≠ *eligibility to request production access*. (5) The owner's actual Play account type and creation date cannot be seen from here — confirm it is a personal account created after 13 Nov 2023, otherwise this requirement may not apply.

## 1. What the rule is

* **[Google]** A personal developer account created after 13 Nov 2023 must run a **closed test with at least 12 testers who have been opted in continuously for at least 14 days** before it can apply for production access. Testers who opt in, test < 14 days and opt out do not count; an opt-out followed by an opt-in must still make 14 *consecutive* days.
* **[Google]** Apply from the app's **Dashboard → Apply for production**. Three sections: *about your closed test* (how easy testers were to recruit, whether they used all features, whether usage matched production behaviour, feedback summary and how it was collected), *about your app* (target audience, value proposition, estimated first-year installs), *about production readiness* (what changed from the test, how you judged readiness). Review "usually takes seven days or less, but can occasionally take longer."
* **[Google]** Complete **app setup before** starting the closed test; provide **working test credentials** if the app needs login; the app must be stable (no crashes/missing screens); Google may ask for **more testing** if there are fewer than 12 opted-in testers or "insufficient tester engagement".
* **[Guides]** (not Google text): the clock effectively starts when the 12th tester opts in; "opted in" means the tester clicked the opt-in link and joined through Play; testers who never open the app are the most common rejection cause; internal-track testers cannot also be closed-track testers.

## 2. Does each app need its own qualifying test? — answered with the evidence available

* **[Google]** The page speaks of "your app" and the production application is made from **each app's own Dashboard**; it does **not state** that approval for one app unlocks production for another. **[Guides]**: two of three say each new app needs its own test; none says the opposite.
* **Working assumption (conservative): yes — every app that needs *Production* needs its own 12-tester/14-day test.** First thing to check once both apps exist: if the second app's Dashboard already offers production access after the first is approved, that is a free upside.
* **The driver app probably does not need Production at all.** Drivers are created and managed by Hatly (no public sign-up; a few dozen people), so the driver app can live permanently on a **Play testing track** (internal: up to 100 testers, no Google review [Google]; closed: up to 2,000 per list, 50 lists per track [Google help, via search summary]). The 12-tester rule only gates the *Production* track. **Recommendation: run the qualifying test for the customer app only; keep the driver app on internal/closed testing and skip its production application** unless you want a public driver listing. **[Unverified]** whether Google is comfortable with a testing track as a permanent driver channel — it is not prohibited in the pages read, but confirm in Play Console policy text before relying on it for a year.

## 3. Prerequisites, in dependency order

| # | Prerequisite | Who | Time **[Unverified]** unless noted |
|---|---|---|---|
| 1 | Create the personal developer account (US$25 one-time, card must be chargeable in USD; **an Egyptian card may need international online payments enabled** — check with the bank first) | **you** (cost + identity) | same day |
| 2 | **Identity verification** (legal name + address from the Payments profile; contact e-mail/phone confirmed by one-time password). **[Google]**: "You will need to verify these identity details before publishing on Google Play." **[Guides]**: government photo ID, possibly a selfie, and a real-Android-device check through the Play Console mobile app for new personal accounts. Google states **no duration** (the "up to 5 days" on that page is for *payment-method* verification of paid developers). | **you** | unknown — plan 1–5 days, watch the console |
| 3 | **Upload keystore** created by you and `android/key.properties` filled (`RELEASE_SIGNING_AND_FIREBASE.md` §A) — can be done **today** | **you** (15 min) | — |
| 4 | **A backend the testers can actually use for 14 days.** Today's staging serves the 2026-10-12 build; the new apps call endpoints it lacks (notifications, account deletion…). Deploying the current build to staging (RUNBOOK §9) is therefore on the critical path, **needs your approvals**, and **driver tester accounts** must exist (accounts are admin-created; one refresh session per user, so testers cannot share an account) | Claude (gated ⛔) | 1 day once approved |
| 4a | **UPDATE 2026-10-19 — prerequisite 4 is MET for Staging:** Staging runs the current build (54 → 59 migrations, new endpoints live, auth/CSRF/logout contract verified by the owner-run script). Still open for the pilot: driver tester accounts, and the decision whether testers use Staging data or wait for Production | owner | — |
| 5 | **App setup complete** in Play Console: store listing (`store/STORE_LISTINGS.md`), privacy-policy URL, **account-deletion URL**, content rating, target audience, **Data safety** (`PRIVACY_AND_COMPLIANCE.md` §5), ads declaration (**No ads; no Advertising ID** — verified: neither merged release manifest contains `AD_ID`), app access (**test credentials**), financial-features declaration (the app has a store-credit wallet and loyalty points, no real-money online payments — answer truthfully when the form is shown) | you + Claude drafts | 1 day |
| 6 | First **release-signed AAB** (target SDK 36, min SDK 24 — verified) uploaded to the **Closed testing** track with Play App Signing enabled; Google may review this release before testers can install | Claude builds/uploads **only with your explicit go** (or you run the two commands) | **[Unverified]** hours to a few days |
| 7 | **12 testers (recruit 20)** on the list, each with a Google account and an Android phone, each clicking the opt-in link and installing from Play | **you** (people) | 1–3 days |
| 8 | **14 continuous days**, tester engagement, feedback log (`play-testing/`) | testers; Claude helps run the log | 14 days |
| 9 | **Apply for production access** (answers drafted in `play-testing/FEEDBACK_LOG_AND_APPLICATION_DRAFT.md`) | you press the button | — |
| 10 | Google review (≤ 7 days typical **[Google]**) → create the **production release** → Play review of that release (**[Unverified]**, plan 1–7 days for a brand-new account) | Google | up to ~2 weeks |

## 4. Tester setup (exact)

1. Create a **Google Group** (free) — e.g. `hatly-testers@googlegroups.com` — and add testers' Gmail/Google-account addresses (a Group is easier than editing e-mail lists when someone changes phone). Alternatively use an e-mail list in the closed-testing track (up to 2,000 addresses per list).
2. In Play Console → app → Testing → **Closed testing** → create track → *Testers* → add the Group → copy the **opt-in URL** (appears once a release is available to testers).
3. Send each tester the message in `play-testing/TESTER_GUIDE.md` (Arabic + English): open the opt-in link signed in with the listed Google account → *Become a tester* → install from the Play Store link → **do not opt out for at least 14 days** → open the app and use it a few times a week.
4. Track every tester in the log (name, Google account, opt-in date, device, last-seen, issues). The **clock date** = the day the 12th tester opted in (conservative); keep 20 so a few drop-outs do not reset it.
5. Customer testers use real registration (phone + password; OTP is off on staging) or provided tester accounts; **driver-app testers (if the driver app is also tested) need distinct admin-created driver accounts**.
6. Real pilot customers can join the same closed track (more testers do no harm and show genuine usage); keep the 12 qualifying people on the closed track only, and use the **internal** track for you/your team and urgent hotfixes (internal builds skip review **[Google via search]**, ≤ 100 testers).

## 5. Earliest realistic timeline (today = Saturday 17 Oct 2026; 1 Nov = Sunday)

Chain: identity verification → AAB on closed track (+possible Google review) → 12th tester opts in (**clock day 0**) → +14 days → apply → ≤ 7 days → production release + review.

| Scenario | Verification done | Closed release live | 12th tester in (day 0) | Eligible to apply | Production access ≤ 7 d | **Public on Play** |
|---|---|---|---|---|---|---|
| **Best case** (everything instant, you start tonight) | Mon 19 Oct | Tue 20 Oct | Wed 21 Oct | **Wed 4 Nov** | ~Wed 11 Nov | **~Fri 13 – Sun 15 Nov** |
| **Realistic** | Wed 21 Oct | Mon 26 Oct | Wed 28 Oct | **Wed 11 Nov** | ~Wed 18 Nov | **~Sat 21 – Wed 25 Nov** |
| **Slow** (verification 5+ days, closed-track review 3 days, testers late, one "continue testing" response) | Mon 26 Oct | Fri 30 Oct | Mon 2 Nov | Mon 16 Nov | + another 14 days if Google asks to continue | **December** |

**Even the best case misses 1 Nov by about two weeks.** Public Play release on 1 Nov is not achievable by any engineering effort; only the dates in the table can move, and only by Google's pace.

## 6. What stays possible for 1 Nov on Android

* **Play closed/internal testing is itself a Play-delivered channel** (installs and updates through the Play Store, same signing as the final release) — usable for a **pilot** with invited customers from as soon as the first release is live (best case ~20 Oct; realistic ~26 Oct). This is the recommended Android pilot channel.
* **APK download link** (the Sales APK pipeline) works in Egypt today **[Guides, Android Authority 1 Oct 2026]**: Google's developer-verification enforcement for sideloaded apps started 30 Sep 2026 in **Brazil, Indonesia, Singapore and Thailand only**, with a global expansion planned for 2027. Treat it as a **fallback**, not the plan: people who sideload must re-install when they move to the Play version (different signing certificate), and from 2027 unregistered apps will need an advanced install flow.

## 7. What can be completed **before** identity verification finishes (start now)

| Item | Who | Notes |
|---|---|---|
| Create the Android upload keystore + `key.properties` + 2 offline copies | you | `RELEASE_SIGNING_AND_FIREBASE.md` §A |
| Create the Firebase project and download the two Android `google-services.json` (customer, driver) | you | free; independent of Play (§B) |
| Create the Google Group, recruit **20 testers** (people with Android phones and Google accounts, ideally the real pilot customers + 3–5 who will act as drivers), collect their Google-account e-mails | you | the single most schedule-critical human task |
| Decide: privacy policy / terms / support contact / website text; deletion-page text | you | `PRIVACY_AND_COMPLIANCE.md` |
| Tester message (Arabic/English), feedback log, production-access answers draft | **done** (`play-testing/`) | |
| Play Console "App content" answers prepared from verified facts | **done** (§3 row 5 and `PRIVACY_AND_COMPLIANCE.md`) | |
| Backend: approve the staging deployment of the current build (RUNBOOK §9) and driver tester accounts | you ⛔ → Claude | the test needs a working backend from day 0 |
| Store assets: 512 px icon (**ready** in `store/icons/*/play-store-icon-512.png`, after you approve the look), **feature graphic 1024×500** and phone screenshots (taken from the real app on the deployed staging backend — after the staging deploy) | Claude (after deploy) | |
| Release-signed AAB build | Claude **after** keystore + your go (the build reads your signing secrets locally; it never prints them) | or run `flutter build appbundle --release --dart-define=API_BASE_URL=…` yourself |

**Cannot** be done before verification: creating the app record, uploading any build, creating the tester track, and (probably) completing the Data-safety/app-content forms (they live inside an app record).

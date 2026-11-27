# iOS release track: iOS follows every tested Android release

**Owner decision 2026-11-27 (item 6):** after each Android release has passed the owner's testing, the same code goes to iOS. This page is the
standing procedure. It builds on `HATLY_APPLE_APP_STORE_READINESS_AUDIT.md` (2026-11-13), which has the full App Store checklist, review risks and
privacy notes, and on `RELEASE_VERSIONING.md`. Where they differ, this page is newer.

**Evidence labels:** **[Repo]** = checked in this repository today · **[Owner]** = only the owner can do or confirm it · **[Unverified]** = not
checked against Apple or GitHub today.

---

## 1. The rule

1. **Android first, then iOS, from the same commit.** An iOS build is made only from a commit whose Android build the owner has tested and
   accepted. iOS never carries code that Android testers have not seen.
2. **Same version and build number.** Both platforms read `version:` in each app's `pubspec.yaml` (`1.1.0+22` means version 1.1.0, build 22).
   No separate iOS number is kept. Every upload to TestFlight or Play needs a build number higher than any earlier upload of that app, so the
   build number is raised once per release, before the Android build **[Repo: RELEASE_VERSIONING.md]**.
3. **Apps stay independent.** The customer app (`com.hatly.customer` on iOS, `dev.hatly.customer` on Android) and the driver app (`com.hatly.driver`)
   keep their own versions. Only the app that changed is built for iOS **[Repo]**.
4. **TestFlight before the App Store.** Every iOS build goes to internal TestFlight testers first. App Store submission is a separate owner
   decision, like Play production.
5. **Nothing here is a release by itself.** An `.ipa` file or a TestFlight build is not an App Store publication, and passing CI is not device testing.

## 2. One-time prerequisites (blocking; all owner actions)

| # | Item | Status today | Who |
|---|---|---|---|
| P1 | Apple Developer Program, Individual enrolment (US$99/year) | **Pending** in the last handoff. Not confirmed since. | **[Owner]** |
| P2 | Team ID set as `DEVELOPMENT_TEAM` for both iOS projects (automatic signing) | Not set; projects have no team **[Repo]** | Owner gives the Team ID, which is not a secret; agent sets it |
| P3 | App Store Connect records: Hatly (`com.hatly.customer`) and Hatly Driver (`com.hatly.driver`) | Not created | **[Owner]** |
| P4 | Internal TestFlight testers (owner, Operations, 1–2 drivers) | Not created | **[Owner]** |
| P5 | iOS Google Maps key restricted to the bundle id `com.hatly.customer`, only if the in-app map is wanted on iOS (`HATLY_MAPS_ENABLED`) | Not created; the map stays off without it, and map-link paste works without a key | **[Owner]** |
| P6 | Push on iOS (APNs key in Firebase): **deferred** with item 3 (notifications, Google sign-in and password saving, before go-live) | Off | Later |
| P7 | Driver app on iOS: TestFlight only (recommended in `APPLE_INDIVIDUAL_ENROLLMENT_CHECKLIST.md` §6), with no public listing | Decision stands unless the owner changes it | **[Owner]** |

Until P1–P4 exist, the per-release steps below stop at step 3, an unsigned build that proves the code compiles for iPhone.

## 3. Where the iOS build runs (cost policy, AGENTS.md)

| Option | Cost | Notes |
|---|---|---|
| **A. The owner's Mac (recommended)** | Free | Xcode 26 and the iOS 26 SDK were already verified there on 2026-11-13 **[Audit §4]**. Signing stays on the Mac, so no certificate or App Store Connect key has to be stored in GitHub. |
| B. GitHub-hosted macOS runner, repo private | Billed: private-repo macOS minutes cost more than Linux minutes **[Unverified: check GitHub's current billing page before use]** | Needs signing material as repository secrets (distribution certificate, App Store Connect API key). That is a **credential change**, so it needs explicit owner approval. |
| C. GitHub macOS runner while the repo is temporarily public | Standard runners are generally free for public repos | Same secrets as B. Under AGENTS.md the owner switches visibility; an agent never does. A security review of source and history comes first, and the owner switches it back once the run is terminal. Only trusted refs. |

**Default: option A.** There is no iOS workflow in `.github/workflows` today **[Repo]**. Adding one (options B or C) is a separate change that
needs the owner's approval for the signing secrets.

## 4. Per-release checklist (each tested Android release)

Run from the released commit on `main` (the merged release branch), never from an unmerged branch.

1. **Confirm Android acceptance.** Record the commit, the Android build (version and build number, workflow run, APK/AAB) and that the owner
   accepted it.
2. **Check iOS-specific changes in that release.** Compare against the last iOS build:
   - new permissions: each needs an `Info.plist` usage text **and** an Arabic text in `ios/Runner/ar.lproj/InfoPlist.strings`;
   - new data collected: `ios/Runner/PrivacyInfo.xcprivacy` and the App Store privacy answers;
   - new plugins: `cd ios && pod install` on the Mac;
   - anything platform-specific (Apple Maps, push, sign-in).
3. **Build on the Mac:**
   ```bash
   cd apps/customer-app && flutter build ipa --release --dart-define=API_BASE_URL=<production API URL>
   ```
   Add `--dart-define=HATLY_MAPS_ENABLED=true` only once P5 exists. Without P1–P2 use
   `flutter build ios --release --no-codesign` as a compile check only.
4. **Upload** the `.ipa` with Xcode Organizer or Transporter → it appears in TestFlight after Apple's processing.
5. **Internal TestFlight test**, using the same scenarios the Android build passed, plus the iOS-only points listed for that release (§5).
6. **Record it** in `RELEASE_UPLOAD_LOG.tsv` with the file's existing columns (`app`, `version_name`, `version_code`, `sha256`, `date_utc`, `track`),
   with track `ios-testflight-internal`. Put the commit in the release notes.
7. **App Store submission** only on the owner's explicit decision; follow the readiness audit §6–§7 (demo account and address for the reviewer,
   pharmacy wording, privacy policy).

## 5. iOS points in the current round (owner round 2026-11-27)

Already done in the code **[Repo]**:

| Change | iOS item | Status |
|---|---|---|
| Voice notes on Hatly / Wasaly (item 4) | `NSMicrophoneUsageDescription` in `Info.plist` (English) and `ar.lproj/InfoPlist.strings` (Arabic) | Added |
| | `PrivacyInfo.xcprivacy`: Audio Data, linked to the user, App Functionality, no tracking | Added (10 data types) |
| | New plugins `record`, `audioplayers`, `path_provider` → `pod install` on the Mac | **To do on the Mac** |
| | App Store privacy answers: add **Audio Data** | **[Owner]** in App Store Connect |
| Map-link picking (item 10) | "Open the maps app" opens **Apple Maps** on iOS; the customer shares the place and pastes the link (Apple Maps links are on the server's allow-list) | Added; test on a real iPhone |
| Promotions, delivery-fee campaigns, store logos (items 7, 8, 11) | No iOS-specific work | — |

TestFlight test points for this round: record a voice note (prompt in Arabic and English, stops at 5:00, playback, delete); a voice-only request
reaches the driver; Apple Maps → share → paste link sets the point; a promo code and a delivery-fee campaign show the same totals as on Android.

## 6. What this page does not cover

- **Not done:** no Apple account, App Store Connect record, certificate, TestFlight build or iOS CI workflow was created. Nothing was uploaded.
- **Not verified today:** Apple's processing and review times, current GitHub macOS pricing, whether a TestFlight build expires after 90 days
  (see the readiness audit §9), and whether the `record` plugin needs extra iOS audio-session settings beyond its defaults. Check on the first
  device run.

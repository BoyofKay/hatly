# Release versioning policy (1.0.0)

Applies to both Flutter apps (`apps/customer-app`, `apps/driver-app`). Decision recorded 2026-10-17; reversible (it is two lines in each `pubspec.yaml`).

| Item | Rule |
|---|---|
| Marketing version | `MAJOR.MINOR.PATCH`. First public store release = **1.0.0**. Bug-fix release = `1.0.1`; backwards-compatible features = `1.1.0`; a change that needs a new backend contract the old app cannot speak = `2.0.0`. Customer and driver apps version **independently**. |
| Build number | The integer after `+` in `pubspec.yaml` (`1.0.0+1`). It feeds Android `versionCode` and iOS `CFBundleVersion`. **Every binary uploaded to either store — including TestFlight, Play internal/closed testing and rejected submissions — needs a build number higher than any earlier upload of that app.** Never reuse one, never decrease it. Simplest rule: increment by 1 on every upload. |
| Where it is set | Only `pubspec.yaml`. Android reads `flutter.versionCode/versionName`, iOS reads `FLUTTER_BUILD_NAME/NUMBER` — verified: the 2026-10-16 build showed the pubspec version in `Info.plist`. (Both apps are now `1.0.0+1`.) |
| Tagging | After a store submission is **approved by the owner and sent**, tag the exact commit `customer-v1.0.0+N` / `driver-v1.0.0+N` (git tag only; no tag is created automatically). |
| Release notes | One line per user-visible change, Arabic first, English second (`store/` folder). |
| API compatibility | The backend must keep serving the **previous** app version for at least 30 days after a release (stores roll out gradually and people do not update at once). There is **no minimum-supported-version gate** in the apps or the backend today (verified by search); if a breaking API change is ever needed, add that gate first. Recorded as a post-launch hardening item. |
| Environment per build | `--dart-define=API_BASE_URL=<https production URL>` is required (release builds refuse to start with a localhost/emulator URL — `apiBaseUrlProblem`). The Maps keys are build-time inputs (`GOOGLE_MAPS_API_KEY`), never committed. |

**Android: use the wrapper, not the raw command** — `scripts/launch/build-android-release.sh <app> --api-url <URL>` builds and verifies, and `… record-upload <app> <track>` writes `RELEASE_UPLOAD_LOG.tsv` after you upload, after which it refuses any build whose versionCode is not higher than the last recorded one for that app. The shapes below are what it runs underneath.

Release command shapes (run only after the preflight passes — `scripts/launch/release-preflight.sh`):

```bash
# Android (uploadable to Play only when android/key.properties exists — the preflight checks that)
flutter build appbundle --release --dart-define=API_BASE_URL=https://api.hatly.dev/api/v1
# iOS (signed archive is produced in Xcode / `flutter build ipa` once the Apple team is configured)
flutter build ipa --release --dart-define=API_BASE_URL=https://api.hatly.dev/api/v1
```

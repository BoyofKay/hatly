# Decision-register Release 1 — post-release verification and closure (2026-11-06)

Production release `20261106T195428Z-50ef7fbe7cd6`. Verification only: nothing was deployed, migrated or changed in Production; the pending transfer was not approved or rejected; the three protected tunnels and the owner's dev stack (ports 3000/3002/8765) were not touched.

## 1. Full backend E2E on the committed tree
- Tree: `feature/register-release-1` @ `9ec6cc4`, clean working tree. `9ec6cc4` = deployed commit `dc4a364` + one docs-only commit.
- Result: **82/82 suites, 1,124/1,124 tests passed, 0 failed, 0 skipped.**
- Earlier runs: unit 2,444 ✔, integration 314 ✔ (same code).
- Changed test expectations, each tied to a register rule:
  - R16/R13: no automatic release; the alert instead (70, 84)
  - R17: no driver hand-back (60, 70, 83, 84, 86, 130)
  - R3/R40: cancellation window (60, 64, 66, 85, 114)
  - R2: vendors can't see or act on unverified transfers, so Operations act on their behalf (62, 63, 64, 65, 66, 67)
  - R28: driver list field (drivers.service.spec)

## 2. R16 driver acknowledgement
- **Backend:**
  - Verified by automated tests: recorded once (a later open, the endpoint, or pickup keeps the first time); the configured window is used (default 5; 1–30; invalid values refused); timeout raises one Operations alert only; no release or reassignment; toggling the dispatch mode leaves assignments unchanged; a reassignment starts a fresh window for the new driver.
  - Verified in production: the route exists (401 without a session); column present.
- **Driver app (current build, 1.0.0+5):**
  - The detail endpoint is called only when the driver taps an order card on the home screen (`home_screen.dart:201`). There is no prefetch and no push navigation; the History link uses the wrong id and never matches an active assignment.
  - So the system records only a real "driver opened this order".
  - **The app never tells the driver that opening counts as acknowledging, and has no explicit action.** R16 says the driver *acknowledges* having viewed the order. Opening the order is therefore an interim, backward-compatible acknowledgement, not the faithful UI.
- **Smallest driver-app change needed (Requires a code change; no APK built or distributed):**
  - On the delivery detail screen, while the status is ASSIGNED_TO_DRIVER and `acknowledgedAt` is null, show a primary button "I've seen this order" that calls `POST /driver/deliveries/:id/acknowledge`.
  - Show "Acknowledge by HH:MM" from `acceptDeadlineAt`, and a "Call Operations" link.
  - Keep every existing step button.
  - Ship it as versionCode 6+ (production upload key).
  - Once all drivers run it, the backend may optionally stop treating a plain open as acknowledgement for new builds (keep it for old builds, R38).

## 3. Authenticated dashboard verification
Production sign-in was not possible: I don't hold credentials and must not enter yours. Verified instead on an **isolated local stack**:
- Release 1 code, ports 3300/3302.
- Database: a disposable copy of the local Playwright database `hatly_pw`, with migration 74 applied.
- Its own Redis database index; test accounts from the repository's e2e fixtures.
- The stack and its database were removed afterwards.

**Full Playwright suite:** 238 passed, 19 failed, 1 skipped. Triage of the 19:

| Failure | Cause | Outcome |
|---|---|---|
| admin-control-tower ×3 | tested the removed driver hand-back (U3) | updated to R17 → **15/15 pass** |
| 11 others in 8 spec files | HTTP 429 (per-minute rate limit when the whole suite hits one backend) | spec files re-run alone, 65 s apart → all pass |
| enterprise-admin:211 | flaky | passes alone twice |
| security-headers:5 | test hard-codes port 3000; the CSP correctly names 3300 | environment only |
| dashboard-overview:160, enterprise-admin:45 | **also fail on the previous release's code** (baseline run on an identical database copy) | pre-existing, not Release 1 |

**New `release1-register.spec.ts`: 3/3 pass.**
- Drivers page commission editor: 10% saved as 1000 bp; 150% blocked.
- Acknowledgement setting visible; 12 saved; 45 refused.
- An InstaPay order is not on the vendor board and its detail is refused; after Operations approve it, it appears.

**Found and fixed on the branch (not deployed):** an order released by Operations was labelled "Released after the accept window". That rule no longer exists; it now reads "Released by Operations". Commit `425edb1`.

**Manual check in Production (owner, signed in):**
1. Drivers → set a commission on the one driver without a rate.
2. Settings → "Driver Acknowledgement Window" is shown (empty = 5).
3. Order detail of an assigned order → "Driver acknowledged" line.
4. Vendor account → the order whose transfer is UNDER_REVIEW is not on the board; after you approve it, it appears.
5. Admin order detail → finished orders show no vendor-part buttons.
6. Customer app → an order before pickup offers Cancel.

## 4. Production read-only
- RELEASE file, `current` symlink, backend and dashboard image tags: all `20261106T195428Z-50ef7fbe7cd6`.
- Migrations: 74, the last being `DeliveryAcknowledgement1700007300000`.
- `/health/ready` reports the database and Redis up. Backend and dashboard logs since the deploy: 0 errors.
- Counts, identical to before the deploy:
  - users 16, orders 29 (PENDING 17, READY 4, DELIVERED 1, CANCELLED 7), vendors 34, products 226
  - payments 3, financial events 2, wallet transactions 0, deliveries 5
- **Rows changed since the deploy:** orders 0, payments 0, financial events 0, wallet transactions 0, deliveries 0.
- **The unverified transfer:** UNDER_REVIEW on a PENDING order; vendor-visible = false under the deployed rule; 0 vendor new-order notifications. It was not approved or rejected.
- Open dispatch alerts: NO_ELIGIBLE_DRIVER ×4 (existing READY orders, no eligible driver). The acknowledgement window is unset, so the 5-minute default applies. 1 driver has no commission rate.

## 5. Git and release integrity
- **Release 1 commits:**
  - `8110c54` (feature)
  - `dc4a364` (empty `packages/*` tracked; the Docker build needs them). **Bundle built from this commit.**
  - After the deploy: `9ec6cc4` (docs) and `425edb1` (wording fix + Playwright; not deployed).
- **Bundle = commit:** I extracted the bundle and compared it with `git archive dc4a364`. All 1,411 files are identical; the only missing file is `apps/dashboard/tsconfig.tsbuildinfo`, which the bundle script excludes by design. The bundle's SHA-256 prefix `50ef7fbe7cd6` is the release id, and the checksum was verified on the host at upload.
- **Reproducible:** `git checkout dc4a364 && bash deploy/production/make-release-bundle.sh`, then the runbook sequence in LAUNCH_PROGRESS §3ah.
- **Branches:**
  - `feature/register-release-1` branches from `release/admin-vendor-20261101` @ `8b1c0e3`, which hasn't moved since.
  - `master` (`464ab67`) is 4 commits behind the release branch.
  - Nothing is merged. Branch protection can't be read (private repository on the free plan).
- **Recommended integration:**
  - Open a PR `feature/register-release-1` → `release/admin-vendor-20261101` (it fast-forwards, with no conflicts).
  - After you approve it, merge the release branch into `master`.
  - Cut each later release as `feature/register-release-N` from the updated release branch.
  - Build bundles only from a clean, committed worktree.
  - I haven't merged anything.

## 6. Classification
| Item | Status |
|---|---|
| R16 backend acknowledgement (once, window, alert only, no release, mode toggle) | Verified in automated tests (e2e + unit); route and column verified in Production |
| R16 driver-app experience (explicit acknowledgement) | **Requires a code change** (driver app button; APK needs your authorisation) |
| R17 no driver release | Verified in automated tests (e2e + Playwright) |
| R3/R40/R45 cancellation | Verified in automated tests |
| R2 vendor visibility of unverified transfers | Verified in Production (read-only rule evaluation and notifications) + automated tests + browser test |
| R28 commission basis and Hatly Service split | Verified in automated tests; no delivery since the deploy, so not yet exercised in Production |
| Commission editor, acknowledgement setting | Verified in an isolated browser environment; **not yet verified signed in on Production** |
| Operations alert wording for an Operations release | **Requires a code change** — fixed on the branch (`425edb1`), not deployed |
| Release id, images, migrations, health, logs, data unchanged | Verified in Production |
| Bundle = commit, reproducibility | Verified |
| Pre-existing Playwright failures (overview:160, enterprise:45, CSP port test) | Not Release 1; open, pre-existing |
| Merge into release/master | Not done; waiting for your approval |

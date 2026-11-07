# Decision-register roadmap — checkpoint

Source of truth for rules: `HATLY_FINAL_DECISION_REGISTER_2026-11-06.md` (R1–R45, R23a, R33a).
Work happens in the git worktree `../hatly-r1` on branch `feature/register-release-1`. After each release, `master` and `release/admin-vendor-20261101` are fast-forwarded to it. The main checkout `../hatly` keeps the owner's uncommitted customer-app work — never pull into it.

## Live in Production
| Release | Id | Rules |
|---|---|---|
| 1 | `20261106T195428Z-50ef7fbe7cd6` | R16 acknowledgement (no automatic release), R17 Operations-only release, R3/R40/R45 cancellation window, R2 unverified transfers hidden from vendors, R28 driver commission basis + Hatly Service revenue, commission editor |
| 1.1 | `20261106T214231Z-27f40e93dabb` | explicit acknowledgement for app build ≥ 6 (`X-Hatly-Driver-Ack`), `GET /driver/support-contact`, "Released by Operations" wording |
| 2A | `20261107T004846Z-593d380baae2` | R20 no new Pay-at-Delivery, R21 transfer verification window (Settings; **off until set**), R3 admin cancel until pickup |
| 2B | `20261107T022800Z-feb790433010` | R8/R44 store pause/reopen, weekly hours and closures are vendor requests that Operations approve (Stores → Store Requests); R9 paused / outside-hours stores refuse new orders (no hours = no limit) |
| 2C | `20261107T035612Z-d19b76161a80` (current; rollback = 2B) | R7 vendor new products / price increases / detail and option changes wait for Hatly (Products → Product Requests); reductions and stock apply directly; Excel per row; Hatly activation = approval |

## Built, not distributed
Driver APK 1.0.0+6: `~/Downloads/Hatly-Driver-Release/hatly-driver-1.0.0-build6-20261106/` (SHA-256 `26bef899…6a89`, upload key `6e9dcf06…`). Waiting for the owner's approval to distribute.

## Owner settings to fill in (Admin → Settings / Drivers)
- each driver's commission %
- "Operations Phone (for drivers)" (optional)
- "Transfer Verification Window" (leave empty to keep R21 off)
- acknowledgement window (empty = 5 min)

## Release procedure (per release)
1. Commit on the branch.
2. Full backend unit / e2e / integration suites on the clean committed tree. The base64 speed test needs an otherwise idle machine.
3. Dashboard tsc / unit / build.
4. Playwright on the isolated stack:
   - `pg_restore` the scratchpad `hatly_pw.dump` into a new database (created as the local superuser)
   - `iso-env.sh`: `MAPS_PROVIDER=deterministic`, Redis db 9, ports 3300/3302
   - run spec files 65 s apart
5. `make-release-bundle.sh`, then compare with `git archive` of the commit.
6. Stage on the host: upload, checksum, build, `env-check`, `plan`.
7. Back up, run the restore drill, copy off-host.
8. Migrate (only if the plan lists a pending migration).
9. Switch `RELEASE`/`current` and run `prod.sh apps`.
10. Smoke checks.
11. Record in LAUNCH_PROGRESS, then fast-forward `master` and the release branch.

## Next packages (not started)
1. **2D — acceptance and dispatch:**
   - R12 acceptance mode AUTO / VENDOR / HATLY
   - R18 capacity per vehicle with an audited override
   - R14 round-robin fallback
2. **2E — scheduled orders (R5).**
3. **P2 money:**
   - goods principal and collections by source
   - daily settlement statement (R29–R31)
   - vendor payable vs commission without netting (R32)
   - subscriptions (R33a)
   - R43 historical-rate flag
   - R45 operational expense
   - wallet top-up and transfer, loyalty as discount only (R23/R24)
   - gateway port (R20)
   - return-to-office custody (R36)

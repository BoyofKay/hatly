# Dependency security audit (M5 Batch 4, 2026-10-02)

Scope: the npm workspace (`apps/backend`, `apps/dashboard`, root) and the two Flutter apps. `npm audit` output is **not**
suppressed or configured away; remaining advisories are listed here with the reason they remain.

> **Reading guide — this file is chronological.** The **current, verified** production state is the last section
> ([Verified state 2026-10-16](#verified-state-2026-10-16-fresh-audit-from-the-current-lockfile)): **8 advisories, 0 critical, 0 high**.
> Every earlier table (2026-10-02 summary, "Remaining (production dependencies)", the 2026-10-14 and the "evaluated; nothing applied"
> 2026-10-16 addenda) is kept as **history** and is marked *superseded* where its numbers no longer hold. Zero High/critical advisories
> is a statement about `npm audit`'s database only, not a claim that the application is free of vulnerabilities.

*Snapshot of 2026-10-02 (superseded — see the verified state at the end).*

| | Before | After |
|---|---|---|
| Whole workspace (incl. dev) | 48 (2 critical, 21 high, 21 moderate, 4 low) | 39 (1 critical, 14 high, 20 moderate, 4 low) |
| Whole workspace, production only | 29 (2 critical, 12 high) | 21 (1 critical, 5 high) |
| `apps/backend`, production only | 27 (1 critical, 11 high) | 19 (0 critical, 4 high) |
| `apps/dashboard`, production only (package count; `next` stays flagged) | 3 (1 critical, 2 high) | 3 (1 critical, 2 high) — but individual `next` advisories fall from 35 (3 critical, 12 high) to 23 (2 critical, 8 high) |

## Fixed (smallest compatible change each)

| Package | Advisory class | Change |
|---|---|---|
| `xlsx` 0.18.5 (backend, **reachable by vendor and admin accounts** through the Excel import) | prototype pollution, ReDoS; no fix on the npm registry | `0.20.3` from the vendor's own distribution (`cdn.sheetjs.com`, integrity-pinned in the lockfile). Same API; Excel import tests green |
| `multer` (via `@nestjs/platform-express` 10.4.22, pinned `2.0.2`) | 8 DoS advisories (crafted multipart field names, incomplete cleanup, ...) | root `overrides` -> `2.4.0` (same major Nest 10 already uses). New e2e `77-multipart-uploads` covers the real routes |
| `bcrypt` 5.1.1 -> 6.0.0 | `tar` **critical** + `@mapbox/node-pre-gyp` (install-time download/extract tooling) | drops that whole chain (prebuilt binaries ship inside the package). Hash format unchanged; verified against published crypt_blowfish vectors |
| `next` 14.2.5 -> 14.2.35 (dashboard) | 12 advisories fixable on the 14.x line (incl. the middleware authorization bypass) | patch bump inside 14.2; dashboard typecheck and build pass. 23 advisories remain, fixed only in 15.5+ (below) |
| `qs` 6.14.2 (Express query parser) | DoS advisories | root `overrides` -> `6.16.0` (minor, same major) |
| `@grpc/grpc-js`, `brace-expansion`, `fast-uri` | assorted | `npm audit fix` (7 lockfile entries, patch level) |
| (not a version change) Next.js image optimizer | image-optimizer DoS / disk cache / AVIF RCE advisories | `apps/dashboard/next.config.js` sets `images.unoptimized`; `/_next/image` now 404s. The dashboard does not use `next/image` |

Also hardened because the multipart routes were exposed (independent of versions): single-file multer limits
(`files/fields/parts/fieldSize/headerPairs`) and a clean 400 (was a 500) when no file is sent.

## Remaining (production dependencies) — SUPERSEDED (2026-10-02 snapshot)

> Historical. `next` is now 15.5.27, `firebase-admin` 14.5.0 (no `node-forge`), `lodash`/`js-yaml` are overridden to fixed releases, and
> the Node runtime is 22. Only the Nest-10-derived rows below (`@nestjs/*`, `file-type`, `uuid`, `body-parser`) still apply.

| Package (path) | Severity | Class | Relevance to us | Remediation |
|---|---|---|---|---|
| `next` 14.2.35 (dashboard) | critical/high | **requires upstream major upgrade** (14.x is end of line; fixes are in 15.5.24+/16) | Not reachable: middleware, `next/image` (disabled), server actions, rewrites, i18n, Windows hosting. **Reachable if the dashboard is exposed publicly:** App Router / React Server Components request-handling DoS advisories | Migrate the dashboard to Next 15.5.x/16 (React 19) **before it is exposed to the public internet**; until then keep it behind access control (IP allow-list / Cloudflare Access / VPN) |
| `postcss` (bundled in `next`) | high | build tooling | Processes only our own CSS at build time; the advisories need attacker-controlled CSS/source maps | Resolved by the Next upgrade |
| `firebase-admin` 12.7 -> `node-forge`, `@google-cloud/*`, `google-gax`, `retry-request`, `teeny-request`, `gaxios` | high / moderate | **requires upstream major upgrade** (firebase-admin 13/14) | `node-forge` is only used to *parse our own service-account private key* (`privateKeyFromPem`); the advisory concerns RSA signature *verification*, which we never call. We use only FCM messaging, not Firestore/Storage | Upgrade firebase-admin when Firebase is set up for the test environment (verify `FirebasePushProvider` tests) |
| `js-yaml` (via `@nestjs/swagger` pin) | high | **requires upstream major upgrade** (`@nestjs/swagger` 12) | Swagger/OpenAPI generation only; disabled in production/staging; no untrusted YAML parsed | Nest 11/12 upgrade |
| `lodash` (via `@nestjs/config` and `@nestjs/swagger`, exact pins) | high | **requires upstream major upgrade** | Prototype pollution via `_.unset/_.omit/_.template` with attacker-controlled *paths/keys*; config keys here are static | Nest 11/12 upgrade |
| `@nestjs/core` <= 11.1.17 | moderate | **requires upstream major upgrade** | Advisory is about Server-Sent Events field injection; the app has no `@Sse` endpoints. **Not applicable** | Nest 11 upgrade |
| `@nestjs/common` (via `file-type`) | moderate | not applicable | `file-type` is used by Nest's `ParseFilePipe`/`FileTypeValidator`, which the app does not use (image types are verified by our own byte inspection) | Nest upgrade |
| `@nestjs/platform-express`, `@nestjs/typeorm`, `@nestjs/swagger`, `@nestjs/config` | moderate | derived from the rows above | - | Nest upgrade |
| `uuid` (direct, unused) | moderate | false positive / not applicable | The package is never imported by our code; the advisory (v3/v5/v6 with a caller-supplied `buf`) is not reachable via the transitive copies either | Remove the unused direct dependency in a hygiene pass |
| `body-parser` | low | not applicable | Fires only on an invalid `limit` option value; ours are fixed constants | Nest upgrade |

A Nest 10 -> 11 upgrade (one framework major, with `@nestjs/*` plugins) clears every row except `firebase-admin` and `next`,
and is the recommended next dependency task. It was deliberately **not** done here: it is a framework-wide migration, not a
targeted security fix.

## Remaining (development / build tooling only — nothing ships to production)

`@nestjs/cli` and its chain (`glob`, `tmp`, `picomatch`, `minimatch`, `ajv`, `fast-uri`, `@angular-devkit/*`, `webpack`,
`inquirer`, `external-editor`, `@nestjs/schematics`, `@nestjs/testing`), `eslint-config-next` / `@next/eslint-plugin-next`
(`glob` CLI command injection), `@typescript-eslint/*`. These run on developer machines/CI against our own source. Fixes are
`@nestjs/cli` 12 / `eslint-config-next` 16 (majors) and a few patch bumps inside tool ranges that were left alone to avoid
unrelated churn.

## Flutter (Customer, Driver)

`flutter pub get` reports no security advisories for either app. Two **discontinued transitive** packages are present
(`flutter_secure_storage_macos`, `js`): not shipped in the Android/iOS builds.

## CI note

`xlsx` is now installed from `https://cdn.sheetjs.com/...`; `npm ci` in CI therefore needs outbound access to that host. The
tarball integrity hash is pinned in `package-lock.json`.

## Addendum — consolidated hardening milestone (2026-10-14) — numbers superseded

`npm audit --omit=dev` (workspace): 23 → **21** (2 → 1 critical, 6 → 5 high). Two non-breaking fixes, same major each, via root `overrides`
(lockfile diff: 16 lines):

| Package | Advisory | Change | Why it mattered |
|---|---|---|---|
| `proxy-addr` 2.0.7 (Express) | IPv4-mapped-IPv6 trust-subnet spoofing — **critical** | `2.0.8` | `TRUST_PROXY` decides the client IP that every rate limit keys on; a spoofable IP means a bypassable limit |
| `source-map-js` 1.2.1 (via PostCSS) | event-loop DoS via crafted source maps | `1.2.2` | build-time tooling; fixed because it was free |

Still open, **not fixable without a major upgrade** (unchanged reasoning from above): `next` (critical/high; fixed only in the Next 15.5+/16 line —
image optimizer already disabled, headers/CSP added this milestone), `firebase-admin` → `node-forge`/`@google-cloud/*` (fix is a major `firebase-admin`),
`@nestjs/swagger` → `js-yaml`/`lodash` (major; API docs are disabled outside development). Flutter: `flutter pub outdated` shows 26 locked/22
constrained packages and two discontinued ones (`flutter_secure_storage_macos`, `js`, transitive); there is no `pub audit`, so this is an
inventory, not a vulnerability verdict.

## Addendum — remaining production-high advisories, remediation paths (2026-10-16, evaluated; nothing applied) — SUPERSEDED by "APPLIED" below

> This was the plan written *before* the changes. The next section records what was applied; the counts here (19 / 4 high) are the
> **pre-change** audit and explain the older "4 High" figure.

`npm audit --omit=dev` (workspace): 19 (0 critical, **4 high**, 14 moderate, 1 low). The dashboard is on `next` 15.5.27 and is no longer flagged.

| High | Path | Safe compatible remediation | Validated |
|---|---|---|---|
| `lodash` ≤4.17.23 | `@nestjs/config` 3.3, `@nestjs/swagger` 7.4 (exact pins) | root `overrides`: `"lodash": "4.18.1"` (same major) | scratch copy of the manifests: `npm ls` clean, both packages resolve 4.18.1, the advisory clears |
| `js-yaml` 4.0.0–4.3.1 | `@nestjs/swagger` 7.4 (`4.1.0`) | **scoped** override `"@nestjs/swagger": { "js-yaml": "4.3.2" }` (same major). Do NOT override globally: `@istanbuljs/load-nyc-config` (dev) needs js-yaml **3.x** | as above; the advisory clears, the 3.x consumer is untouched |
| `node-forge` (all versions; no fixed release exists) | `firebase-admin` 12.7 | only by leaving it: `firebase-admin` **14.x** no longer depends on `node-forge` (13.x still does) | — |
| `firebase-admin` 5.0–14.3 | direct | `firebase-admin` 14.5 — a **major**: requires Node ≥ 22 and removes the namespaced API that `notifications/providers/firebase-push.provider.ts` uses (`admin.apps`, `admin.credential.cert`, `admin.messaging(app)`) → port to `firebase-admin/app` (`initializeApp`, `cert`, `getApps`) + `firebase-admin/messaging` (`getMessaging(app).sendEachForMulticast`) and update its spec | type surface checked in the 14.5.0 tarball; not installed |

With the two overrides, the production audit is 16 (2 high: `firebase-admin`, `node-forge`). Reachability is unchanged from the table above
(`node-forge` parses only our own service-account key; `lodash` paths/keys and the YAML are never attacker-controlled), so these are
hygiene, not exploitable-today fixes. Recommended order: apply the two overrides with the backend unit + e2e suites in the next dependency
change; do the firebase-admin 14 port when push is configured for a real environment (and confirm the runtime is Node 22).

## Addendum — security milestone (2026-10-16): APPLIED

`npm audit --omit=dev`: **19 → 8** (critical 0, **high 4 → 0**, moderate 14 → 7, low 1). Lockfile regenerated with `npm install`; `npm ls`
reports no invalid/missing packages.

| Change | Why it is safe |
|---|---|
| root `overrides`: `"lodash": "4.18.1"` | same major; clears the `lodash` high via `@nestjs/config` / `@nestjs/swagger` |
| root `overrides`: `"@nestjs/swagger": { "js-yaml": "4.3.2" }` | same major, SCOPED (a global override would hand js-yaml 4 to `@istanbuljs/load-nyc-config`, which needs 3.x) |
| `firebase-admin` `^12.5.0` → `^14.5.0` | removes `node-forge` (no fixed release exists) and the `@google-cloud/*`/`uuid` chain. The push provider was ported to the modular API (`firebase-admin/app`, `firebase-admin/messaging`), which exists unchanged in v12–v14; validated first in a scratch copy (typecheck + full unit suite on 14.5.0), then applied |
| root `overrides`: `"google-gax": { "glob": "10.5.0" }` | firebase-admin 14 brought `rimraf` → `glob@10.4.5` (CLI command-injection advisory; the CLI is never run). Scoped to that subtree; `rimraf` 3 in dev tooling keeps glob 7 |
| Node runtime **20 → 22** (`deploy/staging/*.Dockerfile`, root `engines`) | firebase-admin 14 requires Node ≥ 22; Node 20 reached end of life in April 2026 (no more security releases). Every test suite already runs on Node 22.14 |

Remaining production advisories (all moderate/low, all need a framework MAJOR):

| Package | Sev. | Reachability | Plan |
|---|---|---|---|
| `@nestjs/core` ≤ 11.1.17 | moderate | SSE field injection — the app has no `@Sse` routes. Not reachable | Nest 11 upgrade |
| `@nestjs/common` 10.4.22 → `file-type` | moderate | `FileTypeValidator`/`ParseFilePipe` unused (own byte inspection). Not reachable | Nest 11 |
| `@nestjs/platform-express`, `@nestjs/typeorm`, `@nestjs/swagger` | moderate | derived from the above | Nest 11 |
| `uuid` < 11.1.1 (direct, unused) | moderate | never imported | remove in a hygiene pass |
| `body-parser` | low | invalid `limit` option only; ours are constants | Nest 11 |

Development tooling (`npm audit` incl. dev: 68 — 1 critical, 44 high): `@nestjs/cli`/`@nestjs/schematics`/`webpack`/`@angular-devkit/*`,
`eslint-config-next`, `@typescript-eslint/*`, `jest`/`ts-jest` chains (`glob`, `minimatch`, `tmp`, `picomatch`, `form-data`, `ajv`…). None
ship in the Docker runtime stage (`npm ci --omit=dev`). Fixes are tool majors (`@nestjs/cli` 12, `eslint-config-next` 16, jest 30);
accepted for now, re-assess with the Nest 11 upgrade.

## Verified state 2026-10-16 (fresh audit from the current lockfile)

Command (repository root, current `package-lock.json`, current installed tree; nothing modified by running it):

```bash
npm audit --omit=dev --json     # machine-readable
npm audit --omit=dev            # summary
```

Result: **8 vulnerable packages — 0 critical, 0 high, 7 moderate, 1 low** (5 distinct GitHub advisories; the rest are packages that merely
depend on a vulnerable one).

**Why the "4 High" and the "0 High" figures both appear.** The 4 highs (`lodash`, `js-yaml`, `node-forge`, `firebase-admin`) were the audit
*before* the "APPLIED" section above: the overrides for `lodash` / `@nestjs/swagger → js-yaml`, the `firebase-admin ^12 → ^14.5.0` upgrade (which
removes `node-forge`) and the Node 22 runtime had not been applied yet. After them the audit is the 8 above. `package.json` (overrides +
`firebase-admin ^14.5.0`), the lockfile (no `node_modules/node-forge`; `firebase-admin` 14.5.0) and a fresh audit all agree.

| Package | Severity | Verified dependency path | Advisory | Fix offered by npm | Breaking? | Reachable in our code? |
|---|---|---|---|---|---|---|
| `@nestjs/core` 10.4.22 | moderate | `@hatly/backend → @nestjs/core` | GHSA-36xv-jgw5-4q75 (SSE field injection, ≤ 11.1.17) | `@nestjs/core` 12.1.3 | **yes** (2 Nest majors) | no — no `@Sse` routes |
| `@nestjs/common` 10.4.22 | moderate | `@hatly/backend → @nestjs/common → file-type@20.4.1` | derived from `file-type` | "true" (but see `file-type`) | n/a | no |
| `file-type` 20.4.1 | moderate | `@nestjs/common → file-type` (exact pin by Nest) | GHSA-5v7r-6r5c-r473 (ASF parser loop), GHSA-j47w-4g3g-c36v (ZIP bomb) | ≥ 21.3.2 — `@nestjs/common` 10.4.22 pins 20.4.1, and 10.4.22 is the last 10.x release; an override would cross a major of `file-type` (ESM-only) | **yes** if forced | no — only Nest's `FileTypeValidator`/`ParseFilePipe`, which the app does not use; uploads use our own byte inspection |
| `@nestjs/platform-express` 10.4.22 | moderate | `@hatly/backend → @nestjs/platform-express` | derived from `@nestjs/core` / `body-parser` | 12.1.3 | **yes** | derived |
| `@nestjs/swagger` 7.4.2 | moderate | `@hatly/backend → @nestjs/swagger` | derived from `@nestjs/core` | 12.0.2 | **yes** | derived; API docs are off outside development |
| `@nestjs/typeorm` 10.0.2 | moderate | `@hatly/backend → @nestjs/typeorm → uuid@9.0.1` | derived from `@nestjs/core` / `uuid` | 12.0.2 | **yes** | derived |
| `uuid` 9.0.1 / 10.0.0 | moderate | `@nestjs/typeorm → uuid@9.0.1`; direct `apps/backend` dependency `uuid@10.0.0` | GHSA-w5hq-g745-h8pq (v3/v5/v6 with a caller-supplied `buf`, < 11.1.1) | `uuid` 14.0.3 | **yes** | no — our code never imports `uuid`; `typeorm` itself resolves `uuid@11.1.1` (not affected) |
| `body-parser` 1.20.4 | low | `@nestjs/platform-express → body-parser` (exact pin) | GHSA-v422-hmwv-36x6 (invalid `limit` value disables enforcement, < 1.20.6) | npm reports it only via `platform-express` 12.1.3 (breaking). A **same-line** release exists (`body-parser` 1.20.6 / 1.20.8) that a root `overrides` entry could pick up | no for the override, but **not applied** | no — our `limit` values are fixed valid constants |

Notes:
- No non-breaking fix is *applied automatically*: `npm audit fix --dry-run --omit=dev` changes nothing (it only proposes `--force`
  upgrades). The two optional, low-risk follow-ups, neither done because the audit is not the goal: (1) remove the unused direct
  `uuid` dependency; (2) a `body-parser` override to the 1.20 line, validated with the e2e suites. Both need a decision, not a rush.
- Development-only advisories (68 incl. 1 critical, 44 high) do not ship in the runtime image (`npm ci --omit=dev`); see above.
- Nothing here replaces dependency monitoring: the audit database changes daily. Re-run the command before every release.

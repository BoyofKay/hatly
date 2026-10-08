# Dependency security audit (M5 Batch 4, 2026-10-02)

Scope: the npm workspace (`apps/backend`, `apps/dashboard`, root) and the two Flutter apps. `npm audit` output is **not**
suppressed or configured away; remaining advisories are listed here with the reason they remain.

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

## Remaining (production dependencies)

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

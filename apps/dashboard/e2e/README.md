# Vendor Dashboard — Playwright browser tests

Real-browser (Chromium) tests for the Vendor Dashboard's Sales-critical path, run against the
**real** Next.js dev server and the **real** NestJS backend/PostgreSQL/Redis — nothing here is
mocked. See each spec file for what it covers; this file is only setup/running instructions.

## One-time setup (per environment)

These tests need a working Vendor Manager login. There is no way to get one without a working
SUPER_ADMIN session first (the same chicken-and-egg problem `bootstrap-admin.ts`'s own comment
describes), so this is the one manual step:

1. **A dev SUPER_ADMIN must exist with a password you know.** If `hatly_dev` doesn't have one yet,
   bootstrap it the documented way:
   ```bash
   cd apps/backend
   BOOTSTRAP_ADMIN_PHONE=+201099999999 BOOTSTRAP_ADMIN_NAME="Dev Super Admin" BOOTSTRAP_ADMIN_PASSWORD='<your-password>' npm run bootstrap:admin
   ```
   If one already exists but you don't know its password (this repo's own `hatly_dev` was in
   exactly that state), reset it directly in the dev database — never in any other environment:
   ```sql
   -- password hash below is bcrypt('Playwright-Dev-1!', 10) — replace with your own if you prefer
   UPDATE users SET password_hash = '$2b$10$vRe/WAlgkvHMSEr5Myide.KrG2DJM/x2G7Cyzipunn7qW9cYzivpu'
   WHERE phone = '+201099999999' AND role = 'SUPER_ADMIN';
   ```
2. Export that password (and phone, if different from the default) so `global-setup.ts` can use it:
   ```bash
   export PLAYWRIGHT_SUPER_ADMIN_PHONE=+201099999999
   export PLAYWRIGHT_SUPER_ADMIN_PASSWORD='Playwright-Dev-1!'
   ```
   `global-setup.ts` uses this SUPER_ADMIN session **once**, only to idempotently create (or reuse)
   two Vendor Manager fixture accounts through the real `POST /admin/vendor-staff` endpoint — it is
   never referenced by any spec file, and never used inside the browser itself.
3. `hatly_dev` must already be seeded with `npm run seed:dev-marketplace` (from `apps/backend`) —
   this is what provides the vendor branches/products the fixture accounts and orders attach to.
   The default env values in `e2e/env.ts` match that seed script's own fixture data exactly.

Every other run after this is fully automatic — `global-setup.ts` re-provisions everything it needs
idempotently (reusing existing fixture accounts, always placing fresh fixture orders) each time.

## Running

```bash
# Terminal 1 — the real backend, already configured against hatly_dev
cd apps/backend && npm run start:dev

# Terminal 2 — the tests (this starts the dashboard's own dev server on :3002 automatically)
cd apps/dashboard && npx playwright test

# A single file, or with the browser visible:
npx playwright test e2e/order-detail.spec.ts
npx playwright test --headed

# View the HTML report / a failure's trace after a run:
npx playwright show-report
npx playwright show-trace test-results/<test-name>/trace.zip
```

## What's covered

- `auth.spec.ts` — real login form (correct/incorrect credentials), unauthenticated route
  protection, reload-while-authenticated, sign-out, and the session-expiry regression (see below).
- `order-detail.spec.ts` — list→detail navigation, direct URL access, a real segment-status
  mutation, rapid-double-click protection, and an invalid order id.
- `order-isolation.spec.ts` — a second, unrelated Vendor Manager cannot open or list the first
  vendor's order.
- `record-weight.spec.ts` — a real weight submission and its client-side validation.

## Known, intentional limitations

- **`auth/password/login` is genuinely rate-limited** (10 requests/60s) — a real backend security
  control, not a test artifact. Tests are deliberately structured to spend that budget sparingly
  (most reuse a saved `storageState` instead of a fresh UI login — see `env.ts`'s
  `VENDOR_A_STORAGE_STATE`/`VENDOR_B_STORAGE_STATE`), but running the whole suite many times within
  the same 60s window can still occasionally hit it. If a login-dependent test fails showing
  "Invalid phone number or password" for correct credentials, wait ~60s and re-run — this was
  reproduced and confirmed once during this milestone's own work.
- **Customer-side browser automation is out of scope here.** The Customer app is Flutter (mobile),
  not a web build in this repository — Playwright drives browsers, not Flutter's own widget
  rendering. The Customer half of the Customer→Vendor vertical slice is instead exercised over the
  real HTTP API (see `global-setup.ts`'s `registerFixtureCustomer`/`placeFixtureOrder`) — the exact
  same requests the real Customer app's network layer makes, just not through a rendered UI.

## Dashboard sessions are cookies now
`global-setup.ts` signs the fixture accounts in through the real `POST /auth/dashboard/login`; the HttpOnly cookies become the Playwright storage
state (no token is ever written into browser storage). Bearer tokens for the Node-side helpers live in `e2e/.auth/tokens.json` only.
`auth/dashboard/login` is throttled to 10 requests per minute per client, and `global-setup` already uses three of them: a full run can hit the
limit when many specs sign in through the form in the same minute — rerun the failing spec files after a minute rather than loosening the limit.

`e2e/admin-mfa.spec.ts` needs one extra dev account (never a production one): an ADMIN with phone `+201099999998` and password
`Playwright-Dev-1!`, created once in `hatly_dev` (the `bootstrap-admin` script only creates a SUPER_ADMIN when none exists, so insert the row with
a bcrypt hash of the password). The spec skips itself when the account is missing or already has an authenticator, and removes the authenticator
it enrols.

## Determinism preconditions (found 2026-10-31)

- **Run against the production build**, not `next dev`: `next build && next start -p 3002` (Playwright reuses a server already listening on the port). `next dev` compiles each route on first visit; under CPU load a first visit (e.g. `/finance/revenue`) took 7.5 s against the 5 s expectation. Production build: `enterprise-admin` 73/73, 1.1–1.3 min.
- **No stale orders waiting for a driver.** `admin-control-tower` brings fresh test drivers online with automatic dispatch ON; the dispatcher hands ANY waiting `READY_FOR_PICKUP` order to a driver that becomes eligible, so a leftover order from an earlier run or from old manual QA (the dev template had ~225) can land on a test driver and make it busy (`DRIVER_UNAVAILABLE` / `NO_AVAILABLE_DRIVER`). `cancelTestOrder` used to send the vendor cancellation without the mandatory reason and ignore the 400, so every fixture order stayed waiting forever; it now sends the reason and fails loudly. Orders left by OLDER runs must be cleared in the disposable database copy before a run (proven: Control Tower 4/4 after clearing them, 14–15/15 before).
- Use a **disposable copy** of the dev database (`createdb -T hatly_dev hatly_pw`), backend on Redis db 13, flush Redis between spec files.

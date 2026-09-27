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

# HTTP end-to-end journeys (Group 8)

Real backend over a real socket: `AppModule` + `configureApp()` (the production wiring), real
PostgreSQL 16, real Redis, real guards/filter/interceptor/middleware, supertest as the client.

```
npm run test:e2e:setup   # once: creates the disposable database hatly_e2e_test (needs a PostgreSQL superuser; PGADMIN_URL overrides)
npm run test:e2e         # ~65 s, serial (--runInBand); every spec file boots a fresh app on a freshly migrated schema
```

Isolation (enforced in `support/config.ts`, the suite refuses to run otherwise): database `hatly_e2e_test`
(never `hatly_dev` / `hatly_integration_test`), Redis logical db **14** (never db 0). Global setup/teardown
reset both; nothing is left behind.

## The only test doubles (all at the external network edge — `support/external-boundary.ts`)

| Boundary | How | What the real code still does |
|---|---|---|
| Unifonic SMS | `fetch` answered by the harness (also how OTP codes are read — no real SMS) | real `UnifonicSmsProvider`, real `OtpService`, real Redis |
| Google Maps | `fetch` answered with deterministic haversine×1.3 distances | real `GoogleMapsProvider` incl. its Redis cache, real fee calculation |
| FCM push | capturing provider bound to `PUSH_NOTIFICATION_PROVIDER` (SDK, not fetch) | real `PushNotificationService`, real device tokens |
| Any other host | refused loudly and recorded in `boundary.forbiddenCalls` | — |

Throttling: specs use the real `ThrottlerGuard` with a non-counting storage (`throttling: 'relaxed'`) so actor
factories are not rate-limited; `95-rate-limiting` runs the real storage.

## Post-Group-8 product decisions

Three decisions were locked after this suite was written (Wallet payment required in V1; partial vendor
cancellation recalculates from remaining segments; Delivery Fee fixed) — see `docs/PRODUCT_DECISIONS.md` and
`docs/IMPACT_AUDIT_POST_GROUP_8.md`. Tests that pin the old behaviour are annotated and will change with that work.

## Documented seams (each is a one-liner in `support/actors.ts` or the spec that uses it)

1. **SUPER_ADMIN / ADMIN users** are inserted directly (production does the same: `src/scripts/bootstrap-admin.ts`), then log in over HTTP; permissions are granted over HTTP.
2. **Driver eligibility**: no HTTP endpoint sets `verification_status = 'APPROVED'`, a vehicle type or `is_available`; `Scenario.driver()` does it with one UPDATE (see the report's "driver onboarding gap").
3. **Time**: Redis keys/offers windows are shortened with `DEL`/`PEXPIRE`/`UPDATE` instead of sleeping.
4. **Failure injection** (`97-resilience`): a PostgreSQL trigger created in the E2E database for one test and always dropped — no code in `src/` knows about it.
5. **Assertions** read PostgreSQL/Redis directly; they never make a business action succeed.

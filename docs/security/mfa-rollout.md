# Admin two-factor (TOTP) rollout procedure

Status (2026-10-16): **documented and validated; NOT enabled anywhere.** The production policy `DASHBOARD_ADMIN_MFA_REQUIRED` stays
`false` until an operator runs step 5 below. Design and protections: [dashboard-sessions-mfa-audit.md](dashboard-sessions-mfa-audit.md) §2.

## The one rule: the encryption key comes first

Enrolled TOTP secrets are AES-256-GCM encrypted with `MFA_ENCRYPTION_KEY` when it is set, otherwise with a key derived (HKDF) from
`JWT_REFRESH_SECRET`. There is **no fallback between the two**. Therefore:

| Situation | Effect on enrolled admins |
|---|---|
| `MFA_ENCRYPTION_KEY` set **before** the first enrolment, `JWT_REFRESH_SECRET` rotated later | none (safe) |
| no `MFA_ENCRYPTION_KEY`, `JWT_REFRESH_SECRET` rotated | authenticator codes stop working (sign-in error) |
| `MFA_ENCRYPTION_KEY` introduced / changed **after** admins enrolled | authenticator codes stop working |

In the broken cases the sign-in now **fails safe** (security milestone): the code check answers **503 `MFA_UNAVAILABLE`** — never a 500,
never a bypass, never counted against the account's brake — and the server logs `mfa.secret_undecryptable` with the remedy. Recovery codes
still work (they are stored as hashes, not encrypted), so an affected admin can sign in with a recovery code, then disable and re-enrol; a
SUPER_ADMIN can also reset other admins. Pinned by `apps/backend/src/modules/auth/mfa/staff-mfa.key-rollout.spec.ts`.

**Boot rule (security milestone):** production and staging now **refuse to start without `MFA_ENCRYPTION_KEY`**, even with the policy off
— admins can enrol voluntarily at any time, so the key must exist before anyone can enrol. A malformed key (not 32 bytes base64) is refused
everywhere.

## Procedure (per environment: staging first, then production)

1. **Pre-check (read-only).** Nobody is enrolled yet and you know who the SUPER_ADMINs are:
   ```sql
   SELECT count(*) FILTER (WHERE enabled_at IS NOT NULL) AS enabled, count(*) AS rows FROM staff_mfa_credentials;
   SELECT id, phone, role, is_active FROM users WHERE role IN ('SUPER_ADMIN','ADMIN') ORDER BY role;
   ```
   If `rows > 0` and no dedicated key is configured yet, those admins must re-enrol after step 2 (disable first, or SUPER_ADMIN reset).
2. **Configure the key** in the environment's secret store (never in git, never printed): `openssl rand -base64 32` → `MFA_ENCRYPTION_KEY`.
   Keep `DASHBOARD_ADMIN_MFA_REQUIRED=false`. Restart the backend; the boot validator refuses a key that is not 32 bytes base64, and a
   production/staging backend without the key no longer starts at all.
   Staging: `deploy/staging/init-staging-env.sh` now generates this key (and writes the policy as `false`) for a NEW env file; an existing
   `/opt/hatly-staging/.env.staging` needs the line added by hand. Back the key up with the other secrets: losing it = every admin re-enrols.
3. **Enrol every SUPER_ADMIN** (at least two people, so one can reset the other): dashboard → **Security** (`/security`) → add the setup
   key to an authenticator app → enter the first code → store the 8 recovery codes offline. Verify each: sign out, sign in → the password
   is followed by a code prompt (`MFA_REQUIRED`), and the code signs in.
4. **Enrol the ADMINs** the same way. Re-run the pre-check query: `enabled` = number of SUPER_ADMIN + ADMIN accounts in use.
5. **Turn the policy on** (separate, deliberate change): `DASHBOARD_ADMIN_MFA_REQUIRED=true`, restart. Production/staging refuse to boot
   with the policy on and no `MFA_ENCRYPTION_KEY`. From now on an un-enrolled admin can only reach enrolment (`403 MFA_ENROLLMENT_REQUIRED`
   elsewhere).
6. **Verify** with one admin: sign-in needs the code; the audit log (`admin_audit_logs`) shows `MFA_SETUP_STARTED`, `MFA_ENABLED` and the
   sign-ins, and never a secret or a code.

**Rollback:** set `DASHBOARD_ADMIN_MFA_REQUIRED=false` and restart (enrolled admins keep using their codes; nothing is lost). Never roll
back by removing or changing `MFA_ENCRYPTION_KEY`.

**Lost device:** recovery code → sign in → disable → re-enrol; or a SUPER_ADMIN uses `DELETE /admin/users/:id/mfa` (audited, ends the
target's sessions). The last SUPER_ADMIN locked out with no recovery codes: database break-glass in
[dashboard-sessions-mfa-audit.md](dashboard-sessions-mfa-audit.md) §2, recorded out of band.

## Validation run (2026-10-16, local; nothing deployed or enabled)

| Check | Result |
|---|---|
| e2e `92-dashboard-session-mfa-audit` (enrolment, sign-in with code, legacy route cannot skip it, replay, concurrency, recovery codes, per-account brake, disable, SUPER_ADMIN reset, policy on → only enrolment, audit) | 23/23 pass |
| `staff-mfa.key-rollout.spec.ts` (the key-ordering rule above) | 4/4 pass |
| `env.validation.spec.ts`, `totp.spec.ts` (RFC vectors), `dashboard-session.spec.ts` | pass |
| `init-staging-env.sh` into a scratch directory: key generated, decodes to 32 bytes, policy written `false`; the generated file passes the boot validator in fallback and strict mode, and strict staging with policy on + no key is refused | pass |
| `hatly_dev`: 0 enrolled credentials; 1 SUPER_ADMIN, 2 ADMIN accounts; no MFA variables set | as expected (nothing enabled) |

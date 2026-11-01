# Dashboard sessions, two-factor authentication and audit trail (2026-10-14)

Scope: the admin/vendor dashboard (`apps/dashboard`) and the staff-facing API. The mobile apps keep their bearer-token contract unchanged.

## 1. Browser session: HttpOnly cookies instead of a token in `localStorage`

Before: the dashboard stored the access and refresh JWTs in `localStorage` (readable by any script that ran on the page), sent them as
`Authorization: Bearer`, and had no refresh. After:

| Piece | Design |
|---|---|
| Cookies | `hatly_at` (access JWT, 15 min), `hatly_rt` (refresh JWT, path-scoped to `/api/v1/auth/dashboard`), `hatly_sid` (random session id). All `HttpOnly`, `SameSite=Strict`, `Secure` on every strict (production/staging) environment and whenever the request arrived over HTTPS |
| Endpoints | `POST auth/dashboard/login` (phone, password, optional `mfaCode`), `POST auth/dashboard/refresh`, `POST auth/dashboard/logout`, `GET auth/dashboard/me`. Tokens are **never** in a response body |
| Expiry / idle | access cookie 15 min; the refresh cookie slides on every refresh and lapses after `DASHBOARD_SESSION_SECONDS` (default 12 h) of inactivity |
| Rotation / revocation | the existing single-use refresh rotation with reuse detection is reused unchanged: replaying an old refresh cookie revokes the live session. Logout revokes server-side (not just the browser copy) |
| CSRF | `SameSite=Strict` + an `Origin` allow-list check + a signed per-session token. Unsafe cookie-authenticated requests must send `X-CSRF-Token` = HMAC(server secret, `hatly_sid`); the token is returned in the JSON of login/me/refresh, never in a cookie, so another origin can neither read nor guess it. Refresh/logout (which must work when the token was lost) require the custom header `X-Requested-With: hatly-dashboard` instead (forces a CORS preflight other origins fail). Bearer-authenticated requests and requests with no session cookie are untouched |
| Roles | unchanged: the same `RolesGuard` / `PermissionsGuard` run for cookie and bearer requests; the dashboard's locally-kept profile is display-only |
| Staff liveness | for ADMIN/SUPER_ADMIN/VENDOR/VENDOR_MANAGER the JWT strategy now re-checks the user in the database on every request: **deactivating an account ends its access immediately** (it used to last until the 15-minute token expired; the old characterization test pinning that was replaced). Customers and drivers keep the stateless check |
| CORS | credentials are now allowed — for the exact configured origins only (a wildcard is never valid with credentials; the open development mode reflects the origin). `X-CSRF-Token` and `X-Requested-With` are allowed headers |
| Page hardening | the dashboard sends a CSP (`frame-ancestors 'none'`, `object-src 'none'`, `base-uri`/`form-action 'self'`, `connect-src` limited to itself and the API origin), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` |

### Deployment requirements (cannot be enforced from code)
- The dashboard and the API **must share a registrable domain** (e.g. `sales.hatly.dev` + `api-sales.hatly.dev`, or `localhost` ports in development): `SameSite=Strict` cookies are not sent cross-site. Serving them from unrelated domains would need `SameSite=None` and a different CSRF stance — not supported.
- `CORS_ALLOWED_ORIGINS` must list the dashboard origin(s) exactly (already required in production/staging). `TRUST_PROXY` must be set behind a proxy so `req.secure` is correct (the staging kit already sets `1`).
- HTTPS end to end for deployed environments (HSTS is already sent in strict mode).
- Known limitation: the refresh token store keeps one live refresh session **per user** (existing design), so signing in to the dashboard on a second device replaces the first device's refresh session; its access cookie keeps working until it expires (≤15 min), then it must sign in again.
- No absolute (non-sliding) session lifetime: a continuously active session can last as long as its refresh chain is valid (the refresh JWT itself lives `JWT_REFRESH_EXPIRES_IN`, default 30 d).

## 2. Two-factor authentication (TOTP)

No MFA existed. Implemented a standard RFC 6238 authenticator (HMAC-SHA1, 6 digits, 30 s step, ±1 step drift) with Node's `crypto` — **no new dependency**, verified against the RFC 4226/6238 vectors.

- **Who:** ADMIN and SUPER_ADMIN. Enrol from the dashboard **Security** page (`/security`): setup key shown once → first valid code confirms → 8 single-use recovery codes shown once.
- **Sign-in:** an enrolled admin gets `MFA_REQUIRED` after a correct password and **no tokens or cookies**; the dashboard then asks for the code. The check lives in `AuthService.loginStaffWithPassword`, which backs **both** `auth/dashboard/login` and the legacy `auth/password/login`, so the legacy route cannot be used to skip it.
- **Protections:** a code works once (atomic `last_used_step` compare-and-set; five concurrent requests with one code → exactly one succeeds); recovery codes are stored only as SHA-256 hashes and consumed atomically; wrong codes are rate-limited **per account** (the existing login brake, regardless of IP); the secret is AES-256-GCM encrypted at rest; disabling needs the password **and** a code.
- **Policy:** `DASHBOARD_ADMIN_MFA_REQUIRED=true` makes an un-enrolled admin able to do nothing except enrol (`MfaEnrollmentGuard`, for cookie and bearer credentials alike). Default **off** so enabling it is a deliberate rollout step (enrol the SUPER_ADMINs first).
- **Secret key:** TOTP secrets are encrypted with a key derived (HKDF) from `JWT_REFRESH_SECRET`, or `MFA_ENCRYPTION_KEY` (32 bytes, base64) when set. **Rotating `JWT_REFRESH_SECRET` without setting `MFA_ENCRYPTION_KEY` first would make existing authenticators undecryptable** — set a dedicated `MFA_ENCRYPTION_KEY` in production before relying on MFA.
- **Lost device and recovery codes:** a SUPER_ADMIN can reset another admin (`DELETE admin/users/:id/mfa`, audited, ends the target's sessions). A lost SUPER_ADMIN with no other SUPER_ADMIN needs the database-level procedure: `DELETE FROM staff_mfa_credentials WHERE user_id = '<id>'` (the audit table is append-only but this one is not) — record it out of band.
- **Not covered:** vendor accounts do not have MFA (no privileged power over other tenants; can be added by widening `MFA_ROLES`); no WebAuthn/passkeys; no QR code (the key is typed or opened via the `otpauth://` link).

## 3. Audit trail

`admin_audit_logs` (append-only: a database trigger refuses every UPDATE and DELETE). Recorded: dashboard sign-in (success and failure, masked phone, reason code), sign-out, MFA setup/enable/disable/failed code/recovery-code use/admin reset, permission grant/revoke, vendor-staff create/activate/deactivate, business-config changes (the setting **name** only, never the value, because a value may be a payment destination), Hatly Service pricing config changes, and the per-sector custom-request switch. Metadata is flat and sanitized: keys that look like secrets (`password`, `token`, `code`, `secret`, `hash`, `key`, `cookie`, `authorization`) are dropped whatever a caller passes; strings are truncated. Audit writes never throw (a failed write is logged loudly, the admin action still succeeds).

~~Gaps: other admin mutations are not yet audited~~ — **closed by the security milestone (2026-10-16):** `AdminMutationAuditInterceptor`
(global) records EVERY ADMIN/SUPER_ADMIN POST/PUT/PATCH/DELETE outside `/auth/*` as `admin.mutation` (actor, route template, target id,
required permission, HTTP outcome incl. FAILURE, body field NAMES only — never values). Handlers that write their own richer entry are
marked `@ExplicitlyAudited()` (reviewed list pinned by e2e `94-admin-mutation-audit`). Remaining gap: reads are not audited.
See [security-milestone-2026-10-16.md](security-milestone-2026-10-16.md) §8 for the fail-closed vs resilient reasoning.

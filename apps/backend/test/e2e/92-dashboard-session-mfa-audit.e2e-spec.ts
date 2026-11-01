/**
 * The dashboard's browser session, its second factor and the audit trail — over real HTTP against PostgreSQL/Redis.
 *  - session: HttpOnly SameSite=Strict cookies (no token in any body), CSRF defence for cookie requests, refresh rotation + reuse detection,
 *    logout that revokes server-side, immediate effect of deactivation, role enforcement unchanged;
 *  - MFA: real TOTP, secret never returned after setup, replay protection, single-use recovery codes, brute-force brake, and no way around
 *    it through the legacy bearer login; the enrolment policy that confines un-enrolled admins;
 *  - audit: append-only, secret-free records of the privileged actions.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, expectData, nextPhone, DEFAULT_PASSWORD } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';
import { hotp, base32Decode, timeStep } from '../../src/modules/auth/mfa/totp';

interface Cookie { value: string; attrs: string[] }
const parse = (setCookie: unknown): Record<string, Cookie> => {
  const list = (Array.isArray(setCookie) ? setCookie : setCookie ? [String(setCookie)] : []) as string[];
  const out: Record<string, Cookie> = {};
  for (const line of list) {
    const [pair, ...attrs] = line.split(';').map((p) => p.trim());
    const i = pair.indexOf('=');
    out[pair.slice(0, i)] = { value: decodeURIComponent(pair.slice(i + 1)), attrs };
  }
  return out;
};
const jar = (c: Record<string, Cookie>) => Object.entries(c).filter(([, v]) => v.value !== '').map(([k, v]) => `${k}=${encodeURIComponent(v.value)}`).join('; ');

describe('E2E — dashboard session, MFA and audit', () => {
  let world: World;
  let s: Scenario;
  const q = (sql: string, params: unknown[] = []) => world.ds.query(sql, params);
  const dashboardLogin = (phone: string, password = DEFAULT_PASSWORD, extra: Record<string, unknown> = {}) => world.api('post', '/auth/dashboard/login', { body: { phone, password, ...extra } });
  const asBrowser = (cookies: Record<string, Cookie>, csrf?: string, extraHeaders: Record<string, string> = {}) => ({ headers: { cookie: jar(cookies), ...(csrf ? { 'x-csrf-token': csrf } : {}), ...extraHeaders } });
  const totp = (secretBase32: string, offsetSteps = 0) => hotp(base32Decode(secretBase32), timeStep(Date.now()) + offsetSteps);
  const auditActions = async (userId: string): Promise<string[]> => (await q('SELECT action FROM admin_audit_logs WHERE actor_user_id = $1 ORDER BY created_at, id', [userId])).map((r: any) => r.action as string);

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('cookie session', () => {
    it('login sets HttpOnly + SameSite=Strict cookies, returns NO token in the body, and the cookie alone authenticates', async () => {
      const admin = await s.superAdmin();
      const res = await dashboardLogin(admin.phone);
      expect(res.status).toBe(200);
      const cookies = parse(res.headers['set-cookie']);
      expect(Object.keys(cookies).sort()).toEqual(['hatly_at', 'hatly_rt', 'hatly_sid']);
      for (const c of Object.values(cookies)) {
        expect(c.attrs).toEqual(expect.arrayContaining(['HttpOnly', 'SameSite=Strict']));
      }
      expect(cookies.hatly_rt.attrs).toContain('Path=/api/v1/auth/dashboard'); // the refresh cookie is only ever sent to refresh/logout
      expect(cookies.hatly_at.attrs).toContain('Path=/api/v1');
      expect(JSON.stringify(res.body)).not.toContain(cookies.hatly_at.value);
      expect(JSON.stringify(res.body)).not.toContain(cookies.hatly_rt.value);
      expect(res.body.data.user).toMatchObject({ id: admin.id, role: 'SUPER_ADMIN' });
      expect(typeof res.body.data.csrfToken).toBe('string');

      // GET with the cookie only — no Authorization header
      const me = await world.api('get', '/admin/me/permissions', asBrowser(cookies));
      expect(me.status).toBe(200);
    });

    it('wrong credentials, a customer, and a non-phone are refused with the generic 401/400 and set no cookie', async () => {
      const customer = await s.customer();
      const admin = await s.superAdmin();
      for (const [phone, password] of [[admin.phone, 'wrong-password'], [customer.phone, DEFAULT_PASSWORD], [nextPhone(), DEFAULT_PASSWORD]] as const) {
        const res = await dashboardLogin(phone, password);
        expect({ phone: phone === customer.phone ? 'customer' : 'x', status: res.status, cookies: res.headers['set-cookie'] }).toEqual({ phone: phone === customer.phone ? 'customer' : 'x', status: 401, cookies: undefined });
      }
    });

    it('CSRF: an unsafe cookie-authenticated request needs the signed token — missing, wrong or another session’s token is a 403; a valid one passes; a bearer request never needs one', async () => {
      const admin = await s.superAdmin();
      const first = await dashboardLogin(admin.phone);
      const cookies = parse(first.headers['set-cookie']);
      const csrf = first.body.data.csrfToken as string;
      const second = await dashboardLogin(admin.phone);
      const otherCsrf = second.body.data.csrfToken as string;
      const body = { name: 'CSRF sector', slug: `csrf-${Date.now()}` };
      const post = (opts: ReturnType<typeof asBrowser>) => world.api('post', '/admin/sectors', { ...opts, body });

      const none = await post(asBrowser(cookies));
      expect(none.status).toBe(403);
      expect(none.body.error.details.code).toBe('CSRF_TOKEN_INVALID');
      expect((await post(asBrowser(cookies, 'forged-token'))).status).toBe(403);
      expect((await post(asBrowser(cookies, otherCsrf))).status).toBe(403); // a token minted for a different browser session
      expect(Number((await q('SELECT count(*)::int AS n FROM marketplace_sectors WHERE slug = $1', [body.slug]))[0].n)).toBe(0);
      expect((await post(asBrowser(cookies, csrf))).status).toBe(201);

      // a bearer-token client (the mobile apps, scripts) is unaffected
      expect((await world.api('post', '/admin/sectors', { token: admin.accessToken, body: { name: 'Bearer sector', slug: `bearer-${Date.now()}` } })).status).toBe(201);
    });

    it('/auth/dashboard/me returns who is signed in plus a CSRF token that really works; a bearer-only caller has no dashboard session', async () => {
      const admin = await s.superAdmin();
      const login = await dashboardLogin(admin.phone);
      const cookies = parse(login.headers['set-cookie']);
      const me = await world.api('get', '/auth/dashboard/me', asBrowser(cookies));
      expect(me.status).toBe(200);
      expect(me.body.data.user).toMatchObject({ id: admin.id, role: 'SUPER_ADMIN' });
      expect(me.body.data.csrfToken).toBe(login.body.data.csrfToken); // deterministic per session, so a reloaded page recovers it
      const created = await world.api('post', '/admin/sectors', { ...asBrowser(cookies, me.body.data.csrfToken), body: { name: 'Via me token', slug: `me-${Date.now()}` } });
      expect(created.status).toBe(201);
      expect((await world.api('get', '/auth/dashboard/me', { token: admin.accessToken })).status).toBe(401);
      expect((await world.api('get', '/auth/dashboard/me')).status).toBe(401);
    });

    it('refresh: needs the custom header, rotates every cookie, and replaying the OLD refresh cookie is detected as theft (session revoked)', async () => {
      const admin = await s.superAdmin();
      const login = await dashboardLogin(admin.phone);
      const cookies = parse(login.headers['set-cookie']);
      const noHeader = await world.api('post', '/auth/dashboard/refresh', asBrowser(cookies));
      expect(noHeader.status).toBe(403);
      expect(noHeader.body.error.details.code).toBe('CSRF_HEADER_REQUIRED');

      const refreshed = await world.api('post', '/auth/dashboard/refresh', asBrowser(cookies, undefined, { 'x-requested-with': 'hatly-dashboard' }));
      expect(refreshed.status).toBe(200);
      const next = parse(refreshed.headers['set-cookie']);
      expect(next.hatly_at.value).toBeTruthy(); // (access tokens have second granularity and no jti; the refresh token is the rotating one)
      expect(next.hatly_rt.value).not.toBe(cookies.hatly_rt.value);
      expect(refreshed.body.data.user.id).toBe(admin.id);

      // the rotated refresh cookie works once more
      const again = await world.api('post', '/auth/dashboard/refresh', asBrowser(next, undefined, { 'x-requested-with': 'hatly-dashboard' }));
      expect(again.status).toBe(200);
      // replaying the FIRST (already rotated) one: refused, cookies cleared, and the live session is revoked too
      const replay = await world.api('post', '/auth/dashboard/refresh', asBrowser({ hatly_rt: cookies.hatly_rt }, undefined, { 'x-requested-with': 'hatly-dashboard' }));
      expect(replay.status).toBe(401);
      expect(parse(replay.headers['set-cookie']).hatly_rt.attrs).toContain('Max-Age=0');
      const afterTheft = await world.api('post', '/auth/dashboard/refresh', asBrowser(parse(again.headers['set-cookie']), undefined, { 'x-requested-with': 'hatly-dashboard' }));
      expect(afterTheft.status).toBe(401);
    });

    it('logout revokes the refresh session server-side (not just the browser copy) and clears all three cookies', async () => {
      const admin = await s.superAdmin();
      const login = await dashboardLogin(admin.phone);
      const cookies = parse(login.headers['set-cookie']);
      const csrf = login.body.data.csrfToken as string;
      // logout is authorised by the custom header, NOT by the CSRF token: a request with only the token is refused and changes nothing
      const tokenOnly = await world.api('post', '/auth/dashboard/logout', asBrowser(cookies, csrf));
      expect(tokenOnly.status).toBe(403);
      expect(tokenOnly.body.error.details.code).toBe('CSRF_HEADER_REQUIRED');
      expect((await world.api('get', '/auth/dashboard/me', asBrowser(cookies))).status).toBe(200); // still signed in

      const out = await world.api('post', '/auth/dashboard/logout', asBrowser(cookies, undefined, { 'x-requested-with': 'hatly-dashboard' }));
      expect(out.status).toBe(200);
      const cleared = parse(out.headers['set-cookie']);
      expect(Object.values(cleared).every((c) => c.attrs.includes('Max-Age=0'))).toBe(true);
      // what the browser holds after logout (all three cookies cleared) is not a session any more
      expect((await world.api('get', '/auth/dashboard/me', asBrowser(cleared))).status).toBe(401);
      // and the PRE-logout refresh cookie is dead server-side — a copy kept by a thief cannot mint a new session
      const reuse = await world.api('post', '/auth/dashboard/refresh', asBrowser(cookies, undefined, { 'x-requested-with': 'hatly-dashboard' }));
      expect(reuse.status).toBe(401);
      expect((await world.api('post', '/auth/dashboard/logout', asBrowser(cookies))).status).toBe(403); // no header, no logout
    });

    it('customer-only routes under a STAFF cookie session: anonymous is 401, signed-in staff is 403 (role, and CSRF for writes) — nothing is created or deleted', async () => {
      const admin = await s.superAdmin();
      const login = await dashboardLogin(admin.phone);
      const cookies = parse(login.headers['set-cookie']);
      const csrf = login.body.data.csrfToken as string;
      const customersBefore = Number((await q("SELECT count(*)::int AS n FROM users WHERE role = 'CUSTOMER' AND is_active = true"))[0].n);

      expect((await world.api('get', '/customer/notifications')).status).toBe(401); // no session at all
      expect((await world.api('get', '/customer/notifications', asBrowser(cookies))).status).toBe(403); // authenticated, wrong role
      expect((await world.api('get', '/customer/notifications/unread-count', asBrowser(cookies))).status).toBe(403);

      const del = (opts: ReturnType<typeof asBrowser>) => world.api('post', '/auth/customer/delete-account', { ...opts, body: {} });
      expect((await world.api('post', '/auth/customer/delete-account', { body: {} })).status).toBe(401);
      const noToken = await del(asBrowser(cookies));
      expect(noToken.status).toBe(403); // the CSRF check stops a cookie-authenticated write before the role check
      expect(noToken.body.error.details.code).toBe('CSRF_TOKEN_INVALID');
      const withToken = await del(asBrowser(cookies, csrf));
      expect(withToken.status).toBe(403); // a valid token gets past CSRF; the CUSTOMER-only role rule refuses it
      expect(withToken.body.error.details?.code ?? '').not.toMatch(/^CSRF_/);

      expect(Number((await q("SELECT count(*)::int AS n FROM users WHERE role = 'CUSTOMER' AND is_active = true"))[0].n)).toBe(customersBefore);
      expect((await q('SELECT is_active FROM users WHERE id = $1', [admin.id]))[0].is_active).toBe(true);
    });

    it('a refresh cookie that belongs to a customer never yields a dashboard session', async () => {
      const customer = await s.customer();
      const res = await world.api('post', '/auth/dashboard/refresh', asBrowser({ hatly_rt: { value: customer.refreshToken, attrs: [] } }, undefined, { 'x-requested-with': 'hatly-dashboard' }));
      expect(res.status).toBe(401);
      expect(parse(res.headers['set-cookie']).hatly_at?.value ?? '').toBe('');
    });

    it('role enforcement is unchanged under cookies: a vendor session cannot use admin routes; admin permissions still gate', async () => {
      const vendorArea = await s.serviceArea({ radiusMeters: 50000 });
      const vendor = await s.vendor({ name: 'Cookie Vendor', serviceAreaId: vendorArea.id, lat: 30.421, lng: 31.561 });
      const vendorLogin = await dashboardLogin(vendor.manager.phone);
      expect(vendorLogin.status).toBe(200);
      const vendorCookies = parse(vendorLogin.headers['set-cookie']);
      expect((await world.api('get', '/admin/sectors', asBrowser(vendorCookies))).status).toBe(403);
      expect((await world.api('get', '/vendor/branches', asBrowser(vendorCookies))).status).toBe(200);

      const limited = await s.admin([Permission.VIEW_ORDERS], 'Limited Admin');
      const limitedCookies = parse((await dashboardLogin(limited.phone)).headers['set-cookie']);
      expect((await world.api('get', '/admin/sectors', asBrowser(limitedCookies))).status).toBe(403);
    });

    it('deactivating a vendor account ends its access IMMEDIATELY (not when the 15-minute token expires), for cookie and bearer alike', async () => {
      const superAdmin = await s.superAdmin();
      const area = await s.serviceArea({ radiusMeters: 50000 });
      const vendor = await s.vendor({ name: 'Soon Deactivated', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
      const cookies = parse((await dashboardLogin(vendor.manager.phone)).headers['set-cookie']);
      expect((await world.api('get', '/vendor/branches', asBrowser(cookies))).status).toBe(200);
      expect((await world.api('get', '/vendor/branches', { token: vendor.manager.accessToken })).status).toBe(200);

      await q('UPDATE users SET is_active = false WHERE id = $1', [vendor.manager.id]);
      expect((await world.api('get', '/vendor/branches', asBrowser(cookies))).status).toBe(401);
      expect((await world.api('get', '/vendor/branches', { token: vendor.manager.accessToken })).status).toBe(401);
      expect((await dashboardLogin(vendor.manager.phone)).status).toBe(401);
      void superAdmin;
    });
  });

  describe('two-factor authentication (TOTP)', () => {
    const enrol = async (admin: Actor) => {
      const bearer = { token: admin.accessToken };
      const setup = expectData<any>(await world.api('post', '/auth/mfa/setup', bearer));
      const enabled = expectData<any>(await world.api('post', '/auth/mfa/enable', { ...bearer, body: { code: totp(setup.secret) } }));
      return { secret: setup.secret as string, recoveryCodes: enabled.recoveryCodes as string[] };
    };

    it('enrolment: setup shows the secret once; a wrong code does not enable it; the right one does and returns single-use recovery codes; the secret is encrypted at rest', async () => {
      const admin = await s.admin([Permission.VIEW_ORDERS], 'MFA Admin');
      const bearer = { token: admin.accessToken };
      const setup = expectData<any>(await world.api('post', '/auth/mfa/setup', bearer));
      expect(setup.otpauthUrl).toContain('otpauth://totp/');
      expect(setup.otpauthUrl).toContain(`secret=${setup.secret}`);
      const [row] = await q('SELECT secret_encrypted, enabled_at FROM staff_mfa_credentials WHERE user_id = $1', [admin.id]);
      expect(row.enabled_at).toBeNull(); // pending: nothing changes for sign-in yet
      expect(row.secret_encrypted).not.toContain(setup.secret);
      expect(row.secret_encrypted.startsWith('v1.')).toBe(true);
      expect((await dashboardLogin(admin.phone)).status).toBe(200); // still password-only while pending

      expect((await world.api('post', '/auth/mfa/enable', { ...bearer, body: { code: '000000' } })).status).toBe(401);
      expect((await q('SELECT enabled_at FROM staff_mfa_credentials WHERE user_id = $1', [admin.id]))[0].enabled_at).toBeNull();
      const enabled = expectData<any>(await world.api('post', '/auth/mfa/enable', { ...bearer, body: { code: totp(setup.secret) } }));
      expect(enabled.recoveryCodes).toHaveLength(8);
      expect(new Set(enabled.recoveryCodes).size).toBe(8);
      expect(expectData<any>(await world.api('get', '/auth/mfa/status', bearer)).enabled).toBe(true);
      expect((await world.api('post', '/auth/mfa/setup', bearer)).status).toBe(409); // cannot silently replace an active authenticator
      expect(JSON.stringify(await q('SELECT * FROM staff_mfa_credentials WHERE user_id = $1', [admin.id]))).not.toContain(enabled.recoveryCodes[0]); // codes stored hashed only
    });

    it('sign-in then needs the code: password alone gets MFA_REQUIRED and NO cookies/tokens; a wrong code is refused; the right code signs in', async () => {
      const admin = await s.admin([Permission.VIEW_ORDERS], 'MFA Login Admin');
      const { secret } = await enrol(admin);

      const needs = await dashboardLogin(admin.phone);
      expect(needs.status).toBe(401);
      expect(needs.body.error.details.code).toBe('MFA_REQUIRED');
      expect(needs.headers['set-cookie']).toBeUndefined();

      const wrong = await dashboardLogin(admin.phone, DEFAULT_PASSWORD, { mfaCode: '123456' });
      expect(wrong.status).toBe(401);
      expect(wrong.headers['set-cookie']).toBeUndefined();

      const ok = await dashboardLogin(admin.phone, DEFAULT_PASSWORD, { mfaCode: totp(secret, 1) }); // a step ahead is inside the drift window
      expect(ok.status).toBe(200);
      expect(ok.body.data.mfa).toMatchObject({ eligible: true, enabled: true });
    });

    it('the LEGACY bearer login cannot be used to skip the second factor', async () => {
      const admin = await s.admin([Permission.VIEW_ORDERS], 'MFA Bypass Admin');
      const { secret } = await enrol(admin);
      const bypass = await world.api('post', '/auth/password/login', { body: { phone: admin.phone, password: DEFAULT_PASSWORD } });
      expect(bypass.status).toBe(401);
      expect(bypass.body.error.details.code).toBe('MFA_REQUIRED');
      expect(bypass.body.data).toBeUndefined();
      const ok = await world.api('post', '/auth/password/login', { body: { phone: admin.phone, password: DEFAULT_PASSWORD, mfaCode: totp(secret, 1) } });
      expect(ok.status).toBe(200);
      expect(ok.body.data.accessToken).toBeTruthy();
    });

    it('a code works ONCE (replay protection) — also across the two sign-in routes', async () => {
      const admin = await s.admin([Permission.VIEW_ORDERS], 'MFA Replay Admin');
      const { secret } = await enrol(admin);
      const code = totp(secret, 1);
      expect((await dashboardLogin(admin.phone, DEFAULT_PASSWORD, { mfaCode: code })).status).toBe(200);
      const replay = await dashboardLogin(admin.phone, DEFAULT_PASSWORD, { mfaCode: code });
      expect(replay.status).toBe(401);
      const viaLegacy = await world.api('post', '/auth/password/login', { body: { phone: admin.phone, password: DEFAULT_PASSWORD, mfaCode: code } });
      expect(viaLegacy.status).toBe(401);
    });

    it('concurrent use of the same code: exactly one request wins', async () => {
      const admin = await s.admin([Permission.VIEW_ORDERS], 'MFA Race Admin');
      const { secret } = await enrol(admin);
      const code = totp(secret, 1);
      const results = await Promise.all(Array.from({ length: 5 }, () => dashboardLogin(admin.phone, DEFAULT_PASSWORD, { mfaCode: code })));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    });

    it('recovery codes: each works exactly once (also concurrently), is consumed, and is audited', async () => {
      const admin = await s.admin([Permission.VIEW_ORDERS], 'MFA Recovery Admin');
      const { recoveryCodes } = await enrol(admin);
      const [first, second] = recoveryCodes;
      const raced = await Promise.all(Array.from({ length: 4 }, () => dashboardLogin(admin.phone, DEFAULT_PASSWORD, { mfaCode: first })));
      expect(raced.filter((r) => r.status === 200)).toHaveLength(1);
      expect((await dashboardLogin(admin.phone, DEFAULT_PASSWORD, { mfaCode: first })).status).toBe(401);
      expect((await dashboardLogin(admin.phone, DEFAULT_PASSWORD, { mfaCode: second.toUpperCase() })).status).toBe(200); // case-insensitive
      expect((await auditActions(admin.id)).filter((a) => a === 'mfa.recovery_code_used')).toHaveLength(2);
    });

    it('guessing codes is braked per ACCOUNT: after repeated wrong codes even the right one is refused with 429 for a while', async () => {
      const admin = await s.admin([Permission.VIEW_ORDERS], 'MFA Brute Admin');
      const { secret } = await enrol(admin);
      let limited = false;
      for (let i = 0; i < 14 && !limited; i += 1) {
        const res = await dashboardLogin(admin.phone, DEFAULT_PASSWORD, { mfaCode: String(100000 + i) });
        limited = res.status === 429;
      }
      expect(limited).toBe(true);
      expect((await dashboardLogin(admin.phone, DEFAULT_PASSWORD, { mfaCode: totp(secret, 1) })).status).toBe(429);
    });

    it('disable needs the password AND a valid code; afterwards sign-in is password-only again', async () => {
      const admin = await s.admin([Permission.VIEW_ORDERS], 'MFA Disable Admin');
      const { secret } = await enrol(admin);
      const bearer = { token: admin.accessToken };
      expect((await world.api('post', '/auth/mfa/disable', { ...bearer, body: { password: 'wrong-pass', code: totp(secret, 1) } })).status).toBe(401);
      expect((await world.api('post', '/auth/mfa/disable', { ...bearer, body: { password: DEFAULT_PASSWORD, code: '000000' } })).status).toBe(401);
      expect(expectData<any>(await world.api('get', '/auth/mfa/status', bearer)).enabled).toBe(true);
      expect((await world.api('post', '/auth/mfa/disable', { ...bearer, body: { password: DEFAULT_PASSWORD, code: totp(secret, 1) } })).status).toBe(200);
      expect(expectData<any>(await world.api('get', '/auth/mfa/status', bearer)).enabled).toBe(false);
      expect((await dashboardLogin(admin.phone)).status).toBe(200);
    });

    it('only admin accounts can enrol; vendors and customers are refused', async () => {
      const customer = await s.customer();
      expect((await world.api('post', '/auth/mfa/setup', { token: customer.accessToken })).status).toBe(403);
      const area = await s.serviceArea({ radiusMeters: 50000 });
      const vendor = await s.vendor({ name: 'No MFA Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
      expect((await world.api('post', '/auth/mfa/setup', { token: vendor.manager.accessToken })).status).toBe(403);
      expect((await world.api('post', '/auth/mfa/setup')).status).toBe(401);
    });

    it('audit: setup, enable, failed verification, disable are on record — and never contain the secret, a code or a hash', async () => {
      const admin = await s.admin([Permission.VIEW_ORDERS], 'MFA Audit Admin');
      const bearer = { token: admin.accessToken };
      const setup = expectData<any>(await world.api('post', '/auth/mfa/setup', bearer));
      await world.api('post', '/auth/mfa/enable', { ...bearer, body: { code: '000000' } });
      const enabled = expectData<any>(await world.api('post', '/auth/mfa/enable', { ...bearer, body: { code: totp(setup.secret) } }));
      await world.api('post', '/auth/mfa/disable', { ...bearer, body: { password: DEFAULT_PASSWORD, code: totp(setup.secret, 1) } });
      const actions = await auditActions(admin.id);
      expect(actions).toEqual(expect.arrayContaining(['mfa.setup_started', 'mfa.verify_failed', 'mfa.enabled']));
      const dump = JSON.stringify(await q('SELECT * FROM admin_audit_logs WHERE actor_user_id = $1', [admin.id]));
      for (const secretish of [setup.secret, enabled.recoveryCodes[0], totp(setup.secret), DEFAULT_PASSWORD]) expect(dump).not.toContain(secretish);
    });
  });

  describe('break-glass reset by a SUPER_ADMIN', () => {
    it('removes another admin\'s authenticator, ends their sessions, is audited, and is not available to anyone else or on oneself', async () => {
      const superAdmin = await s.superAdmin();
      const locked = await s.admin([Permission.VIEW_ORDERS], 'Locked Out Admin');
      const { secret } = await (async () => {
        const setup = expectData<any>(await world.api('post', '/auth/mfa/setup', { token: locked.accessToken }));
        expectData(await world.api('post', '/auth/mfa/enable', { token: locked.accessToken, body: { code: totp(setup.secret) } }));
        return { secret: setup.secret as string };
      })();
      const cookies = parse((await dashboardLogin(locked.phone, DEFAULT_PASSWORD, { mfaCode: totp(secret, 1) })).headers['set-cookie']);
      expect((await dashboardLogin(locked.phone)).status).toBe(401); // MFA_REQUIRED: locked out without the device

      // only a SUPER_ADMIN, and never on themselves
      const plainAdmin = await s.admin([Permission.VIEW_ORDERS], 'Plain Admin');
      expect((await world.api('delete', `/admin/users/${locked.id}/mfa`, { token: plainAdmin.accessToken })).status).toBe(403);
      expect((await world.api('delete', `/admin/users/${locked.id}/mfa`, { token: locked.accessToken })).status).toBe(403);
      expect((await world.api('delete', `/admin/users/${superAdmin.id}/mfa`, { token: superAdmin.accessToken })).status).toBe(400);
      expect((await world.api('delete', `/admin/users/00000000-0000-4000-8000-000000000000/mfa`, { token: superAdmin.accessToken })).status).toBe(404);

      const reset = await world.api('delete', `/admin/users/${locked.id}/mfa`, { token: superAdmin.accessToken });
      expect(expectData<any>(reset).removed).toBe(true);
      expect((await dashboardLogin(locked.phone)).status).toBe(200); // password-only again
      // their previous refresh session was revoked by the reset
      expect((await world.api('post', '/auth/dashboard/refresh', asBrowser(cookies, undefined, { 'x-requested-with': 'hatly-dashboard' }))).status).toBe(401);
      const [row] = await q("SELECT actor_user_id, target_id, metadata FROM admin_audit_logs WHERE action = 'mfa.reset_by_admin' AND target_id = $1", [locked.id]);
      expect(row).toMatchObject({ actor_user_id: superAdmin.id, target_id: locked.id });
      expect(row.metadata).toMatchObject({ hadAuthenticator: true });
    });
  });

  describe('enrolment policy (DASHBOARD_ADMIN_MFA_REQUIRED)', () => {
    it('with the policy on, an un-enrolled admin can only enrol / keep the session — every other route is 403 MFA_ENROLLMENT_REQUIRED — and after enrolment everything works', async () => {
      const admin = await s.admin([Permission.MANAGE_MARKETPLACE_SECTORS], 'Policy Admin');
      const config = world.app.get((await import('@nestjs/config')).ConfigService);
      const original = config.get('auth.adminMfaRequired');
      (config as any).internalConfig.auth.adminMfaRequired = true;
      try {
        const blocked = await world.api('get', '/admin/sectors', { token: admin.accessToken });
        expect(blocked.status).toBe(403);
        expect(blocked.body.error.details.code).toBe('MFA_ENROLLMENT_REQUIRED');
        // enrolment and session upkeep still work
        const setup = expectData<any>(await world.api('post', '/auth/mfa/setup', { token: admin.accessToken }));
        const status = await world.api('get', '/auth/mfa/status', { token: admin.accessToken });
        expect(status.status).toBe(200);
        expectData(await world.api('post', '/auth/mfa/enable', { token: admin.accessToken, body: { code: totp(setup.secret) } }));
        expect((await world.api('get', '/admin/sectors', { token: admin.accessToken })).status).toBe(200);
        // the dashboard session reports it too
        const login = await dashboardLogin(admin.phone, DEFAULT_PASSWORD, { mfaCode: totp(setup.secret, 1) });
        expect(login.body.data.mfa).toMatchObject({ eligible: true, enabled: true, enrollmentRequired: false });
        // a customer / vendor is never affected by an admin policy
        const customer = await s.customer();
        expect((await world.api('get', '/orders', { token: customer.accessToken })).status).toBe(200);
      } finally {
        (config as any).internalConfig.auth.adminMfaRequired = original;
      }
    });
  });

  describe('audit trail', () => {
    it('sign-ins (success and failure), logout, permission grants/revokes, staff changes, config and sector changes are recorded, without secrets', async () => {
      const superAdmin = await s.superAdmin();
      const login = await dashboardLogin(superAdmin.phone);
      const cookies = parse(login.headers['set-cookie']);
      const failed = await dashboardLogin(superAdmin.phone, 'not-the-password');
      expect(failed.status).toBe(401);

      const target = await s.admin([], 'Audited Target');
      const bearer = { token: superAdmin.accessToken };
      expectData(await world.api('post', `/admin/users/${target.id}/permissions`, { ...bearer, body: { permission: Permission.VIEW_ORDERS } }), 201);
      expect((await world.api('delete', `/admin/users/${target.id}/permissions/${Permission.VIEW_ORDERS}`, bearer)).status).toBe(200);
      const sector = await s.sector('Audit Sector');
      expectData(await world.api('patch', `/admin/sectors/${sector.id}`, { ...bearer, body: { customRequestsEnabled: true } }));
      expectData(await world.api('put', '/admin/business-config/CHECKOUT_QUOTE_TTL_SECONDS', { ...bearer, body: { value: 600 } }));
      await world.api('post', '/auth/dashboard/logout', asBrowser(cookies, undefined, { 'x-requested-with': 'hatly-dashboard' }));

      const rows = await q('SELECT action, actor_user_id, target_type, target_id, outcome, metadata, ip_address FROM admin_audit_logs ORDER BY created_at, id');
      const mine = rows.filter((r: any) => r.actor_user_id === superAdmin.id).map((r: any) => r.action);
      expect(mine).toEqual(expect.arrayContaining(['auth.dashboard_login', 'permission.granted', 'permission.revoked', 'sector.custom_requests_changed', 'business_config.changed', 'auth.dashboard_logout']));
      const failure = rows.find((r: any) => r.action === 'auth.dashboard_login_failed' && r.outcome === 'FAILURE');
      expect(failure).toBeTruthy();
      expect(failure.target_id).toBe(`***${superAdmin.phone.slice(-3)}`); // masked: never the full number
      expect(rows.find((r: any) => r.action === 'permission.granted').metadata).toMatchObject({ permission: 'VIEW_ORDERS' });
      const config = rows.find((r: any) => r.action === 'business_config.changed');
      expect(config.target_id).toBe('CHECKOUT_QUOTE_TTL_SECONDS');
      expect(JSON.stringify(config.metadata)).not.toContain('600'); // the setting's name is recorded, never its value
      const dump = JSON.stringify(rows);
      expect(dump).not.toContain(DEFAULT_PASSWORD);
      expect(dump).not.toContain('not-the-password');
      expect(dump).not.toContain(cookies.hatly_at.value);
      expect(dump).not.toContain(cookies.hatly_rt.value);
    });

    it('the log is append-only: UPDATE and DELETE are refused by the database itself', async () => {
      const admin = await s.superAdmin();
      await dashboardLogin(admin.phone);
      const [{ id }] = await q('SELECT id FROM admin_audit_logs ORDER BY created_at DESC LIMIT 1');
      await expect(q("UPDATE admin_audit_logs SET action = 'tampered' WHERE id = $1", [id])).rejects.toThrow(/append-only/);
      await expect(q('DELETE FROM admin_audit_logs WHERE id = $1', [id])).rejects.toThrow(/append-only/);
      expect((await q('SELECT action FROM admin_audit_logs WHERE id = $1', [id]))[0].action).not.toBe('tampered');
    });
  });
});

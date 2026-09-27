/**
 * Group 8 / phase 3 — authentication over real HTTP: customer OTP (real OtpService + Redis, real
 * UnifonicSmsProvider with only the network edge faked), driver/vendor/admin/customer password
 * login, role separation, session validity, token rotation, and correlation ids.
 */
import * as jwt from 'jsonwebtoken';
import { bootWorld, World } from './support/world';
import { Scenario, decodeJwt, expectData, nextPhone, DEFAULT_PASSWORD } from './support/actors';
import { boundary } from './support/external-boundary';
import { Role } from '../../src/common/enums/role.enum';
import { Permission } from '../../src/modules/permissions/permission.enum';
import { User } from '../../src/modules/users/entities/user.entity';

describe('E2E — authentication', () => {
  let world: World;
  let s: Scenario;

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
  beforeEach(() => boundary.reset());

  const bare = (phone: string) => phone.replace(/^\+/, '');

  describe('customer OTP (register → verify)', () => {
    it('registers a new customer, sends ONE real-provider SMS, and never stores the code in plaintext', async () => {
      const phone = nextPhone();
      const res = await world.api('post', '/auth/register', { body: { phone, fullName: 'Otp Customer' } });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'If eligible, a verification code has been sent.' });

      expect(boundary.sms).toHaveLength(1);
      expect(boundary.sms[0].to).toBe(bare(phone)); // Unifonic wants the number without '+'
      expect(boundary.sms[0].code).toMatch(/^\d{6}$/);
      expect(boundary.sms[0].body).toContain('Hatly verification code');

      const stored = await world.redis.get(`otp:${phone}`);
      expect(stored).not.toBeNull();
      expect(stored).not.toContain(boundary.sms[0].code!); // sha256 hash only
      expect(JSON.parse(stored!)).toEqual({ codeHash: expect.stringMatching(/^[0-9a-f]{64}$/), attempts: 0 });
      const ttl = await world.redis.ttl(`otp:${phone}`);
      expect(ttl).toBeGreaterThan(290);
      expect(ttl).toBeLessThanOrEqual(300);
      expect(await world.redis.ttl(`otp-cooldown:${phone}`)).toBeLessThanOrEqual(60);

      const user = await world.ds.getRepository(User).findOneByOrFail({ phone });
      expect(user.role).toBe(Role.CUSTOMER);
      expect(user.isPhoneVerified).toBe(false);
    });

    it('verifies with the real code: issues an access+refresh pair, marks the phone verified, consumes the code', async () => {
      const phone = nextPhone();
      await world.api('post', '/auth/register', { body: { phone, fullName: 'Verify Me' } });
      const code = boundary.lastOtpFor(phone);

      const res = await world.api('post', '/auth/otp/verify', { body: { phone, code } });
      const tokens = expectData<{ accessToken: string; refreshToken: string }>(res);
      const access = decodeJwt(tokens.accessToken);
      expect(access).toMatchObject({ role: Role.CUSTOMER, phone });
      expect(access.exp - access.iat).toBe(15 * 60);
      expect(decodeJwt(tokens.refreshToken).jti).toBeDefined();

      const me = await world.api('get', '/auth/customer/me', { token: tokens.accessToken });
      expect(expectData(me)).toEqual({ isPhoneVerified: true });

      // single use
      const replay = await world.api('post', '/auth/otp/verify', { body: { phone, code } });
      expect(replay.status).toBe(401);
      expect(await world.redis.get(`otp:${phone}`)).toBeNull();
    });

    it('a wrong code is rejected and counted; a correct code still works afterwards (within the attempt budget)', async () => {
      const phone = nextPhone();
      await world.api('post', '/auth/register', { body: { phone, fullName: 'Typo Customer' } });
      const code = boundary.lastOtpFor(phone);
      const wrong = code === '000000' ? '111111' : '000000';

      const bad = await world.api('post', '/auth/otp/verify', { body: { phone, code: wrong } });
      expect(bad.status).toBe(401);
      expect(bad.body.error.message).toBe('Invalid code.');
      expect(JSON.parse((await world.redis.get(`otp:${phone}`))!).attempts).toBe(1);

      expectData(await world.api('post', '/auth/otp/verify', { body: { phone, code } }));
    });

    it('locks the code out after the maximum wrong attempts — even the correct code is then refused', async () => {
      const phone = nextPhone();
      await world.api('post', '/auth/register', { body: { phone, fullName: 'Brute Force' } });
      const code = boundary.lastOtpFor(phone);
      const wrong = code === '000000' ? '111111' : '000000';

      for (let i = 0; i < 5; i += 1) {
        expect((await world.api('post', '/auth/otp/verify', { body: { phone, code: wrong } })).status).toBe(401);
      }
      const locked = await world.api('post', '/auth/otp/verify', { body: { phone, code } });
      expect(locked.status).toBe(401);
      expect(locked.body.error.message).toBe('Too many attempts. Request a new code.');
      expect(await world.redis.get(`otp:${phone}`)).toBeNull();
      // and it stays refused: the record is gone
      expect((await world.api('post', '/auth/otp/verify', { body: { phone, code } })).status).toBe(401);
    });

    it('an expired code (Redis TTL elapsed) is refused', async () => {
      const phone = nextPhone();
      await world.api('post', '/auth/register', { body: { phone, fullName: 'Slow Customer' } });
      const code = boundary.lastOtpFor(phone);
      await world.redis.pexpire(`otp:${phone}`, 50); // real Redis expiry, not a mock
      await new Promise((r) => setTimeout(r, 120));
      const res = await world.api('post', '/auth/otp/verify', { body: { phone, code } });
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid or expired code.');
    });

    it('enforces the resend cooldown (no second SMS) and allows a new code once it lapses; the new code supersedes the old', async () => {
      const phone = nextPhone();
      await world.api('post', '/auth/register', { body: { phone, fullName: 'Impatient' } });
      const first = boundary.lastOtpFor(phone);

      const again = await world.api('post', '/auth/login', { body: { phone } });
      expect(again.status).toBe(200); // same neutral response, no signal to the caller
      expect(boundary.sms).toHaveLength(1);

      await world.redis.del(`otp-cooldown:${phone}`); // the 60s cooldown lapsing
      await world.api('post', '/auth/login', { body: { phone } });
      expect(boundary.sms).toHaveLength(2);
      const second = boundary.lastOtpFor(phone);
      if (second !== first) {
        expect((await world.api('post', '/auth/otp/verify', { body: { phone, code: first } })).status).toBe(401);
      }
      expectData(await world.api('post', '/auth/otp/verify', { body: { phone, code: second } }));
    });

    it('login for an unknown phone is indistinguishable from a known one and sends NO SMS (no enumeration)', async () => {
      const known = nextPhone();
      await world.api('post', '/auth/register', { body: { phone: known, fullName: 'Known' } });
      await world.redis.del(`otp-cooldown:${known}`);
      boundary.reset();

      const knownRes = await world.api('post', '/auth/login', { body: { phone: known } });
      const unknownRes = await world.api('post', '/auth/login', { body: { phone: nextPhone() } });
      expect(unknownRes.status).toBe(knownRes.status);
      expect(unknownRes.body).toEqual(knownRes.body);
      expect(boundary.sms).toHaveLength(1); // only the known phone was texted
    });

    it('an SMS provider outage fails closed: 400 SMS_PROVIDER_UNAVAILABLE, no usable code is left behind', async () => {
      const phone = nextPhone();
      boundary.smsOutage = true;
      const res = await world.api('post', '/auth/register', { body: { phone, fullName: 'Outage Customer' } });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual({ code: 'SMS_PROVIDER_UNAVAILABLE' });
      expect(res.body.error.message).not.toMatch(/unifonic|503|appsid/i); // no provider internals leak
      expect(await world.redis.get(`otp:${phone}`)).toBeNull();
      expect(await world.redis.get(`otp-cooldown:${phone}`)).toBeNull();
      expect((await world.api('post', '/auth/otp/verify', { body: { phone, code: '123456' } })).status).toBe(401);
      boundary.smsOutage = false;
    });

    it('is gated by CUSTOMER_OTP_ENABLED: when off, register is refused before any OTP/SMS work', async () => {
      await s.setConfig('CUSTOMER_OTP_ENABLED', false);
      const res = await world.api('post', '/auth/register', { body: { phone: nextPhone(), fullName: 'No Otp' } });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual({ code: 'CUSTOMER_OTP_DISABLED' });
      expect(boundary.sms).toHaveLength(0);
      await s.setConfig('CUSTOMER_OTP_ENABLED', true);
    });

    it('toggling CUSTOMER_OTP_ENABLED never invalidates an existing password or session: a password account created ' +
      'while OTP is OFF logs in exactly the same once OTP is turned back ON', async () => {
      await s.setConfig('CUSTOMER_OTP_ENABLED', false);
      const customer = await s.customer('Survives Otp Toggle');
      const loginWhileOff = expectData<{ accessToken: string }>(
        await world.api('post', '/auth/customer/password/login', { body: { phone: customer.phone, password: DEFAULT_PASSWORD } }),
      );
      expect(decodeJwt(loginWhileOff.accessToken)).toMatchObject({ sub: customer.id, role: Role.CUSTOMER });

      await s.setConfig('CUSTOMER_OTP_ENABLED', true);
      // Same phone, same password, no re-registration — the flag never touched the stored hash or the session store.
      const loginAfterReenable = expectData<{ accessToken: string }>(
        await world.api('post', '/auth/customer/password/login', { body: { phone: customer.phone, password: DEFAULT_PASSWORD } }),
      );
      expect(decodeJwt(loginAfterReenable.accessToken)).toMatchObject({ sub: customer.id, role: Role.CUSTOMER });
    });

    it('validates input at the HTTP edge (bad phone, missing name, unknown property)', async () => {
      const badPhone = await world.api('post', '/auth/register', { body: { phone: '12345', fullName: 'X Y' } });
      expect(badPhone.status).toBe(400);
      expect((await world.api('post', '/auth/register', { body: { phone: nextPhone() } })).status).toBe(400);
      expect((await world.api('post', '/auth/register', { body: { phone: nextPhone(), fullName: 'Ok Name', role: 'SUPER_ADMIN' } })).status).toBe(400);
      expect(boundary.sms).toHaveLength(0);
    });

    it('POST /auth/login validates its body (an empty body was a 500) and sends nothing for a rejected request', async () => {
      for (const body of [{}, { phone: '' }, { phone: 12345 }, { phone: 'not-a-phone' }, { phone: nextPhone(), extra: 1 }]) {
        const res = await world.api('post', '/auth/login', { body });
        expect({ body, status: res.status }).toEqual({ body, status: 400 });
      }
      expect(boundary.sms).toHaveLength(0);
    });

    it('the OTP flow can never mint a privileged session: a customer who registers via OTP is only ever a CUSTOMER', async () => {
      const phone = nextPhone();
      await world.api('post', '/auth/register', { body: { phone, fullName: 'Sneaky', role: 'ADMIN' } });
      expect(await world.ds.getRepository(User).count({ where: { phone } })).toBe(0); // rejected outright
    });
  });

  describe('password logins and role separation', () => {
    it('customer password registration → login round trip', async () => {
      const customer = await s.customer('Pw Customer');
      const login = expectData(await world.api('post', '/auth/customer/password/login', { body: { phone: customer.phone, password: DEFAULT_PASSWORD } }));
      expect(decodeJwt(login.accessToken)).toMatchObject({ sub: customer.id, role: Role.CUSTOMER });
    });

    it('each role logs in only through ITS endpoint; every other pairing is a generic 401', async () => {
      const superAdmin = await s.superAdmin();
      const admin = await s.admin([Permission.MANAGE_DRIVERS]);
      const customer = await s.customer();
      const area = await s.serviceArea();
      const vendor = await s.vendor({ serviceAreaId: area.id, lat: area.lat, lng: area.lng });
      const driverPhone = nextPhone();
      expectData(
        await world.api('post', '/admin/drivers', { token: admin.accessToken, body: { phone: driverPhone, fullName: 'Role Driver', password: DEFAULT_PASSWORD } }),
        201,
      );

      const endpoints = {
        driver: '/auth/driver/login',
        staff: '/auth/password/login',
        customer: '/auth/customer/password/login',
      } as const;
      const accounts: Array<{ who: string; phone: string; allowed: keyof typeof endpoints }> = [
        { who: 'driver', phone: driverPhone, allowed: 'driver' },
        { who: 'vendor manager', phone: vendor.manager.phone, allowed: 'staff' },
        { who: 'admin', phone: admin.phone, allowed: 'staff' },
        { who: 'super admin', phone: superAdmin.phone, allowed: 'staff' },
        { who: 'customer', phone: customer.phone, allowed: 'customer' },
      ];
      for (const account of accounts) {
        for (const [name, path] of Object.entries(endpoints)) {
          const res = await world.api('post', path, { body: { phone: account.phone, password: DEFAULT_PASSWORD } });
          if (name === account.allowed) {
            expect({ who: account.who, endpoint: name, status: res.status }).toEqual({ who: account.who, endpoint: name, status: 200 });
          } else {
            expect({ who: account.who, endpoint: name, status: res.status, message: res.body.error?.message }).toEqual({
              who: account.who,
              endpoint: name,
              status: 401,
              message: 'Invalid credentials.',
            });
          }
        }
      }
    });

    it('wrong password, unknown phone and wrong-role produce the SAME response (no account enumeration)', async () => {
      const customer = await s.customer();
      const wrongPassword = await world.api('post', '/auth/customer/password/login', { body: { phone: customer.phone, password: 'not-the-password' } });
      const unknownPhone = await world.api('post', '/auth/customer/password/login', { body: { phone: nextPhone(), password: 'not-the-password' } });
      const wrongRole = await world.api('post', '/auth/password/login', { body: { phone: customer.phone, password: DEFAULT_PASSWORD } });
      for (const res of [wrongPassword, unknownPhone, wrongRole]) {
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHORIZED');
        expect(res.body.error.message).toBe('Invalid credentials.');
      }
    });

    it('a deactivated staff account can no longer log in or refresh', async () => {
      const area = await s.serviceArea();
      const vendor = await s.vendor({ serviceAreaId: area.id, lat: area.lat, lng: area.lng });
      const superAdmin = await s.superAdmin();
      const staffRows = expectData<Array<{ id: string; userId?: string; phone?: string }>>(
        await world.api('get', '/admin/vendor-staff', { token: superAdmin.accessToken, query: { vendorBranchId: vendor.branchId } }),
      );
      expect(staffRows.length).toBeGreaterThan(0);
      const staffId = staffRows[0].id;
      expectData(await world.api('patch', `/admin/vendor-staff/${staffId}/deactivate`, { token: superAdmin.accessToken }));

      const login = await world.api('post', '/auth/password/login', { body: { phone: vendor.manager.phone, password: DEFAULT_PASSWORD } });
      expect(login.status).toBe(401);
      const refresh = await world.api('post', '/auth/refresh', { body: { refreshToken: vendor.manager.refreshToken } });
      expect(refresh.status).toBe(401);
    });
  });

  describe('session validity', () => {
    it('rejects requests with no token, a malformed token, and a non-bearer scheme', async () => {
      expect((await world.api('get', '/cart')).status).toBe(401);
      expect((await world.api('get', '/cart', { token: 'not.a.jwt' })).status).toBe(401);
      expect((await world.api('get', '/cart', { headers: { Authorization: 'Basic abc' } })).status).toBe(401);
    });

    it('rejects an expired access token and a token signed with the wrong secret', async () => {
      const customer = await s.customer();
      const expired = jwt.sign({ sub: customer.id, role: Role.CUSTOMER, phone: customer.phone }, 'e2e-access-secret', { expiresIn: -10 });
      const forged = jwt.sign({ sub: customer.id, role: Role.CUSTOMER, phone: customer.phone }, 'attacker-secret', { expiresIn: '1h' });
      const asAdmin = jwt.sign({ sub: customer.id, role: Role.SUPER_ADMIN, phone: customer.phone }, 'attacker-secret', { expiresIn: '1h' });
      for (const token of [expired, forged, asAdmin]) {
        const res = await world.api('get', '/cart', { token });
        expect(res.status).toBe(401);
      }
      expect((await world.api('get', '/cart', { token: customer.accessToken })).status).toBe(200);
    });

    it('a refresh token is not accepted as an access token, and an access token is not accepted for refresh', async () => {
      const customer = await s.customer();
      expect((await world.api('get', '/cart', { token: customer.refreshToken })).status).toBe(401);
      expect((await world.api('post', '/auth/refresh', { body: { refreshToken: customer.accessToken } })).status).toBe(401);
    });

    it('rotates refresh tokens: each is single-use, the old one is dead, the new pair works', async () => {
      const customer = await s.customer();
      const rotated = expectData<{ accessToken: string; refreshToken: string }>(
        await world.api('post', '/auth/refresh', { body: { refreshToken: customer.refreshToken } }),
      );
      expect(rotated.refreshToken).not.toBe(customer.refreshToken);
      expect((await world.api('post', '/auth/refresh', { body: { refreshToken: customer.refreshToken } })).status).toBe(401); // replay
      expect((await world.api('get', '/cart', { token: rotated.accessToken })).status).toBe(200);
      expectData(await world.api('post', '/auth/refresh', { body: { refreshToken: rotated.refreshToken } }));
    });

    it('logout revokes the refresh token in Redis; a second login supersedes the first session (single jti per user)', async () => {
      const customer = await s.customer();
      expect(await world.redis.get(`refresh-jti:${customer.id}`)).not.toBeNull();
      expect((await world.api('post', '/auth/logout', { token: customer.accessToken })).status).toBe(200);
      expect(await world.redis.get(`refresh-jti:${customer.id}`)).toBeNull();
      expect((await world.api('post', '/auth/refresh', { body: { refreshToken: customer.refreshToken } })).status).toBe(401);

      const deviceA = expectData<{ refreshToken: string }>(await world.api('post', '/auth/customer/password/login', { body: { phone: customer.phone, password: DEFAULT_PASSWORD } }));
      const deviceB = expectData<{ refreshToken: string }>(await world.api('post', '/auth/customer/password/login', { body: { phone: customer.phone, password: DEFAULT_PASSWORD } }));
      expect((await world.api('post', '/auth/refresh', { body: { refreshToken: deviceA.refreshToken } })).status).toBe(401);
      expect((await world.api('post', '/auth/refresh', { body: { refreshToken: deviceB.refreshToken } })).status).toBe(200);
    });

    it('CHARACTERIZATION: logout is not instant for an already-issued access token (stateless JWT, 15 min lifetime)', async () => {
      const customer = await s.customer();
      await world.api('post', '/auth/logout', { token: customer.accessToken });
      // Documented limitation, not a regression: only the REFRESH token is revocable. Access tokens
      // stay valid until `exp` (15 minutes by default).
      expect((await world.api('get', '/cart', { token: customer.accessToken })).status).toBe(200);
    });

    it('a token cannot escalate privilege: role gates use the signed role, not anything the caller sends', async () => {
      const customer = await s.customer();
      const attempts = [
        world.api('get', '/admin/service-areas', { token: customer.accessToken }),
        world.api('get', '/driver/deliveries', { token: customer.accessToken }),
        world.api('get', '/vendor/orders', { token: customer.accessToken }),
        world.api('get', '/admin/service-areas', { token: customer.accessToken, headers: { 'X-Role': 'SUPER_ADMIN' }, query: { role: 'SUPER_ADMIN' } }),
      ];
      for (const res of await Promise.all(attempts)) expect(res.status).toBe(403);
    });
  });

  describe('correlation ids', () => {
    it('generates one when absent, echoes a valid caller-supplied one, and replaces an invalid one', async () => {
      const generated = await world.api('get', '/health');
      expect(generated.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);

      const supplied = await world.api('get', '/health', { headers: { 'x-correlation-id': 'e2e-trace_123' } });
      expect(supplied.headers['x-correlation-id']).toBe('e2e-trace_123');

      const invalid = await world.api('get', '/health', { headers: { 'x-correlation-id': 'bad id with spaces & symbols!' } });
      expect(invalid.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(invalid.headers['x-correlation-id']).not.toContain(' ');
    });

    it('failures at every layer (auth, validation, role, not found) carry the request correlation id in header AND body', async () => {
      const customer = await s.customer();
      const cases = [
        { name: '401 auth', res: await world.api('get', '/cart', { headers: { 'x-correlation-id': 'trace-401' } }), status: 401, id: 'trace-401' },
        { name: '400 validation', res: await world.api('post', '/auth/register', { body: { phone: 'x' }, headers: { 'x-correlation-id': 'trace-400' } }), status: 400, id: 'trace-400' },
        { name: '403 role', res: await world.api('get', '/admin/service-areas', { token: customer.accessToken, headers: { 'x-correlation-id': 'trace-403' } }), status: 403, id: 'trace-403' },
        { name: '404 route', res: await world.api('get', '/no/such/route', { headers: { 'x-correlation-id': 'trace-404' } }), status: 404, id: 'trace-404' },
      ];
      for (const c of cases) {
        expect({ name: c.name, status: c.res.status }).toEqual({ name: c.name, status: c.status });
        expect(c.res.headers['x-correlation-id']).toBe(c.id);
        expect(c.res.body.error.correlationId).toBe(c.id);
      }
    });

    it('the request log line carries the same correlation id, and never the bearer token or password', async () => {
      const customer = await s.customer();
      await world.api('get', '/cart', { token: customer.accessToken, headers: { 'x-correlation-id': 'trace-log-1' } });
      await world.api('post', '/auth/customer/password/login', { body: { phone: customer.phone, password: 'super-secret-wrong' }, headers: { 'x-correlation-id': 'trace-log-2' } });
      const joined = world.logs.map((l) => l.message).join('\n');
      expect(joined).toContain('"correlationId":"trace-log-1"');
      expect(joined).toContain('"correlationId":"trace-log-2"');
      expect(joined).not.toContain(customer.accessToken);
      expect(joined).not.toContain('super-secret-wrong');
      expect(joined).not.toContain(DEFAULT_PASSWORD);
    });
  });
});

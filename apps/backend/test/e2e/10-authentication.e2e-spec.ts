/**
 * Group 8 / phase 3 — authentication over real HTTP: customer OTP (real OtpService + Redis, real
 * UnifonicSmsProvider with only the network edge faked), driver/vendor/admin/customer password
 * login, role separation, session validity, token rotation, and correlation ids.
 */
import { createHash } from 'crypto';
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

  // ---------------------------------------------------------------------------------------------------------------------
  // THE CUSTOMER AUTH CONTRACT: every account has a password; sign-in is phone + password; OTP only VERIFIES a phone, for the
  // signed-in customer, while CUSTOMER_OTP_ENABLED is on.
  // ---------------------------------------------------------------------------------------------------------------------

  const registerBody = (phone: string, password: unknown = DEFAULT_PASSWORD, fullName = 'Contract Customer', code?: string) => ({
    phone,
    fullName,
    password,
    ...(code ? { code } : {}),
  });
  const requestCode = (phone: string) => world.api('post', '/auth/customer/register/request-code', { body: { phone } });
  /** The first step of registration while OTP is on, as the app does it: ask for a code, read it from the (faked) SMS edge. */
  const codeFor = async (phone: string) => {
    expect((await requestCode(phone)).status).toBe(200);
    return boundary.lastOtpFor(phone);
  };
  const register = (body: Record<string, unknown>) => world.api('post', '/auth/customer/password/register', { body });
  const passwordLogin = (phone: string, password: string) => world.api('post', '/auth/customer/password/login', { body: { phone, password } });
  const passwordHashOf = async (phone: string) => (await world.ds.query('SELECT password_hash FROM users WHERE phone = $1', [phone]))[0]?.password_hash ?? null;
  const userCount = async () => Number((await world.ds.query('SELECT count(*)::int AS n FROM users'))[0].n);
  const plantValidOtp = async (phone: string, code = '424242') => {
    await world.redis.set(`otp:${phone}`, JSON.stringify({ codeHash: createHash('sha256').update(code).digest('hex'), attempts: 0 }), 'EX', 300);
    return code;
  };

  describe('every customer account has a password', () => {
    beforeAll(async () => {
      await s.setConfig('CUSTOMER_OTP_ENABLED', true);
    });
    afterEach(async () => {
      await s.setConfig('CUSTOMER_OTP_ENABLED', true);
    });

    it('registration WITHOUT a password (missing, empty, null, wrong type, too short) is rejected and creates NO account', async () => {
      const before = await userCount();
      for (const password of [undefined, '', null, 12345678, 'short', 'seven77']) {
        const res = await register({ phone: nextPhone(), fullName: 'No Password', ...(password === undefined ? {} : { password }) }); // `undefined` = the key is absent
        expect({ password, status: res.status }).toEqual({ password, status: 400 });
      }
      expect(await userCount()).toBe(before);
    });

    it('OTP OFF: registration creates the account WITH a bcrypt hash, a CUSTOMER role (never anything privileged) and a session — no SMS, and the phone stays UNVERIFIED', async () => {
      await s.setConfig('CUSTOMER_OTP_ENABLED', false);
      const phone = nextPhone();
      const res = await register(registerBody(phone));
      expect(res.status).toBe(200);
      expect(decodeJwt(res.body.data.accessToken)).toMatchObject({ role: Role.CUSTOMER, phone });
      expect(await passwordHashOf(phone)).toMatch(/^\$2[aby]\$/);
      expect((await world.ds.getRepository(User).findOneByOrFail({ phone })).isPhoneVerified).toBe(false);
      expect(boundary.sms).toHaveLength(0);

      // a privilege-escalation attempt through the body is rejected outright
      const before = await userCount();
      expect((await register({ ...registerBody(nextPhone()), role: 'SUPER_ADMIN' })).status).toBe(400);
      expect(await userCount()).toBe(before);
    });

    it('INVARIANT: no customer row in the database exists without a password hash', async () => {
      const rows = await world.ds.query("SELECT phone FROM users WHERE role = 'CUSTOMER' AND (password_hash IS NULL OR password_hash = '')");
      expect(rows).toEqual([]);
    });

    it('registering a phone that already has an account is a generic 401 and changes NOTHING (password, name, verification)', async () => {
      const customer = await s.customer('Existing Owner');
      const hash = await passwordHashOf(customer.phone);
      await s.setConfig('CUSTOMER_OTP_ENABLED', false);
      const again = await register(registerBody(customer.phone, 'Attacker-Pass-1!', 'Attacker Name'));
      expect(again.status).toBe(401);
      expect(again.body.error.code).toBe('UNAUTHORIZED');
      expect(await passwordHashOf(customer.phone)).toBe(hash);
      expect((await world.ds.getRepository(User).findOneByOrFail({ phone: customer.phone })).fullName).toBe('Existing Owner');
      expectData(await passwordLogin(customer.phone, DEFAULT_PASSWORD));
      expect((await passwordLogin(customer.phone, 'Attacker-Pass-1!')).status).toBe(401);
    });

    it('five simultaneous registrations of one phone: exactly one account is created, the others get the generic refusal (never a 500)', async () => {
      await s.setConfig('CUSTOMER_OTP_ENABLED', false);
      const phone = nextPhone();
      const results = await Promise.all(['A', 'B', 'C', 'D', 'E'].map((x) => register(registerBody(phone, `Racer-Pass-${x}-1!`, `Racer ${x}`))));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 401)).toHaveLength(4);
      expect(await world.ds.getRepository(User).countBy({ phone })).toBe(1);
    });

    it('GUESTS have no account: anonymous browsing and refused anonymous cart/checkout calls never create a user', async () => {
      const before = await userCount();
      for (const path of ['/sectors', '/vendors', '/products', '/search?q=a']) {
        expect((await world.api('get', path)).status).toBeLessThan(500);
      }
      for (const [method, path] of [['get', '/cart'], ['post', '/cart/items'], ['post', '/checkout/quote'], ['post', '/orders']] as const) {
        expect({ path, status: (await world.api(method, path, { body: {} })).status }).toEqual({ path, status: 401 });
      }
      expect(await userCount()).toBe(before);
    });

    it('the existing flow stays coherent: a guest who must check out registers WITH a password, then signs in with phone + password', async () => {
      await s.setConfig('CUSTOMER_OTP_ENABLED', true);
      const phone = nextPhone();
      const registered = expectData<{ accessToken: string }>(await register(registerBody(phone, DEFAULT_PASSWORD, 'Checkout Guest', await codeFor(phone))));
      expect((await world.api('get', '/cart', { token: registered.accessToken })).status).toBe(200); // the new account can use the cart
      expectData(await passwordLogin(phone, DEFAULT_PASSWORD));
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------
  // PHONE OWNERSHIP IS PROVEN BEFORE THE ACCOUNT EXISTS (no phone squatting) while CUSTOMER_OTP_ENABLED is on.
  // ---------------------------------------------------------------------------------------------------------------------

  describe('registration proves phone ownership first (OTP ON) — nobody can register a number they do not hold', () => {
    beforeAll(async () => {
      await s.setConfig('CUSTOMER_OTP_ENABLED', true);
    });
    afterEach(async () => {
      await s.setConfig('CUSTOMER_OTP_ENABLED', true);
    });

    it('request code -> register with it: ONE SMS to that phone; the account is created with a password AND a VERIFIED phone, and a session; the code is stored hashed', async () => {
      const phone = nextPhone();
      const res = await requestCode(phone);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'If eligible, a verification code has been sent.' });
      expect(boundary.sms).toHaveLength(1);
      expect(boundary.sms[0].to).toBe(bare(phone));
      expect(await world.redis.get(`otp:${phone}`)).not.toContain(boundary.sms[0].code!);
      expect(await world.ds.getRepository(User).countBy({ phone })).toBe(0); // asking for a code creates nothing

      const registered = await register(registerBody(phone, DEFAULT_PASSWORD, 'Proven Owner', boundary.sms[0].code!));
      expect(registered.status).toBe(200);
      expect(decodeJwt(registered.body.data.accessToken)).toMatchObject({ role: Role.CUSTOMER, phone });
      expect(await passwordHashOf(phone)).toMatch(/^\$2[aby]\$/);
      expect((await world.ds.getRepository(User).findOneByOrFail({ phone })).isPhoneVerified).toBe(true);
      expectData(await passwordLogin(phone, DEFAULT_PASSWORD)); // normal sign-in is still phone + password
    });

    it('the session issued at registration is a real one: its refresh token rotates once (the jti stored before the insert belongs to the new account id)', async () => {
      const phone = nextPhone();
      const registered = expectData<{ accessToken: string; refreshToken: string }>(await register(registerBody(phone, DEFAULT_PASSWORD, 'Refresher', await codeFor(phone))));
      const refreshed = await world.api('post', '/auth/refresh', { body: { refreshToken: registered.refreshToken } });
      expect(refreshed.status).toBe(200);
      expect(decodeJwt(refreshed.body.data.accessToken).sub).toBe(decodeJwt(registered.accessToken).sub);
      expect((await world.api('post', '/auth/refresh', { body: { refreshToken: registered.refreshToken } })).status).toBe(401); // single use
    });

    it('CRITICAL (squatting): registering a phone WITHOUT its code is refused — 400 PHONE_VERIFICATION_REQUIRED, no account, no password stored', async () => {
      const phone = nextPhone();
      const before = await userCount();
      for (const body of [registerBody(phone), registerBody(phone, DEFAULT_PASSWORD, 'Squatter', '')]) {
        const res = await register(body);
        expect(res.status).toBe(400);
      }
      const res = await register(registerBody(phone));
      expect(res.body.error.details).toMatchObject({ code: 'PHONE_VERIFICATION_REQUIRED' });
      expect(await userCount()).toBe(before);
      expect(await world.ds.getRepository(User).countBy({ phone })).toBe(0);
    });

    it('CRITICAL (squatting): a wrong code, a code for ANOTHER phone, or a made-up code never creates the account — and the real owner can still register afterwards', async () => {
      const victim = nextPhone();
      const attackerOwn = nextPhone();
      await requestCode(victim);
      const victimCode = boundary.lastOtpFor(victim);
      const attackerCode = await codeFor(attackerOwn);

      const before = await userCount();
      const wrong = victimCode === '111111' ? '222222' : '111111';
      for (const code of [wrong, attackerCode]) {
        const res = await register(registerBody(victim, 'Squatter-Pass-1!', 'Squatter', code));
        expect({ code, status: res.status }).toEqual({ code, status: 401 });
      }
      expect(await userCount()).toBe(before);
      expect(await world.ds.getRepository(User).countBy({ phone: victim })).toBe(0);

      // the legitimate owner (holder of the SMS) is NOT locked out by the squatting attempts
      const owner = await register(registerBody(victim, DEFAULT_PASSWORD, 'Real Owner', victimCode));
      expect(owner.status).toBe(200);
      expectData(await passwordLogin(victim, DEFAULT_PASSWORD));
      expect((await passwordLogin(victim, 'Squatter-Pass-1!')).status).toBe(401);
    });

    it('a code is single-use and brute force is capped: a used code is dead; five wrong guesses kill the code even for the right value', async () => {
      const used = nextPhone();
      const usedCode = await codeFor(used);
      expect((await register(registerBody(used, DEFAULT_PASSWORD, 'Once', usedCode))).status).toBe(200);
      const again = await register(registerBody(used, 'Replay-Pass-1!', 'Replay', usedCode));
      expect(again.status).toBe(401); // the code is gone AND the phone now has an account: one generic refusal
      expect(await world.ds.getRepository(User).countBy({ phone: used })).toBe(1);

      const guessed = nextPhone();
      const guessedCode = await codeFor(guessed);
      const wrong = guessedCode === '000000' ? '000001' : '000000';
      for (let i = 0; i < 5; i += 1) expect((await register(registerBody(guessed, DEFAULT_PASSWORD, 'Guess', wrong))).status).toBe(401);
      expect((await register(registerBody(guessed, DEFAULT_PASSWORD, 'Guess', guessedCode))).status).toBe(401); // locked out: request a new code
      expect(await world.ds.getRepository(User).countBy({ phone: guessed })).toBe(0);
    });

    it('a malformed code or a client-supplied "verified" flag is rejected at the edge — the server alone decides verification', async () => {
      const phone = nextPhone();
      const before = await userCount();
      for (const extra of [{ code: '12345' }, { code: 'abcdef' }, { code: 123456 }, { isPhoneVerified: true }, { phoneVerified: true }, { verified: true }]) {
        const res = await register({ ...registerBody(phone), ...extra });
        expect({ extra, status: res.status }).toEqual({ extra, status: 400 });
      }
      expect(await userCount()).toBe(before);
    });

    it('requesting a code for a phone that ALREADY has an account sends nothing and answers exactly like a fresh phone (no enumeration)', async () => {
      const existing = await s.customer('Already Here');
      boundary.reset();
      const fresh = await requestCode(nextPhone());
      const sentForFresh = boundary.sms.length;
      boundary.reset();
      const known = await requestCode(existing.phone);
      expect(known.status).toBe(fresh.status);
      expect(known.body).toEqual(fresh.body);
      expect(sentForFresh).toBe(1);
      expect(boundary.sms).toHaveLength(0);
      expect(await world.redis.get(`otp:${existing.phone}`)).toBeNull();
    });

    it('OTP can never overwrite a password: a VALID code for an existing customer is refused at registration and the password is untouched', async () => {
      const customer = await s.customer('Has Password');
      const hash = await passwordHashOf(customer.phone);
      const code = await plantValidOtp(customer.phone);
      const res = await register(registerBody(customer.phone, 'Takeover-Pass-1!', 'Takeover', code));
      expect(res.status).toBe(401);
      expect(await passwordHashOf(customer.phone)).toBe(hash);
      expectData(await passwordLogin(customer.phone, DEFAULT_PASSWORD));
      expect((await passwordLogin(customer.phone, 'Takeover-Pass-1!')).status).toBe(401);
    });

    it('SMS provider down: the request answers like any other (fail closed — no code is stored, nothing can be verified) and registering is impossible until a code exists', async () => {
      const phone = nextPhone();
      boundary.smsOutage = true;
      const res = await requestCode(phone);
      expect(res.status).toBe(200);
      expect(await world.redis.get(`otp:${phone}`)).toBeNull();
      expect((await register(registerBody(phone, DEFAULT_PASSWORD, 'No Code', '123456'))).status).toBe(401);
      expect(await world.ds.getRepository(User).countBy({ phone })).toBe(0);
      boundary.smsOutage = false;
      const code = await codeFor(phone); // recovers by itself: the failed attempt left no cooldown behind
      expect((await register(registerBody(phone, DEFAULT_PASSWORD, 'Now Ok', code))).status).toBe(200);
    });

    it('request-code validates its input: no phone / an invalid phone / extra fields -> 400 and nothing is sent', async () => {
      for (const body of [{}, { phone: '12345' }, { phone: nextPhone(), isPhoneVerified: true }]) {
        expect({ body, status: (await world.api('post', '/auth/customer/register/request-code', { body })).status }).toEqual({ body, status: 400 });
      }
      expect(boundary.sms).toHaveLength(0);
    });
  });

  describe('OTP OFF: registration does not fabricate verification and does not require SMS', () => {
    afterEach(async () => {
      await s.setConfig('CUSTOMER_OTP_ENABLED', true);
    });

    it('request-code answers 400 CUSTOMER_OTP_DISABLED and sends nothing; registration with a password alone works and the phone stays unverified', async () => {
      await s.setConfig('CUSTOMER_OTP_ENABLED', false);
      const phone = nextPhone();
      const asked = await requestCode(phone);
      expect(asked.status).toBe(400);
      expect(asked.body.error.details).toMatchObject({ code: 'CUSTOMER_OTP_DISABLED' });
      expect(boundary.sms).toHaveLength(0);
      expect(await world.redis.get(`otp:${phone}`)).toBeNull();

      expect((await register(registerBody(phone))).status).toBe(200);
      expect((await world.ds.getRepository(User).findOneByOrFail({ phone })).isPhoneVerified).toBe(false);
      expect(boundary.sms).toHaveLength(0);
    });

    it('a code supplied anyway is ignored, never trusted: even a REAL pending code does not make the phone verified', async () => {
      await s.setConfig('CUSTOMER_OTP_ENABLED', true);
      const phone = nextPhone();
      const code = await codeFor(phone);
      await s.setConfig('CUSTOMER_OTP_ENABLED', false);
      expect((await register(registerBody(phone, DEFAULT_PASSWORD, 'Toggled', code))).status).toBe(200);
      expect((await world.ds.getRepository(User).findOneByOrFail({ phone })).isPhoneVerified).toBe(false);
    });

    it('the Admin turning OTP ON again later: the unverified account signs in normally and can verify through the authenticated flow', async () => {
      await s.setConfig('CUSTOMER_OTP_ENABLED', false);
      const phone = nextPhone();
      expect((await register(registerBody(phone))).status).toBe(200);
      await s.setConfig('CUSTOMER_OTP_ENABLED', true);
      const login = expectData<{ accessToken: string }>(await passwordLogin(phone, DEFAULT_PASSWORD));
      boundary.reset();
      expect((await world.api('post', '/auth/customer/verify-phone/request', { token: login.accessToken })).status).toBe(200);
      expect((await world.api('post', '/auth/customer/verify-phone/confirm', { token: login.accessToken, body: { code: boundary.lastOtpFor(phone) } })).status).toBe(200);
      expect((await world.ds.getRepository(User).findOneByOrFail({ phone })).isPhoneVerified).toBe(true);
    });
  });

  describe('legacy OTP registration and sign-in are retired — a one-time code is not a way in', () => {
    afterEach(async () => {
      await s.setConfig('CUSTOMER_OTP_ENABLED', true);
    });

    it('POST /auth/register with OTP ON: 410 LEGACY_OTP_REGISTRATION_RETIRED — no account, no SMS, no code, no session', async () => {
      await s.setConfig('CUSTOMER_OTP_ENABLED', true);
      const phone = nextPhone();
      const res = await world.api('post', '/auth/register', { body: { phone, fullName: 'Legacy App' } });
      expect(res.status).toBe(410);
      expect(res.body.error.details).toEqual({ code: 'LEGACY_OTP_REGISTRATION_RETIRED' });
      expect(JSON.stringify(res.body)).not.toMatch(/accessToken|refreshToken/);
      expect(await world.ds.getRepository(User).countBy({ phone })).toBe(0);
      expect(boundary.sms).toHaveLength(0);
      expect(await world.redis.get(`otp:${phone}`)).toBeNull();
    });

    it('POST /auth/register with OTP OFF: the CUSTOMER_OTP_DISABLED answer older apps use to fall back to the password form (they keep working)', async () => {
      await s.setConfig('CUSTOMER_OTP_ENABLED', false);
      const phone = nextPhone();
      const res = await world.api('post', '/auth/register', { body: { phone, fullName: 'Legacy App' } });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual({ code: 'CUSTOMER_OTP_DISABLED' });
      expect(await world.ds.getRepository(User).countBy({ phone })).toBe(0);
      expect(boundary.sms).toHaveLength(0);
    });

    it('the legacy register route still validates its body, and the removed OTP sign-in / code-exchange / claim routes no longer exist', async () => {
      expect((await world.api('post', '/auth/register', { body: { phone: '12345', fullName: 'X Y' } })).status).toBe(400);
      expect((await world.api('post', '/auth/register', { body: { phone: nextPhone() } })).status).toBe(400);
      expect((await world.api('post', '/auth/register', { body: { phone: nextPhone(), fullName: 'Ok Name', role: 'SUPER_ADMIN' } })).status).toBe(400);
      for (const path of ['/auth/login', '/auth/otp/verify', '/auth/customer/password/claim', '/auth/customer/password/claim/request']) {
        expect({ path, status: (await world.api('post', path, { body: { phone: nextPhone(), code: '123456', password: 'Whatever-1!' } })).status }).toEqual({ path, status: 404 });
      }
      expect(boundary.sms).toHaveLength(0);
    });

    it('OTP ALONE can never attach, replace or create a password — a valid code in Redis changes nothing on any route', async () => {
      await s.setConfig('CUSTOMER_OTP_ENABLED', true);
      const customer = await s.customer('Has Password');
      const hash = await passwordHashOf(customer.phone);
      const code = await plantValidOtp(customer.phone);

      for (const [path, body] of [
        ['/auth/register', { phone: customer.phone, fullName: 'Takeover' }],
        ['/auth/customer/password/register', { phone: customer.phone, fullName: 'Takeover', password: 'Takeover-Pass-1!', code }],
        ['/auth/customer/password/login', { phone: customer.phone, password: code }],
        ['/auth/otp/verify', { phone: customer.phone, code }],
        ['/auth/customer/password/claim', { phone: customer.phone, code, password: 'Takeover-Pass-1!' }],
      ] as const) {
        const res = await world.api('post', path, { body });
        expect({ path, ok: res.status === 200 && !!res.body?.data?.accessToken && path !== '/auth/customer/password/register' }).toEqual({ path, ok: false });
      }
      expect(await passwordHashOf(customer.phone)).toBe(hash);
      expectData(await passwordLogin(customer.phone, DEFAULT_PASSWORD));
      // ...and the authenticated change still wants the current password, not a code
      expect((await world.api('patch', '/auth/customer/password', { token: customer.accessToken, body: { password: 'Takeover-Pass-1!', currentPassword: code } })).status).toBe(403);
      expect(await passwordHashOf(customer.phone)).toBe(hash);
    });
  });

  describe('phone verification by OTP (signed-in customer, CUSTOMER_OTP_ENABLED on)', () => {
    beforeAll(async () => {
      await s.setConfig('CUSTOMER_OTP_ENABLED', true);
    });
    afterEach(async () => {
      await s.setConfig('CUSTOMER_OTP_ENABLED', true);
      boundary.smsOutage = false;
    });
    const requestCode = (token: string) => world.api('post', '/auth/customer/verify-phone/request', { token });
    const confirm = (token: string, code: string) => world.api('post', '/auth/customer/verify-phone/confirm', { token, body: { code } });
    const verified = async (phone: string) => (await world.ds.getRepository(User).findOneByOrFail({ phone })).isPhoneVerified;

    it('the signed-in customer gets ONE real-provider SMS to their OWN phone; the code is stored only as a hash with a TTL and a resend cooldown', async () => {
      const c = await s.unverifiedCustomer('Verify Me');
      boundary.reset();
      const res = await requestCode(c.accessToken);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'If eligible, a verification code has been sent.' });

      expect(boundary.sms).toHaveLength(1);
      expect(boundary.sms[0].to).toBe(bare(c.phone)); // Unifonic wants the number without '+'
      expect(boundary.sms[0].code).toMatch(/^\d{6}$/);
      expect(boundary.sms[0].body).toContain('Hatly verification code');
      const stored = await world.redis.get(`otp:${c.phone}`);
      expect(stored).not.toContain(boundary.sms[0].code!); // sha256 hash only
      expect(JSON.parse(stored!)).toEqual({ codeHash: expect.stringMatching(/^[0-9a-f]{64}$/), attempts: 0 });
      const ttl = await world.redis.ttl(`otp:${c.phone}`);
      expect(ttl).toBeGreaterThan(290);
      expect(ttl).toBeLessThanOrEqual(300);
      expect(await world.redis.ttl(`otp-cooldown:${c.phone}`)).toBeLessThanOrEqual(60);
      expect(await verified(c.phone)).toBe(false); // sending a code proves nothing
    });

    it('a correct code verifies the phone — and issues NO tokens; the code is consumed and cannot be replayed', async () => {
      const c = await s.unverifiedCustomer('Verify Me 2');
      boundary.reset();
      await requestCode(c.accessToken);
      const code = boundary.lastOtpFor(c.phone);

      const res = await confirm(c.accessToken, code);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body)).toEqual(['message']); // verification is not authentication
      expect(await verified(c.phone)).toBe(true);
      expect(expectData(await world.api('get', '/auth/customer/me', { token: c.accessToken }))).toEqual({ isPhoneVerified: true, phoneVerificationAvailable: true });
      expect(await world.redis.get(`otp:${c.phone}`)).toBeNull();

      const replay = await confirm(c.accessToken, code);
      expect(replay.status).toBe(401);
    });

    it('a phone is NEVER verified without proof: no code requested, a wrong code, an expired code, and another account\'s code all leave it unverified', async () => {
      const a = await s.unverifiedCustomer('Proof A');
      const b = await s.unverifiedCustomer('Proof B');
      boundary.reset();

      expect((await confirm(a.accessToken, '123456')).status).toBe(401); // nothing was ever requested
      await requestCode(a.accessToken);
      const codeA = boundary.lastOtpFor(a.phone);
      const wrong = codeA === '000000' ? '111111' : '000000';
      expect((await confirm(a.accessToken, wrong)).status).toBe(401);
      expect((await confirm(b.accessToken, codeA)).status).toBe(401); // A's code cannot verify B
      await world.redis.pexpire(`otp:${a.phone}`, 50);
      await new Promise((r) => setTimeout(r, 120));
      expect((await confirm(a.accessToken, codeA)).status).toBe(401); // expired (real Redis TTL)

      expect(await verified(a.phone)).toBe(false);
      expect(await verified(b.phone)).toBe(false);
    });

    it('a wrong code is counted and the right one still works within the attempt budget; the code locks out after the maximum wrong attempts', async () => {
      const c = await s.unverifiedCustomer('Budget');
      boundary.reset();
      await requestCode(c.accessToken);
      const code = boundary.lastOtpFor(c.phone);
      const wrong = code === '000000' ? '111111' : '000000';

      expect((await confirm(c.accessToken, wrong)).status).toBe(401);
      expect(JSON.parse((await world.redis.get(`otp:${c.phone}`))!).attempts).toBe(1);
      expect((await confirm(c.accessToken, code)).status).toBe(200); // still within the budget

      const d = await s.unverifiedCustomer('Lockout');
      boundary.reset();
      await requestCode(d.accessToken);
      const codeD = boundary.lastOtpFor(d.phone);
      const wrongD = codeD === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i += 1) expect((await confirm(d.accessToken, wrongD)).status).toBe(401);
      const locked = await confirm(d.accessToken, codeD);
      expect(locked.status).toBe(401); // even the correct code is refused now
      expect(await verified(d.phone)).toBe(false);
    });

    it('enforces the resend cooldown (no second SMS) and allows a new code once it lapses; the new code supersedes the old', async () => {
      const c = await s.unverifiedCustomer('Impatient');
      boundary.reset();
      await requestCode(c.accessToken);
      const first = boundary.lastOtpFor(c.phone);
      expect((await requestCode(c.accessToken)).status).toBe(200); // same neutral answer, no signal
      expect(boundary.sms).toHaveLength(1);

      await world.redis.del(`otp-cooldown:${c.phone}`); // the 60s cooldown lapsing
      await requestCode(c.accessToken);
      expect(boundary.sms).toHaveLength(2);
      const second = boundary.lastOtpFor(c.phone);
      if (second !== first) expect((await confirm(c.accessToken, first)).status).toBe(401);
      expect((await confirm(c.accessToken, second)).status).toBe(200);
    });

    it('an SMS provider outage fails closed with a clear non-sensitive error (the caller is signed in and asking about their own phone), and no usable code is left behind', async () => {
      const c = await s.unverifiedCustomer('Outage');
      boundary.reset();
      boundary.smsOutage = true;
      const res = await requestCode(c.accessToken);
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual({ code: 'SMS_PROVIDER_UNAVAILABLE' });
      expect(res.body.error.message).not.toMatch(/unifonic|503|appsid/i);
      expect(await world.redis.get(`otp:${c.phone}`)).toBeNull();
      expect(await world.redis.get(`otp-cooldown:${c.phone}`)).toBeNull();
      expect(await verified(c.phone)).toBe(false);
    });

    it('with CUSTOMER_OTP_ENABLED OFF no SMS is needed or sent: the verification request is refused, the account works with phone + password, and the phone stays unverified', async () => {
      const c = await s.unverifiedCustomer('Otp Off');
      await s.setConfig('CUSTOMER_OTP_ENABLED', false);
      boundary.reset();

      const res = await requestCode(c.accessToken);
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual({ code: 'CUSTOMER_OTP_DISABLED' });
      expect(boundary.sms).toHaveLength(0);
      expect(await world.redis.get(`otp:${c.phone}`)).toBeNull();

      expectData(await passwordLogin(c.phone, DEFAULT_PASSWORD)); // password sign-in and the existing session are untouched
      // OTP off: the phone is NOT verified (nothing proved it), and the app is told verification is not possible right now — so it
      // shows no "verify your phone" prompt that could not be followed.
      expect(expectData(await world.api('get', '/auth/customer/me', { token: c.accessToken }))).toEqual({ isPhoneVerified: false, phoneVerificationAvailable: false });
      expect(await verified(c.phone)).toBe(false);

      await s.setConfig('CUSTOMER_OTP_ENABLED', true); // and verification works once the Admin turns OTP back on
      boundary.reset();
      expect((await requestCode(c.accessToken)).status).toBe(200);
      expect((await confirm(c.accessToken, boundary.lastOtpFor(c.phone))).status).toBe(200);
      expect(await verified(c.phone)).toBe(true);
    });

    it('needs a session and validates its input: anonymous callers are refused, and a malformed code is a 400', async () => {
      const c = await s.unverifiedCustomer('Edge');
      expect((await world.api('post', '/auth/customer/verify-phone/request')).status).toBe(401);
      expect((await world.api('post', '/auth/customer/verify-phone/confirm', { body: { code: '123456' } })).status).toBe(401);
      expect((await world.api('get', '/auth/customer/me')).status).toBe(401);
      expect((await world.api('post', '/auth/customer/verify-phone/confirm', { token: c.accessToken, body: {} })).status).toBe(400);
    });
  });

  describe('authenticated password change needs more than a session', () => {
    const change = (token: string | undefined, body: Record<string, unknown>) => world.api('patch', '/auth/customer/password', { token, body });
    const passwordLogin = (phone: string, password: string) => world.api('post', '/auth/customer/password/login', { body: { phone, password } });

    it('a stolen/left-open session cannot change an existing password: no current password -> 400, wrong current -> 403, and the password is untouched', async () => {
      const customer = await s.customer('Session Only');
      const noCurrent = await change(customer.accessToken, { password: 'Hijacked-Pass-1!' });
      expect(noCurrent.status).toBe(400);
      expect(noCurrent.body.error.details).toEqual({ code: 'CURRENT_PASSWORD_REQUIRED' });
      const wrong = await change(customer.accessToken, { password: 'Hijacked-Pass-1!', currentPassword: 'not-the-password' });
      expect(wrong.status).toBe(403);
      expect(wrong.body.error.details).toEqual({ code: 'CURRENT_PASSWORD_INVALID' });

      expectData(await passwordLogin(customer.phone, DEFAULT_PASSWORD));
      expect((await passwordLogin(customer.phone, 'Hijacked-Pass-1!')).status).toBe(401);
    });

    it('with the correct current password the change works; the old password stops working and the new one signs in', async () => {
      const customer = await s.customer('Legit Change');
      expect((await change(customer.accessToken, { password: 'Brand-New-Pass-1!', currentPassword: DEFAULT_PASSWORD })).status).toBe(200);
      expect((await passwordLogin(customer.phone, DEFAULT_PASSWORD)).status).toBe(401);
      expectData(await passwordLogin(customer.phone, 'Brand-New-Pass-1!'));
    });

    it('guessing the current password is brake-limited per account, exactly like sign-in (a locked account refuses even the right password)', async () => {
      const customer = await s.customer('Brute Force Change');
      let last = 0;
      for (let i = 0; i < 12 && last !== 429; i += 1) {
        last = (await change(customer.accessToken, { password: 'Hijacked-Pass-1!', currentPassword: `guess-${i}-xxxxxxx` })).status;
      }
      expect(last).toBe(429);
      expect((await change(customer.accessToken, { password: 'Hijacked-Pass-1!', currentPassword: DEFAULT_PASSWORD })).status).toBe(429);
      await world.redis.del(...(await world.redis.keys('*login*')).filter((k) => k.includes(customer.phone))); // unlock for later tests
      expectData(await passwordLogin(customer.phone, DEFAULT_PASSWORD));
    });

    it('the new password still has to meet the minimum length, and an anonymous caller is refused', async () => {
      const customer = await s.customer('Short Pass');
      expect((await change(customer.accessToken, { password: 'short', currentPassword: DEFAULT_PASSWORD })).status).toBe(400);
      expect((await change(undefined, { password: 'Anonymous-Pass-1!', currentPassword: DEFAULT_PASSWORD })).status).toBe(401);
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

    it('rotates refresh tokens: each is single-use and the new pair works (a chain of refreshes keeps working)', async () => {
      const customer = await s.customer();
      const rotated = expectData<{ accessToken: string; refreshToken: string }>(
        await world.api('post', '/auth/refresh', { body: { refreshToken: customer.refreshToken } }),
      );
      expect(rotated.refreshToken).not.toBe(customer.refreshToken);
      expect((await world.api('get', '/cart', { token: rotated.accessToken })).status).toBe(200);
      const third = expectData<{ refreshToken: string }>(await world.api('post', '/auth/refresh', { body: { refreshToken: rotated.refreshToken } }));
      expectData(await world.api('post', '/auth/refresh', { body: { refreshToken: third.refreshToken } }));
    });

    describe('refresh-token reuse detection (M5 Batch 2)', () => {
      const refresh = (refreshToken: string) => world.api('post', '/auth/refresh', { body: { refreshToken } });

      it('replaying an already-rotated token is refused with the generic 401 AND revokes the whole session (even the newest token)', async () => {
        const customer = await s.customer();
        const rotated = expectData<{ refreshToken: string }>(await refresh(customer.refreshToken));

        const replay = await refresh(customer.refreshToken);
        expect(replay.status).toBe(401);
        expect(JSON.stringify(replay.body)).not.toMatch(/reuse|replay|stolen|compromis/i); // nothing about WHY leaks to the caller
        expect(await world.redis.get(`refresh-jti:${customer.id}`)).toBeNull();
        expect((await refresh(rotated.refreshToken)).status).toBe(401); // the legitimate holder's newest token died too
      });

      it('the user can sign in again after a reuse event, and the new session works normally', async () => {
        const customer = await s.customer();
        expectData(await refresh(customer.refreshToken));
        expect((await refresh(customer.refreshToken)).status).toBe(401);
        const again = expectData<{ refreshToken: string }>(await world.api('post', '/auth/customer/password/login', { body: { phone: customer.phone, password: DEFAULT_PASSWORD } }));
        expectData(await refresh(again.refreshToken));
      });

      it('a reuse event on one user never touches another user\'s session', async () => {
        const victim = await s.customer('Reuse Victim');
        const bystander = await s.customer('Reuse Bystander');
        expectData(await refresh(victim.refreshToken));
        expect((await refresh(victim.refreshToken)).status).toBe(401);
        expect(await world.redis.get(`refresh-jti:${bystander.id}`)).not.toBeNull();
        expectData(await refresh(bystander.refreshToken));
      });

      it('concurrent replays of one token: exactly one refresh succeeds, the rest are refused, and the session ends revoked', async () => {
        const customer = await s.customer();
        const results = await Promise.all(Array.from({ length: 8 }, () => refresh(customer.refreshToken)));
        expect(results.filter((r) => r.status === 200 || r.status === 201)).toHaveLength(1);
        expect(results.filter((r) => r.status === 401)).toHaveLength(7);
        // Whether the winner's token survives depends on interleaving, but a replay after the win must have revoked the session.
        expect(await world.redis.get(`refresh-jti:${customer.id}`)).toBeNull();
      });
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

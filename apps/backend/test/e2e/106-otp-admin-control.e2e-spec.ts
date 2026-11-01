/**
 * The temporary admin control for customer phone verification (`CUSTOMER_OTP_ENABLED`), over real HTTP: only an admin holding
 * MANAGE_BUSINESS_CONFIG (or a SUPER_ADMIN) can change it; only true/false is accepted and persisted; every change is audited by NAME;
 * OFF = the deliberate password-only registration (phone UNVERIFIED, never trusted from a client); ON again = codes required again.
 * Sign-in never depends on it (password only). The registration flows themselves are covered in depth by 10-authentication.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, expectData, nextPhone } from './support/actors';
import { boundary } from './support/external-boundary';
import { Permission } from '../../src/modules/permissions/permission.enum';
import { User } from '../../src/modules/users/entities/user.entity';

describe('E2E — admin OTP control (CUSTOMER_OTP_ENABLED)', () => {
  let world: World;
  let s: Scenario;
  let superAdmin: Actor;
  let configAdmin: Actor;
  let otherAdmin: Actor;
  const KEY = '/admin/business-config/CUSTOMER_OTP_ENABLED';
  const put = (a: Actor, value: unknown) => world.api('put', KEY, { token: a.accessToken, body: { value } });
  const read = async () => expectData<any>(await world.api('get', KEY, { token: superAdmin.accessToken })).value;
  const register = (phone: string) =>
    world.api('post', '/auth/customer/password/register', { body: { phone, fullName: 'OTP Control', password: 'Otp-Control-Pw-1' } });
  const login = (phone: string) => world.api('post', '/auth/customer/password/login', { body: { phone, password: 'Otp-Control-Pw-1' } });

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    superAdmin = await s.superAdmin();
    configAdmin = await s.admin([Permission.MANAGE_BUSINESS_CONFIG], 'Config Admin');
    otherAdmin = await s.admin([Permission.MANAGE_DELIVERY_FEE_MULTIPLIER], 'Other Admin');
  });
  beforeEach(() => boundary.reset());
  afterAll(async () => {
    try {
      await s.setConfig('CUSTOMER_OTP_ENABLED', true); // leave the default for any later suite
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('is ON by default on a fresh database: registration without a code is refused', async () => {
    await world.ds.query(`DELETE FROM business_config WHERE key = 'CUSTOMER_OTP_ENABLED'`);
    const r = await register(nextPhone());
    expect(r.status).toBe(400);
    expect(r.body.error.details).toMatchObject({ code: 'PHONE_VERIFICATION_REQUIRED' });
  });

  it('authorization: customers, unauthenticated callers and admins WITHOUT MANAGE_BUSINESS_CONFIG cannot change or read it', async () => {
    const customer = await s.customer();
    expect((await put(otherAdmin, false)).status).toBe(403);
    expect((await put(customer, false)).status).toBe(403);
    expect((await world.api('put', KEY, { body: { value: false } })).status).toBe(401);
    expect((await world.api('get', KEY, { token: otherAdmin.accessToken })).status).toBe(403);
    expect(await read()).not.toBe(false);
  });

  it('only true/false is accepted — 0, "", "false" (400 INVALID_BUSINESS_CONFIG_VALUE) and null (400, request validation) are refused and nothing changes', async () => {
    for (const value of [0, '', 'false']) {
      const r = await put(configAdmin, value);
      expect(r.status).toBe(400);
      expect(r.body.error.details).toMatchObject({ code: 'INVALID_BUSINESS_CONFIG_VALUE', key: 'CUSTOMER_OTP_ENABLED' });
    }
    expect((await put(configAdmin, null)).status).toBe(400); // refused even earlier, by the request DTO (@IsDefined)
    expect(await read()).not.toBe(false);
  });

  it('OFF by an authorized admin: persisted, audited by name only, password-only registration with an UNVERIFIED phone, no SMS', async () => {
    expectData(await put(configAdmin, false));
    expect(await read()).toBe(false);
    const [audit] = await world.ds.query(
      `SELECT action, target_type, target_id, actor_user_id, metadata FROM admin_audit_logs WHERE target_id = 'CUSTOMER_OTP_ENABLED' AND actor_user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [configAdmin.id],
    );
    expect(audit).toMatchObject({ action: 'business_config.changed', target_type: 'business_config', target_id: 'CUSTOMER_OTP_ENABLED' });
    expect(JSON.stringify(audit.metadata ?? null)).not.toMatch(/"value"/); // the value is never recorded

    const phone = nextPhone();
    expect((await register(phone)).status).toBe(200);
    expect((await world.ds.getRepository(User).findOneByOrFail({ phone })).isPhoneVerified).toBe(false);
    expect(boundary.sms).toHaveLength(0);
    expect((await login(phone)).status).toBe(200); // sign-in is password-only in both modes
    // a client-supplied code is ignored while OTP is off: the server alone decides, and the phone stays unverified
    const other = nextPhone();
    const forged = await world.api('post', '/auth/customer/password/register', { body: { phone: other, fullName: 'Forged Code', password: 'Otp-Control-Pw-1', code: '123456' } });
    expect(forged.status).toBe(200);
    expect((await world.ds.getRepository(User).findOneByOrFail({ phone: other })).isPhoneVerified).toBe(false);
  });

  it('ON again (SMS provider configured): codes are required again; existing unverified accounts keep signing in', async () => {
    const earlier = nextPhone();
    expectData(await put(configAdmin, false));
    expect((await register(earlier)).status).toBe(200);
    expectData(await put(superAdmin, true));
    expect(await read()).toBe(true);
    const r = await register(nextPhone());
    expect(r.status).toBe(400);
    expect(r.body.error.details).toMatchObject({ code: 'PHONE_VERIFICATION_REQUIRED' });
    expect((await login(earlier)).status).toBe(200);
  });
});

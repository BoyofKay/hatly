/**
 * Google Play "App access": the reviewer account is an ORDINARY customer account created through the product's own public registration
 * (docs/launch/PLAY_REVIEWER_ACCESS.md) — no reviewer code path, no backdoor, no OTP bypass. This suite executes that documented procedure
 * against the real application and proves what the Console instructions rely on:
 *  - provisioning works with OTP OFF (Staging today: phone + password only) and with OTP ON (Production intent: the code texted to the
 *    Hatly-controlled SIM is required ONCE, at registration);
 *  - afterwards signing in needs ONLY phone + password — also while OTP is ON — so the reviewer never needs a code;
 *  - the account can browse, fill a cart, get a quote and place a cash-on-delivery order in a delivery zone;
 *  - it is least-privilege: no wallet balance, no admin / vendor / driver / dashboard access.
 */
import { bootWorld, World } from './support/world';
import { Scenario, nextPhone, expectData, decodeJwt } from './support/actors';
import { boundary } from './support/external-boundary';

describe('E2E — Google Play reviewer access (documented provisioning procedure)', () => {
  let world: World;
  let s: Scenario;
  let product: { id: string };
  let sectorId: string;
  const home = { lat: 30.425, lng: 31.565 };
  const PASSWORD = `Rv-${Math.random().toString(36).slice(2)}-Aa1!`; // generated per run, never a fixed credential

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    const area = await s.serviceArea({ radiusMeters: 50000 });
    const vendor = await s.vendor({ name: 'Reviewer Demo Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    product = await s.product(vendor, { name: 'Reviewer Demo Meal', priceMinor: 9000, inventoryMode: 'OPEN' });
    const sector = await s.sector('Restaurants');
    await s.assignSector(vendor, sector.id);
    sectorId = sector.id;
  });
  afterAll(async () => {
    try {
      await s.setConfig('CUSTOMER_OTP_ENABLED', true);
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  const register = (phone: string, code?: string) =>
    world.api('post', '/auth/customer/password/register', { body: { phone, fullName: 'Google Play Reviewer', password: PASSWORD, ...(code ? { code } : {}) } });
  const signIn = (phone: string) => world.api('post', '/auth/customer/password/login', { body: { phone, password: PASSWORD } });

  it('Staging-style provisioning (OTP OFF): register with phone + password, then a saved address in a delivery zone', async () => {
    await s.setConfig('CUSTOMER_OTP_ENABLED', false);
    const phone = nextPhone();
    const tokens = expectData<{ accessToken: string }>(await register(phone));
    const address = await world.api('post', '/addresses', {
      token: tokens.accessToken,
      body: { label: 'Review address', line1: '1 Review Street', deliveryZoneId: await s.defaultDeliveryZoneId(), latitude: home.lat, longitude: home.lng },
    });
    expect(address.status).toBe(201);
    await s.setConfig('CUSTOMER_OTP_ENABLED', true);
    // the reviewer later signs in with phone + password only — even now that OTP is ON
    const later = expectData<{ accessToken: string }>(await signIn(phone));
    expect(decodeJwt(later.accessToken).role).toBe('CUSTOMER');
  });

  it('Production-style provisioning (OTP ON): registration needs the texted code ONCE; sign-in afterwards never does', async () => {
    await s.setConfig('CUSTOMER_OTP_ENABLED', true);
    const phone = nextPhone();
    const withoutCode = await register(phone);
    expect(withoutCode.status).toBe(400); // PHONE_VERIFICATION_REQUIRED — no way around the code
    expect((await world.api('post', '/auth/customer/register/request-code', { body: { phone } })).status).toBe(200);
    const code = boundary.lastOtpFor(phone);
    expect(code).toBeTruthy();
    expect((await register(phone, code!)).status).toBe(200);
    expect((await signIn(phone)).status).toBe(200);
    expect((await signIn(phone)).status).toBe(200); // repeatable, no code
  });

  it('the reviewer can use the real app flows: browse, cart, quote and a cash-on-delivery order', async () => {
    await s.setConfig('CUSTOMER_OTP_ENABLED', false);
    const phone = nextPhone();
    const { accessToken: token } = expectData<{ accessToken: string }>(await register(phone));
    await s.setConfig('CUSTOMER_OTP_ENABLED', true);
    const t = { token };
    expect((await world.api('get', '/sectors', t)).status).toBe(200);
    const vendors = expectData<any[]>(await world.api('get', '/vendors', { ...t, query: { sectorId } }));
    expect(vendors.length).toBeGreaterThan(0);
    const order = await (async () => {
      const reviewer = { id: decodeJwt(token).sub, phone, fullName: 'Google Play Reviewer', role: 'CUSTOMER', password: PASSWORD, accessToken: token, refreshToken: '' } as any;
      await s.address(reviewer, home);
      await s.addToCart(reviewer, product.id, 1);
      return s.checkout(reviewer, home, 'COD');
    })();
    expect(order.id).toBeDefined();
    expect(expectData<any[]>(await world.api('get', '/orders', t)).map((o) => o.id)).toContain(order.id);
  });

  it('least privilege: no wallet balance, and no admin, vendor, driver or dashboard access', async () => {
    await s.setConfig('CUSTOMER_OTP_ENABLED', false);
    const phone = nextPhone();
    const { accessToken: token } = expectData<{ accessToken: string }>(await register(phone));
    await s.setConfig('CUSTOMER_OTP_ENABLED', true);
    expect(expectData<any>(await world.api('get', '/customer/wallet', { token })).balanceMinor ?? 0).toBe(0);
    for (const path of ['/admin/orders', '/admin/customers', '/vendor/orders', '/driver/deliveries']) {
      expect([path, (await world.api('get', path, { token })).status]).toEqual([path, 403]);
    }
    const dashboard = await world.api('post', '/auth/dashboard/login', { body: { phone, password: PASSWORD } });
    expect([401, 403]).toContain(dashboard.status);
  });
});

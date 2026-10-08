/**
 * M3c (Launch-Readiness Gap Audit, G-10) — Admin Customer Management, over real HTTP. The search/
 * detail SERVICE's own business logic already has thorough real-PostgreSQL coverage in
 * `test/integration/admin-customer-search.int-spec.ts`; this file proves the real HTTP path through
 * the controller + DTO ValidationPipe + PermissionsGuard — the authorization matrix itself
 * (VIEW_CUSTOMERS required, every other permission refused) is covered by the shared PROBES table
 * in `20-authorization.e2e-spec.ts`, extended for these endpoints rather than duplicated here.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, expectData } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — Admin Customer Management', () => {
  let world: World;
  let s: Scenario;
  let viewer: Actor;

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    viewer = await s.admin([Permission.VIEW_CUSTOMERS], 'Customer Viewer');
  });
  afterAll(async () => {
    await world.close();
  });

  it('an authorized admin can search for a real customer by phone, with the real {data, meta} envelope, and never sees a password hash', async () => {
    const customer = await s.customer('Customer Search E2E Customer');

    const res = await world.api('get', `/admin/customers?search=${encodeURIComponent(customer.phone)}`, { token: viewer.accessToken });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([expect.objectContaining({ id: customer.id, phone: customer.phone })]);
    expect(res.body.data[0].passwordHash).toBeUndefined();
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 1 });
  });

  it('opening a found customer returns the detail view with a real wallet balance / order count, never sensitive fields', async () => {
    const customer = await s.customer('Customer Detail E2E Customer');

    const detail = expectData(await world.api('get', `/admin/customers/${customer.id}`, { token: viewer.accessToken }));

    expect((detail as any).id).toBe(customer.id);
    expect((detail as any).walletBalanceMinor).toBe(0);
    expect((detail as any).orderCount).toBe(0);
    expect((detail as any).passwordHash).toBeUndefined();
  });

  it('an invalid query parameter is rejected with a 400, never a 500', async () => {
    const res = await world.api('get', '/admin/customers?isActive=not-a-boolean', { token: viewer.accessToken });
    expect(res.status).toBe(400);
  });

  it('a non-customer id (e.g. an admin) is refused as a customer lookup (404) — this endpoint is customer management only', async () => {
    const res = await world.api('get', `/admin/customers/${viewer.id}`, { token: viewer.accessToken });
    expect(res.status).toBe(404);
  });
});

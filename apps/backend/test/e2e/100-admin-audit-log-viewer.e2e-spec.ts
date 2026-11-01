/**
 * Launch-readiness G-11 — the read side of the append-only admin audit trail, over real HTTP and a real database:
 * `GET /admin/audit-logs` is gated by VIEW_AUDIT_LOG (SUPER_ADMIN bypasses), paginated with a silently clamped limit, filterable by exact
 * match only, never returns a phone number, hash or secret, and there is no route that can write to it.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, expectData } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — admin audit log viewer', () => {
  let world: World;
  let s: Scenario;
  let viewer: Actor;
  const list = (token: string, query = '') => world.api('get', `/admin/audit-logs${query}`, { token });

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    // The extra permissions let the viewer produce audit rows of its own, including one FAILURE: a request that passes the permission guard,
    // reaches its handler and is refused there (404 for an unknown driver). A request refused by the permission guard itself never reaches
    // the interceptor and is logged as `security.access_denied` instead — by design (see security-milestone §8).
    viewer = await s.admin([Permission.VIEW_AUDIT_LOG, Permission.MANAGE_SERVICE_AREAS, Permission.MANAGE_DELIVERY_FEE_MULTIPLIER, Permission.MANAGE_DRIVERS], 'Audit Viewer Ops');
    const zone = await s.deliveryZone({ feeMinor: 1500 });
    for (const fee of [2100, 2200, 2300]) {
      expectData(await world.api('patch', `/admin/delivery-zones/${zone.id}/delivery-fee`, { token: viewer.accessToken, body: { deliveryFeeMinor: fee } }));
    }
    // a refused attempt that reaches its handler (unknown driver)
    const refused = await world.api('patch', '/admin/drivers/00000000-0000-4000-8000-000000000000/verification', { token: viewer.accessToken, body: { status: 'REJECTED' } });
    expect(refused.status).toBe(404);
    // a failed dashboard sign-in for a phone that has no account → a row whose actor is unknown
    const login = await world.api('post', '/auth/dashboard/login', { body: { phone: '+201000000321', password: 'Wrong-Password-1!' } });
    expect([400, 401]).toContain(login.status);
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('lists the viewer’s own recorded actions newest-first with the {data, meta} envelope, the actor’s display name and role — and no phone, hash or secret', async () => {
    const res = await list(viewer.accessToken, `?actorUserId=${viewer.id}&action=admin.mutation`);
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, limit: 25, total: expect.any(Number) });
    expect(res.body.meta.total).toBeGreaterThanOrEqual(3);
    const rows = res.body.data as any[];
    expect(rows[0]).toEqual(expect.objectContaining({ actorUserId: viewer.id, actorName: 'Audit Viewer Ops', actorRole: 'ADMIN', action: 'admin.mutation' }));
    expect(rows.filter((r) => r.outcome === 'SUCCESS').length).toBeGreaterThanOrEqual(3); // the three fee changes
    expect(rows[0].outcome).toBe('FAILURE'); // the most recent action was the handler-refused driver verification
    const times = rows.map((r) => Date.parse(r.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times); // newest first
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/password|hash|secret|token/i);
    expect(text).not.toContain(viewer.phone);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(['action', 'actorName', 'actorRole', 'actorUserId', 'createdAt', 'id', 'ipAddress', 'metadata', 'outcome', 'targetRef', 'targetType']);
  });

  it('paginates: the limit is clamped to 100 silently, and page 2 holds different rows from page 1', async () => {
    const clamped = await list(viewer.accessToken, '?limit=100000');
    expect(clamped.status).toBe(200);
    expect(clamped.body.meta.limit).toBe(100);
    const base = `?actorUserId=${viewer.id}&action=admin.mutation&limit=2`;
    const p1 = (await list(viewer.accessToken, `${base}&page=1`)).body;
    const p2 = (await list(viewer.accessToken, `${base}&page=2`)).body;
    expect(p1.data).toHaveLength(2);
    expect(p2.data.length).toBeGreaterThanOrEqual(1);
    const ids1 = new Set(p1.data.map((r: any) => r.id));
    for (const row of p2.data) expect(ids1.has(row.id)).toBe(false);
    expect(p1.meta.total).toBe(p2.meta.total);
  });

  it('filters by outcome: the handler-refused attempt is recorded as FAILURE and is found; successes are not mixed in', async () => {
    const res = await list(viewer.accessToken, `?actorUserId=${viewer.id}&outcome=FAILURE`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    for (const row of res.body.data) expect(row.outcome).toBe('FAILURE');
  });

  it('a row whose actor is unknown (failed sign-in for a phone without an account) is listed with actorName null', async () => {
    const res = await list(viewer.accessToken, '?action=auth.dashboard_login_failed&limit=100');
    expect(res.status).toBe(200);
    const unknownActor = (res.body.data as any[]).find((r) => r.actorUserId === null);
    expect(unknownActor).toBeDefined();
    expect(unknownActor.actorName).toBeNull();
    expect(unknownActor.outcome).toBe('FAILURE');
  });

  it('date filters work (a window in the future is empty) and malformed input is a 400, never a 500', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const empty = await list(viewer.accessToken, `?from=${encodeURIComponent(future)}`);
    expect(empty.status).toBe(200);
    expect(empty.body.meta.total).toBe(0);
    for (const bad of ['?from=yesterday', '?actorUserId=not-a-uuid', '?outcome=MAYBE', '?page=0', '?limit=abc', '?unknownFilter=1', `?action=${'x'.repeat(61)}`]) {
      const res = await list(viewer.accessToken, bad);
      expect([bad, res.status]).toEqual([bad, 400]);
    }
  });

  it('authorization: SUPER_ADMIN may read (bypass); an ADMIN without VIEW_AUDIT_LOG, a customer and an anonymous caller may not', async () => {
    const superAdmin = await s.superAdmin();
    expect((await list(superAdmin.accessToken)).status).toBe(200);
    const plainAdmin = await s.admin([Permission.VIEW_CUSTOMERS], 'No Audit Access');
    expect((await list(plainAdmin.accessToken)).status).toBe(403);
    const customer = await s.customer('Audit Customer');
    expect((await list(customer.accessToken)).status).toBe(403);
    expect((await world.api('get', '/admin/audit-logs')).status).toBe(401);
  });

  it('the trail is read-only over HTTP: there is no route that creates, changes or deletes an audit row', async () => {
    const superAdmin = await s.superAdmin();
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await world.api(method, '/admin/audit-logs', { token: superAdmin.accessToken, body: {} });
      expect([method, res.status]).toEqual([method, 404]);
    }
  });
});

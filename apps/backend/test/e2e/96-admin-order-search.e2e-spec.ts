/**
 * M3b (Launch-Readiness Gap Audit, G-04) — Admin Order Search, over real HTTP. The search
 * SERVICE's own business logic (filters, pagination, deterministic ordering, customer-scoping,
 * empty results) already has thorough real-PostgreSQL coverage in
 * `test/integration/admin-order-search.int-spec.ts`; this file proves the real HTTP path through
 * the controller + DTO ValidationPipe + PermissionsGuard specifically — the authorization matrix
 * itself (VIEW_ORDERS required, every other permission refused) is covered by the shared PROBES
 * table in `20-authorization.e2e-spec.ts`, extended for this endpoint rather than duplicated here.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, expectData } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — Admin Order Search', () => {
  let world: World;
  let s: Scenario;
  let viewer: Actor;
  let piiViewer: Actor;

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    viewer = await s.admin([Permission.VIEW_ORDERS], 'Order Search Viewer');
    piiViewer = await s.admin([Permission.VIEW_ORDERS, Permission.VIEW_CUSTOMER_PII], 'Order Search PII Viewer');
  });
  afterAll(async () => {
    await world.close();
  });

  /** A minimal, real `orders` row — the same direct-insert shortcut this suite's own migration integration test uses for a "legacy" order, since no full checkout flow is needed to exercise search itself. */
  async function insertOrder(customerId: string, overrides: { orderNumber: string; status?: string; totalMinor?: number }) {
    const [{ id }] = await world.ds.query(
      `INSERT INTO orders (customer_id, order_number, status, fulfillment_type, subtotal_minor, total_minor, payment_method, created_at, updated_at)
       VALUES ($1, $2, $3, 'DELIVERY', 5000, $4, 'COD', now(), now()) RETURNING id`,
      [customerId, overrides.orderNumber, overrides.status ?? 'DELIVERED', overrides.totalMinor ?? 5000],
    );
    return id as string;
  }

  it('an authorized admin can search by order number over real HTTP, with the real {data, meta} envelope', async () => {
    const customer = await s.customer('Order Search E2E Customer');
    const orderId = await insertOrder(customer.id, { orderNumber: 'HT-900001' });

    const res = await world.api('get', '/admin/orders?search=HT-900001', { token: piiViewer.accessToken });

    expect(res.status).toBe(200);
    const body = res.body;
    expect(body.data).toEqual([
      expect.objectContaining({ id: orderId, orderNumber: 'HT-900001', customer: expect.objectContaining({ phone: customer.phone }) }),
    ]);
    expect(body.meta).toEqual({ page: 1, limit: 20, total: 1 });

    // Without VIEW_CUSTOMER_PII the same search never returns the raw phone number or full name (masking by permission).
    const masked = await world.api('get', '/admin/orders?search=HT-900001', { token: viewer.accessToken });
    expect(masked.status).toBe(200);
    expect(masked.body.data[0].customer.phone).not.toBe(customer.phone);
    expect(masked.body.data[0].customer.phone).toContain('•');
  });

  it('an invalid query parameter is rejected with a 400, never a 500', async () => {
    const res = await world.api('get', '/admin/orders?status=NOT_A_REAL_STATUS', { token: viewer.accessToken });
    expect(res.status).toBe(400);
  });

  it('opening a found order reuses the EXISTING admin order detail endpoint — same id round-trips', async () => {
    const customer = await s.customer('Order Search Detail E2E Customer');
    const orderId = await insertOrder(customer.id, { orderNumber: 'HT-900002' });

    const searchRes = await world.api('get', '/admin/orders?search=HT-900002', { token: viewer.accessToken });
    const found = searchRes.body.data[0];

    const detail = expectData(await world.api('get', `/admin/orders/${found.id}`, { token: viewer.accessToken }));
    expect((detail as any).id).toBe(orderId);
    expect((detail as any).orderNumber).toBe('HT-900002');
  });
});

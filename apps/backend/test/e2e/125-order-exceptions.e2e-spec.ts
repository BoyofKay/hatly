/**
 * PD-016 — a product turns out to be unavailable after the order was placed, over real HTTP against real PostgreSQL:
 *  vendor (or Operations for the vendor) marks items → customer is told → the customer continues without them OR asks to cancel the order →
 *  no answer is never consent → Operations records the decision and executes only that.
 * There is NO substitution. Money follows the existing rules (PD-002…PD-004, C4); cases they do not resolve are isolated, not guessed.
 *
 * Delivery pricing: 10 EGP / 100 m, 15 EGP minimum, 5 EGP (500 minor) per additional vendor.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';
import { boundary } from './support/external-boundary';
import { Permission } from '../../src/modules/permissions/permission.enum';

const HOUR = 3600_000;
const window = () => ({ startAt: new Date(Date.now() - HOUR).toISOString(), endAt: new Date(Date.now() + 24 * HOUR).toISOString() });

describe('E2E — unavailable products after ordering (PD-016)', () => {
  let world: World;
  let s: Scenario;
  let area: { id: string };
  let superAdmin: Actor;
  let ops: Actor; // may record "continue without", never cancel
  let supervisor: Actor; // may also execute a cancellation
  let viewer: Actor;
  let reviewer: Actor;
  let v1: VendorFixture;
  let v2: VendorFixture;
  let pA: { id: string }; // v1, 100.00
  let pB: { id: string }; // v1, 50.00, TRACKED stock
  let pC: { id: string }; // v2, 30.00
  let pW: { id: string }; // v1, weighed 200.00 / kg
  const home = { lat: 30.425, lng: 31.565 };
  const num = (v: unknown) => Number(v);
  let seed = 0;

  const orderRow = async (id: string) => (await world.ds.query('SELECT * FROM orders WHERE id = $1', [id]))[0];
  const exRow = async (id: string) => (await world.ds.query('SELECT * FROM order_exceptions WHERE id = $1', [id]))[0];
  const segmentOf = async (orderId: string, v: VendorFixture): Promise<string> =>
    (await world.ds.query('SELECT id FROM order_vendor_segments WHERE order_id = $1 AND vendor_branch_id = $2', [orderId, v.branchId]))[0].id;
  const itemIdOf = async (orderId: string, productId: string): Promise<string> =>
    (await world.ds.query('SELECT i.id FROM order_items i JOIN order_vendor_segments g ON g.id = i.order_vendor_segment_id WHERE g.order_id = $1 AND i.product_id = $2', [orderId, productId]))[0].id;
  const credit = (c: Actor, amountMinor: number) =>
    world.ds.query("INSERT INTO wallet_transactions (customer_id, amount_delta_minor, type, idempotency_key, reason) VALUES ($1, $2, 'ADMIN_CREDIT', $3, 'e2e seed')", [c.id, amountMinor, `pd16-seed-${c.id}-${seed++}`]);
  const refunds = (c: Actor) => world.ds.query("SELECT amount_delta_minor FROM wallet_transactions WHERE customer_id = $1 AND type = 'ORDER_REFUND' ORDER BY created_at", [c.id]);
  const consistent = (row: any) => expect(num(row.total_minor)).toBe(num(row.subtotal_minor) + num(row.delivery_fee_minor) - num(row.discount_minor));

  const mark = (v: VendorFixture, segmentId: string, itemIds: string[], note?: string) =>
    world.api('post', `/vendor/orders/segments/${segmentId}/unavailable-items`, { token: v.manager.accessToken, body: { itemIds, note } });
  const markAsOps = (a: Actor, segmentId: string, itemIds: string[]) =>
    world.api('post', `/admin/orders/segments/${segmentId}/unavailable-items`, { token: a.accessToken, body: { itemIds } });
  const respond = (c: Actor, orderId: string, exceptionId: string, decision: string) =>
    world.api('post', `/orders/${orderId}/item-unavailability/${exceptionId}/respond`, { token: c.accessToken, body: { decision } });
  const decide = (a: Actor, exceptionId: string, body: Record<string, unknown>) => world.api('post', `/admin/order-exceptions/${exceptionId}/record-decision`, { token: a.accessToken, body });
  const customerDetails = async (c: Actor, id: string) => expectData<any>(await world.api('get', `/orders/${id}`, { token: c.accessToken }));

  /** One COD/WALLET order: `lines` = [product, quantity][] from the fixtures. */
  const place = async (lines: Array<[{ id: string }, number, Record<string, unknown>?]>, paymentMethod = 'COD', walletCredit = 0) => {
    const c = await s.customer();
    if (walletCredit) await credit(c, walletCredit);
    for (const [p, q, extra] of lines) await s.addToCart(c, p.id, q, extra ?? {});
    const order = await s.checkout(c, home, paymentMethod);
    return { c, order };
  };

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    area = await s.serviceArea({ radiusMeters: 50000 });
    superAdmin = await s.superAdmin();
    ops = await s.admin([Permission.VIEW_ORDERS, Permission.MANAGE_ORDER_FULFILMENT], 'PD16 Ops');
    supervisor = await s.admin([Permission.VIEW_ORDERS, Permission.MANAGE_ORDER_FULFILMENT, Permission.MANAGE_ORDER_ISSUES], 'PD16 Supervisor');
    viewer = await s.admin([Permission.VIEW_ORDERS], 'PD16 Viewer');
    reviewer = await s.admin([Permission.VERIFY_MANUAL_PAYMENTS], 'PD16 Reviewer');
    v1 = await s.vendor({ name: 'PD16 One', serviceAreaId: area.id, lat: 30.421, lng: 31.561, commissionBasisPoints: 1000 });
    v2 = await s.vendor({ name: 'PD16 Two', serviceAreaId: area.id, lat: 30.431, lng: 31.571, commissionBasisPoints: 1000 });
    pA = await s.product(v1, { priceMinor: 10000, inventoryMode: 'OPEN' });
    pB = await s.product(v1, { priceMinor: 5000, inventoryMode: 'TRACKED', quantity: 100 });
    pC = await s.product(v2, { priceMinor: 3000, inventoryMode: 'OPEN' });
    pW = await s.product(v1, { priceMinor: 20000, pricingUnit: 'WEIGHT', inventoryMode: 'OPEN' });
    await s.setConfig('MANUAL_TRANSFER_DESTINATION', { label: 'Hatly', phoneOrAccountNumber: '01000000000' });
    await s.setConfig('CUSTOMER_SERVICE_WHATSAPP_NUMBER', '+201000000000');
  });
  beforeEach(() => boundary.reset());
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('marking items unavailable', () => {
    it('the vendor marks items of its own part: a case opens, the customer is notified once, nothing about money or stock changes', async () => {
      const { c, order } = await place([[pA, 2], [pB, 1]]);
      const before = await orderRow(order.id);
      const seg = await segmentOf(order.id, v1);
      const itemB = await itemIdOf(order.id, pB.id);
      const stockBefore = (await world.ds.query('SELECT quantity, is_available FROM products WHERE id = $1', [pB.id]))[0];

      const res = await mark(v1, seg, [itemB], 'Sold out in the shop');
      const ex = expectData<any>(res, 201);
      expect(ex).toMatchObject({ type: 'ITEM_UNAVAILABLE', status: 'AWAITING_CUSTOMER', orderId: order.id, customerDecision: null });
      expect(ex.items).toHaveLength(1);
      expect(ex.items[0]).toMatchObject({ orderItemId: itemB, quantity: 1, amountMinor: 5000 });

      const after = await orderRow(order.id);
      expect(num(after.total_minor)).toBe(num(before.total_minor)); // nothing moves until the customer answers
      expect((await world.ds.query('SELECT quantity, is_available FROM products WHERE id = $1', [pB.id]))[0]).toEqual(stockBefore); // global catalogue untouched
      expect((await world.ds.query("SELECT 1 FROM customer_notifications WHERE order_id = $1 AND type = 'ORDER_ITEM_UNAVAILABLE'", [order.id])).length).toBe(1);

      // The customer sees the open question (and only the question).
      const current = expectData<any>(await world.api('get', `/orders/${order.id}/item-unavailability`, { token: c.accessToken }));
      expect(current).toMatchObject({ id: ex.id, status: 'AWAITING_CUSTOMER' });
      expect(current.events).toBeUndefined();
      // A second marking joins the SAME case (one open case per order).
      const itemA = await itemIdOf(order.id, pA.id);
      const again = expectData<any>(await mark(v1, seg, [itemA]), 201);
      expect(again.id).toBe(ex.id);
      expect(again.items).toHaveLength(2);
      expect((await world.ds.query("SELECT count(*)::int AS n FROM order_exceptions WHERE order_id = $1", [order.id]))[0].n).toBe(1);
      // Audit rows exist for the vendor's actions.
      expect((await world.ds.query("SELECT count(*)::int AS n FROM admin_audit_logs WHERE action = 'order_exception.items_marked_unavailable' AND target_id = $1", [order.id]))[0].n).toBeGreaterThanOrEqual(2);
    });

    it('authorization: another vendor, another customer, a viewer, and a customer on the vendor route are all refused', async () => {
      const { c, order } = await place([[pA, 1], [pC, 1]]); // two vendors
      const seg1 = await segmentOf(order.id, v1);
      const seg2 = await segmentOf(order.id, v2);
      const itemA = await itemIdOf(order.id, pA.id);
      const itemC = await itemIdOf(order.id, pC.id);

      expect((await mark(v2, seg1, [itemA])).status).toBe(404); // v2 cannot touch v1's part — same answer as a part that does not exist
      expect((await mark(v1, seg2, [itemC])).status).toBe(404);
      expect((await mark(v1, seg1, [itemC])).status).toBe(400); // an item of another part is not an item of this one
      expect((await markAsOps(viewer, seg1, [itemA])).status).toBe(403);
      expect((await world.api('post', `/vendor/orders/segments/${seg1}/unavailable-items`, { token: c.accessToken, body: { itemIds: [itemA] } })).status).toBe(403);
      expect((await mark(v1, seg1, [])).status).toBe(400);

      const ex = expectData<any>(await mark(v1, seg1, [itemA]), 201);
      const stranger = await s.customer('PD16 Stranger');
      expect((await respond(stranger, order.id, ex.id, 'CONTINUE_WITHOUT')).status).toBe(404);
      expect((await world.api('get', `/orders/${order.id}/item-unavailability`, { token: stranger.accessToken })).status).toBe(404);
      expect((await respond(c, order.id, ex.id, 'REPLACE_IT')).status).toBe(400); // there is no substitution, only two answers
      expect((await decide(viewer, ex.id, { decision: 'CONTINUE_WITHOUT', channel: 'PHONE', note: 'called the customer' })).status).toBe(403);
      expect((await world.api('get', '/admin/order-exceptions', { token: c.accessToken })).status).toBe(403);
    });

    it('Operations can mark items on behalf of the vendor, and a cancelled part or a picked-up order is no longer editable', async () => {
      const { order } = await place([[pA, 1], [pC, 1]]);
      const seg1 = await segmentOf(order.id, v1);
      const itemA = await itemIdOf(order.id, pA.id);
      const ex = expectData<any>(await markAsOps(ops, seg1, [itemA]), 201);
      expect(ex.status).toBe('AWAITING_CUSTOMER');
      expect(ex.events.find((e: any) => e.action === 'ITEMS_MARKED_UNAVAILABLE').metadata.onBehalfOfVendor).toBe(true);

      const { order: other } = await place([[pA, 1], [pC, 1]]);
      const segOther = await segmentOf(other.id, v1);
      expectData(await world.api('patch', `/vendor/orders/segments/${segOther}/status`, { token: v1.manager.accessToken, body: { status: 'CANCELLED', reason: 'cannot prepare' } }));
      expect((await mark(v1, segOther, [await itemIdOf(other.id, pA.id)])).status).toBe(409);
    });
  });

  describe('the customer continues without the items', () => {
    it('COD: the item amount leaves the segment and the order exactly once; the delivery fee stays; the item moves to removedItems; stock is not given back', async () => {
      const { c, order } = await place([[pA, 2], [pB, 1]]);
      const before = await orderRow(order.id);
      const seg = await segmentOf(order.id, v1);
      const itemB = await itemIdOf(order.id, pB.id);
      const stockAfterOrder = num((await world.ds.query('SELECT quantity FROM products WHERE id = $1', [pB.id]))[0].quantity);
      const ex = expectData<any>(await mark(v1, seg, [itemB]), 201);

      const r = expectData<any>(await respond(c, order.id, ex.id, 'CONTINUE_WITHOUT'), 201);
      expect(r).toMatchObject({ executed: true, isolated: null });
      expect(r.exception).toMatchObject({ status: 'RESOLVED', resolution: 'CONTINUED_WITHOUT_ITEMS', customerDecision: 'CONTINUE_WITHOUT', decisionChannel: 'APP' });

      const after = await orderRow(order.id);
      expect(num(after.subtotal_minor)).toBe(num(before.subtotal_minor) - 5000);
      expect(num(after.total_minor)).toBe(num(before.total_minor) - 5000);
      expect(num(after.amount_due_minor)).toBe(num(after.total_minor)); // COD: the driver collects the smaller amount
      expect(num(after.delivery_fee_minor)).toBe(num(before.delivery_fee_minor)); // PD-003
      consistent(after);
      expect(after.status).toBe(before.status); // the state machine is not touched
      expect(num((await world.ds.query('SELECT subtotal_minor FROM order_vendor_segments WHERE id = $1', [seg]))[0].subtotal_minor)).toBe(20000);
      const item = (await world.ds.query('SELECT removed_at, removed_amount_minor, removal_exception_id FROM order_items WHERE id = $1', [itemB]))[0];
      expect(item.removed_at).not.toBeNull();
      expect(num(item.removed_amount_minor)).toBe(5000);
      expect(item.removal_exception_id).toBe(ex.id);
      expect(num((await world.ds.query('SELECT quantity FROM products WHERE id = $1', [pB.id]))[0].quantity)).toBe(stockAfterOrder); // not restored, not changed

      // What every reader shows: removed items are NOT in `items` (older apps never see them) but ARE in `removedItems`.
      const seen = await customerDetails(c, order.id);
      expect(seen.segments[0].items.map((i: any) => i.productId)).toEqual([pA.id]);
      expect(seen.segments[0].removedItems).toHaveLength(1);
      expect(seen.segments[0].removedItems[0]).toMatchObject({ productNameSnapshot: expect.any(String), removedAmountMinor: 5000 });
      const vendorSeen = expectData<any>(await world.api('get', `/vendor/orders/${order.id}`, { token: v1.manager.accessToken }));
      expect(vendorSeen.segments[0].items).toHaveLength(1);
      expect(vendorSeen.segments[0].removedItems).toHaveLength(1);
      const adminSeen = expectData<any>(await world.api('get', `/admin/orders/${order.id}`, { token: ops.accessToken }));
      expect(adminSeen.segments[0].items).toHaveLength(1);
      expect(adminSeen.segments[0].removedItems[0]).toMatchObject({ removedAmountMinor: 5000, exceptionId: ex.id });
      // The merged admin timeline carries the case.
      const timeline = expectData<any[]>(await world.api('get', `/admin/orders/${order.id}/timeline`, { token: ops.accessToken }));
      expect(timeline.filter((t) => t.kind === 'EXCEPTION').map((t) => t.title)).toEqual(expect.arrayContaining(['ITEMS_MARKED_UNAVAILABLE', 'CUSTOMER_DECISION_RECORDED', 'ITEMS_REMOVED_ORDER_CONTINUES']));

      // Repeating the same answer changes nothing; a different one is refused.
      expect((await respond(c, order.id, ex.id, 'CONTINUE_WITHOUT')).status).toBe(201);
      expect((await respond(c, order.id, ex.id, 'CANCEL_ORDER')).status).toBe(409);
      expect(num((await orderRow(order.id)).total_minor)).toBe(num(after.total_minor));
    });

    it('Wallet: the wallet gets back exactly what is no longer owed, once — a repeated or racing answer cannot credit twice', async () => {
      const { c, order } = await place([[pA, 2], [pB, 1]], 'WALLET', 100000);
      const before = await orderRow(order.id);
      expect(num(before.wallet_amount_minor)).toBe(num(before.total_minor));
      const seg = await segmentOf(order.id, v1);
      const ex = expectData<any>(await mark(v1, seg, [await itemIdOf(order.id, pB.id)]), 201);

      // The customer's answer and an Operations execution of the same answer race.
      const [a, b] = await Promise.all([
        respond(c, order.id, ex.id, 'CONTINUE_WITHOUT'),
        decide(ops, ex.id, { decision: 'CONTINUE_WITHOUT', channel: 'PHONE', note: 'customer confirmed on the phone' }),
      ]);
      expect([a.status, b.status].every((x) => x < 500)).toBe(true);
      expect((await refunds(c)).map((r: any) => num(r.amount_delta_minor))).toEqual([5000]); // exactly one credit, of exactly the removed amount
      const after = await orderRow(order.id);
      expect(num(after.total_minor)).toBe(num(before.total_minor) - 5000);
      expect(num(after.amount_due_minor)).toBe(0);
      expect((await world.ds.query('SELECT count(*)::int AS n FROM order_items WHERE removed_at IS NOT NULL AND removal_exception_id = $1', [ex.id]))[0].n).toBe(1);
      expect((await exRow(ex.id)).status).toBe('RESOLVED');
      // And once more, sequentially: nothing more is credited.
      await respond(c, order.id, ex.id, 'CONTINUE_WITHOUT');
      expect((await refunds(c)).length).toBe(1);
    });

    it('Manual Transfer: an APPROVED transfer gets exactly one refund obligation for the removed amount (never shown as sent), and a second removal on the same part is isolated for review', async () => {
      const c = await s.customer();
      await s.addToCart(c, pA.id, 2);
      await s.addToCart(c, pB.id, 1);
      const pB2 = await s.product(v1, { priceMinor: 2000, inventoryMode: 'OPEN' });
      await s.addToCart(c, pB2.id, 1);
      const order = await s.checkout(c, home, 'MANUAL_TRANSFER');
      const payment = (await world.ds.query('SELECT * FROM payments WHERE order_id = $1', [order.id]))[0];
      await world.api('post', `/payments/manual-transfer/orders/${order.id}/claim`, { token: c.accessToken, body: {} });
      expectData(await world.api('post', `/admin/manual-transfer-payments/${payment.id}/approve`, { token: reviewer.accessToken }), 201);
      const before = await orderRow(order.id);
      const seg = await segmentOf(order.id, v1);
      const events = () => world.ds.query("SELECT amount_minor FROM financial_events WHERE order_id = $1 AND type = 'MANUAL_TRANSFER_REFUND_RECORDED' ORDER BY created_at", [order.id]);

      const ex = expectData<any>(await mark(v1, seg, [await itemIdOf(order.id, pB.id)]), 201);
      expect(expectData<any>(await respond(c, order.id, ex.id, 'CONTINUE_WITHOUT'), 201).executed).toBe(true);
      expect((await events()).map((e: any) => num(e.amount_minor))).toEqual([5000]);
      expect(num((await orderRow(order.id)).total_minor)).toBe(num(before.total_minor) - 5000);
      expect(num((await world.ds.query('SELECT pending_refund_minor FROM payments WHERE id = $1', [payment.id]))[0].pending_refund_minor ?? 0)).toBe(0);
      expect((await world.ds.query('SELECT count(*)::int AS n FROM refund_payouts rp JOIN financial_events fe ON fe.id = rp.financial_event_id WHERE fe.order_id = $1', [order.id]))[0].n).toBe(0); // an obligation, not a payout

      // The existing refund mechanism keys one event per (payment, vendor part): a second reduction on this part would be silently skipped,
      // so it is isolated for a person instead of under-refunding.
      const ex2 = expectData<any>(await mark(v1, seg, [await itemIdOf(order.id, pB2.id)]), 201);
      const r2 = expectData<any>(await respond(c, order.id, ex2.id, 'CONTINUE_WITHOUT'), 201);
      expect(r2).toMatchObject({ executed: false, isolated: 'SECOND_REFUND_ON_SEGMENT_REQUIRES_REVIEW' });
      expect((await events()).length).toBe(1);
      expect((await world.ds.query('SELECT count(*)::int AS n FROM order_items WHERE removed_at IS NOT NULL AND removal_exception_id = $1', [ex2.id]))[0].n).toBe(0);
    });

    it('multi-vendor: only the affected vendor part changes; the other part, the delivery fee and the additional-vendor charge stay', async () => {
      const { c, order } = await place([[pA, 1], [pB, 1], [pC, 2]]);
      const before = await orderRow(order.id);
      const seg1 = await segmentOf(order.id, v1);
      const seg2 = await segmentOf(order.id, v2);
      const seg2Before = (await world.ds.query('SELECT subtotal_minor FROM order_vendor_segments WHERE id = $1', [seg2]))[0];
      const ex = expectData<any>(await mark(v1, seg1, [await itemIdOf(order.id, pB.id)]), 201);
      expect(expectData<any>(await respond(c, order.id, ex.id, 'CONTINUE_WITHOUT'), 201).executed).toBe(true);
      const after = await orderRow(order.id);
      expect(num(after.total_minor)).toBe(num(before.total_minor) - 5000);
      expect(num(after.delivery_fee_minor)).toBe(num(before.delivery_fee_minor));
      expect((await world.ds.query('SELECT subtotal_minor FROM order_vendor_segments WHERE id = $1', [seg2]))[0]).toEqual(seg2Before);
      consistent(after);
    });

    it('a weighed item leaves with its estimated amount (C4 is untouched: no approval step exists), and the pickup weight gate no longer waits for it', async () => {
      await s.driver({ lat: 30.4215, lng: 31.5615 });
      const { c, order } = await place([[pA, 1], [pW, 1, { requestedWeightGrams: 500 }]]);
      const before = await orderRow(order.id);
      const seg = await segmentOf(order.id, v1);
      const itemW = await itemIdOf(order.id, pW.id);
      const ex = expectData<any>(await mark(v1, seg, [itemW]), 201);
      expect(ex.items[0].amountMinor).toBe(10000); // 200.00/kg × 0.5 kg
      expect(expectData<any>(await respond(c, order.id, ex.id, 'CONTINUE_WITHOUT'), 201).executed).toBe(true);
      expect(num((await orderRow(order.id)).total_minor)).toBe(num(before.total_minor) - 10000);

      await s.vendorPrepares(v1, order.id);
      const driver = await s.driverAssignedTo(order.id);
      const delivery = expectData<any[]>(await world.api('get', '/driver/deliveries', { token: driver.accessToken })).find((d) => d.orderId === order.id);
      expect(delivery.segments?.[0]?.items?.length ?? 1).toBe(1); // the driver is never shown the removed item
      const pickedUp = await world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: driver.accessToken, body: { status: 'PICKED_UP' } });
      expect(pickedUp.status).toBe(200); // would be 400 WEIGHT_NOT_RECORDED if the removed weighed item still counted
    });
  });

  describe('cases the approved rules do not resolve are isolated, never guessed', () => {
    it('an order that would become empty: the answer is not executed, nothing changes, Operations records a fresh documented decision and the existing cancellation runs', async () => {
      const { c, order } = await place([[pA, 1]], 'WALLET', 100000);
      const before = await orderRow(order.id);
      const seg = await segmentOf(order.id, v1);
      const ex = expectData<any>(await mark(v1, seg, [await itemIdOf(order.id, pA.id)]), 201);

      const r = expectData<any>(await respond(c, order.id, ex.id, 'CONTINUE_WITHOUT'), 201);
      expect(r).toMatchObject({ executed: false, isolated: 'ORDER_WOULD_BE_EMPTY' });
      expect(r.exception).toMatchObject({ status: 'AWAITING_OPERATIONS', priority: 'HIGH', customerDecision: null }); // the unexecutable answer is cleared
      expect(num((await orderRow(order.id)).total_minor)).toBe(num(before.total_minor));
      expect((await world.ds.query('SELECT count(*)::int AS n FROM order_items WHERE removed_at IS NOT NULL AND removal_exception_id = $1', [ex.id]))[0].n).toBe(0);
      expect((await refunds(c)).length).toBe(0);

      // Operations must reach the customer and document what they decided; an ordinary Ops user cannot cancel an order.
      expect((await decide(ops, ex.id, { decision: 'CANCEL_ORDER', channel: 'PHONE', note: 'customer chose to cancel the order' })).status).toBe(403);
      expect((await decide(supervisor, ex.id, { decision: 'CANCEL_ORDER', channel: 'APP', note: 'customer chose to cancel the order' })).status).toBe(400); // APP is not a way Operations reached the customer
      expect((await decide(supervisor, ex.id, { decision: 'CANCEL_ORDER', channel: 'PHONE', note: 'x' })).status).toBe(400); // a real note is required
      const done = expectData<any>(await decide(supervisor, ex.id, { decision: 'CANCEL_ORDER', channel: 'PHONE', note: 'spoke to the customer, they cancel the whole order' }), 201);
      expect(done).toMatchObject({ cancelled: true });
      expect(done.exception).toMatchObject({ status: 'RESOLVED', resolution: 'ORDER_CANCELLED', customerDecision: 'CANCEL_ORDER', decisionChannel: 'PHONE' });
      expect((await orderRow(order.id)).status).toBe('CANCELLED'); // through the existing authorized cancellation path
      expect((await refunds(c)).map((x: any) => num(x.amount_delta_minor))).toEqual([num(before.total_minor)]);
    });

    it('an order-level coupon on the part: no approved rule recalculates it, so "continue" is isolated and the customer\'s wish goes to Operations', async () => {
      const code = `PD16${Date.now() % 100000}`;
      expectData(
        await world.api('post', '/admin/offers', { token: superAdmin.accessToken, body: { ...window(), vendorBranchId: v2.branchId, name: 'PD16 coupon', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 500, couponCode: code } }),
        201,
      );
      const c = await s.customer();
      await s.addToCart(c, pC.id, 2);
      const p2 = await s.product(v2, { priceMinor: 1500, inventoryMode: 'OPEN' });
      await s.addToCart(c, p2.id, 1);
      const order = await s.checkout(c, home, 'COD', { couponCode: code });
      const seg = await segmentOf(order.id, v2);
      expect(num((await world.ds.query('SELECT offer_discount_amount_minor FROM order_vendor_segments WHERE id = $1', [seg]))[0].offer_discount_amount_minor)).toBe(500);
      const before = await orderRow(order.id);
      const ex = expectData<any>(await mark(v2, seg, [await itemIdOf(order.id, p2.id)]), 201);
      const r = expectData<any>(await respond(c, order.id, ex.id, 'CONTINUE_WITHOUT'), 201);
      expect(r).toMatchObject({ executed: false, isolated: 'DISCOUNT_RECALCULATION_NOT_DEFINED' });
      expect(num((await orderRow(order.id)).total_minor)).toBe(num(before.total_minor));
    });
  });

  describe('no answer is never consent', () => {
    it('nothing happens by itself; Operations records what the customer said by phone, and may not replace an answer the customer already gave in the app', async () => {
      const { c, order } = await place([[pA, 2], [pB, 1]]);
      const before = await orderRow(order.id);
      const seg = await segmentOf(order.id, v1);
      const ex = expectData<any>(await mark(v1, seg, [await itemIdOf(order.id, pB.id)]), 201);

      // The case waits in the queue, oldest first, with its age.
      const queue = expectData<any[]>(await world.api('get', '/admin/order-exceptions?status=AWAITING_CUSTOMER', { token: ops.accessToken }));
      expect(queue.find((q) => q.id === ex.id)).toMatchObject({ status: 'AWAITING_CUSTOMER', itemCount: 1, order: { id: order.id }, customer: { id: c.id } });
      const summary = expectData<any>(await world.api('get', '/admin/order-exceptions/summary', { token: ops.accessToken }));
      expect(summary.awaitingCustomer).toBeGreaterThanOrEqual(1);
      expect(num((await orderRow(order.id)).total_minor)).toBe(num(before.total_minor));
      expect((await exRow(ex.id)).customer_decision).toBeNull();

      // Operations documents the call; escalation and notes are plain recorded events.
      expectData(await world.api('post', `/admin/order-exceptions/${ex.id}/notes`, { token: ops.accessToken, body: { note: 'Called twice, no answer' } }), 201);
      expect(expectData<any>(await world.api('post', `/admin/order-exceptions/${ex.id}/escalate`, { token: ops.accessToken, body: { note: 'still no answer' } }), 201)).toMatchObject({ status: 'ESCALATED', priority: 'HIGH' });
      expect((await decide(ops, ex.id, { decision: 'CONTINUE_WITHOUT', channel: 'PHONE' })).status).toBe(400); // a note is mandatory
      const done = expectData<any>(await decide(ops, ex.id, { decision: 'CONTINUE_WITHOUT', channel: 'WHATSAPP', note: 'Customer replied on WhatsApp: continue without it' }), 201);
      expect(done.executed).toBe(true);
      expect(done.exception).toMatchObject({ status: 'RESOLVED', customerDecision: 'CONTINUE_WITHOUT', decisionChannel: 'WHATSAPP' });
      expect(num((await orderRow(order.id)).total_minor)).toBe(num(before.total_minor) - 5000);
      expect((await exRow(ex.id)).decision_recorded_by_user_id).toBe(ops.id); // who recorded it is kept
      expect((await respond(c, order.id, ex.id, 'CANCEL_ORDER')).status).toBe(409);
    });

    it('a cancel request left in the app waits for authorized Operations; Operations may only execute that answer, not another', async () => {
      const { c, order } = await place([[pA, 1], [pB, 1]], 'WALLET', 100000);
      const before = await orderRow(order.id);
      const seg = await segmentOf(order.id, v1);
      const ex = expectData<any>(await mark(v1, seg, [await itemIdOf(order.id, pB.id)]), 201);

      const r = expectData<any>(await respond(c, order.id, ex.id, 'CANCEL_ORDER'), 201);
      expect(r).toMatchObject({ executed: false });
      expect(r.exception).toMatchObject({ status: 'AWAITING_OPERATIONS', customerDecision: 'CANCEL_ORDER', decisionChannel: 'APP' });
      expect((await orderRow(order.id)).status).toBe(before.status); // customer cancellation permissions are unchanged: nothing is cancelled by the answer itself

      expect((await decide(supervisor, ex.id, { decision: 'CONTINUE_WITHOUT', channel: 'PHONE', note: 'trying to override the customer' })).status).toBe(409);
      expect((await decide(ops, ex.id, { decision: 'CANCEL_ORDER' })).status).toBe(403); // no supervisor authority
      const done = expectData<any>(await decide(supervisor, ex.id, { decision: 'CANCEL_ORDER' }), 201); // no channel/note needed: the customer's own answer is being executed
      expect(done.cancelled).toBe(true);
      expect((await orderRow(order.id)).status).toBe('CANCELLED');
      expect((await refunds(c)).map((x: any) => num(x.amount_delta_minor))).toEqual([num(before.total_minor)]);
      // Running it again is harmless.
      expect((await decide(supervisor, ex.id, { decision: 'CANCEL_ORDER' })).status).toBe(409); // the case is closed
      expect((await refunds(c)).length).toBe(1);
    });
  });
});

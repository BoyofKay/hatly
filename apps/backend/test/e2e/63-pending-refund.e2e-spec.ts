/**
 * PD-004 — Manual Transfer PENDING REFUND ENTITLEMENT, over real HTTP against real PostgreSQL.
 *
 * A customer may already have sent a transfer that an admin has not verified yet (PENDING / CLAIMED / UNDER_REVIEW).
 * If a vendor segment is cancelled meanwhile, the overpayment is recorded as a pending entitlement on the payment —
 * NEVER as a refund payable, because the transfer may still be rejected and Hatly may never have received the money.
 * Approval converts it into exactly one refund payable for paid − amount owed; rejection voids it and pays nothing.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';

const ADDITIONAL_VENDOR_FEE = 500;

describe('E2E — Manual Transfer pending refund entitlement (PD-004)', () => {
  let world: World;
  let s: Scenario;
  let area: { id: string; lat: number; lng: number };
  let superAdmin: Actor;
  let reviewer: Actor;
  let v1: VendorFixture;
  let v2: VendorFixture;
  let v3: VendorFixture;
  let p1: { id: string };
  let p2: { id: string };
  let p3: { id: string };
  const home = { lat: 30.425, lng: 31.565 };

  const num = (v: unknown) => Number(v);
  const orderRow = async (id: string) => (await world.ds.query('SELECT * FROM orders WHERE id = $1', [id]))[0];
  const paymentOf = async (orderId: string) => (await world.ds.query('SELECT * FROM payments WHERE order_id = $1', [orderId]))[0];
  const refundEvents = (orderId: string) =>
    world.ds.query(
      "SELECT amount_minor, idempotency_key, actor_user_id FROM financial_events WHERE order_id = $1 AND type = 'MANUAL_TRANSFER_REFUND_RECORDED' ORDER BY created_at",
      [orderId],
    );
  const refundedTotal = async (orderId: string) => (await refundEvents(orderId)).reduce((sum: number, e: any) => sum + num(e.amount_minor), 0);
  const segmentOf = async (orderId: string, v: VendorFixture): Promise<string> =>
    (await world.ds.query('SELECT id FROM order_vendor_segments WHERE order_id = $1 AND vendor_branch_id = $2', [orderId, v.branchId]))[0].id;
  // R2: an InstaPay / Vodafone Cash order is invisible to its vendor until Operations verify the money, so a vendor part of a transfer
  // order is cancelled by Operations on the vendor's behalf (same transition, same money rules). `v` names the vendor whose part it is.
  const cancelSegment = (v: VendorFixture, segmentId: string) =>
    world.api('patch', `/admin/orders/segments/${segmentId}/status`, { token: superAdmin.accessToken, body: { status: 'CANCELLED', reason: `Out of stock (${v.branchId})` } });
  const claim = (customer: Actor, orderId: string) => world.api('post', `/payments/manual-transfer/orders/${orderId}/claim`, { token: customer.accessToken, body: {} });
  const approve = (paymentId: string) => world.api('post', `/admin/manual-transfer-payments/${paymentId}/approve`, { token: reviewer.accessToken });
  const reject = (paymentId: string) => world.api('post', `/admin/manual-transfer-payments/${paymentId}/reject`, { token: reviewer.accessToken, body: { reason: 'no money received' } });
  const order = async (products: Array<{ id: string }>, paymentMethod = 'MANUAL_TRANSFER') => {
    const customer = await s.customer();
    for (const p of products) await s.addToCart(customer, p.id, 1);
    return { customer, order: await s.checkout(customer, home, paymentMethod) };
  };
  /** A transfer the customer has claimed and that is UNDER_REVIEW — sent, but not yet verified. */
  const underReview = async (products: Array<{ id: string }>) => {
    const o = await order(products);
    await claim(o.customer, o.order.id);
    expect((await paymentOf(o.order.id)).status).toBe('UNDER_REVIEW');
    return o;
  };

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    area = await s.serviceArea({ radiusMeters: 50000 });
    superAdmin = await s.superAdmin();
    reviewer = await s.admin([Permission.VERIFY_MANUAL_PAYMENTS]);
    v1 = await s.vendor({ name: 'PR 1', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    v2 = await s.vendor({ name: 'PR 2', serviceAreaId: area.id, lat: 30.431, lng: 31.571 });
    v3 = await s.vendor({ name: 'PR 3', serviceAreaId: area.id, lat: 30.441, lng: 31.581 });
    p1 = await s.product(v1, { priceMinor: 10000, inventoryMode: 'OPEN' });
    p2 = await s.product(v2, { priceMinor: 20000, inventoryMode: 'OPEN' });
    p3 = await s.product(v3, { priceMinor: 30000, inventoryMode: 'OPEN' });
    await s.setConfig('MANUAL_TRANSFER_DESTINATION', { label: 'Hatly Wallet', phoneOrAccountNumber: '01000000000' });
    await s.setConfig('CUSTOMER_SERVICE_WHATSAPP_NUMBER', '+201000000000');
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('a) cancellation while the transfer is not yet verified', () => {
    it.each(['PENDING', 'CUSTOMER_CLAIMED_TRANSFER', 'UNDER_REVIEW'])(
      'a %s transfer + partial cancellation: a pending entitlement of (paid − owed) is recorded, and NO refund payable exists',
      async (state) => {
        const o = await order([p1, p2]);
        if (state !== 'PENDING') {
          await claim(o.customer, o.order.id);
          if (state === 'CUSTOMER_CLAIMED_TRANSFER') {
            // the claim endpoint advances CLAIMED → UNDER_REVIEW at once; force the intermediate state to prove it is handled too
            await world.ds.query("UPDATE payments SET status = 'CUSTOMER_CLAIMED_TRANSFER' WHERE order_id = $1", [o.order.id]);
          }
        }
        const paid = num((await paymentOf(o.order.id)).amount_minor);

        expectData(await cancelSegment(v2, await segmentOf(o.order.id, v2)));

        const payment = await paymentOf(o.order.id);
        expect(payment.status).toBe(state);
        expect(payment.pending_refund_status).toBe('PENDING');
        expect(num(payment.pending_refund_minor)).toBe(20000 + ADDITIONAL_VENDOR_FEE);
        expect(num(payment.pending_refund_minor)).toBe(paid - num((await orderRow(o.order.id)).total_minor));
        expect(num(payment.amount_minor)).toBe(paid); // what the customer may already have sent is never rewritten
        expect(await refundEvents(o.order.id)).toEqual([]); // no payable before Hatly confirms receipt
      },
    );
  });

  describe('b) several cancellations before approval', () => {
    it('the entitlement is exactly the FINAL overpayment (3 → 2 → 1), never a stack of stale amounts; repeating changes nothing', async () => {
      const o = await underReview([p1, p2, p3]);
      const paid = num((await paymentOf(o.order.id)).amount_minor);

      expectData(await cancelSegment(v3, await segmentOf(o.order.id, v3)));
      expect(num((await paymentOf(o.order.id)).pending_refund_minor)).toBe(30000 + ADDITIONAL_VENDOR_FEE);
      expectData(await cancelSegment(v2, await segmentOf(o.order.id, v2)));
      const payment = await paymentOf(o.order.id);
      expect(num(payment.pending_refund_minor)).toBe(paid - num((await orderRow(o.order.id)).total_minor));
      expect(num(payment.pending_refund_minor)).toBe(50000 + 2 * ADDITIONAL_VENDOR_FEE);

      expect((await cancelSegment(v2, await segmentOf(o.order.id, v2))).status).toBe(400); // repeated cancellation is refused…
      expect(num((await paymentOf(o.order.id)).pending_refund_minor)).toBe(50000 + 2 * ADDITIONAL_VENDOR_FEE); // …and changes nothing
      expect(await refundEvents(o.order.id)).toEqual([]);
    });
  });

  describe('c) approval converts the entitlement into exactly one refund payable', () => {
    it('partial cancellation, then approval: ONE refund of paid − owed, by the verifier, entitlement CONVERTED; a second approval is refused', async () => {
      const o = await underReview([p1, p2]);
      const paymentId = (await paymentOf(o.order.id)).id;
      const paid = num((await paymentOf(o.order.id)).amount_minor);
      expectData(await cancelSegment(v2, await segmentOf(o.order.id, v2)));
      expect(await refundEvents(o.order.id)).toEqual([]);

      expectData(await approve(paymentId), 201);

      const refunds = await refundEvents(o.order.id);
      expect(refunds).toHaveLength(1);
      expect(num(refunds[0].amount_minor)).toBe(20000 + ADDITIONAL_VENDOR_FEE);
      expect(num(refunds[0].amount_minor)).toBe(paid - num((await orderRow(o.order.id)).total_minor));
      expect(refunds[0].idempotency_key).toBe(`manual-transfer-refund:${paymentId}:pending-conversion`);
      expect(refunds[0].actor_user_id).toBe(reviewer.id);
      const payment = await paymentOf(o.order.id);
      expect(payment).toMatchObject({ status: 'PAID', pending_refund_status: 'CONVERTED' });
      expect(payment.pending_refund_resolved_at).not.toBeNull();

      expect((await approve(paymentId)).status).toBe(409); // never a second decision…
      expect(await refundEvents(o.order.id)).toHaveLength(1); // …and never a second refund
    });

    it('cancellations both BEFORE and AFTER approval: every amount is refunded exactly once, together paid − owed', async () => {
      const o = await underReview([p1, p2, p3]);
      const paymentId = (await paymentOf(o.order.id)).id;
      const paid = num((await paymentOf(o.order.id)).amount_minor);
      expectData(await cancelSegment(v3, await segmentOf(o.order.id, v3))); // pending
      expectData(await approve(paymentId), 201); // converts the 30500
      expect(await refundedTotal(o.order.id)).toBe(30000 + ADDITIONAL_VENDOR_FEE);
      expectData(await cancelSegment(v2, await segmentOf(o.order.id, v2))); // PAID → the existing immediate refund of the rest
      expect(await refundedTotal(o.order.id)).toBe(paid - num((await orderRow(o.order.id)).total_minor));
      expect(await refundEvents(o.order.id)).toHaveLength(2);
    });

    it('an approval with no cancellation never creates a refund (ordinary approvals are unchanged)', async () => {
      const o = await underReview([p1, p2]);
      expectData(await approve((await paymentOf(o.order.id)).id), 201);
      expect(await refundEvents(o.order.id)).toEqual([]);
      expect((await paymentOf(o.order.id)).pending_refund_status).toBe('NONE');
    });
  });

  describe('d) rejection voids the entitlement and pays nothing', () => {
    it('partial cancellation, then rejection: no refund payable, entitlement VOIDED; a second rejection or an approval is refused', async () => {
      const o = await underReview([p1, p2]);
      const paymentId = (await paymentOf(o.order.id)).id;
      expectData(await cancelSegment(v2, await segmentOf(o.order.id, v2)));
      expect((await paymentOf(o.order.id)).pending_refund_status).toBe('PENDING');

      expectData(await reject(paymentId), 201);

      const payment = await paymentOf(o.order.id);
      expect(payment).toMatchObject({ status: 'REJECTED', pending_refund_status: 'VOIDED' });
      expect(payment.pending_refund_resolved_at).not.toBeNull();
      expect(await refundEvents(o.order.id)).toEqual([]);
      expect((await reject(paymentId)).status).toBe(409);
      expect((await approve(paymentId)).status).toBe(409);
      expect(await refundEvents(o.order.id)).toEqual([]);
    });

    it('a cancellation AFTER the rejection creates no entitlement and no refund (Hatly never received the money)', async () => {
      const o = await underReview([p1, p2]);
      expectData(await reject((await paymentOf(o.order.id)).id), 201);
      expectData(await cancelSegment(v2, await segmentOf(o.order.id, v2)));
      expect((await paymentOf(o.order.id)).pending_refund_status).toBe('NONE');
      expect(await refundEvents(o.order.id)).toEqual([]);
    });
  });

  describe('e) already-PAID transfers keep the existing immediate refund', () => {
    it('PAID + partial cancellation: the refund payable is recorded at once and no entitlement is ever created', async () => {
      const o = await underReview([p1, p2]);
      expectData(await approve((await paymentOf(o.order.id)).id), 201);
      expectData(await cancelSegment(v2, await segmentOf(o.order.id, v2)));
      expect(await refundedTotal(o.order.id)).toBe(20000 + ADDITIONAL_VENDOR_FEE);
      expect((await paymentOf(o.order.id)).pending_refund_status).toBe('NONE');
    });
  });

  describe('f) COD and PAY_AT_DELIVERY', () => {
    it('never get an entitlement or a refund event, on partial or final cancellation', async () => {
      for (const method of ['COD', 'PAY_AT_DELIVERY']) {
        const o = await order([p1, p2], 'COD');
        // R20: no NEW order can use Pay at Delivery; an order placed before R20 keeps it — simulated by marking a cash order as such.
        if (method === 'PAY_AT_DELIVERY') await world.ds.query(`UPDATE orders SET payment_method = 'PAY_AT_DELIVERY', electronic_payment_method = 'INSTAPAY' WHERE id = $1`, [o.order.id]);
        expectData(await cancelSegment(v2, await segmentOf(o.order.id, v2)));
        expectData(await cancelSegment(v1, await segmentOf(o.order.id, v1)));
        expect(await world.ds.query('SELECT 1 FROM payments WHERE order_id = $1', [o.order.id])).toEqual([]);
        expect(await refundEvents(o.order.id)).toEqual([]);
      }
    });
  });

  describe('i) whole-order cancellation', () => {
    it('final vendor cancels while the transfer is under review: the WHOLE amount is the entitlement; approval then refunds exactly the paid amount, once', async () => {
      const o = await underReview([p1, p2]);
      const paymentId = (await paymentOf(o.order.id)).id;
      const paid = num((await paymentOf(o.order.id)).amount_minor);
      expectData(await cancelSegment(v2, await segmentOf(o.order.id, v2)));
      expectData(await cancelSegment(v1, await segmentOf(o.order.id, v1)));
      expect((await orderRow(o.order.id)).status).toBe('CANCELLED');
      expect(num((await paymentOf(o.order.id)).pending_refund_minor)).toBe(paid);
      expect(await refundEvents(o.order.id)).toEqual([]);

      expectData(await approve(paymentId), 201);
      expect(await refundedTotal(o.order.id)).toBe(paid);
      expect(await refundEvents(o.order.id)).toHaveLength(1);
    });

    it('admin cancels the whole order under review, then rejects: nothing is ever refunded', async () => {
      const o = await underReview([p1, p2]);
      expectData(await world.api('patch', `/orders/${o.order.id}/status`, { token: superAdmin.accessToken, body: { status: 'CANCELLED', cancellationReason: 'admin' } }));
      const paid = num((await paymentOf(o.order.id)).amount_minor);
      expect(num((await paymentOf(o.order.id)).pending_refund_minor)).toBe(paid);
      expectData(await reject((await paymentOf(o.order.id)).id), 201);
      expect((await paymentOf(o.order.id)).pending_refund_status).toBe('VOIDED');
      expect(await refundEvents(o.order.id)).toEqual([]);
    });

    it('a PENDING (never claimed) transfer on a cancelled order keeps an inert entitlement — no event', async () => {
      const o = await order([p1, p2]);
      expectData(await world.api('patch', `/orders/${o.order.id}/status`, { token: superAdmin.accessToken, body: { status: 'CANCELLED', cancellationReason: 'x' } }));
      expect(await refundEvents(o.order.id)).toEqual([]);
      expect((await paymentOf(o.order.id)).pending_refund_status).toBe('PENDING');
    });
  });

  describe('g/h) idempotency and concurrency', () => {
    it('approval racing a partial cancellation, in whatever order they interleave: the customer always gets exactly paid − owed back — never double, never lost', async () => {
      for (let i = 0; i < 6; i++) {
        const o = await underReview([p1, p2]);
        const paymentId = (await paymentOf(o.order.id)).id;
        const paid = num((await paymentOf(o.order.id)).amount_minor);

        const [cancelled, approved] = await Promise.all([cancelSegment(v2, await segmentOf(o.order.id, v2)), approve(paymentId)]);
        expect(cancelled.status).toBeLessThan(300);
        expect(approved.status).toBeLessThan(300);

        const payment = await paymentOf(o.order.id);
        expect(payment.status).toBe('PAID');
        const owed = num((await orderRow(o.order.id)).total_minor);
        expect(await refundedTotal(o.order.id)).toBe(paid - owed);
        expect(await refundedTotal(o.order.id)).toBe(20000 + ADDITIONAL_VENDOR_FEE);
        expect((await refundEvents(o.order.id)).length).toBe(1);
        // whichever ran first, the entitlement is resolved: either converted, or (approval first) never created
        expect(['CONVERTED', 'NONE']).toContain(payment.pending_refund_status);
        expect(payment.pending_refund_status === 'PENDING').toBe(false);
      }
      expect(world.unhandledServerErrors()).toEqual([]);
    });

    it('rejection racing a partial cancellation: never a refund, and the entitlement never stays PENDING', async () => {
      for (let i = 0; i < 4; i++) {
        const o = await underReview([p1, p2]);
        const paymentId = (await paymentOf(o.order.id)).id;
        const [cancelled, rejected] = await Promise.all([cancelSegment(v2, await segmentOf(o.order.id, v2)), reject(paymentId)]);
        expect(cancelled.status).toBeLessThan(300);
        expect(rejected.status).toBeLessThan(300);
        const payment = await paymentOf(o.order.id);
        expect(payment.status).toBe('REJECTED');
        expect(['VOIDED', 'NONE']).toContain(payment.pending_refund_status);
        expect(await refundEvents(o.order.id)).toEqual([]);
      }
    });

    it('approval sent five times at once: one decision, one refund', async () => {
      const o = await underReview([p1, p2]);
      const paymentId = (await paymentOf(o.order.id)).id;
      expectData(await cancelSegment(v2, await segmentOf(o.order.id, v2)));
      const results = await Promise.all(Array.from({ length: 5 }, () => approve(paymentId)));
      expect(results.filter((r) => r.status < 300)).toHaveLength(1);
      expect(results.filter((r) => r.status >= 500)).toHaveLength(0);
      expect(await refundEvents(o.order.id)).toHaveLength(1);
    });

    it('final cancellation racing approval: paid is refunded exactly once in total', async () => {
      const o = await underReview([p1, p2]);
      const paymentId = (await paymentOf(o.order.id)).id;
      const paid = num((await paymentOf(o.order.id)).amount_minor);
      expectData(await cancelSegment(v2, await segmentOf(o.order.id, v2)));
      const [cancelled, approved] = await Promise.all([cancelSegment(v1, await segmentOf(o.order.id, v1)), approve(paymentId)]);
      expect(cancelled.status).toBeLessThan(300);
      expect(approved.status).toBeLessThan(300);
      expect((await orderRow(o.order.id)).status).toBe('CANCELLED');
      expect(await refundedTotal(o.order.id)).toBe(paid);
    });
  });
});

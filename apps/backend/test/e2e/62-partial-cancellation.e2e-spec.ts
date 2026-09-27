/**
 * PD-002 / PD-003 — multi-vendor PARTIAL cancellation, over real HTTP against real PostgreSQL:
 * the delivery fee is re-derived for the vendors that remain (exactly one additional-vendor fee less per cancelled
 * vendor, base fee untouched), the order totals stay internally consistent, a PAID Manual Transfer is refunded exactly
 * what is no longer owed (server-computed, idempotent), the last cancelled segment cancels the whole order with a zero
 * fee, a vendor can only ever cancel its OWN segment, and stock / flash-sale allocations come back per segment.
 *
 * Delivery pricing here: 10 EGP / 100 m, 15 EGP minimum, 5 EGP (500 minor) per additional vendor.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';
import { boundary } from './support/external-boundary';
import { Permission } from '../../src/modules/permissions/permission.enum';

const ADDITIONAL_VENDOR_FEE = 500;
const HOUR = 3600_000;
const window = () => ({ startAt: new Date(Date.now() - HOUR).toISOString(), endAt: new Date(Date.now() + 24 * HOUR).toISOString() });

describe('E2E — multi-vendor partial cancellation (fee, totals, refund)', () => {
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

  const orderRow = async (id: string) => (await world.ds.query('SELECT * FROM orders WHERE id = $1', [id]))[0];
  const num = (v: unknown) => Number(v);
  const segmentOf = async (orderId: string, v: VendorFixture): Promise<string> =>
    (await world.ds.query('SELECT id FROM order_vendor_segments WHERE order_id = $1 AND vendor_branch_id = $2', [orderId, v.branchId]))[0].id;
  const cancelSegment = async (v: VendorFixture, segmentId: string) =>
    world.api('patch', `/vendor/orders/segments/${segmentId}/status`, { token: v.manager.accessToken, body: { status: 'CANCELLED' } });
  const refundEvents = (orderId: string) =>
    world.ds.query(
      "SELECT amount_minor, idempotency_key, order_vendor_segment_id FROM financial_events WHERE order_id = $1 AND type = 'MANUAL_TRANSFER_REFUND_RECORDED' ORDER BY created_at",
      [orderId],
    );
  const refundedTotal = async (orderId: string) => (await refundEvents(orderId)).reduce((sum: number, e: any) => sum + num(e.amount_minor), 0);
  const paymentOf = async (orderId: string) => (await world.ds.query('SELECT * FROM payments WHERE order_id = $1', [orderId]))[0];
  const stock = async (productId: string) => num((await world.ds.query('SELECT quantity FROM products WHERE id = $1', [productId]))[0].quantity);
  /** total = subtotal + deliveryFee - discount — must hold on every persisted order. */
  const expectConsistent = (row: any) => expect(num(row.total_minor)).toBe(num(row.subtotal_minor) + num(row.delivery_fee_minor) - num(row.discount_minor));
  const payTransfer = async (customer: Actor, orderId: string) => {
    const payment = await paymentOf(orderId);
    await world.api('post', `/payments/manual-transfer/orders/${orderId}/claim`, { token: customer.accessToken, body: {} });
    expectData(await world.api('post', `/admin/manual-transfer-payments/${payment.id}/approve`, { token: reviewer.accessToken }), 201);
  };
  /** A customer with one unit of each given product in the cart, checked out. */
  const order = async (products: Array<{ id: string }>, paymentMethod = 'COD', quantities: number[] = []) => {
    const customer = await s.customer();
    for (let i = 0; i < products.length; i++) await s.addToCart(customer, products[i].id, quantities[i] ?? 1);
    return { customer, order: await s.checkout(customer, home, paymentMethod) };
  };

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing(); // additional vendor fee = 500 minor
    area = await s.serviceArea({ radiusMeters: 50000 });
    superAdmin = await s.superAdmin();
    reviewer = await s.admin([Permission.VERIFY_MANUAL_PAYMENTS]);
    v1 = await s.vendor({ name: 'PC 1', serviceAreaId: area.id, lat: 30.421, lng: 31.561, commissionBasisPoints: 1000 });
    v2 = await s.vendor({ name: 'PC 2', serviceAreaId: area.id, lat: 30.431, lng: 31.571, commissionBasisPoints: 500 });
    v3 = await s.vendor({ name: 'PC 3', serviceAreaId: area.id, lat: 30.441, lng: 31.581 });
    p1 = await s.product(v1, { priceMinor: 10000, inventoryMode: 'OPEN' });
    p2 = await s.product(v2, { priceMinor: 20000, inventoryMode: 'OPEN' });
    p3 = await s.product(v3, { priceMinor: 30000, inventoryMode: 'OPEN' });
    await s.driver({ lat: 30.4212, lng: 31.5612 });
    await s.setConfig('MANUAL_TRANSFER_DESTINATION', { label: 'Hatly Wallet', phoneOrAccountNumber: '01000000000' });
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

  describe('delivery fee and totals', () => {
    it('2 vendors: cancelling one removes exactly ONE additional-vendor fee and that vendor\'s merchandise; the base fee is untouched', async () => {
      const { order: o } = await order([p1, p2]);
      const before = await orderRow(o.id);
      const base = num(before.delivery_fee_minor) - ADDITIONAL_VENDOR_FEE; // 2 vendors = base + 1 × 500
      expect(num(before.subtotal_minor)).toBe(30000);

      expectData(await cancelSegment(v2, await segmentOf(o.id, v2)));

      const after = await orderRow(o.id);
      expect(after.status).toBe('PENDING'); // one vendor cancelling never cancels the order
      expect(num(after.subtotal_minor)).toBe(10000);
      expect(num(after.delivery_fee_minor)).toBe(base); // = max(minimum, distance fee) + 500 × (1 - 1)
      expect(num(after.delivery_fee_minor)).toBe(num(before.delivery_fee_minor) - ADDITIONAL_VENDOR_FEE);
      expect(num(after.total_minor)).toBe(num(before.total_minor) - 20000 - ADDITIONAL_VENDOR_FEE);
      expectConsistent(after);
    });

    it('3 vendors: 3 → 2 removes exactly one additional fee, 2 → 1 removes exactly one more; the base fee never moves', async () => {
      const { order: o } = await order([p1, p2, p3]);
      const before = await orderRow(o.id);
      const base = num(before.delivery_fee_minor) - 2 * ADDITIONAL_VENDOR_FEE;
      expect(num(before.subtotal_minor)).toBe(60000);

      expectData(await cancelSegment(v3, await segmentOf(o.id, v3)));
      const two = await orderRow(o.id);
      expect(num(two.delivery_fee_minor)).toBe(base + ADDITIONAL_VENDOR_FEE); // 2 vendors remain
      expect(num(two.subtotal_minor)).toBe(30000);
      expect(num(two.total_minor)).toBe(num(before.total_minor) - 30000 - ADDITIONAL_VENDOR_FEE);
      expectConsistent(two);

      expectData(await cancelSegment(v2, await segmentOf(o.id, v2)));
      const one = await orderRow(o.id);
      expect(num(one.delivery_fee_minor)).toBe(base); // 1 vendor remains
      expect(num(one.subtotal_minor)).toBe(10000);
      expect(num(one.total_minor)).toBe(num(before.total_minor) - 50000 - 2 * ADDITIONAL_VENDOR_FEE);
      expectConsistent(one);
      expect(one.status).toBe('PENDING');
    });

    it('the order is not stuck when the cancelled vendor was the one the others were waiting for: it moves on to dispatch', async () => {
      await s.driver({ lat: 30.4212, lng: 31.5612 }); // a free driver for this dispatch
      const { order: o } = await order([p1, p2]);
      await s.vendorPrepares(v1, o.id); // v1 READY_FOR_PICKUP, waiting for v2
      expect((await orderRow(o.id)).status).toBe('PENDING');
      expectData(await cancelSegment(v2, await segmentOf(o.id, v2)));
      expect((await orderRow(o.id)).status).toBe('ASSIGNED_TO_DRIVER');
    });

    it('cancelling the FINAL active vendor cancels the order: delivery fee 0, nothing owed, all segments cancelled, customer notified once', async () => {
      const customer = await s.customer();
      expectData(await world.api('post', '/customer/device-token', { token: customer.accessToken, body: { token: 'fcm-final', platform: 'android' } }), 201);
      await s.addToCart(customer, p1.id, 1);
      await s.addToCart(customer, p2.id, 1);
      const o = await s.checkout(customer, home);

      expectData(await cancelSegment(v2, await segmentOf(o.id, v2)));
      expect((await orderRow(o.id)).status).toBe('PENDING');
      expectData(await cancelSegment(v1, await segmentOf(o.id, v1)));

      const row = await orderRow(o.id);
      expect(row.status).toBe('CANCELLED');
      expect(num(row.delivery_fee_minor)).toBe(0);
      expect(num(row.subtotal_minor)).toBe(0);
      expect(num(row.discount_minor)).toBe(0);
      expect(num(row.total_minor)).toBe(0);
      expect(row.cancelled_by_role).toBe('VENDOR_MANAGER');
      expect(await world.ds.query('SELECT status FROM order_vendor_segments WHERE order_id = $1', [o.id])).toEqual([{ status: 'CANCELLED' }, { status: 'CANCELLED' }]);
      expect(boundary.push.filter((p) => p.data.type === 'ORDER_CANCELLED' && p.data.orderId === o.id)).toHaveLength(1);
    });

    it('a single-vendor order cancelled by its vendor (segment or order endpoint) also ends with fee 0', async () => {
      const a = await order([p1]);
      expectData(await cancelSegment(v1, await segmentOf(a.order.id, v1)));
      expect(await orderRow(a.order.id)).toMatchObject({ status: 'CANCELLED', delivery_fee_minor: 0, total_minor: 0 });

      const b = await order([p1]);
      expectData(await world.api('patch', `/orders/${b.order.id}/status`, { token: v1.manager.accessToken, body: { status: 'CANCELLED', cancellationReason: 'sold out' } }));
      expect(await orderRow(b.order.id)).toMatchObject({ status: 'CANCELLED', delivery_fee_minor: 0, total_minor: 0, cancellation_reason: 'sold out' });
    });

    it('the last segment cannot be cancelled once a driver is assigned (the order can no longer be cancelled then) — nothing changes', async () => {
      await s.driver({ lat: 30.4212, lng: 31.5612 }); // a free driver for this dispatch
      const { order: o } = await order([p1, p2]);
      expectData(await cancelSegment(v2, await segmentOf(o.id, v2)));
      await s.vendorPrepares(v1, o.id);
      expect((await orderRow(o.id)).status).toBe('ASSIGNED_TO_DRIVER');
      const before = await orderRow(o.id);

      const res = await cancelSegment(v1, await segmentOf(o.id, v1));
      expect(res.status).toBe(409);
      expect(res.body.error.details.code).toBe('ORDER_ASSIGNED_CANNOT_CANCEL_LAST_SEGMENT');
      expect(await orderRow(o.id)).toMatchObject({ status: 'ASSIGNED_TO_DRIVER', total_minor: before.total_minor, delivery_fee_minor: before.delivery_fee_minor });
    });
  });

  describe('refunds', () => {
    it('already-PAID Manual Transfer, partial cancel: refunds exactly paid − new total (the cancelled merchandise + one additional-vendor fee), server-computed', async () => {
      const { customer, order: o } = await order([p1, p2], 'MANUAL_TRANSFER');
      await payTransfer(customer, o.id);
      const paid = num((await paymentOf(o.id)).amount_minor);
      expect(paid).toBe(o.totalMinor);

      expectData(await cancelSegment(v2, await segmentOf(o.id, v2)));

      const after = await orderRow(o.id);
      const refunds = await refundEvents(o.id);
      expect(refunds).toHaveLength(1);
      expect(num(refunds[0].amount_minor)).toBe(20000 + ADDITIONAL_VENDOR_FEE); // v2's merchandise + the removed additional fee
      expect(num(refunds[0].amount_minor)).toBe(paid - num(after.total_minor));
      expect(refunds[0].order_vendor_segment_id).toBe(await segmentOf(o.id, v2));
      expect((await paymentOf(o.id)).status).toBe('PAID'); // the original payment is never mutated
      expect(num((await paymentOf(o.id)).amount_minor)).toBe(paid); // …it stays the amount actually paid
      expectConsistent(after);
    });

    it('3 vendors, paid: each cancellation refunds only its own new difference; together they equal paid − what is still owed', async () => {
      const { customer, order: o } = await order([p1, p2, p3], 'MANUAL_TRANSFER');
      await payTransfer(customer, o.id);
      const paid = num((await paymentOf(o.id)).amount_minor);

      expectData(await cancelSegment(v3, await segmentOf(o.id, v3)));
      expect(await refundedTotal(o.id)).toBe(30000 + ADDITIONAL_VENDOR_FEE);
      expectData(await cancelSegment(v2, await segmentOf(o.id, v2)));
      expect(await refundedTotal(o.id)).toBe(50000 + 2 * ADDITIONAL_VENDOR_FEE);
      expect((await refundEvents(o.id)).map((e: any) => num(e.amount_minor))).toEqual([30000 + ADDITIONAL_VENDOR_FEE, 20000 + ADDITIONAL_VENDOR_FEE]);
      expect(await refundedTotal(o.id)).toBe(paid - num((await orderRow(o.id)).total_minor));
    });

    it('cancelling the FINAL vendor of a paid order makes the FULL paid amount refundable — in total exactly once, including the delivery fee', async () => {
      const { customer, order: o } = await order([p1, p2], 'MANUAL_TRANSFER');
      await payTransfer(customer, o.id);
      const paid = num((await paymentOf(o.id)).amount_minor);

      expectData(await cancelSegment(v2, await segmentOf(o.id, v2)));
      expectData(await cancelSegment(v1, await segmentOf(o.id, v1)));

      expect((await orderRow(o.id)).status).toBe('CANCELLED');
      expect(await refundedTotal(o.id)).toBe(paid);
      const refunds = await refundEvents(o.id);
      expect(refunds).toHaveLength(2);
      expect(refunds[1].idempotency_key).toBe(`manual-transfer-refund:${(await paymentOf(o.id)).id}`); // the whole-payment key, for the remainder
      expect(num(refunds[1].amount_minor)).toBe(paid - num(refunds[0].amount_minor));
    });

    it('a whole-order cancel by an admin AFTER a partial cancellation refunds only the remainder (never the same money twice)', async () => {
      const { customer, order: o } = await order([p1, p2], 'MANUAL_TRANSFER');
      await payTransfer(customer, o.id);
      const paid = num((await paymentOf(o.id)).amount_minor);
      expectData(await cancelSegment(v2, await segmentOf(o.id, v2)));
      expectData(await world.api('patch', `/orders/${o.id}/status`, { token: superAdmin.accessToken, body: { status: 'CANCELLED', cancellationReason: 'admin' } }));
      expect(await refundedTotal(o.id)).toBe(paid);
      expect(await refundEvents(o.id)).toHaveLength(2);
    });

    it('COD (and PAY_AT_DELIVERY): no refund record and no Payment row is ever created by a partial or final cancellation', async () => {
      for (const method of ['COD', 'PAY_AT_DELIVERY']) {
        const { order: o } = await order([p1, p2], method);
        expectData(await cancelSegment(v2, await segmentOf(o.id, v2)));
        expectData(await cancelSegment(v1, await segmentOf(o.id, v1)));
        expect(await refundEvents(o.id)).toEqual([]);
        expect(await world.ds.query('SELECT 1 FROM payments WHERE order_id = $1', [o.id])).toEqual([]);
        expect((await orderRow(o.id)).status).toBe('CANCELLED');
      }
    });

    it('an UNPAID transfer records no refund EVENT (it may still be rejected): PD-004 keeps a pending entitlement instead and never rewrites the amount the customer may have sent', async () => {
      const pending = await order([p1, p2], 'MANUAL_TRANSFER');
      const paidBasis = num((await paymentOf(pending.order.id)).amount_minor);
      expectData(await cancelSegment(v2, await segmentOf(pending.order.id, v2)));
      expect(await refundEvents(pending.order.id)).toEqual([]);
      const payment = await paymentOf(pending.order.id);
      expect(num(payment.amount_minor)).toBe(paidBasis);
      expect(payment).toMatchObject({ pending_refund_status: 'PENDING' });
      expect(num(payment.pending_refund_minor)).toBe(paidBasis - num((await orderRow(pending.order.id)).total_minor));

      const claimed = await order([p1, p2], 'MANUAL_TRANSFER');
      await world.api('post', `/payments/manual-transfer/orders/${claimed.order.id}/claim`, { token: claimed.customer.accessToken, body: {} });
      expectData(await cancelSegment(v2, await segmentOf(claimed.order.id, v2)));
      expect(await refundEvents(claimed.order.id)).toEqual([]);
      expect((await paymentOf(claimed.order.id)).pending_refund_status).toBe('PENDING');
    });

    it('the refund can never be steered by the client: the vendor endpoint takes only the status, and unknown fields are rejected', async () => {
      const { customer, order: o } = await order([p1, p2], 'MANUAL_TRANSFER');
      await payTransfer(customer, o.id);
      const res = await world.api('patch', `/vendor/orders/segments/${await segmentOf(o.id, v2)}/status`, {
        token: v2.manager.accessToken,
        body: { status: 'CANCELLED', refundAmountMinor: 1, totalMinor: 1, deliveryFeeMinor: 0 },
      });
      expect(res.status).toBe(400);
      expect(await refundEvents(o.id)).toEqual([]);
      expect(num((await orderRow(o.id)).total_minor)).toBe(o.totalMinor);
    });
  });

  describe('authorization', () => {
    it('vendor A cannot cancel vendor B\'s segment — nothing changes', async () => {
      const { order: o } = await order([p1, p2]);
      const before = await orderRow(o.id);
      const res = await cancelSegment(v1, await segmentOf(o.id, v2));
      expect([403, 404]).toContain(res.status);
      expect((await world.ds.query('SELECT status FROM order_vendor_segments WHERE id = $1', [await segmentOf(o.id, v2)]))[0].status).toBe('PENDING');
      expect(await orderRow(o.id)).toMatchObject({ total_minor: before.total_minor, delivery_fee_minor: before.delivery_fee_minor });
      expect(await refundEvents(o.id)).toEqual([]);
    });

    it('a vendor can never cancel the WHOLE multi-vendor order (403 VENDOR_MAY_ONLY_CANCEL_OWN_SEGMENT), even though it owns a segment of it', async () => {
      const { order: o } = await order([p1, p2]);
      const res = await world.api('patch', `/orders/${o.id}/status`, { token: v1.manager.accessToken, body: { status: 'CANCELLED', cancellationReason: 'everything' } });
      expect(res.status).toBe(403);
      expect(res.body.error.details.code).toBe('VENDOR_MAY_ONLY_CANCEL_OWN_SEGMENT');
      expect((await orderRow(o.id)).status).toBe('PENDING');
    });

    it('…but once the other vendors have cancelled, the last vendor standing may cancel the order (it is its own last segment); an admin may always cancel the whole order', async () => {
      const a = await order([p1, p2]);
      expectData(await cancelSegment(v2, await segmentOf(a.order.id, v2)));
      expectData(await world.api('patch', `/orders/${a.order.id}/status`, { token: v1.manager.accessToken, body: { status: 'CANCELLED', cancellationReason: 'last one' } }));
      expect(await orderRow(a.order.id)).toMatchObject({ status: 'CANCELLED', delivery_fee_minor: 0, total_minor: 0 });

      const b = await order([p1, p2]);
      expectData(await world.api('patch', `/orders/${b.order.id}/status`, { token: superAdmin.accessToken, body: { status: 'CANCELLED', cancellationReason: 'admin' } }));
      expect((await orderRow(b.order.id)).status).toBe('CANCELLED');
    });

    it('a vendor with no segment in the order cannot touch it at all', async () => {
      const { order: o } = await order([p1, p2]);
      expect((await world.api('patch', `/orders/${o.id}/status`, { token: v3.manager.accessToken, body: { status: 'CANCELLED', cancellationReason: 'x' } })).status).toBe(404);
      expect((await cancelSegment(v3, await segmentOf(o.id, v2))).status).toBeGreaterThanOrEqual(400);
    });

    it('a customer cannot cancel a segment or the order through the vendor/order endpoints', async () => {
      const { customer, order: o } = await order([p1, p2]);
      expect((await world.api('patch', `/vendor/orders/segments/${await segmentOf(o.id, v2)}/status`, { token: customer.accessToken, body: { status: 'CANCELLED' } })).status).toBe(403);
      expect((await world.api('patch', `/orders/${o.id}/status`, { token: customer.accessToken, body: { status: 'CANCELLED' } })).status).toBe(400);
      expect((await orderRow(o.id)).status).toBe('PENDING');
    });
  });

  describe('idempotency and concurrency', () => {
    it('repeating the same cancellation is refused and changes nothing: no second refund, no second fee reduction, stock restored once', async () => {
      const t1 = await s.product(v1, { priceMinor: 10000, inventoryMode: 'TRACKED', quantity: 10 });
      const t2 = await s.product(v2, { priceMinor: 20000, inventoryMode: 'TRACKED', quantity: 10 });
      const { customer, order: o } = await order([t1, t2], 'MANUAL_TRANSFER', [1, 3]);
      await payTransfer(customer, o.id);
      const segment = await segmentOf(o.id, v2);

      expectData(await cancelSegment(v2, segment));
      const afterFirst = await orderRow(o.id);
      const refundsFirst = await refundEvents(o.id);
      expect(await stock(t2.id)).toBe(10);

      const again = await cancelSegment(v2, segment);
      expect(again.status).toBe(400);
      expect(await orderRow(o.id)).toMatchObject({ total_minor: afterFirst.total_minor, delivery_fee_minor: afterFirst.delivery_fee_minor, subtotal_minor: afterFirst.subtotal_minor });
      expect(await refundEvents(o.id)).toEqual(refundsFirst);
      expect(await stock(t2.id)).toBe(10);
      expect(await stock(t1.id)).toBe(9); // the other vendor's unit is untouched
    });

    it('the same cancellation sent five times at once: exactly one wins, one refund, one fee reduction, stock restored once', async () => {
      const t2 = await s.product(v2, { priceMinor: 20000, inventoryMode: 'TRACKED', quantity: 10 });
      const { customer, order: o } = await order([p1, t2], 'MANUAL_TRANSFER', [1, 2]);
      await payTransfer(customer, o.id);
      const before = await orderRow(o.id);
      const segment = await segmentOf(o.id, v2);

      const results = await Promise.all(Array.from({ length: 5 }, () => cancelSegment(v2, segment)));
      expect(results.filter((r) => r.status < 300)).toHaveLength(1);
      expect(results.filter((r) => r.status >= 500)).toHaveLength(0);
      expect(await refundEvents(o.id)).toHaveLength(1);
      expect(num((await orderRow(o.id)).delivery_fee_minor)).toBe(num(before.delivery_fee_minor) - ADDITIONAL_VENDOR_FEE);
      expect(await stock(t2.id)).toBe(10);
    });

    it('two vendors cancelling their segments at the same time: both apply, the order ends cancelled, and the paid amount is refunded exactly once in total', async () => {
      const { customer, order: o } = await order([p1, p2], 'MANUAL_TRANSFER');
      await payTransfer(customer, o.id);
      const paid = num((await paymentOf(o.id)).amount_minor);
      const [a, b] = await Promise.all([cancelSegment(v1, await segmentOf(o.id, v1)), cancelSegment(v2, await segmentOf(o.id, v2))]);
      expect(a.status).toBeLessThan(300);
      expect(b.status).toBeLessThan(300);
      const row = await orderRow(o.id);
      expect(row.status).toBe('CANCELLED');
      expect(num(row.delivery_fee_minor)).toBe(0);
      expect(await refundedTotal(o.id)).toBe(paid);
      expect(world.unhandledServerErrors()).toEqual([]);
    });
  });

  describe('inventory and flash-sale allocation', () => {
    it('only the cancelled vendor\'s stock and flash-sale allocation come back; the other vendor\'s stay consumed; the order discount drops accordingly', async () => {
      const t1 = await s.product(v1, { priceMinor: 10000, inventoryMode: 'TRACKED', quantity: 10 });
      const t2 = await s.product(v2, { priceMinor: 20000, inventoryMode: 'TRACKED', quantity: 10 });
      const offer1 = expectData(await world.api('post', '/admin/offers', { token: superAdmin.accessToken, body: { vendorBranchId: v1.branchId, name: 'F1', mechanism: 'FLASH_SALE', specialPriceMinor: 8000, productIds: [t1.id], ...window() } }), 201);
      const offer2 = expectData(await world.api('post', '/admin/offers', { token: superAdmin.accessToken, body: { vendorBranchId: v2.branchId, name: 'F2', mechanism: 'FLASH_SALE', specialPriceMinor: 15000, productIds: [t2.id], ...window() } }), 201);
      const consumed = async (id: string) => num((await world.ds.query('SELECT consumed_units_count FROM offers WHERE id = $1', [id]))[0].consumed_units_count);

      const { order: o } = await order([t1, t2], 'COD', [1, 2]);
      const before = await orderRow(o.id);
      expect(num(before.discount_minor)).toBe(2000 + 2 * 5000); // v1: 1×(10000−8000), v2: 2×(20000−15000)
      expect([await stock(t1.id), await stock(t2.id)]).toEqual([9, 8]);
      expect([await consumed(offer1.id), await consumed(offer2.id)]).toEqual([1, 2]);

      expectData(await cancelSegment(v2, await segmentOf(o.id, v2)));

      expect([await stock(t1.id), await stock(t2.id)]).toEqual([9, 10]);
      expect([await consumed(offer1.id), await consumed(offer2.id)]).toEqual([1, 0]);
      const reversed = await world.ds.query('SELECT offer_id, is_reversed FROM offer_consumptions WHERE order_id = $1 ORDER BY offer_id', [o.id]);
      expect(reversed.find((r: any) => r.offer_id === offer2.id).is_reversed).toBe(true);
      expect(reversed.find((r: any) => r.offer_id === offer1.id).is_reversed).toBe(false);

      const after = await orderRow(o.id);
      expect(num(after.discount_minor)).toBe(2000); // only v1's discount remains
      expect(num(after.subtotal_minor)).toBe(10000);
      expect(num(after.total_minor)).toBe(10000 + num(after.delivery_fee_minor) - 2000);
      expectConsistent(after);

      // cancelling the last vendor afterwards restores the rest exactly once, and returns the remaining allocation
      expectData(await cancelSegment(v1, await segmentOf(o.id, v1)));
      expect([await stock(t1.id), await stock(t2.id)]).toEqual([10, 10]);
      expect([await consumed(offer1.id), await consumed(offer2.id)]).toEqual([0, 0]);
    });
  });
});

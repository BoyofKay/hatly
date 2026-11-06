/**
 * PD-001 (amended) — Wallet is an independent payment source that may be combined with COD, PAY_AT_DELIVERY and MANUAL_TRANSFER.
 * Wallet + MANUAL_TRANSFER end to end over real HTTP against real PostgreSQL:
 *   - the Payment row holds ONLY the remainder; the wallet part needs no approval; approval unlocks fulfilment;
 *   - refund waterfall: EXTERNAL (transfer) FIRST → WALLET SECOND, never more than was actually paid, never twice;
 *   - pending transfers (cancel before approval → approve / reject), failed delivery and concurrent cancellation.
 *
 * Invariant checked everywhere:   wallet kept + transfer kept  ==  what the order still owes   (net payment == owed).
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, DriverFixture, VendorFixture, expectData, withQuoteToken } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';
import { DriverFailedDeliveryReason } from '../../src/modules/delivery/driver-failed-delivery-reason.enum';

describe('E2E — wallet + Manual Transfer (PD-001 amended)', () => {
  let world: World;
  let s: Scenario;
  let area: { id: string; lat: number; lng: number };
  let superAdmin: Actor;
  let reviewer: Actor;
  let issuesAdmin: Actor;
  let v1: VendorFixture;
  let v2: VendorFixture;
  let p1: { id: string };
  let p2: { id: string };
  let driver: DriverFixture;
  const home = { lat: 30.425, lng: 31.565 };

  const num = (v: unknown) => Number(v);
  const q = (sql: string, params: unknown[] = []) => world.ds.query(sql, params);
  const addr = () => ({ line1: 'Wallet Transfer Street 1', latitude: home.lat, longitude: home.lng });
  const place = async (c: Actor, body: Record<string, unknown>) => world.api('post', '/orders', { token: c.accessToken, body: await withQuoteToken(world, c.accessToken, { deliveryAddress: addr(), ...body }) });
  const wt = (c: Actor, walletCapMinor: number | undefined, extra: Record<string, unknown> = {}) =>
    place(c, { paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: 'INSTAPAY', useWallet: true, ...(walletCapMinor ? { walletAmountMinor: walletCapMinor } : {}), ...extra });
  const orderRow = async (id: string) => (await q('SELECT * FROM orders WHERE id = $1', [id]))[0];
  const paymentOf = async (orderId: string) => (await q('SELECT * FROM payments WHERE order_id = $1', [orderId]))[0];
  const transferRefunds = async (orderId: string): Promise<Array<{ amount: number; key: string }>> => (await q("SELECT amount_minor, idempotency_key FROM financial_events WHERE order_id = $1 AND type = 'MANUAL_TRANSFER_REFUND_RECORDED' ORDER BY created_at", [orderId])).map((r: any) => ({ amount: num(r.amount_minor), key: r.idempotency_key as string }));
  const transferRefunded = async (orderId: string) => (await transferRefunds(orderId)).reduce((sum, r) => sum + r.amount, 0);
  const walletRefunds = async (orderId: string): Promise<Array<{ amount: number; key: string }>> => (await q("SELECT amount_delta_minor, idempotency_key FROM wallet_transactions WHERE order_id = $1 AND type = 'ORDER_REFUND' ORDER BY created_at", [orderId])).map((r: any) => ({ amount: num(r.amount_delta_minor), key: r.idempotency_key as string }));
  const walletRefunded = async (orderId: string) => (await walletRefunds(orderId)).reduce((sum, r) => sum + r.amount, 0);
  const balance = async (c: Actor) => num((await q('SELECT COALESCE(SUM(amount_delta_minor), 0) AS b FROM wallet_transactions WHERE customer_id = $1', [c.id]))[0].b);
  let seed = 0;
  const credit = (c: Actor, amountMinor: number) =>
    q("INSERT INTO wallet_transactions (customer_id, amount_delta_minor, type, idempotency_key, reason) VALUES ($1, $2, 'ADMIN_CREDIT', $3, 'e2e seed')", [c.id, amountMinor, `e2e-wtm-${c.id}-${seed++}`]);
  const segmentOf = async (orderId: string, v: VendorFixture): Promise<string> => (await q('SELECT id FROM order_vendor_segments WHERE order_id = $1 AND vendor_branch_id = $2', [orderId, v.branchId]))[0].id;
  const vendorStatus = (v: VendorFixture, segmentId: string, status: string) => world.api('patch', `/vendor/orders/segments/${segmentId}/status`, { token: v.manager.accessToken, body: { status, ...(status === 'CANCELLED' ? { reason: 'Out of stock' } : {}) } });
  // R2: until Operations verify an InstaPay / Vodafone Cash payment the vendor cannot see the order; Operations act on its behalf.
  let opsToken = '';
  const opsStatus = (segmentId: string, status: string) => world.api('patch', `/admin/orders/segments/${segmentId}/status`, { token: opsToken, body: { status, ...(status === 'CANCELLED' ? { reason: 'Out of stock' } : {}) } });
  const cancelCustomer = (c: Actor, id: string) => world.api('post', `/orders/${id}/cancel`, { token: c.accessToken, body: {} });
  const claim = (c: Actor, orderId: string) => world.api('post', `/payments/manual-transfer/orders/${orderId}/claim`, { token: c.accessToken, body: {} });
  const approve = (paymentId: string) => world.api('post', `/admin/manual-transfer-payments/${paymentId}/approve`, { token: reviewer.accessToken });
  const reject = (paymentId: string) => world.api('post', `/admin/manual-transfer-payments/${paymentId}/reject`, { token: reviewer.accessToken, body: { reason: 'no money received' } });
  const cartFor = async (products: Array<{ id: string }>) => {
    const c = await s.customer();
    for (const p of products) await s.addToCart(c, p.id, 1);
    return c;
  };
  /** wallet + transfer order: wallet paid `walletCap`, the transfer the rest; balance seeded generously. */
  const walletTransferOrder = async (products: Array<{ id: string }>, walletCap: number, opts: { approved?: boolean; claimed?: boolean } = {}) => {
    const c = await cartFor(products);
    await credit(c, 500000);
    const order = expectData<any>(await wt(c, walletCap), 201);
    const payment = await paymentOf(order.id);
    if (opts.claimed || opts.approved) await claim(c, order.id);
    if (opts.approved) expectData(await approve(payment.id), 201);
    return { c, order, payment };
  };
  /** what the customer effectively still paid after refunds, per component */
  const kept = async (order: any) => {
    const row = await orderRow(order.id);
    const pay = await paymentOf(order.id);
    const walletKept = num(row.wallet_amount_minor) - (await walletRefunded(order.id));
    const transferKept = pay && pay.status === 'PAID' ? num(pay.amount_minor) - (await transferRefunded(order.id)) : 0;
    return { row, walletKept, transferKept, total: num(row.total_minor) };
  };

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    area = await s.serviceArea({ radiusMeters: 50000 });
    superAdmin = await s.superAdmin();
    reviewer = await s.admin([Permission.VERIFY_MANUAL_PAYMENTS]);
    opsToken = (await s.superAdmin()).accessToken;
    issuesAdmin = await s.admin([Permission.MANAGE_ORDER_ISSUES, Permission.VERIFY_MANUAL_PAYMENTS]);
    v1 = await s.vendor({ name: 'WTM 1', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    v2 = await s.vendor({ name: 'WTM 2', serviceAreaId: area.id, lat: 30.431, lng: 31.571 });
    p1 = await s.product(v1, { priceMinor: 10000, inventoryMode: 'OPEN' });
    p2 = await s.product(v2, { priceMinor: 20000, inventoryMode: 'OPEN' });
    await s.setConfig('MANUAL_TRANSFER_DESTINATION', { label: 'Hatly', phoneOrAccountNumber: '01000000000' });
    await s.setConfig('CUSTOMER_SERVICE_WHATSAPP_NUMBER', '+201000000000');
    driver = await s.driver({ lat: 30.4212, lng: 31.5612 });
  });
  beforeEach(async () => {
    await q('UPDATE drivers SET is_online = true, is_available = true');
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('A/B — creation', () => {
    it('wallet + MANUAL_TRANSFER is ACCEPTED: the wallet is debited once, the Payment row holds ONLY the remainder, and it awaits approval', async () => {
      const c = await cartFor([p1]);
      await credit(c, 50000);
      const quote = expectData<any>(await world.api('post', '/checkout/quote', { token: c.accessToken, body: { deliveryAddress: addr(), paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: 'INSTAPAY', useWallet: true, walletAmountMinor: 3000 } }), 201);
      expect(quote.blockers).toEqual([]);
      expect(quote.payment).toMatchObject({ awaitsPaymentApproval: true, selected: { method: 'MANUAL_TRANSFER', electronicMethod: 'INSTAPAY' } });
      expect(quote.payment.wallet.appliedMinor).toBe(3000);
      expect(quote.summary.amountDueMinor).toBe(quote.summary.totalMinor - 3000);

      const order = expectData<any>(await wt(c, 3000), 201);
      const row = await orderRow(order.id);
      const payment = await paymentOf(order.id);
      expect(row.payment_method).toBe('MANUAL_TRANSFER');
      expect(num(row.wallet_amount_minor)).toBe(3000);
      expect(num(row.amount_due_minor)).toBe(num(row.total_minor) - 3000);
      expect(num(payment.amount_minor)).toBe(num(row.total_minor) - 3000); // NEVER the full total
      expect(payment.amount_minor).not.toBe(row.total_minor);
      expect(payment.status).toBe('PENDING');
      expect(payment.electronic_method).toBe('INSTAPAY');
      expect(await balance(c)).toBe(47000);
      expect((await q("SELECT amount_delta_minor FROM wallet_transactions WHERE order_id = $1 AND type = 'ORDER_PAYMENT'", [order.id])).map((r: any) => num(r.amount_delta_minor))).toEqual([-3000]);
      expect(quote.summary.totalMinor).toBe(num(row.total_minor));
    });

    it('the client can only LOWER the wallet amount: asking for far more than balance/total is capped by the server, and the transfer is what is left', async () => {
      const c = await cartFor([p1]);
      await credit(c, 4000);
      const order = expectData<any>(await wt(c, 999999999), 201);
      const row = await orderRow(order.id);
      expect(num(row.wallet_amount_minor)).toBe(4000);
      expect(num((await paymentOf(order.id)).amount_minor)).toBe(num(row.total_minor) - 4000);
      expect(await balance(c)).toBe(0);
    });

    it('FULL wallet: no external Payment row, nothing pending, immediately fulfillable', async () => {
      const c = await cartFor([p1]);
      await credit(c, 500000);
      const order = expectData<any>(await place(c, { paymentMethod: 'WALLET' }), 201);
      expect(await paymentOf(order.id)).toBeUndefined();
      expect(num((await orderRow(order.id)).amount_due_minor)).toBe(0);
      const seg = await segmentOf(order.id, v1);
      for (const st of ['CONFIRMED', 'PREPARING']) expectData(await vendorStatus(v1, seg, st));
    });

    it('the wallet is still refused where its amount is unknown: an unpriced (ad-hoc) order or one with a weighed item', async () => {
      const cheese = await s.product(v1, { priceMinor: 20000, pricingUnit: 'WEIGHT', inventoryMode: 'OPEN' });
      const w = await s.customer();
      await s.addToCart(w, cheese.id, 1, { requestedWeightGrams: 500 });
      await credit(w, 50000);
      const weighed = await place(w, { paymentMethod: 'COD', useWallet: true });
      expect(weighed.body.error.details.code).toBe('WALLET_NOT_ALLOWED_FOR_WEIGHTED_ORDER');
    });
  });

  describe('K — payment gating (the wallet part needs no approval; the transfer remainder does)', () => {
    it('pending transfer blocks PREPARING/dispatch; approval unlocks ONLY that remainder-payment gate — the order was never paid twice', async () => {
      const { c, order, payment } = await walletTransferOrder([p1], 3000);
      const seg = await segmentOf(order.id, v1);
      expect((await vendorStatus(v1, seg, 'CONFIRMED')).status).toBe(404); // R2: the vendor cannot see or act on it yet
      const vendorList = async () => expectData<any[]>(await world.api('get', '/vendor/orders', { token: v1.manager.accessToken })).map((o) => o.id);
      expect(await vendorList()).not.toContain(order.id);
      expect((await world.api('get', `/vendor/orders/${order.id}`, { token: v1.manager.accessToken })).status).toBe(404);
      const unseen = await q(`SELECT count(*)::int AS n FROM staff_notifications WHERE order_id = $1 AND category = 'VENDOR_NEW_ORDER'`, [order.id]);
      expect(unseen[0].n).toBe(0); // and is not told about it
      expectData(await opsStatus(seg, 'CONFIRMED'));
      const blocked = await opsStatus(seg, 'PREPARING');
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.details).toMatchObject({ code: 'PAYMENT_NOT_APPROVED', paymentStatus: 'PENDING' });
      await claim(c, order.id);
      expect((await opsStatus(seg, 'PREPARING')).status).toBe(409); // under review still blocks

      const before = num(payment.amount_minor);
      expectData(await approve(payment.id), 201);
      const after = await paymentOf(order.id);
      expect(after.status).toBe('PAID');
      expect(num(after.amount_minor)).toBe(before); // approval unlocks exactly what the payment is: the remainder
      expect(num(after.amount_minor)).toBe(num((await orderRow(order.id)).total_minor) - 3000);
      expectData(await vendorStatus(v1, seg, 'PREPARING'));
      expect(await vendorList()).toContain(order.id); // visible from the verification on
      expect(await transferRefunded(order.id)).toBe(0); // approving refunds nothing
    });

    it('a REJECTED transfer keeps blocking even though the wallet part was paid', async () => {
      const { c, order, payment } = await walletTransferOrder([p1], 3000, { claimed: true });
      expectData(await reject(payment.id), 201);
      const seg = await segmentOf(order.id, v1);
      expect((await vendorStatus(v1, seg, 'CONFIRMED')).status).toBe(404); // R2: still hidden from the vendor
      expectData(await opsStatus(seg, 'CONFIRMED'));
      expect((await opsStatus(seg, 'PREPARING')).body.error.details.code).toBe('PAYMENT_NOT_APPROVED');
      expect(c).toBeDefined();
    });
  });

  describe('C/D — vendor segment cancellation: EXTERNAL FIRST → WALLET SECOND', () => {
    it('C: wallet 30, transfer PAID, one vendor cancels → the reduction comes back through the TRANSFER; the wallet keeps its 30; net payment == owed', async () => {
      const { c, order } = await walletTransferOrder([p1, p2], 3000, { approved: true });
      const total = num(order.totalMinor);
      const removed = 20000 + 500; // vendor 2's goods + one additional-vendor fee
      expectData(await vendorStatus(v2, await segmentOf(order.id, v2), 'CANCELLED'));

      expect(await transferRefunded(order.id)).toBe(removed);
      expect(await walletRefunded(order.id)).toBe(0);
      expect(await balance(c)).toBe(500000 - 3000);
      const k = await kept(order);
      expect(k.total).toBe(total - removed);
      expect(k.walletKept + k.transferKept).toBe(k.total); // the customer's net payment is exactly what is owed
      expect(num(k.row.amount_due_minor)).toBe(k.total - 3000);
    });

    it('D: a large wallet share + a small transfer → the WHOLE transfer is refunded first, then only the excess to the wallet; net payment == owed', async () => {
      // wallet pays everything except a small remainder (1000) of the transfer
      const c = await cartFor([p1, p2]);
      await credit(c, 500000);
      const quoted = expectData<any>(await world.api('post', '/checkout/quote', { token: c.accessToken, body: { deliveryAddress: addr() } }), 201);
      const wallet = quoted.summary.totalMinor - 1000;
      const order = expectData<any>(await wt(c, wallet), 201);
      const payment = await paymentOf(order.id);
      await claim(c, order.id);
      expectData(await approve(payment.id), 201);
      const E = num(payment.amount_minor);
      expect(E).toBe(1000);
      const removed = 20500;
      expectData(await vendorStatus(v2, await segmentOf(order.id, v2), 'CANCELLED'));

      expect(await transferRefunded(order.id)).toBe(E); // transfer exhausted first
      const owed = num(order.totalMinor) - removed;
      expect(await walletRefunded(order.id)).toBe(wallet - owed); // then the wallet, only the excess
      expect(await transferRefunded(order.id) + (await walletRefunded(order.id))).toBe(removed);
      expect(await balance(c)).toBe(500000 - owed);
      const k = await kept(order);
      expect(k.walletKept + k.transferKept).toBe(k.total);
    });

    it('a second cancellation is cumulative (never refunds the same money twice) and every component stays within what was paid', async () => {
      const { order, payment } = await walletTransferOrder([p1, p2], 3000, { approved: true });
      const E = num(payment.amount_minor);
      expectData(await vendorStatus(v2, await segmentOf(order.id, v2), 'CANCELLED'));
      expectData(await vendorStatus(v1, await segmentOf(order.id, v1), 'CANCELLED')); // nothing owed any more
      expect(await transferRefunded(order.id)).toBe(E);
      expect(await walletRefunded(order.id)).toBe(3000);
      const k = await kept(order);
      expect([k.walletKept, k.transferKept, k.total]).toEqual([0, 0, 0]);
      const keys = [...(await transferRefunds(order.id)), ...(await walletRefunds(order.id))].map((r) => r.key);
      expect(new Set(keys).size).toBe(keys.length);
    });
  });

  describe('E/F/G/H — whole-order cancellation and the pending entitlement', () => {
    it('E: cancelled after the transfer is PAID → the transfer is refunded in full through the existing mechanism, the wallet part to the wallet; repeating changes nothing', async () => {
      const { c, order, payment } = await walletTransferOrder([p1], 3000, { approved: true });
      expectData(await cancelCustomer(c, order.id), 201);
      expect(await transferRefunded(order.id)).toBe(num(payment.amount_minor));
      expect((await transferRefunds(order.id))[0].key).toBe(`manual-transfer-refund:${payment.id}`);
      expect((await walletRefunds(order.id)).map((r) => r.amount)).toEqual([3000]);
      expect(await balance(c)).toBe(500000);
      expect((await cancelCustomer(c, order.id)).status).toBe(400); // already cancelled: no second refund
      expect(await transferRefunded(order.id)).toBe(num(payment.amount_minor));
      expect(await walletRefunded(order.id)).toBe(3000);
    });

    it('F: cancelled while the transfer is PENDING → the wallet part returns now; the transfer becomes a pending entitlement of exactly the transfer (no event yet)', async () => {
      const { c, order, payment } = await walletTransferOrder([p1], 3000, { claimed: true });
      expectData(await cancelCustomer(c, order.id), 201);
      expect(await transferRefunds(order.id)).toEqual([]);
      expect(await walletRefunded(order.id)).toBe(3000);
      const pay = await paymentOf(order.id);
      expect(num(pay.pending_refund_minor)).toBe(num(payment.amount_minor)); // never more than the transfer
      expect(pay.pending_refund_status).toBe('PENDING');
    });

    it('G: … and when the transfer is approved LATER it converts into exactly ONE refund of the transfer; approving again is a no-op', async () => {
      const { c, order, payment } = await walletTransferOrder([p1], 3000, { claimed: true });
      expectData(await cancelCustomer(c, order.id), 201);
      expectData(await approve(payment.id), 201);
      const refunds = await transferRefunds(order.id);
      expect(refunds).toEqual([{ amount: num(payment.amount_minor), key: `manual-transfer-refund:${payment.id}:pending-conversion` }]);
      expect((await paymentOf(order.id)).pending_refund_status).toBe('CONVERTED');
      expect((await approve(payment.id)).status).toBeGreaterThanOrEqual(400); // terminal: cannot be approved twice
      expect(await transferRefunded(order.id)).toBe(num(payment.amount_minor));
    });

    it('H: … and when it is REJECTED, no transfer refund is ever produced (Hatly never received it); the wallet part was already returned', async () => {
      const { c, order, payment } = await walletTransferOrder([p1], 3000, { claimed: true });
      expectData(await cancelCustomer(c, order.id), 201);
      expectData(await reject(payment.id), 201);
      expect(await transferRefunds(order.id)).toEqual([]);
      expect((await paymentOf(order.id)).pending_refund_status).toBe('VOIDED');
      expect(await walletRefunded(order.id)).toBe(3000);
    });

    it('a partial cancellation while UNVERIFIED: the entitlement is net of the wallet share (owed − wallet), and approval later refunds exactly that once; net == owed', async () => {
      const { c, order, payment } = await walletTransferOrder([p1, p2], 3000, { claimed: true });
      const removed = 20500;
      // R2: before verification only Operations (on the vendor's behalf) can cancel a vendor part.
      expect((await vendorStatus(v2, await segmentOf(order.id, v2), 'CANCELLED')).status).toBe(404);
      expectData(await opsStatus(await segmentOf(order.id, v2), 'CANCELLED'));
      const pending = await paymentOf(order.id);
      expect(num(pending.pending_refund_minor)).toBe(removed); // NOT (transfer − whole total)
      expect(await transferRefunds(order.id)).toEqual([]);
      expect(await walletRefunded(order.id)).toBe(0);

      expectData(await approve(payment.id), 201);
      expect(await transferRefunded(order.id)).toBe(removed);
      const k = await kept(order);
      expect(k.walletKept + k.transferKept).toBe(k.total);
      expect(c).toBeDefined();
    });
  });

  describe('I — failed delivery: each PAID component, external first, never more than was paid', () => {
    const resolveRefund = (orderId: string, amount: number) => world.api('post', `/admin/orders/${orderId}/failed-delivery-resolution`, { token: issuesAdmin.accessToken, body: { outcome: 'REFUND_CUSTOMER', refundAmountMinor: amount } });
    const executeRefund = (orderId: string) => world.api('post', `/admin/orders/${orderId}/failed-delivery-refund`, { token: issuesAdmin.accessToken });
    const deliveryOf = async (orderId: string) => expectData<any[]>(await world.api('get', '/driver/deliveries', { token: driver.accessToken })).find((d) => d.orderId === orderId);
    const step = (deliveryId: string, status: string, extra: Record<string, unknown> = {}) => world.api('patch', `/driver/deliveries/${deliveryId}/status`, { token: driver.accessToken, body: { status, ...extra } });
    /** drives a placed order (transfer already approved where relevant) to FAILED_DELIVERY */
    const fail = async (orderId: string) => {
      await s.vendorPrepares(v1, orderId);
      const delivery = await deliveryOf(orderId);
      for (const st of ['PICKED_UP', 'ON_THE_WAY']) expectData(await step(delivery.id, st));
      expectData(await step(delivery.id, 'FAILED_DELIVERY', { failureReason: DriverFailedDeliveryReason.CUSTOMER_UNREACHABLE }));
    };

    it('FULL WALLET: the wallet is refunded, no transfer exists; replay is ALREADY_REFUNDED; more than paid is refused', async () => {
      const c = await cartFor([p1]);
      await credit(c, 500000);
      const order = expectData<any>(await place(c, { paymentMethod: 'WALLET' }), 201);
      await fail(order.id);
      const total = num(order.totalMinor);
      expectData(await resolveRefund(order.id, total + 1), 201);
      expect((await executeRefund(order.id)).body.error.details.code).toBe('REFUND_EXCEEDS_PAYMENT_AMOUNT');
      expect(await walletRefunded(order.id)).toBe(0);
    });

    it('FULL WALLET refund executes once: the ledger credit equals what the wallet paid; the second call moves nothing', async () => {
      const c = await cartFor([p1]);
      await credit(c, 500000);
      const order = expectData<any>(await place(c, { paymentMethod: 'WALLET' }), 201);
      await fail(order.id);
      const total = num(order.totalMinor);
      expectData(await resolveRefund(order.id, total), 201);
      const first = expectData<any>(await executeRefund(order.id), 201);
      expect(first).toMatchObject({ status: 'REFUNDED', paymentId: null, transferRefundedMinor: 0, walletRefundedMinor: total });
      expect(expectData<any>(await executeRefund(order.id), 201).status).toBe('ALREADY_REFUNDED');
      expect(await walletRefunded(order.id)).toBe(total);
      expect(await balance(c)).toBe(500000);
    });

    it.each([
      ['COD', {}],
      ['PAY_AT_DELIVERY', { electronicPaymentMethod: 'VODAFONE_CASH' }],
    ])('WALLET + %s: only the wallet-paid part (never the unpaid cash) is refundable', async (method, extra) => {
      const c = await cartFor([p1]);
      await credit(c, 500000);
      const order = expectData<any>(await place(c, { paymentMethod: method, useWallet: true, walletAmountMinor: 3000, ...extra }), 201);
      await fail(order.id);
      expectData(await resolveRefund(order.id, 3001), 201);
      expect((await executeRefund(order.id)).body.error.details.code).toBe('REFUND_EXCEEDS_PAYMENT_AMOUNT');
      expect(await walletRefunded(order.id)).toBe(0);
    });

    it.each([['COD', {}], ['PAY_AT_DELIVERY', { electronicPaymentMethod: 'VODAFONE_CASH' }]])('WALLET + %s: refunding exactly the wallet part credits the wallet once', async (method, extra) => {
      const c = await cartFor([p1]);
      await credit(c, 500000);
      const order = expectData<any>(await place(c, { paymentMethod: method, useWallet: true, walletAmountMinor: 3000, ...extra }), 201);
      await fail(order.id);
      expectData(await resolveRefund(order.id, 3000), 201);
      expect(expectData<any>(await executeRefund(order.id), 201)).toMatchObject({ transferRefundedMinor: 0, walletRefundedMinor: 3000 });
      expect(await balance(c)).toBe(500000);
      expect(await transferRefunds(order.id)).toEqual([]);
    });

    it('WALLET + PAID TRANSFER: refunding the full paid amount returns the transfer FIRST and the wallet SECOND; replay/over-refund are safe', async () => {
      const { c, order, payment } = await walletTransferOrder([p1], 3000, { approved: true });
      await fail(order.id);
      const E = num(payment.amount_minor);
      expectData(await resolveRefund(order.id, E + 3000), 201);
      const r = expectData<any>(await executeRefund(order.id), 201);
      expect(r).toMatchObject({ status: 'REFUNDED', transferRefundedMinor: E, walletRefundedMinor: 3000 });
      expect(await transferRefunded(order.id)).toBe(E);
      expect(await walletRefunded(order.id)).toBe(3000);
      expect(expectData<any>(await executeRefund(order.id), 201).status).toBe('ALREADY_REFUNDED');
      expect(await transferRefunded(order.id)).toBe(E);
      expect(await walletRefunded(order.id)).toBe(3000);
      expect(await balance(c)).toBe(500000);
    });

    it('WALLET + PAID TRANSFER: a refund smaller than the transfer never touches the wallet; more than paid is refused', async () => {
      const { order, payment } = await walletTransferOrder([p1], 3000, { approved: true });
      await fail(order.id);
      const E = num(payment.amount_minor);
      expectData(await resolveRefund(order.id, E - 1), 201);
      expect(expectData<any>(await executeRefund(order.id), 201)).toMatchObject({ transferRefundedMinor: E - 1, walletRefundedMinor: 0 });
      expect(await walletRefunded(order.id)).toBe(0);

      const other = await walletTransferOrder([p1], 3000, { approved: true });
      await fail(other.order.id);
      expectData(await resolveRefund(other.order.id, num(other.payment.amount_minor) + 3001), 201);
      expect((await executeRefund(other.order.id)).body.error.details.code).toBe('REFUND_EXCEEDS_PAYMENT_AMOUNT');
      expect(await transferRefunded(other.order.id)).toBe(0);
      expect(await walletRefunded(other.order.id)).toBe(0);
    });
  });

  describe('J — concurrency: neither component can be refunded twice', () => {
    it('customer cancel racing a vendor segment cancel on a PAID wallet + transfer order: exactly what was paid comes back, once', async () => {
      for (let i = 0; i < 3; i++) {
        const { c, order, payment } = await walletTransferOrder([p1], 3000, { approved: true });
        const seg = await segmentOf(order.id, v1);
        await Promise.all([cancelCustomer(c, order.id), vendorStatus(v1, seg, 'CANCELLED')]);
        expect(await transferRefunded(order.id)).toBe(num(payment.amount_minor));
        expect(await walletRefunded(order.id)).toBe(3000);
        const keys = [...(await transferRefunds(order.id)), ...(await walletRefunds(order.id))].map((r) => r.key);
        expect(new Set(keys).size).toBe(keys.length);
        expect(await balance(c)).toBe(500000);
      }
    });

    it('two simultaneous cancellations of a PENDING wallet + transfer order: one wallet credit, one entitlement', async () => {
      const { c, order, payment } = await walletTransferOrder([p1], 3000, { claimed: true });
      await Promise.all([cancelCustomer(c, order.id), cancelCustomer(c, order.id)]);
      expect(await walletRefunded(order.id)).toBe(3000);
      expect(num((await paymentOf(order.id)).pending_refund_minor)).toBe(num(payment.amount_minor));
    });

    it('two simultaneous failed-delivery refund executions: the transfer and the wallet are each refunded exactly once', async () => {
      const resolve = (orderId: string, amount: number) => world.api('post', `/admin/orders/${orderId}/failed-delivery-resolution`, { token: issuesAdmin.accessToken, body: { outcome: 'REFUND_CUSTOMER', refundAmountMinor: amount } });
      const exec = (orderId: string) => world.api('post', `/admin/orders/${orderId}/failed-delivery-refund`, { token: issuesAdmin.accessToken });
      const { c, order, payment } = await walletTransferOrder([p1], 3000, { approved: true });
      await s.vendorPrepares(v1, order.id);
      const deliveries = expectData<any[]>(await world.api('get', '/driver/deliveries', { token: driver.accessToken }));
      const delivery = deliveries.find((d) => d.orderId === order.id);
      for (const st of ['PICKED_UP', 'ON_THE_WAY']) expectData(await world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: driver.accessToken, body: { status: st } }));
      expectData(await world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: driver.accessToken, body: { status: 'FAILED_DELIVERY', failureReason: DriverFailedDeliveryReason.OTHER } }));
      const E = num(payment.amount_minor);
      expectData(await resolve(order.id, E + 3000), 201);
      const results = await Promise.all([exec(order.id), exec(order.id)]);
      expect(results.filter((r) => r.status === 201).length).toBeGreaterThanOrEqual(1);
      expect(await transferRefunded(order.id)).toBe(E);
      expect(await walletRefunded(order.id)).toBe(3000);
      expect(await balance(c)).toBe(500000);
    });
  });

  describe('K — Reliability & Adversarial Testing milestone: concurrent claim replay', () => {
    const paymentTransitionLogs = (paymentId: string) =>
      world.logs
        .filter((l) => l.message.includes('"event":"payment.state_transition"') && l.message.includes(paymentId))
        .map((l) => JSON.parse(l.message));

    it('the SAME customer double-tapping "I sent the transfer" (5 truly concurrent claim requests) never applies either transition more than once — never a 5xx, never a stuck/duplicated state', async () => {
      const { c, order } = await walletTransferOrder([p1], 3000);
      const before = await paymentOf(order.id);
      expect(before.status).toBe('PENDING');

      const results = await Promise.all(Array.from({ length: 5 }, () => claim(c, order.id)));

      // The documented contract ("idempotent, never a duplicate claim or a confusing error") holds
      // under TRUE concurrency, not just sequential replay: every one of the 5 concurrent callers gets
      // a clean success (their own attempt, or the current/already-advanced payment handed back once a
      // race is detected) — never a 409/5xx surfacing what is, from the client's perspective, an
      // operation that already succeeded.
      for (const r of results) expect(r.status).toBe(201);
      expect(world.unhandledServerErrors()).toEqual([]);

      // Authoritative state: settled exactly once, at UNDER_REVIEW — never stuck mid-way (CLAIMED only),
      // never regressed, never left PENDING.
      const final = await paymentOf(order.id);
      expect(final.status).toBe('UNDER_REVIEW');
      expect(final.claimed_at).not.toBeNull();

      // The strongest proof: the transition LOG itself (the one place PaymentStateMachineService.transition
      // ever records a status change) shows each step exactly once — never double-applied by two
      // concurrent callers racing the same idempotency check.
      const transitions = paymentTransitionLogs(final.id);
      expect(transitions.filter((t) => t.to === 'CUSTOMER_CLAIMED_TRANSFER')).toHaveLength(1);
      expect(transitions.filter((t) => t.to === 'UNDER_REVIEW')).toHaveLength(1);
    });
  });
});

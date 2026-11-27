/**
 * Hatly ("هاتلي من مكان", BUY_FROM_PLACE) and Wasally ("وصّلي لمكان", DELIVER_TO_PLACE), over real HTTP.
 *
 *  - ROUTE (PD-012): every request is ORIGIN → DESTINATION, each end the customer's choice or the service's configured default. The
 *    backend persists them in the origin / destination slots of the segment and never mirrors them.
 *  - PRICE: Hatly buys something whose price is unknown until it is bought (pending, cash-only). Wasally has NO product: the
 *    customer pays the delivery fee only — known now, total set, payable like any ordinary order.
 *  - The fee is the SAME for both (the address's zone fee × the configured multiplier — PD-009), whatever the direction.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, expectData, withQuoteToken } from './support/actors';

describe('E2E — Hatly vs Wasally: direction, delivery-fee-only pricing, payment rules', () => {
  let world: World;
  let s: Scenario;
  const address: Record<string, unknown> = { line1: 'Customer Home', latitude: 30.42, longitude: 31.56 };
  const PLACE = { latitude: 30.3, longitude: 31.45 };
  const START = { latitude: 30.35, longitude: 31.5 };
  const FEE = 2250; // zone fee 1500 × multiplier 1.5

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    const area = await s.serviceArea({ radiusMeters: 50000 });
    address.deliveryZoneId = (await s.deliveryZone({ serviceAreaId: area.id, feeMinor: 1500 })).id;
    await s.setConfig('HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER', 1.5);
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

  const hatlyItem = { adHocPlaceName: 'Corner Pharmacy', adHocServiceType: 'BUY_FROM_PLACE', pickupLatitude: PLACE.latitude, pickupLongitude: PLACE.longitude, destinationLatitude: START.latitude, destinationLongitude: START.longitude, freeTextDescription: 'Two boxes of tea', quantity: 1 };
  const wasallyItem = { adHocPlaceName: "Mom's house", adHocServiceType: 'DELIVER_TO_PLACE', pickupLatitude: START.latitude, pickupLongitude: START.longitude, destinationLatitude: PLACE.latitude, destinationLongitude: PLACE.longitude, freeTextDescription: 'A forgotten key', quantity: 1 };
  const quote = (c: Actor, body: Record<string, unknown> = { paymentMethod: 'COD' }) =>
    world.api('post', '/checkout/quote', { token: c.accessToken, body: { deliveryAddress: address, ...body } });
  const order = async (c: Actor, body: Record<string, unknown>) =>
    world.api('post', '/orders', { token: c.accessToken, body: await withQuoteToken(world, c.accessToken, { deliveryAddress: address, ...body }) });
  async function withItem(item: Record<string, unknown>): Promise<Actor> {
    const c = await s.customer();
    expectData(await world.api('post', '/cart/adhoc-items', { token: c.accessToken, body: item }), 201);
    return c;
  }
  const segmentRow = async (orderId: string) => (await world.ds.query('SELECT * FROM order_vendor_segments WHERE order_id = $1', [orderId]))[0];
  const orderRow = async (orderId: string) => (await world.ds.query('SELECT * FROM orders WHERE id = $1', [orderId]))[0];

  describe('Wasally (DELIVER_TO_PLACE): the delivery fee is the whole price', () => {
    it('the quote has a definite total: subtotal 0, fee = zone fee × multiplier (a final amount, not a formula), total = fee, amount due = fee, nothing pending', async () => {
      const c = await withItem(wasallyItem);
      const q = expectData<any>(await quote(c), 201);
      expect(q.hasPendingPricing).toBe(false);
      expect(q.summary).toMatchObject({ subtotalMinor: 0, discountMinor: 0, deliveryFeeMinor: FEE, totalMinor: FEE, amountDueMinor: FEE });
      expect(q.canPlaceOrder).toBe(true);
      expect(q.quoteToken).not.toBeNull();
    });

    it('the cart reports nothing unpriced for Wasally', async () => {
      const c = await withItem(wasallyItem);
      const cart = expectData<any>(await world.api('get', '/cart', { token: c.accessToken }));
      expect(cart.hasUnpricedItems).toBe(false);
      expect(cart.subtotalMinor).toBe(0);
    });

    it('placing it persists a priced order: total = fee, amount due = fee, NOT pending, its item recorded as priced at 0 (no price to confirm later)', async () => {
      const c = await withItem(wasallyItem);
      const placed = expectData<any>(await order(c, { paymentMethod: 'COD' }), 201);
      const row = await orderRow(placed.id);
      expect(row).toMatchObject({ has_pending_ad_hoc_pricing: false });
      expect(Number(row.subtotal_minor)).toBe(0);
      expect(Number(row.delivery_fee_minor)).toBe(FEE);
      expect(Number(row.total_minor)).toBe(FEE);
      expect(Number(row.amount_due_minor)).toBe(FEE);
      const items = await world.ds.query('SELECT actual_amount_minor FROM order_items oi JOIN order_vendor_segments s ON s.id = oi.order_vendor_segment_id WHERE s.order_id = $1', [placed.id]);
      expect(items.map((i: any) => Number(i.actual_amount_minor))).toEqual([0]);
      const detail = expectData<any>(await world.api('get', `/orders/${placed.id}`, { token: c.accessToken }));
      expect(detail.hasPendingPricing).toBe(false);
      expect(detail.totalMinor).toBe(FEE);
    });

    it('PAYMENT RULES are the ordinary ones: Manual Transfer is offered and accepted with the delivery fee as the amount; Pay at Delivery is not (R20)', async () => {
      const c = await withItem(wasallyItem);
      const q = expectData<any>(await quote(c), 201);
      expect(q.payment.options.cod).toBe(true);
      expect(q.payment.options.payAtDelivery).toBe(false); // R20
      expect(q.payment.options.manualTransfer).toMatchObject({ available: true, reason: null });
      expect(q.payment.wallet.available).toBe(true);

      const viaTransfer = expectData<any>(await order(c, { paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: 'INSTAPAY' }), 201);
      expect(viaTransfer).toMatchObject({ paymentMethod: 'MANUAL_TRANSFER' });
      const payment = (await world.ds.query('SELECT amount_minor FROM payments WHERE order_id = $1', [viaTransfer.id]))[0];
      expect(Number(payment.amount_minor)).toBe(FEE);

      const c2 = await withItem(wasallyItem);
      const viaPad = await order(c2, { paymentMethod: 'PAY_AT_DELIVERY', electronicPaymentMethod: 'INSTAPAY' });
      expect(viaPad.status).toBe(400);
      expect(viaPad.body.error.details.code).toBe('PAY_AT_DELIVERY_NOT_AVAILABLE');
    });

    it('DIRECTION: the customer-chosen start is the ORIGIN and the chosen place the DESTINATION (origin → destination), frozen in the segment and the route snapshot', async () => {
      const c = await withItem(wasallyItem);
      const placed = expectData<any>(await order(c, { paymentMethod: 'COD' }), 201);
      const seg = await segmentRow(placed.id);
      expect(seg.ad_hoc_service_type_snapshot).toBe('DELIVER_TO_PLACE');
      expect([Number(seg.ad_hoc_destination_latitude_snapshot), Number(seg.ad_hoc_destination_longitude_snapshot)]).toEqual([PLACE.latitude, PLACE.longitude]);
      expect([Number(seg.ad_hoc_pickup_latitude_snapshot), Number(seg.ad_hoc_pickup_longitude_snapshot)]).toEqual([START.latitude, START.longitude]);
      const row = await orderRow(placed.id);
      expect(row.delivery_fee_breakdown_snapshot.route).toMatchObject({
        origin: { latitude: START.latitude, longitude: START.longitude, source: 'CUSTOMER' },
        destination: { latitude: PLACE.latitude, longitude: PLACE.longitude, source: 'CUSTOMER' },
      });
      // The customer's own address is NOT a route end here — it only decides the pricing method (zone fee / road distance).
      expect(row.delivery_address_snapshot).toMatchObject({ line1: 'Customer Home' });
    });
  });

  describe('Hatly (BUY_FROM_PLACE): the purchase price is not known yet', () => {
    it('the quote keeps the explicit pending state (total null, never 0), shows the same final fee, and is cash-only', async () => {
      const c = await withItem(hatlyItem);
      const q = expectData<any>(await quote(c), 201);
      expect(q.hasPendingPricing).toBe(true);
      expect(q.summary).toMatchObject({ subtotalMinor: 0, deliveryFeeMinor: FEE, totalMinor: null, amountDueMinor: null });
      expect(q.payment.options).toMatchObject({ cod: true, payAtDelivery: false });
      expect(q.payment.wallet.available).toBe(false);
      const refused = await world.api('post', '/orders', { token: c.accessToken, body: { deliveryAddress: address, paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: 'INSTAPAY' } });
      expect(refused.status).toBe(400);
      expect(refused.body.error.details.code).toBe('ELECTRONIC_PAYMENT_NOT_ALLOWED_FOR_UNPRICED_ORDER');
    });

    it('DIRECTION: the chosen place is the ORIGIN (pickup) and the chosen end the DESTINATION; the order stays pending-priced', async () => {
      const c = await withItem(hatlyItem);
      const placed = expectData<any>(await order(c, { paymentMethod: 'COD' }), 201);
      const seg = await segmentRow(placed.id);
      expect(seg.ad_hoc_service_type_snapshot).toBe('BUY_FROM_PLACE');
      expect([Number(seg.ad_hoc_pickup_latitude_snapshot), Number(seg.ad_hoc_pickup_longitude_snapshot)]).toEqual([PLACE.latitude, PLACE.longitude]);
      expect([Number(seg.ad_hoc_destination_latitude_snapshot), Number(seg.ad_hoc_destination_longitude_snapshot)]).toEqual([START.latitude, START.longitude]);
      const row = await orderRow(placed.id);
      expect(row.has_pending_ad_hoc_pricing).toBe(true);
      expect(row.total_minor).toBeNull();
      const items = await world.ds.query('SELECT actual_amount_minor FROM order_items oi JOIN order_vendor_segments s ON s.id = oi.order_vendor_segment_id WHERE s.order_id = $1', [placed.id]);
      expect(items.map((i: any) => i.actual_amount_minor)).toEqual([null]);
    });
  });

  it('both services accept an origin AND a destination (no cross-type restriction since PD-012), and half a pair is refused', async () => {
    const c = await s.customer();
    expectData(await world.api('post', '/cart/adhoc-items', { token: c.accessToken, body: wasallyItem }), 201);
    await world.api('delete', '/cart', { token: c.accessToken });
    expectData(await world.api('post', '/cart/adhoc-items', { token: c.accessToken, body: hatlyItem }), 201);
    await world.api('delete', '/cart', { token: c.accessToken });
    const half = await world.api('post', '/cart/adhoc-items', { token: c.accessToken, body: { ...hatlyItem, destinationLongitude: undefined } });
    expect(half.status).toBe(400);
    expect(half.body.error.details.code).toBe('INCOMPLETE_COORDINATE');
  });

  it('the fee does not depend on the direction or on the chosen place: both services quote the same final delivery fee', async () => {
    const a = await withItem(hatlyItem);
    const b = await withItem({ ...wasallyItem, destinationLatitude: 30.6, destinationLongitude: 31.75 }); // a different place, still inside the 50 km service area (places outside it are refused since UAT 2026-11-27)
    // (zone-priced: the route never changes a manual fee)
    const qa = expectData<any>(await quote(a), 201);
    const qb = expectData<any>(await quote(b), 201);
    expect(qa.summary.deliveryFeeMinor).toBe(qb.summary.deliveryFeeMinor);
    expect(qb.summary.deliveryFeeMinor).toBe(FEE);
  });
});

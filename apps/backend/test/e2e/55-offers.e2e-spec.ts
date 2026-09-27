/**
 * Group 8 / phase 8 — offers over real HTTP: admin creates SUBTOTAL_DISCOUNT and FLASH_SALE offers,
 * customers see the preview in their cart, checkout applies and snapshots the discount, limits hold
 * under concurrency, and a cancellation gives flash-sale allocation back.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';

const HOUR = 3_600_000;
const window = (fromHours = -1, toHours = 24) => ({ startAt: new Date(Date.now() + fromHours * HOUR).toISOString(), endAt: new Date(Date.now() + toHours * HOUR).toISOString() });

describe('E2E — offers', () => {
  let world: World;
  let s: Scenario;
  let area: { id: string; lat: number; lng: number };
  let superAdmin: Actor;
  const home = { lat: 30.425, lng: 31.565 };

  const createOffer = (body: Record<string, unknown>) => world.api('post', '/admin/offers', { token: superAdmin.accessToken, body });
  const offerRow = async (id: string) => (await world.ds.query('SELECT * FROM offers WHERE id = $1', [id]))[0];
  const newVendor = async (name: string, lat = 30.421, lng = 31.561) => s.vendor({ name, serviceAreaId: area.id, lat, lng });

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    area = await s.serviceArea({ radiusMeters: 50000 });
    superAdmin = await s.superAdmin();
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('admin validation', () => {
    it('rejects invalid definitions with a precise code', async () => {
      const v = await newVendor('Validation Vendor');
      const p = await s.product(v, { priceMinor: 10000 });
      const base = { vendorBranchId: v.branchId, name: 'X', ...window() };
      const codeOf = (r: { body: any }) => r.body.error?.details?.code;
      expect(codeOf(await createOffer({ ...base, mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'PERCENTAGE', discountValue: 1000, startAt: window().endAt, endAt: window().startAt }))).toBe('INVALID_VALIDITY_WINDOW');
      expect(codeOf(await createOffer({ ...base, mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'PERCENTAGE', discountValue: 10001 }))).toBe('INVALID_DISCOUNT_VALUE');
      expect(codeOf(await createOffer({ ...base, mechanism: 'SUBTOTAL_DISCOUNT' }))).toBe('MISSING_SUBTOTAL_DISCOUNT_FIELDS');
      expect(codeOf(await createOffer({ ...base, mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 100, specialPriceMinor: 1 }))).toBe('UNEXPECTED_FLASH_SALE_FIELD');
      expect(codeOf(await createOffer({ ...base, mechanism: 'FLASH_SALE' }))).toBe('MISSING_FLASH_SALE_FIELDS');
      expect(codeOf(await createOffer({ ...base, mechanism: 'FLASH_SALE', specialPriceMinor: 5, discountValue: 1 }))).toBe('UNEXPECTED_SUBTOTAL_DISCOUNT_FIELD');
      const other = await newVendor('Other Vendor');
      const foreign = await s.product(other, {});
      expect(codeOf(await createOffer({ ...base, mechanism: 'FLASH_SALE', specialPriceMinor: 5, productIds: [foreign.id] }))).toBe('PRODUCT_BRANCH_MISMATCH');
      expect((await createOffer({ ...base, mechanism: 'BOGO' })).status).toBe(400);
      expect(p.id).toBeDefined();
    });

    it('a flash sale and a subtotal discount cannot cover the same product at overlapping times', async () => {
      const v = await newVendor('Conflict Vendor');
      const p = await s.product(v, { priceMinor: 10000 });
      const flash = await createOffer({ vendorBranchId: v.branchId, name: 'Flash', mechanism: 'FLASH_SALE', specialPriceMinor: 8000, productIds: [p.id], ...window() });
      expect(flash.status).toBe(201);
      const conflict = await createOffer({ vendorBranchId: v.branchId, name: 'Sub', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 100, productIds: [p.id], ...window() });
      expect(conflict.status).toBe(400);
      expect(conflict.body.error.details).toMatchObject({ code: 'OFFER_MECHANISM_CONFLICT', conflictingOfferId: flash.body.data.id });
      const later = await createOffer({ vendorBranchId: v.branchId, name: 'Sub later', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 100, productIds: [p.id], ...window(30, 40) });
      expect(later.status).toBe(201); // no overlap in time → allowed
    });

    it('only an admin holding MANAGE_OFFERS can create or list offers', async () => {
      const v = await newVendor('Perm Vendor');
      const noPerm = await s.admin([]);
      const withPerm = await s.admin(['MANAGE_OFFERS' as never]);
      const body = { vendorBranchId: v.branchId, name: 'P', mechanism: 'FLASH_SALE', specialPriceMinor: 1, ...window() };
      expect((await world.api('post', '/admin/offers', { token: noPerm.accessToken, body })).status).toBe(403);
      expect((await world.api('post', '/admin/offers', { token: v.manager.accessToken, body })).status).toBe(403);
      expect((await world.api('post', '/admin/offers', { token: withPerm.accessToken, body })).status).toBe(201);
    });
  });

  describe('SUBTOTAL_DISCOUNT', () => {
    it('percentage discount with a minimum and a cap: previewed in the cart, applied at checkout, snapshotted on the segment, total = subtotal + fee − discount', async () => {
      const v = await newVendor('Percent Vendor');
      const big = await s.product(v, { name: 'Big Ticket', priceMinor: 50000 });
      const offer = expectData(await createOffer({ vendorBranchId: v.branchId, name: '10% over 300', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'PERCENTAGE', discountValue: 1000, minimumEligibleSubtotalMinor: 30000, maximumDiscountMinor: 4000, ...window() }), 201);

      const under = await s.customer('Under Minimum');
      const smallProduct = await s.product(v, { name: 'Small', priceMinor: 20000 });
      await s.addToCart(under, smallProduct.id, 1);
      const underOrder = await s.checkout(under, home);
      expect(underOrder.discountMinor).toBe(0); // 200 < 300 minimum

      const over = await s.customer('Over Minimum');
      const preview = await s.addToCart(over, big.id, 1);
      expect(preview.groups[0].hasSubtotalDiscountOffer).toBe(true);
      const order = await s.checkout(over, home);
      // 10% of 500.00 = 50.00, capped at 40.00
      expect(order.discountMinor).toBe(4000);
      expect(order.subtotalMinor).toBe(50000);
      expect(order.totalMinor).toBe(50000 + order.deliveryFeeMinor - 4000);
      expect(order.segments[0]).toMatchObject({ appliedOfferId: offer.id, offerDiscountAmountMinor: 4000, offerDiscountTypeSnapshot: 'PERCENTAGE', offerDiscountValueSnapshot: 1000 });
      expect(order.segments[0].subtotalMinor).toBe(50000); // vendor commission basis stays GROSS
      const row = await offerRow(offer.id);
      expect(Number(row.consumed_units_count)).toBe(1);
      expect(Number(row.consumed_discount_minor)).toBe(4000);
      expect((await world.ds.query("SELECT amount_minor FROM financial_events WHERE order_id = $1 AND type = 'HATLY_FUNDED_OFFER_DISCOUNT_RECORDED'", [order.id]))).toEqual([{ amount_minor: 4000 }]);
    });

    it('a FIXED discount never exceeds the eligible subtotal; the budget cap stops discounting once exhausted', async () => {
      const v = await newVendor('Budget Vendor');
      const p = await s.product(v, { priceMinor: 3000 });
      const offer = expectData(await createOffer({ vendorBranchId: v.branchId, name: 'Fixed 50', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 5000, budgetCapMinor: 4000, ...window() }), 201);
      const a = await s.customer();
      await s.addToCart(a, p.id, 1);
      const first = await s.checkout(a, home);
      expect(first.discountMinor).toBe(3000); // fixed 50 EGP but the subtotal is only 30
      const b = await s.customer();
      await s.addToCart(b, p.id, 1);
      const second = await s.checkout(b, home);
      expect(second.discountMinor).toBe(1000); // only 10 EGP of budget remained
      const c = await s.customer();
      await s.addToCart(c, p.id, 1);
      expect((await s.checkout(c, home)).discountMinor).toBe(0); // budget exhausted
      expect(Number((await offerRow(offer.id)).consumed_discount_minor)).toBe(4000);
    });

    it('a deactivated, expired or not-yet-started offer never applies; reactivating applies it again', async () => {
      const v = await newVendor('Window Vendor');
      const p = await s.product(v, { priceMinor: 10000 });
      const active = expectData(await createOffer({ vendorBranchId: v.branchId, name: 'Live', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 1000, ...window() }), 201);
      const order = async () => {
        const c = await s.customer();
        await s.addToCart(c, p.id, 1);
        return s.checkout(c, home);
      };
      expect((await order()).discountMinor).toBe(1000);
      expectData(await world.api('patch', `/admin/offers/${active.id}/deactivate`, { token: superAdmin.accessToken }));
      expect((await order()).discountMinor).toBe(0);
      expectData(await world.api('patch', `/admin/offers/${active.id}/activate`, { token: superAdmin.accessToken }));
      expect((await order()).discountMinor).toBe(1000);
      await world.ds.query("UPDATE offers SET end_at = now() - interval '1 minute' WHERE id = $1", [active.id]); // window elapsed
      expect((await order()).discountMinor).toBe(0);
      await world.ds.query("UPDATE offers SET start_at = now() + interval '1 hour', end_at = now() + interval '2 hours' WHERE id = $1", [active.id]);
      expect((await order()).discountMinor).toBe(0);
    });

    it("another branch's offer never applies", async () => {
      const a = await newVendor('Offer Owner');
      const b = await newVendor('Offer Bystander');
      await createOffer({ vendorBranchId: a.branchId, name: 'A only', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'PERCENTAGE', discountValue: 5000, ...window() });
      const p = await s.product(b, { priceMinor: 10000 });
      const c = await s.customer();
      await s.addToCart(c, p.id, 1);
      expect((await s.checkout(c, home)).discountMinor).toBe(0);
    });
  });

  describe('FLASH_SALE', () => {
    it('applies the special price per unit, capped by perOrderLimit; the rest of the quantity is charged full price', async () => {
      const v = await newVendor('Flash Vendor');
      const p = await s.product(v, { name: 'Flash Item', priceMinor: 10000 });
      const offer = expectData(await createOffer({ vendorBranchId: v.branchId, name: 'Flash 60', mechanism: 'FLASH_SALE', specialPriceMinor: 6000, productIds: [p.id], perOrderLimit: 2, ...window() }), 201);
      const c = await s.customer();
      const preview = await s.addToCart(c, p.id, 5);
      expect(preview.groups[0].items[0]).toMatchObject({ offerId: offer.id, offerMechanism: 'FLASH_SALE', specialPriceMinor: 6000, offerDiscountedQuantity: 2, offerDiscountAmountMinor: 8000, lineTotalMinor: 50000, payableLineTotalMinor: 42000 });
      const order = await s.checkout(c, home);
      expect(order.discountMinor).toBe(8000);
      expect(order.subtotalMinor).toBe(50000);
      expect(order.segments[0].items[0]).toMatchObject({ offerDiscountedQuantity: 2, offerDiscountAmountMinor: 8000, offerSpecialPriceMinorSnapshot: 6000, offerMechanismSnapshot: 'FLASH_SALE' });
      expect(Number((await offerRow(offer.id)).consumed_units_count)).toBe(2);
    });

    it('perCustomerLifetimeLimit: the second order over the limit is refused with FLASH_SALE_LIMIT_EXCEEDED and creates nothing', async () => {
      const v = await newVendor('Lifetime Vendor');
      const p = await s.product(v, { priceMinor: 10000, inventoryMode: 'TRACKED', quantity: 50 });
      await createOffer({ vendorBranchId: v.branchId, name: 'Two per customer', mechanism: 'FLASH_SALE', specialPriceMinor: 5000, productIds: [p.id], perCustomerLifetimeLimit: 2, ...window() });
      const c = await s.customer();
      await s.addToCart(c, p.id, 2);
      expect((await s.checkout(c, home)).discountMinor).toBe(10000);
      await s.addToCart(c, p.id, 1);
      const refused = await world.api('post', '/orders', { token: c.accessToken, body: { deliveryAddress: { line1: 'x', latitude: home.lat, longitude: home.lng }, paymentMethod: 'COD' } });
      expect(refused.status).toBe(400);
      expect(refused.body.error.details).toMatchObject({ code: 'FLASH_SALE_LIMIT_EXCEEDED', limitType: 'CUSTOMER', limit: 2, alreadyConsumed: 2, remaining: 0, requested: 1 });
      expect(await world.ds.query('SELECT id FROM orders WHERE customer_id = $1', [c.id])).toHaveLength(1);
      expect((await world.ds.query('SELECT quantity FROM products WHERE id = $1', [p.id]))[0].quantity).toBe(48); // the refused attempt took no stock
    });

    it('totalAllocationLimit under a 6-way race: exactly 3 of 6 concurrent single-unit orders get the flash price; the rest are refused; the counter is exact', async () => {
      const v = await newVendor('Allocation Vendor');
      const p = await s.product(v, { priceMinor: 10000 });
      const offer = expectData(await createOffer({ vendorBranchId: v.branchId, name: 'First 3', mechanism: 'FLASH_SALE', specialPriceMinor: 7000, productIds: [p.id], totalAllocationLimit: 3, ...window() }), 201);
      const racers: Actor[] = [];
      for (let i = 0; i < 6; i += 1) {
        const c = await s.customer(`Flash Racer ${i}`);
        await s.addToCart(c, p.id, 1);
        racers.push(c);
      }
      const body = { deliveryAddress: { line1: 'x', latitude: home.lat, longitude: home.lng }, paymentMethod: 'COD' };
      const results = await Promise.all(
        racers.map(async (c) => {
          const quote = await world.api('post', '/checkout/quote', { token: c.accessToken, body });
          return world.api('post', '/orders', { token: c.accessToken, body: { ...body, quoteToken: quote.body.data.quoteToken } });
        }),
      );
      const won = results.filter((r) => r.status === 201);
      const lost = results.filter((r) => r.status === 400);
      expect(won).toHaveLength(3);
      expect(lost).toHaveLength(3);
      for (const r of lost) expect(r.body.error.details).toMatchObject({ code: 'FLASH_SALE_LIMIT_EXCEEDED', limitType: 'GLOBAL' });
      for (const r of won) expect(r.body.data.discountMinor).toBe(3000);
      expect(Number((await offerRow(offer.id)).consumed_units_count)).toBe(3);
      const consumptions = await world.ds.query('SELECT quantity_consumed FROM offer_consumptions WHERE offer_id = $1 AND is_reversed = false', [offer.id]);
      expect(consumptions).toHaveLength(3);
    });

    it('cancelling a flash-sale order gives the allocation back exactly once, so another customer can then buy it', async () => {
      const v = await newVendor('Reversal Vendor');
      const p = await s.product(v, { priceMinor: 10000 });
      const offer = expectData(await createOffer({ vendorBranchId: v.branchId, name: 'Only 1', mechanism: 'FLASH_SALE', specialPriceMinor: 5000, productIds: [p.id], totalAllocationLimit: 1, ...window() }), 201);
      const first = await s.customer();
      await s.addToCart(first, p.id, 1);
      const order = await s.checkout(first, home);
      const second = await s.customer();
      await s.addToCart(second, p.id, 1);
      const blocked = await world.api('post', '/orders', { token: second.accessToken, body: { deliveryAddress: { line1: 'x', latitude: home.lat, longitude: home.lng }, paymentMethod: 'COD' } });
      expect(blocked.body.error.details.code).toBe('FLASH_SALE_LIMIT_EXCEEDED');

      expectData(await world.api('patch', `/orders/${order.id}/status`, { token: superAdmin.accessToken, body: { status: 'CANCELLED', cancellationReason: 'changed mind' } }));
      expect(Number((await offerRow(offer.id)).consumed_units_count)).toBe(0);
      expect(await world.ds.query('SELECT is_reversed FROM offer_consumptions WHERE order_id = $1', [order.id])).toEqual([{ is_reversed: true }]);
      const retry = await s.checkout(second, home);
      expect(retry.discountMinor).toBe(5000);
      expect(Number((await offerRow(offer.id)).consumed_units_count)).toBe(1);
    });

    it('weighted products are never discounted by a flash sale', async () => {
      const v = await newVendor('Weighed Flash Vendor');
      const w = await s.product(v, { name: 'Olives', priceMinor: 10000, pricingUnit: 'WEIGHT' });
      await createOffer({ vendorBranchId: v.branchId, name: 'Weighed flash', mechanism: 'FLASH_SALE', specialPriceMinor: 1, productIds: [w.id], ...window() });
      const c = await s.customer();
      await s.addToCart(c, w.id, 1, { requestedWeightGrams: 1000 });
      expect((await s.checkout(c, home)).discountMinor).toBe(0);
    });
  });

  describe('CHARACTERIZATION — subtotal-discount consumption on cancellation', () => {
    it('cancelling an order that used a SUBTOTAL_DISCOUNT does not return its consumption/budget (only flash-sale allocation is reversed today)', async () => {
      const v = await newVendor('Sub Reversal Vendor');
      const p = await s.product(v, { priceMinor: 10000 });
      const offer = expectData(await createOffer({ vendorBranchId: v.branchId, name: 'Cap', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 1000, budgetCapMinor: 1000, ...window() }), 201);
      const c = await s.customer();
      await s.addToCart(c, p.id, 1);
      const order = await s.checkout(c, home);
      expect(order.discountMinor).toBe(1000);
      expectData(await world.api('patch', `/orders/${order.id}/status`, { token: superAdmin.accessToken, body: { status: 'CANCELLED', cancellationReason: 'x' } }));
      expect(Number((await offerRow(offer.id)).consumed_discount_minor)).toBe(1000); // budget stays consumed
    });
  });
});

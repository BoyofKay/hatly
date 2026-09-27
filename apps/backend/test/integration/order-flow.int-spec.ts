import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { createIntegrationApp } from './support/app';
import { TestData } from './support/test-data';
import { OrderCreationService } from '../../src/modules/orders/order-creation.service';
import { OrderStateMachineService } from '../../src/modules/orders/order-state-machine.service';
import { Order } from '../../src/modules/orders/entities/order.entity';
import { OrderStatus } from '../../src/modules/orders/order-status.enum';
import { OrderVendorSegmentStatus } from '../../src/modules/orders/order-vendor-segment-status.enum';
import { Product } from '../../src/modules/products/entities/product.entity';
import { ProductCategory } from '../../src/modules/products/entities/product-category.entity';
import { InventoryMode } from '../../src/modules/products/inventory-mode.enum';
import { Cart, CartStatus } from '../../src/modules/cart/entities/cart.entity';
import { CartVendorGroup } from '../../src/modules/cart/entities/cart-vendor-group.entity';
import { CartItem } from '../../src/modules/cart/entities/cart-item.entity';
import { CartGroupType } from '../../src/modules/cart/cart-group-type.enum';
import { FulfillmentType } from '../../src/modules/cart/fulfillment-type.enum';
import { Role } from '../../src/common/enums/role.enum';
import { VendorBranch } from '../../src/modules/vendors/entities/vendor-branch.entity';
import { Offer } from '../../src/modules/offers/entities/offer.entity';
import { OfferProduct } from '../../src/modules/offers/entities/offer-product.entity';
import { OfferMechanism } from '../../src/modules/offers/offer-mechanism.enum';
import { OfferConsumptionService, FlashSaleLimitExceededException } from '../../src/modules/offers/offer-consumption.service';
import { PricingUnit } from '../../src/modules/products/pricing-unit.enum';
import { BusinessConfigService } from '../../src/modules/business-config/business-config.service';
import { ElectronicPaymentMethod } from '../../src/modules/payments/electronic-payment-method.enum';

/**
 * The real order-creation and order-state-machine services against real
 * PostgreSQL — raw SQL fragments, row locks, enum writes, post-commit
 * hooks, money arithmetic and all. These paths are exactly where a
 * mocked EntityManager can hide column-name, enum and bigint defects.
 */
describe('Real order flow (OrderCreationService / OrderStateMachineService) on PostgreSQL', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let data: TestData;
  const address = { line1: '1 Test St', latitude: 30.4, longitude: 31.5 };

  beforeAll(async () => {
    app = await createIntegrationApp();
    ds = app.get(DataSource);
    data = new TestData(ds);
  });
  afterEach(async () => {
    await data.dispose();
  });
  afterAll(async () => {
    await app?.close();
  });

  /** Records everything the service created for an order so dispose() can remove it (children before parents). */
  async function trackOrderGraph(orderId: string): Promise<void> {
    data.track('orders', orderId);
    for (const r of await ds.query('SELECT id FROM order_vendor_segments WHERE order_id = $1', [orderId])) data.track('order_vendor_segments', r.id);
    for (const r of await ds.query('SELECT i.id FROM order_items i JOIN order_vendor_segments s ON s.id = i.order_vendor_segment_id WHERE s.order_id = $1', [orderId])) data.track('order_items', r.id);
    for (const r of await ds.query('SELECT id FROM payments WHERE order_id = $1', [orderId])) data.track('payments', r.id);
    for (const r of await ds.query('SELECT id FROM financial_events WHERE order_id = $1', [orderId])) data.track('financial_events', r.id);
    for (const r of await ds.query('SELECT id FROM loyalty_points_transactions WHERE order_id = $1', [orderId])) data.track('loyalty_points_transactions', r.id);
  }

  async function pickupCart(customerId: string, branch: VendorBranch, product: Product, quantity: number): Promise<Cart> {
    const cart = await data.save<Cart>(Cart, { customerId, status: CartStatus.ACTIVE, fulfillmentType: FulfillmentType.PICKUP });
    const group = await data.save<CartVendorGroup>(CartVendorGroup, { cartId: cart.id, groupType: CartGroupType.CATALOG, vendorBranchId: branch.id });
    await data.save<CartItem>(CartItem, { cartVendorGroupId: group.id, productId: product.id, quantity });
    return cart;
  }

  async function trackedProduct(branch: VendorBranch, quantity: number, priceMinor = 15_000): Promise<Product> {
    const category = await data.save<ProductCategory>(ProductCategory, { vendorBranchId: branch.id, name: 'Integration Category' });
    return data.save<Product>(Product, {
      vendorBranchId: branch.id, categoryId: category.id, name: 'Integration Product', priceMinor,
      inventoryMode: InventoryMode.TRACKED, quantity,
    });
  }

  const productQuantity = async (id: string): Promise<number> => (await ds.query('SELECT quantity FROM products WHERE id = $1', [id]))[0].quantity;

  it('createOrder: prices with real numbers (not concatenated bigint strings), decrements TRACKED stock with the real SQL, creates the Manual Transfer payment, marks the cart ORDERED', async () => {
    const creation = app.get(OrderCreationService);
    const customer = await data.user();
    const branch = await data.vendorBranch();
    const product = await trackedProduct(branch, 10, 15_000);
    const cart = await pickupCart(customer.id, branch, product, 2);
    // Manual Transfer is only offered once an admin has configured where to send the money (PD-006).
    const config = app.get(BusinessConfigService);
    await config.set('MANUAL_TRANSFER_DESTINATION', { label: 'Test', phoneOrAccountNumber: '01000000000' }, customer.id);
    await config.set('CUSTOMER_SERVICE_WHATSAPP_NUMBER', '+201000000000', customer.id);
    try {
    const order = await creation.createOrder(customer.id, { deliveryAddress: address, paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: ElectronicPaymentMethod.INSTAPAY } as never);
    await trackOrderGraph(order.id);

    expect(order.subtotalMinor).toBe(30_000); // 15_000 x 2 — a string-typed bigint would have produced garbage
    expect(order.deliveryFeeMinor).toBe(0); // PICKUP: no delivery fee, no map call
    expect(order.totalMinor).toBe(30_000);
    expect(order.status).toBe(OrderStatus.PENDING);
    expect(order.segments).toHaveLength(1);
    expect(order.segments[0].status).toBe(OrderVendorSegmentStatus.PENDING);
    expect(order.segments[0].items[0].unitPriceMinor).toBe(15_000);

    expect(await productQuantity(product.id)).toBe(8);
    expect((await ds.getRepository(Cart).findOneByOrFail({ id: cart.id })).status).toBe(CartStatus.ORDERED);
    const [payment] = await ds.query('SELECT status, method, amount_minor FROM payments WHERE order_id = $1', [order.id]);
    expect(payment).toEqual({ status: 'PENDING', method: 'MANUAL_TRANSFER', amount_minor: 30_000 });
    } finally {
      await ds.query("DELETE FROM business_config WHERE key IN ('MANUAL_TRANSFER_DESTINATION', 'CUSTOMER_SERVICE_WHATSAPP_NUMBER')");
    }
  });

  it('createOrder under real concurrency: two customers race for the LAST unit — exactly one order is created, stock never goes negative, the loser gets INSUFFICIENT_INVENTORY and leaves nothing behind', async () => {
    const creation = app.get(OrderCreationService);
    const branch = await data.vendorBranch();
    const product = await trackedProduct(branch, 1);
    const customers = [await data.user(), await data.user()];
    const carts = await Promise.all(customers.map((c) => pickupCart(c.id, branch, product, 1)));

    const results = await Promise.allSettled(
      customers.map((c) => creation.createOrder(c.id, { deliveryAddress: address, paymentMethod: 'COD' } as never)),
    );

    const fulfilled = results.filter((r): r is PromiseFulfilledResult<Order> => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.getResponse().details.code).toBe('INSUFFICIENT_INVENTORY');
    await trackOrderGraph(fulfilled[0].value.id);

    expect(await productQuantity(product.id)).toBe(0);
    const orders = await ds.query('SELECT count(*)::int AS n FROM orders WHERE customer_id = ANY($1)', [customers.map((c) => c.id)]);
    expect(orders[0].n).toBe(1);
    // The loser's cart is still ACTIVE (its transaction rolled back completely); the winner's is ORDERED.
    const statuses = (await Promise.all(carts.map((c) => ds.getRepository(Cart).findOneByOrFail({ id: c.id })))).map((c) => c.status).sort();
    expect(statuses).toEqual([CartStatus.ACTIVE, CartStatus.ORDERED]);
  });

  it('state machine: cancelling restores TRACKED inventory with the real SQL, in the same transaction as the status change', async () => {
    const machine = app.get(OrderStateMachineService);
    const customer = await data.user();
    const branch = await data.vendorBranch();
    const product = await trackedProduct(branch, 3);
    const order = await data.order(customer.id, { status: OrderStatus.PENDING });
    const segment = await data.segment(order.id, branch.id);
    await data.item(segment.id, { productId: product.id, quantity: 2, unitPriceMinor: 15_000 });

    const cancelled = await machine.transition({ orderId: order.id, to: OrderStatus.CANCELLED, actorRole: Role.ADMIN, cancellationReason: 'integration' });

    expect(cancelled.status).toBe(OrderStatus.CANCELLED);
    expect(await productQuantity(product.id)).toBe(5); // 3 + 2 restored
    const [row] = await ds.query('SELECT status, cancelled_by_role, cancellation_reason FROM orders WHERE id = $1', [order.id]);
    expect(row).toEqual({ status: 'CANCELLED', cancelled_by_role: 'ADMIN', cancellation_reason: 'integration' });
    await trackOrderGraph(order.id);
  });

  it('state machine: FAILED_DELIVERY persists (the value the database enum was missing), stamps failedAt/failureReason, and the post-commit financial event is written', async () => {
    const machine = app.get(OrderStateMachineService);
    const customer = await data.user();
    const order = await data.order(customer.id, { status: OrderStatus.ON_THE_WAY });

    const failed = await machine.transition({ orderId: order.id, to: OrderStatus.FAILED_DELIVERY, actorRole: Role.DRIVER, failureReason: 'customer unreachable' });

    expect(failed.status).toBe(OrderStatus.FAILED_DELIVERY);
    const [row] = await ds.query('SELECT status, failure_reason, failed_at FROM orders WHERE id = $1', [order.id]);
    expect(row.status).toBe('FAILED_DELIVERY');
    expect(row.failure_reason).toBe('customer unreachable');
    expect(row.failed_at).toBeInstanceOf(Date);
    const events = await ds.query('SELECT type, direction FROM financial_events WHERE order_id = $1', [order.id]);
    expect(events).toEqual([{ type: 'FAILED_DELIVERY_RECORDED', direction: 'INFORMATIONAL' }]);
    await trackOrderGraph(order.id);
  });

  it('state machine: DELIVERED awards loyalty points inside the same transaction, computed from real item prices (integer arithmetic)', async () => {
    const machine = app.get(OrderStateMachineService);
    const customer = await data.user();
    const branch = await data.vendorBranch();
    const order = await data.order(customer.id, { status: OrderStatus.ON_THE_WAY });
    const segment = await data.segment(order.id, branch.id);
    await data.item(segment.id, { quantity: 2, unitPriceMinor: 10_000 }); // 200.00 EGP at 1 point/EGP

    await machine.transition({ orderId: order.id, to: OrderStatus.DELIVERED, actorRole: Role.DRIVER });

    const earning = await ds.query("SELECT points_delta, type, order_id FROM loyalty_points_transactions WHERE customer_id = $1", [customer.id]);
    expect(earning).toEqual([{ points_delta: 200, type: 'EARNING', order_id: order.id }]);
    await trackOrderGraph(order.id);
  });

  it('state machine under real concurrency: two IDENTICAL cancellations race — the row lock lets exactly one through, and the TRACKED stock is restored exactly ONCE (never doubled)', async () => {
    const machine = app.get(OrderStateMachineService);
    const customer = await data.user();
    const branch = await data.vendorBranch();
    const product = await trackedProduct(branch, 3);
    const order = await data.order(customer.id, { status: OrderStatus.PENDING });
    const segment = await data.segment(order.id, branch.id);
    await data.item(segment.id, { productId: product.id, quantity: 2, unitPriceMinor: 15_000 });

    const results = await Promise.allSettled([
      machine.transition({ orderId: order.id, to: OrderStatus.CANCELLED, actorRole: Role.ADMIN }),
      machine.transition({ orderId: order.id, to: OrderStatus.CANCELLED, actorRole: Role.ADMIN }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await productQuantity(product.id)).toBe(5); // 3 + 2, restored once — a double restore would be 7
    await trackOrderGraph(order.id);
  });

  it('a CANCELLED order can never be confirmed afterwards, even when the two requests race (CANCELLED is terminal under the lock)', async () => {
    const machine = app.get(OrderStateMachineService);
    const customer = await data.user();
    const order = await data.order(customer.id, { status: OrderStatus.PENDING });

    const results = await Promise.allSettled([
      machine.transition({ orderId: order.id, to: OrderStatus.CANCELLED, actorRole: Role.ADMIN }),
      machine.transition({ orderId: order.id, to: OrderStatus.CONFIRMED, actorRole: Role.ADMIN }),
    ]);

    // Valid serializations: CONFIRMED then CANCELLED (both succeed) or CANCELLED then CONFIRMED (second rejected).
    // In EVERY case the final state is CANCELLED — never a confirmed-after-cancelled order.
    const [{ status }] = await ds.query('SELECT status FROM orders WHERE id = $1', [order.id]);
    expect(status).toBe(OrderStatus.CANCELLED);
    expect(results[0].status).toBe('fulfilled');
    await trackOrderGraph(order.id);
  });

  it('Flash Sale consumption/reversal (real OfferConsumptionService, real SQL): limits are enforced from live rows, reversal restores them, and the one-consumption-per-item unique index holds', async () => {
    const offers = app.get(OfferConsumptionService);
    const customer = await data.user();
    const branch = await data.vendorBranch();
    const product = await trackedProduct(branch, 50);
    const offer = await data.save<Offer>(Offer, {
      vendorBranchId: branch.id, name: 'Integration Flash Sale',
      startAt: new Date(Date.now() - 3_600_000), endAt: new Date(Date.now() + 3_600_000),
      mechanism: OfferMechanism.FLASH_SALE, specialPriceMinor: 9_000,
      perCustomerLifetimeLimit: 3, totalAllocationLimit: 5,
    });
    await data.save<OfferProduct>(OfferProduct, { offerId: offer.id, productId: product.id });
    const order = await data.order(customer.id);
    const segment = await data.segment(order.id, branch.id);
    const item = await data.item(segment.id, { productId: product.id, quantity: 3, unitPriceMinor: 15_000 });
    const candidate = (cartItemId: string, quantity: number) => ({
      cartItemId, vendorBranchId: branch.id, productId: product.id, categoryId: product.categoryId,
      quantity, unitPriceMinor: 15_000, pricingUnit: PricingUnit.PIECE,
    });

    // Consume 3 of the customer's 3 lifetime units, in a real transaction.
    await ds.transaction(async (manager) => {
      const { plans } = await offers.planFlashSaleForCart(manager, { customerId: customer.id, items: [candidate('cart-item-1', 3)] });
      expect(plans.get('cart-item-1')).toMatchObject({ discountedQuantity: 3, discountAmountMinor: 3 * 6_000 });
      await offers.finalizeConsumption(manager, {
        customerId: customer.id, orderId: order.id, itemPlans: plans, orderItemIdByCartItemId: new Map([['cart-item-1', item.id]]),
      });
    });
    for (const r of await ds.query('SELECT id FROM offer_consumptions WHERE order_id = $1', [order.id])) data.track('offer_consumptions', r.id);
    const [{ consumed_units_count }] = await ds.query('SELECT consumed_units_count FROM offers WHERE id = $1', [offer.id]);
    expect(consumed_units_count).toBe(3);

    // A further unit is refused by the real customer-limit query (SUM over live, non-reversed rows).
    await expect(
      ds.transaction((manager) => offers.planFlashSaleForCart(manager, { customerId: customer.id, items: [candidate('cart-item-2', 1)] })),
    ).rejects.toBeInstanceOf(FlashSaleLimitExceededException);

    // The one-consumption-per-OrderItem unique index rejects a duplicate at the database level.
    await expect(
      ds.query(
        `INSERT INTO offer_consumptions (offer_id, customer_id, order_id, mechanism_snapshot, order_item_id, quantity_consumed, discount_applied_minor)
         VALUES ($1, $2, $3, 'FLASH_SALE', $4, 1, 100)`,
        [offer.id, customer.id, order.id, item.id],
      ),
    ).rejects.toMatchObject({ code: '23505' });

    // Cancellation reversal: history stays (is_reversed = true), the allowance is restored, and reversing twice is a no-op.
    await ds.transaction((manager) => offers.reverseFlashSaleConsumptionForOrder(manager, order.id));
    await ds.transaction((manager) => offers.reverseFlashSaleConsumptionForOrder(manager, order.id));
    const rows = await ds.query('SELECT is_reversed, quantity_consumed, discount_applied_minor FROM offer_consumptions WHERE order_id = $1', [order.id]);
    expect(rows).toEqual([{ is_reversed: true, quantity_consumed: 3, discount_applied_minor: 18_000 }]);
    expect((await ds.query('SELECT consumed_units_count FROM offers WHERE id = $1', [offer.id]))[0].consumed_units_count).toBe(0);
    const again = await ds.transaction((manager) => offers.planFlashSaleForCart(manager, { customerId: customer.id, items: [candidate('cart-item-3', 3)] }));
    expect(again.plans.get('cart-item-3')?.discountedQuantity).toBe(3);
  });
});

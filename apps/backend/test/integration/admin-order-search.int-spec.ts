import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { createIntegrationApp } from './support/app';
import { TestData } from './support/test-data';
import { AdminOrdersService } from '../../src/modules/orders/admin-orders.service';
import { OrderStatus } from '../../src/modules/orders/order-status.enum';
import { Payment } from '../../src/modules/payments/entities/payment.entity';
import { PaymentStatus } from '../../src/modules/payments/payment-status.enum';
import { OrderVendorSegment } from '../../src/modules/orders/entities/order-vendor-segment.entity';
import { CartGroupType } from '../../src/modules/cart/cart-group-type.enum';

/**
 * M3b (Launch-Readiness Gap Audit, G-04) — real PostgreSQL coverage for
 * `AdminOrdersService.search`. The mixed raw-column-name / entity-join
 * query builder (matching this codebase's own established convention —
 * see SettlementService's identical style) can only be genuinely
 * proven correct against a real database; a mocked query builder (as
 * the rest of this codebase's unit specs use) would just echo back
 * whatever rows it's told to return, never proving the actual SQL is
 * right.
 */
describe('AdminOrdersService.search — real PostgreSQL', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let data: TestData;
  let service: AdminOrdersService;

  beforeAll(async () => {
    app = await createIntegrationApp();
    ds = app.get(DataSource);
    data = new TestData(ds);
    service = app.get(AdminOrdersService);
  });
  afterEach(async () => {
    await data.dispose();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('paginates deterministically, newest first, with a stable id tie-break', async () => {
    const customer = await data.user({ fullName: 'Search Pagination Customer' });
    const base = new Date('2026-02-01T00:00:00.000Z');
    const orders = [];
    for (let i = 0; i < 5; i++) {
      orders.push(await data.order(customer.id, { createdAt: new Date(base.getTime() + i * 1000) } as any));
    }

    const page1 = await service.search({ page: 1, limit: 2, search: customer.phone });
    const page2 = await service.search({ page: 2, limit: 2, search: customer.phone });
    const page3 = await service.search({ page: 3, limit: 2, search: customer.phone });

    expect(page1.total).toBe(5);
    expect(page1.data).toHaveLength(2);
    expect(page2.data).toHaveLength(2);
    expect(page3.data).toHaveLength(1);
    // Newest first: the last-created order (orders[4]) appears on page 1.
    expect(page1.data[0].id).toBe(orders[4].id);
    expect(page1.data[1].id).toBe(orders[3].id);
    expect(page2.data[0].id).toBe(orders[2].id);
    expect(page2.data[1].id).toBe(orders[1].id);
    expect(page3.data[0].id).toBe(orders[0].id);
    // No overlap/gap across pages.
    const allIds = [...page1.data, ...page2.data, ...page3.data].map((o) => o.id);
    expect(new Set(allIds).size).toBe(5);
  });

  it('filters by status', async () => {
    const customer = await data.user();
    const pending = await data.order(customer.id, { status: OrderStatus.PENDING } as any);
    const cancelled = await data.order(customer.id, { status: OrderStatus.CANCELLED } as any);

    const result = await service.search({ status: OrderStatus.CANCELLED, search: customer.phone });

    const ids = result.data.map((o) => o.id);
    expect(ids).toContain(cancelled.id);
    expect(ids).not.toContain(pending.id);
  });

  it('filters by date range (inclusive)', async () => {
    const customer = await data.user();
    const inRange = await data.order(customer.id, { createdAt: new Date('2026-03-15T12:00:00.000Z') } as any);
    const outOfRange = await data.order(customer.id, { createdAt: new Date('2026-01-01T00:00:00.000Z') } as any);

    const result = await service.search({
      search: customer.phone,
      dateFrom: '2026-03-01T00:00:00.000Z',
      dateTo: '2026-03-31T23:59:59.999Z',
    });

    const ids = result.data.map((o) => o.id);
    expect(ids).toContain(inRange.id);
    expect(ids).not.toContain(outOfRange.id);
  });

  it('looks up by exact order number', async () => {
    const customer = await data.user();
    // TestData.order()'s own default orderNumber (`HT-TEST-<random>`) is a placeholder shape that
    // never satisfies the REAL production format `isOrderNumber()` validates (`HT-######`, digits
    // only) — a realistic value is supplied explicitly here so this test exercises the actual
    // order-number lookup branch, not the free-text fallback.
    const order = await data.order(customer.id, { orderNumber: 'HT-100999' });

    const result = await service.search({ search: order.orderNumber });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe(order.id);
    expect(result.data[0].orderNumber).toBe(order.orderNumber);
  });

  it('looks up by order UUID', async () => {
    const customer = await data.user();
    const order = await data.order(customer.id);

    const result = await service.search({ search: order.id });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe(order.id);
  });

  it('a free-text search matches customer phone OR full name — never another customer\'s orders', async () => {
    const target = await data.user({ fullName: 'Findable Customer Name' });
    const other = await data.user({ fullName: 'Someone Else Entirely' });
    const targetOrder = await data.order(target.id);
    const otherOrder = await data.order(other.id);

    const byPhone = await service.search({ search: target.phone });
    expect(byPhone.data.map((o) => o.id)).toEqual([targetOrder.id]);

    const byName = await service.search({ search: 'Findable Customer' });
    expect(byName.data.map((o) => o.id)).toEqual([targetOrder.id]);
    expect(byName.data.map((o) => o.id)).not.toContain(otherOrder.id);
  });

  it('filters by payment status via the joined Payment row, without duplicating rows', async () => {
    const customer = await data.user();
    const paidOrder = await data.order(customer.id, { paymentMethod: 'MANUAL_TRANSFER' });
    await data.save<Payment>(Payment, { orderId: paidOrder.id, method: 'MANUAL_TRANSFER', status: PaymentStatus.PAID, amountMinor: 5000 });
    const pendingOrder = await data.order(customer.id, { paymentMethod: 'MANUAL_TRANSFER' });
    await data.save<Payment>(Payment, { orderId: pendingOrder.id, method: 'MANUAL_TRANSFER', status: PaymentStatus.PENDING });

    const result = await service.search({ search: customer.phone, paymentStatus: PaymentStatus.PAID });

    expect(result.data.map((o) => o.id)).toEqual([paidOrder.id]);
    expect(result.data[0].paymentStatus).toBe('PAID');
    // Exactly one row per order even though a Payment was joined.
    expect(new Set(result.data.map((o) => o.id)).size).toBe(result.data.length);
  });

  it('includes a real segment count for the current page, from a real second query', async () => {
    const customer = await data.user();
    const order = await data.order(customer.id, { orderNumber: 'HT-100998' });
    await data.save<OrderVendorSegment>(OrderVendorSegment, { orderId: order.id, groupType: CartGroupType.CATALOG });
    await data.save<OrderVendorSegment>(OrderVendorSegment, { orderId: order.id, groupType: CartGroupType.CATALOG });

    const result = await service.search({ search: order.orderNumber });

    expect(result.data[0].segmentCount).toBe(2);
  });

  it('an empty result set is a clean, well-formed page — never an error', async () => {
    const result = await service.search({ search: '+201000000000000' });
    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('never leaks another customer\'s order into a phone-number search result', async () => {
    const a = await data.user();
    const b = await data.user();
    await data.order(a.id);
    const bOrder = await data.order(b.id);

    const result = await service.search({ search: b.phone });

    expect(result.data.map((o) => o.id)).toEqual([bOrder.id]);
  });
});

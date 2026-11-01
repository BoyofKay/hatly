import { DataSource } from 'typeorm';
import { TestData } from './support/test-data';
import { Offer } from '../../src/modules/offers/entities/offer.entity';
import { OfferConsumption } from '../../src/modules/offers/entities/offer-consumption.entity';
import { OfferMechanism } from '../../src/modules/offers/offer-mechanism.enum';
import { DiscountType } from '../../src/modules/offers/discount-type.enum';
import { OfferConsumptionService } from '../../src/modules/offers/offer-consumption.service';
import { FinancialEvent } from '../../src/modules/finance/entities/financial-event.entity';
import { FinancialEventService } from '../../src/modules/finance/financial-event.service';
import { FinancialEventDirection, FinancialEventType } from '../../src/modules/finance/financial-event-type.enum';

/**
 * PD-015 on real PostgreSQL, through the real services (no HTTP): the compensating event is written inside the caller's transaction,
 * linked to the original and to the segment, exactly once when two requests reverse the same consumption at the same moment, and the
 * net summary reads recorded − restored.
 */
describe('Hatly-funded discount compensation (real PostgreSQL)', () => {
  let ds: DataSource;
  let data: TestData;
  let events: FinancialEventService;
  let service: OfferConsumptionService;
  const orderIds: string[] = [];

  beforeAll(async () => {
    const { AppDataSource } = await import('../../src/database/data-source');
    ds = AppDataSource;
    if (!ds.isInitialized) await ds.initialize();
    data = new TestData(ds);
    events = new FinancialEventService(ds.getRepository(FinancialEvent), { getCorrelationId: () => 'int-test' } as never);
    service = new OfferConsumptionService(ds, events);
  });
  afterEach(async () => {
    if (orderIds.length) await ds.query('DELETE FROM financial_events WHERE order_id = ANY($1::uuid[])', [orderIds.splice(0)]);
    await data.dispose();
  });
  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  /** An order with one discounted segment: the consumption row, and the original (order-level) event as order creation writes it. */
  async function discountedOrder(discountMinor = 1500) {
    const customer = await data.user();
    const branch = await data.vendorBranch();
    const order = await data.order(customer.id);
    orderIds.push(order.id);
    const segment = await data.segment(order.id, branch.id);
    const offer = await data.save<Offer>(Offer, {
      vendorBranchId: branch.id,
      name: 'PD15 int',
      mechanism: OfferMechanism.SUBTOTAL_DISCOUNT,
      discountType: DiscountType.FIXED,
      discountValue: discountMinor,
      startAt: new Date(Date.now() - 3600_000),
      endAt: new Date(Date.now() + 3600_000),
      isActive: true,
      consumedUnitsCount: 1,
      consumedDiscountMinor: discountMinor,
    } as Partial<Offer>);
    const consumption = await data.save<OfferConsumption>(OfferConsumption, {
      offerId: offer.id,
      customerId: customer.id,
      orderId: order.id,
      mechanismSnapshot: OfferMechanism.SUBTOTAL_DISCOUNT,
      orderVendorSegmentId: segment.id,
      quantityConsumed: 1,
      discountAppliedMinor: discountMinor,
    } as Partial<OfferConsumption>);
    await service.recordHatlyFundedDiscountEvent(order.id, discountMinor);
    return { order, segment, offer, consumption };
  }
  const reverseInTransaction = (orderId: string, segmentId: string) =>
    ds.transaction(async (manager) => {
      // what every caller does first: the order row lock serialises concurrent rejections/cancellations of the same order
      await manager.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
      await service.reverseSubtotalDiscountConsumptionForOrder(manager, orderId, [segmentId]);
    });

  it('writes the compensating event inside the transaction: positive amount, linked to the original and the segment, original unchanged', async () => {
    const { order, segment, consumption } = await discountedOrder(1500);
    const [original] = await ds.query("SELECT * FROM financial_events WHERE order_id = $1 AND type = 'HATLY_FUNDED_OFFER_DISCOUNT_RECORDED'", [order.id]);

    await reverseInTransaction(order.id, segment.id);

    const rows = await ds.query("SELECT * FROM financial_events WHERE order_id = $1 AND type = 'HATLY_FUNDED_OFFER_DISCOUNT_RESTORED'", [order.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      direction: FinancialEventDirection.INFORMATIONAL,
      order_vendor_segment_id: segment.id,
      related_event_id: original.id,
      vendor_branch_id: null,
      idempotency_key: `hatly-funded-offer-discount-restored:${consumption.id}`,
    });
    expect(Number(rows[0].amount_minor)).toBe(1500);
    const [originalAfter] = await ds.query('SELECT * FROM financial_events WHERE id = $1', [original.id]);
    expect(originalAfter).toEqual(original);
    expect(await events.hatlyFundedDiscountSummary(order.id)).toEqual({ recordedMinor: 1500, restoredMinor: 1500, netMinor: 0 });
  });

  it('two requests reversing the same consumption at the same moment compensate once (and restore the offer once)', async () => {
    const { order, segment, offer } = await discountedOrder(900);
    await Promise.all([reverseInTransaction(order.id, segment.id), reverseInTransaction(order.id, segment.id), reverseInTransaction(order.id, segment.id)]);
    expect(await ds.query("SELECT id FROM financial_events WHERE order_id = $1 AND type = 'HATLY_FUNDED_OFFER_DISCOUNT_RESTORED'", [order.id])).toHaveLength(1);
    const [row] = await ds.query('SELECT consumed_units_count, consumed_discount_minor FROM offers WHERE id = $1', [offer.id]);
    expect(Number(row.consumed_units_count)).toBe(0);
    expect(Number(row.consumed_discount_minor)).toBe(0);
    expect((await events.hatlyFundedDiscountSummary(order.id)).netMinor).toBe(0);
  });

  it('the database itself refuses a second compensation for the same consumption (unique idempotency key)', async () => {
    const { order, segment, consumption } = await discountedOrder(700);
    await reverseInTransaction(order.id, segment.id);
    await expect(
      ds.query(
        `INSERT INTO financial_events (type, direction, amount_minor, order_id, idempotency_key) VALUES ($1, 'INFORMATIONAL', 700, $2, $3)`,
        [FinancialEventType.HATLY_FUNDED_OFFER_DISCOUNT_RESTORED, order.id, `hatly-funded-offer-discount-restored:${consumption.id}`],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('a failure after the reversal rolls the compensation back with it (nothing half-recorded)', async () => {
    const { order, segment, consumption } = await discountedOrder(600);
    await expect(
      ds.transaction(async (manager) => {
        await manager.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [order.id]);
        await service.reverseSubtotalDiscountConsumptionForOrder(manager, order.id, [segment.id]);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await ds.query("SELECT id FROM financial_events WHERE order_id = $1 AND type = 'HATLY_FUNDED_OFFER_DISCOUNT_RESTORED'", [order.id])).toEqual([]);
    expect((await ds.query('SELECT is_reversed FROM offer_consumptions WHERE id = $1', [consumption.id]))[0].is_reversed).toBe(false);
    expect((await events.hatlyFundedDiscountSummary(order.id)).netMinor).toBe(600);
  });

  it('an order that never recorded the original event is not compensated', async () => {
    const { order, segment } = await discountedOrder(500);
    await ds.query("DELETE FROM financial_events WHERE order_id = $1", [order.id]);
    await reverseInTransaction(order.id, segment.id);
    expect(await ds.query('SELECT id FROM financial_events WHERE order_id = $1', [order.id])).toEqual([]);
    expect(await events.hatlyFundedDiscountSummary(order.id)).toEqual({ recordedMinor: 0, restoredMinor: 0, netMinor: 0 });
  });
});

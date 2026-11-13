import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { createIntegrationApp } from './support/app';
import { TestData } from './support/test-data';
import { SettlementService } from '../../src/modules/finance/settlement.service';
import { SettlementClosingService } from '../../src/modules/finance/settlement-closing.service';
import { FinancialEvent } from '../../src/modules/finance/entities/financial-event.entity';
import { FinancialEventDirection, FinancialEventType } from '../../src/modules/finance/financial-event-type.enum';
import { OrderVendorSegment } from '../../src/modules/orders/entities/order-vendor-segment.entity';
import { OrderVendorSegmentStatus } from '../../src/modules/orders/order-vendor-segment-status.enum';
import { CartGroupType } from '../../src/modules/cart/cart-group-type.enum';
import { BusinessConfigService } from '../../src/modules/business-config/business-config.service';
import { BusinessConfigKey } from '../../src/modules/business-config/business-config-key.enum';
import { SettlementFrequency } from '../../src/modules/finance/settlement-frequency.enum';
import { Role } from '../../src/common/enums/role.enum';

/**
 * Courier shift closing and vendor period closing (2026-11-13) against real PostgreSQL: the SQL that gathers the facts of each order /
 * store part, the one-closing-per-order/segment guarantee, unresolved orders carried forward, the handover-time basis of vendor closings,
 * and the legacy (event-window) periods left untouched. Amounts in piasters.
 */
describe('Settlement closing — real SQL', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let data: TestData;
  let configData: TestData;
  let settlement: SettlementService;
  let closing: SettlementClosingService;

  beforeAll(async () => {
    app = await createIntegrationApp();
    ds = app.get(DataSource);
    data = new TestData(ds);
    configData = new TestData(ds);
    settlement = app.get(SettlementService);
    closing = app.get(SettlementClosingService);
    const configAdmin = await configData.user();
    const row = await app.get(BusinessConfigService).set(BusinessConfigKey.VENDOR_SETTLEMENT_FREQUENCY, SettlementFrequency.WEEKLY, configAdmin.id);
    configData.track('business_config', row.id);
  });
  afterEach(async () => {
    await data.dispose();
  });
  afterAll(async () => {
    await configData.dispose();
    await app?.close();
  });

  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

  async function statusEvent(orderId: string, toStatus: string, at: Date) {
    const [r] = await ds.query(`INSERT INTO order_status_events (order_id, to_status, created_at) VALUES ($1, $2, $3) RETURNING id`, [orderId, toStatus, at]);
    data.track('order_status_events', r.id);
  }

  /** Tracks what a close wrote so afterEach removes it (lines before the period, the period before its orders — reverse order). */
  async function trackCourierClose(periodId: string) {
    data.track('driver_settlement_periods', periodId);
    for (const r of await ds.query(`SELECT id FROM driver_settlement_period_orders WHERE period_id = $1`, [periodId])) data.track('driver_settlement_period_orders', r.id);
  }
  async function trackVendorClose(periodId: string) {
    data.track('vendor_settlement_periods', periodId);
    for (const r of await ds.query(`SELECT id FROM vendor_settlement_period_lines WHERE period_id = $1`, [periodId])) data.track('vendor_settlement_period_lines', r.id);
  }

  async function courier() {
    const u = await data.user({ role: Role.DRIVER, fullName: 'Closing Courier' });
    return data.driver(u.id);
  }

  /**
   * An order of `driverId`: store parts (subtotals), the vendor commission per part (unless `commissionMinor: null`), the handover and
   * delivered status events, and the DRIVER_COMMISSION event (fee, commission) unless `rate: null`.
   */
  async function deliveredOrder(driverId: string, o: {
    paymentMethod: string; totalMinor: number; amountDueMinor: number | null;
    parts: Array<{ branchId: string; subtotalMinor: number; status?: OrderVendorSegmentStatus; commissionMinor?: number | null }>;
    fee?: number; commission?: number; rate?: null; status?: string; deliveredAt?: Date; pickedUpAt?: Date;
  }) {
    const status = o.status ?? 'DELIVERED';
    const handedOver = ['PICKED_UP', 'ON_THE_WAY', 'DELIVERED', 'FAILED_DELIVERY'].includes(status);
    const customer = await data.user();
    const order = await data.order(customer.id, { paymentMethod: o.paymentMethod } as any);
    await ds.query(`UPDATE orders SET status = $2, total_minor = $3, amount_due_minor = $4 WHERE id = $1`, [order.id, status, o.totalMinor, o.amountDueMinor]);
    for (const p of o.parts) {
      const seg = await data.save<OrderVendorSegment>(OrderVendorSegment, {
        orderId: order.id, vendorBranchId: p.branchId, groupType: CartGroupType.CATALOG, subtotalMinor: p.subtotalMinor, status: p.status ?? OrderVendorSegmentStatus.READY_FOR_PICKUP,
      });
      if (handedOver && p.commissionMinor !== null && p.status !== OrderVendorSegmentStatus.CANCELLED) {
        await data.save<FinancialEvent>(FinancialEvent, {
          createdAt: o.pickedUpAt ?? minutesAgo(30), type: FinancialEventType.VENDOR_COMMISSION_RECOGNIZED, direction: FinancialEventDirection.RECEIVABLE,
          idempotencyKey: `vendor-commission:${seg.id}`, vendorBranchId: p.branchId, orderId: order.id, orderVendorSegmentId: seg.id,
          amountMinor: p.commissionMinor ?? Math.round(p.subtotalMinor / 10),
        });
      }
    }
    const delivery = await data.delivery(order.id, driverId);
    if (handedOver) await statusEvent(order.id, 'PICKED_UP', o.pickedUpAt ?? minutesAgo(30));
    if (status === 'DELIVERED') {
      await statusEvent(order.id, 'DELIVERED', o.deliveredAt ?? minutesAgo(10));
      if (o.rate !== null) {
        await data.save<FinancialEvent>(FinancialEvent, {
          createdAt: o.deliveredAt ?? minutesAgo(10), type: FinancialEventType.DRIVER_COMMISSION_RECOGNIZED, direction: FinancialEventDirection.RECEIVABLE,
          idempotencyKey: `driver-commission:${order.id}`, driverId, orderId: order.id, deliveryId: delivery.id, amountMinor: o.commission ?? 300,
          rateSnapshot: { commissionRateBasisPoints: 1000, baseAmountMinor: o.fee ?? 3000 },
        });
      }
    }
    return { order, delivery, customerId: customer.id };
  }

  const cairoToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

  describe('courier shift closing', () => {
    it('COD and electronic orders settle by their own facts; multi-store goods are summed; totals = Σ lines', async () => {
      const d = await courier();
      const a = await data.vendorBranch();
      const b = await data.vendorBranch();
      const admin = await data.user();
      // COD, two stores 120 + 80, fee 30, commission 3 → the courier owes 3
      const cod = await deliveredOrder(d.id, { paymentMethod: 'COD', totalMinor: 23000, amountDueMinor: 23000, parts: [{ branchId: a.id, subtotalMinor: 12000 }, { branchId: b.id, subtotalMinor: 8000 }] });
      // InstaPay: Hatly owes 200 + 30 − 3
      const tr = await deliveredOrder(d.id, { paymentMethod: 'MANUAL_TRANSFER', totalMinor: 23000, amountDueMinor: 0, parts: [{ branchId: a.id, subtotalMinor: 20000 }] });

      const preview = await closing.courierPreview(d.id);
      expect(preview.unresolved).toEqual([]);
      const byOrder = Object.fromEntries(preview.lines.map((l) => [l.orderId, l.netToCourierMinor]));
      expect(byOrder[cod.order.id]).toBe(-300);
      expect(byOrder[tr.order.id]).toBe(22700);
      expect(preview.totals.netToCourierMinor).toBe(22400);
      expect(preview.direction).toBe('PAYOUT');

      const closed = await settlement.closeDriverPeriod(d.id, admin.id, { previewToken: preview.previewToken });
      await trackCourierClose(closed.id);
      expect(closed.reference).toMatch(/^CS-\d{8}-[0-9A-F]{6}$/);
      expect(closed.netPayableMinor).toBe(22400);
      expect(closed.frequency).toBe('DAILY');
      const [stored] = await ds.query(`SELECT sum(net_to_courier_minor)::bigint AS n, count(*)::int AS c FROM driver_settlement_period_orders WHERE period_id = $1`, [closed.id]);
      expect([Number(stored.n), stored.c]).toEqual([22400, 2]);
      const parts = await ds.query(`SELECT order_id, payment_flow, goods_pass_through_minor::int AS pass, goods_reimbursement_minor::int AS reimb, cash_held_minor::int AS held FROM driver_settlement_period_orders WHERE period_id = $1`, [closed.id]);
      expect(parts.find((x: any) => x.order_id === cod.order.id)).toMatchObject({ payment_flow: 'COD', pass: 20000, reimb: 0, held: 3000 }); // COD goods excluded
      expect(parts.find((x: any) => x.order_id === tr.order.id)).toMatchObject({ payment_flow: 'ELECTRONIC', pass: 0, reimb: 20000, held: 0 });
      const [period] = await ds.query(`SELECT total_reimbursements_owed_minor::int AS reimb, goods_pass_through_minor::int AS pass, cash_held_minor::int AS held FROM driver_settlement_periods WHERE id = $1`, [closed.id]);
      expect(period).toEqual({ reimb: 20000, pass: 20000, held: 3000 }); // the legacy "reimbursements" column now holds only what Hatly owes back
    });

    it('wallet + COD and approved change are counted from facts; a change still under review keeps that order out', async () => {
      const d = await courier();
      const a = await data.vendorBranch();
      const admin = await data.user();
      const mixed = await deliveredOrder(d.id, { paymentMethod: 'COD', totalMinor: 23000, amountDueMinor: 18000, parts: [{ branchId: a.id, subtotalMinor: 20000 }] });
      const change = await deliveredOrder(d.id, { paymentMethod: 'COD', totalMinor: 23000, amountDueMinor: 23000, parts: [{ branchId: a.id, subtotalMinor: 20000 }] });
      const pending = await deliveredOrder(d.id, { paymentMethod: 'COD', totalMinor: 23000, amountDueMinor: 23000, parts: [{ branchId: a.id, subtotalMinor: 20000 }] });
      for (const [o, status] of [[change, 'APPROVED'], [pending, 'PENDING_REVIEW']] as const) {
        const [r] = await ds.query(
          `INSERT INTO driver_cash_remainders (order_id, delivery_id, driver_id, customer_id, remainder_amount_minor, submitted_at, status) VALUES ($1, $2, $3, $4, 2000, now(), $5) RETURNING id`,
          [o.order.id, o.delivery.id, d.id, o.customerId, status],
        );
        data.track('driver_cash_remainders', r.id);
      }
      const preview = await closing.courierPreview(d.id);
      const net = Object.fromEntries(preview.lines.map((l) => [l.orderId, l.netToCourierMinor]));
      expect(net[mixed.order.id]).toBe(4700);
      expect(net[change.order.id]).toBe(-2300);
      expect(net[pending.order.id]).toBeUndefined();
      expect(preview.unresolved).toEqual([expect.objectContaining({ orderId: pending.order.id, reason: 'CHANGE_PENDING_REVIEW' })]);
      const closed = await settlement.closeDriverPeriod(d.id, admin.id);
      await trackCourierClose(closed.id);
      expect(closed.unresolved).toHaveLength(1);
      // the pending order still waits for a later closing
      expect((await closing.courierPreview(d.id)).unresolved.map((u) => u.orderId)).toEqual([pending.order.id]);
    });

    it('rate undefined, legacy pay-at-delivery, orders on the road and unresolved failed deliveries are listed — never settled or guessed', async () => {
      const d = await courier();
      const a = await data.vendorBranch();
      const admin = await data.user();
      const part = [{ branchId: a.id, subtotalMinor: 700 }];
      const noRate = await deliveredOrder(d.id, { paymentMethod: 'COD', totalMinor: 1000, amountDueMinor: 1000, parts: part, rate: null });
      const legacy = await deliveredOrder(d.id, { paymentMethod: 'PAY_AT_DELIVERY', totalMinor: 1000, amountDueMinor: 1000, parts: part });
      const road = await deliveredOrder(d.id, { paymentMethod: 'COD', totalMinor: 1000, amountDueMinor: 1000, parts: part, status: 'ON_THE_WAY' });
      const failed = await deliveredOrder(d.id, { paymentMethod: 'COD', totalMinor: 1000, amountDueMinor: 1000, parts: part, status: 'FAILED_DELIVERY' });
      const ok = await deliveredOrder(d.id, { paymentMethod: 'COD', totalMinor: 1000, amountDueMinor: 1000, parts: part });
      const p = await closing.courierPreview(d.id);
      expect(p.lines.map((l) => l.orderId)).toEqual([ok.order.id]);
      expect(Object.fromEntries(p.unresolved.map((u) => [u.orderId, u.reason]))).toEqual({
        [noRate.order.id]: 'RATE_UNDEFINED', [legacy.order.id]: 'LEGACY_PAY_AT_DELIVERY', [road.order.id]: 'IN_PROGRESS', [failed.order.id]: 'FAILED_DELIVERY_NEEDS_RESOLUTION',
      });
      const closed = await settlement.closeDriverPeriod(d.id, admin.id);
      await trackCourierClose(closed.id);
      const [row] = await ds.query(`SELECT unresolved_count, orders_count FROM driver_settlement_periods WHERE id = $1`, [closed.id]);
      expect(row).toEqual({ unresolved_count: 4, orders_count: 1 });
      expect((await ds.query(`SELECT status FROM orders WHERE id = $1`, [road.order.id]))[0].status).toBe('ON_THE_WAY'); // a closing never moves an order
    });

    it('double close: a stale preview token is refused, a second close finds nothing, and the database refuses a second line for an order', async () => {
      const d = await courier();
      const a = await data.vendorBranch();
      const admin = await data.user();
      const part = [{ branchId: a.id, subtotalMinor: 700 }];
      const o = await deliveredOrder(d.id, { paymentMethod: 'COD', totalMinor: 1000, amountDueMinor: 1000, parts: part });
      const preview = await closing.courierPreview(d.id);
      const first = await settlement.closeDriverPeriod(d.id, admin.id, { previewToken: preview.previewToken });
      await trackCourierClose(first.id);
      await expect(settlement.closeDriverPeriod(d.id, admin.id, { previewToken: preview.previewToken })).rejects.toMatchObject({ response: { details: { code: 'PREVIEW_CHANGED' } } });
      await expect(settlement.closeDriverPeriod(d.id, admin.id)).rejects.toMatchObject({ response: { details: { code: 'NOTHING_TO_CLOSE' } } });
      await expect(ds.query(
        `INSERT INTO driver_settlement_period_orders (period_id, order_id, payment_method, payment_flow, fee_entitlement_minor, commission_minor, courier_compensation_minor,
           goods_paid_to_stores_minor, goods_pass_through_minor, goods_reimbursement_minor, cash_collected_minor, cash_held_minor, change_kept_minor, collected_by_hatly_minor, net_to_courier_minor)
         VALUES ($1, $2, 'COD', 'COD', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)`,
        [first.id, o.order.id],
      )).rejects.toMatchObject({ driverError: { code: '23505' } });
      // the next shift starts exactly where this one ended
      const o2 = await deliveredOrder(d.id, { paymentMethod: 'COD', totalMinor: 1000, amountDueMinor: 1000, parts: part });
      const second = await settlement.closeDriverPeriod(d.id, admin.id);
      await trackCourierClose(second.id);
      expect(second.periodStart).toBe(first.periodEnd);
      expect(second.lines.map((l) => l.orderId)).toEqual([o2.order.id]);
    });

    it('orders covered by a period closed with the earlier formula are not settled again, and that period is never recomputed', async () => {
      const d = await courier();
      const a = await data.vendorBranch();
      const admin = await data.user();
      const part = [{ branchId: a.id, subtotalMinor: 700 }];
      const old = await deliveredOrder(d.id, { paymentMethod: 'MANUAL_TRANSFER', totalMinor: 1000, amountDueMinor: 0, parts: part, deliveredAt: minutesAgo(120), pickedUpAt: minutesAgo(130) });
      const [legacy] = await ds.query(
        `INSERT INTO driver_settlement_periods (driver_id, frequency, period_start, period_end, status, total_earnings_minor, total_commission_owed_minor, total_reimbursements_owed_minor, net_payable_minor, closed_at, closed_by_user_id, reference)
         VALUES ($1, 'WEEKLY', $2, $3, 'CLOSED', 3000, 300, 0, 2700, $3, $4, 'LEGACY-T' || substr(md5(random()::text), 1, 10)) RETURNING id, method_version, net_payable_minor`,
        [d.id, minutesAgo(200), minutesAgo(60), admin.id],
      );
      data.track('driver_settlement_periods', legacy.id);
      expect(legacy.method_version).toBe(1);
      const fresh = await deliveredOrder(d.id, { paymentMethod: 'COD', totalMinor: 1000, amountDueMinor: 1000, parts: part });
      const p = await closing.courierPreview(d.id);
      expect(p.lines.map((l) => l.orderId)).toEqual([fresh.order.id]);
      expect(p.lines.map((l) => l.orderId)).not.toContain(old.order.id);
      const closed = await settlement.closeDriverPeriod(d.id, admin.id);
      await trackCourierClose(closed.id);
      const [after] = await ds.query(`SELECT net_payable_minor, method_version FROM driver_settlement_periods WHERE id = $1`, [legacy.id]);
      expect(after).toEqual({ net_payable_minor: legacy.net_payable_minor, method_version: 1 });
    });

    it('statement by range: closings, a partial payment and what remains; balances from before the range are reported separately', async () => {
      const d = await courier();
      const a = await data.vendorBranch();
      const admin = await data.user();
      await deliveredOrder(d.id, { paymentMethod: 'MANUAL_TRANSFER', totalMinor: 23000, amountDueMinor: 0, parts: [{ branchId: a.id, subtotalMinor: 20000 }] });
      const closed = await settlement.closeDriverPeriod(d.id, admin.id);
      await trackCourierClose(closed.id);
      const [pay] = await ds.query(
        `INSERT INTO settlement_payments (party_type, driver_period_id, direction, amount_minor, method, paid_on, recorded_by_user_id, idempotency_key, status)
         VALUES ('DRIVER', $1, 'PAYOUT', 10000, 'CASH', current_date, $2, $3, 'RECORDED') RETURNING id`,
        [closed.id, admin.id, `t-${closed.id}`],
      );
      data.track('settlement_payments', pay.id);
      const st = await closing.courierStatement(d.id, cairoToday(), cairoToday());
      expect(st.periods).toHaveLength(1);
      expect(st.periods[0]).toMatchObject({ reference: closed.reference, direction: 'PAYOUT', dueMinor: 22700, settledMinor: 10000, remainingMinor: 12700, paymentStatus: 'PARTIAL' });
      expect(st.totals.signedRemainingMinor).toBe(12700);
      expect(st.lines.reduce((t, l) => t + l.netToCourierMinor, 0)).toBe(st.totals.netToCourierMinor);
      const later = await closing.courierStatement(d.id, '2999-01-01', '2999-01-02');
      expect(later.periods).toEqual([]);
      expect(later.totals.signedRemainingBeforeRangeMinor).toBe(12700);
    });
  });

  describe('vendor period closing', () => {
    it('covers parts by HANDOVER time, each part under its own store, excludes cancelled parts, flags rate-undefined ones', async () => {
      const d = await courier();
      const a = await data.vendorBranch();
      const b = await data.vendorBranch();
      const admin = await data.user();
      const multi = await deliveredOrder(d.id, {
        paymentMethod: 'COD', totalMinor: 30000, amountDueMinor: 30000,
        parts: [
          { branchId: a.id, subtotalMinor: 12000, commissionMinor: 1200 },
          { branchId: b.id, subtotalMinor: 8000, commissionMinor: 800 },
          { branchId: a.id, subtotalMinor: 99999, status: OrderVendorSegmentStatus.CANCELLED },
        ],
      });
      const noRate = await deliveredOrder(d.id, { paymentMethod: 'COD', totalMinor: 5000, amountDueMinor: 5000, parts: [{ branchId: a.id, subtotalMinor: 5000, commissionMinor: null }] });
      await deliveredOrder(d.id, { paymentMethod: 'COD', totalMinor: 5000, amountDueMinor: 5000, parts: [{ branchId: a.id, subtotalMinor: 4000 }], status: 'ASSIGNED_TO_DRIVER' }); // not handed over

      const p = await closing.vendorPreview(a.id);
      expect(p.lines.map((l) => [l.orderId, l.segmentSubtotalMinor, l.commissionMinor])).toEqual(expect.arrayContaining([
        [multi.order.id, 12000, 1200], [noRate.order.id, 5000, null],
      ]));
      expect(p.lines).toHaveLength(2);
      expect(p.totals).toMatchObject({ grossSalesMinor: 17000, commissionOwedByVendorMinor: 1200, rateUndefinedParts: 1, collectedByHatlyForVendorMinor: 0 });
      const closedA = await settlement.closeVendorPeriod(a.id, admin.id, { previewToken: p.previewToken });
      await trackVendorClose(closedA.id);
      expect(closedA).toMatchObject({ grossSalesMinor: 17000, totalCommissionOwedMinor: 1200, frequency: 'WEEKLY', methodVersion: 2 });
      expect(closedA.reference).toMatch(/^VS-\d{8}-[0-9A-F]{6}$/);
      const pb = await closing.vendorPreview(b.id);
      expect(pb.lines.map((l) => [l.orderId, l.segmentSubtotalMinor])).toEqual([[multi.order.id, 8000]]); // B's part is B's alone
      await expect(settlement.closeVendorPeriod(a.id, admin.id)).rejects.toMatchObject({ response: { details: { code: 'NOTHING_TO_CLOSE' } } });
    });

    it('a chosen period end includes parts handed over before it and leaves later ones for the next period', async () => {
      const d = await courier();
      const a = await data.vendorBranch();
      const admin = await data.user();
      const early = await deliveredOrder(d.id, { paymentMethod: 'COD', totalMinor: 1000, amountDueMinor: 1000, parts: [{ branchId: a.id, subtotalMinor: 1000, commissionMinor: 100 }], pickedUpAt: minutesAgo(90), deliveredAt: minutesAgo(80) });
      const late = await deliveredOrder(d.id, { paymentMethod: 'COD', totalMinor: 2000, amountDueMinor: 2000, parts: [{ branchId: a.id, subtotalMinor: 2000, commissionMinor: 200 }], pickedUpAt: minutesAgo(20) });
      const cut = minutesAgo(60).toISOString();
      const first = await settlement.closeVendorPeriod(a.id, admin.id, { periodEnd: cut });
      await trackVendorClose(first.id);
      expect(first.lines.map((l) => l.orderId)).toEqual([early.order.id]);
      expect(first.periodEnd).toBe(cut);
      const second = await settlement.closeVendorPeriod(a.id, admin.id);
      await trackVendorClose(second.id);
      expect(second.lines.map((l) => l.orderId)).toEqual([late.order.id]);
      expect(second.periodStart).toBe(cut);
      const st = await closing.vendorStatement(a.id, cairoToday(), cairoToday());
      expect(st.totals).toMatchObject({ closings: 2, grossSalesMinor: 3000, commissionOwedByVendorMinor: 300, remainingMinor: 300 });
    });
  });
});

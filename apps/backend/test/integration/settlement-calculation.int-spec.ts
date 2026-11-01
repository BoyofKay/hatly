import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { createIntegrationApp } from './support/app';
import { TestData } from './support/test-data';
import { SettlementService } from '../../src/modules/finance/settlement.service';
import { FinancialEvent } from '../../src/modules/finance/entities/financial-event.entity';
import { FinancialEventDirection, FinancialEventType } from '../../src/modules/finance/financial-event-type.enum';
import { OrderVendorSegment } from '../../src/modules/orders/entities/order-vendor-segment.entity';
import { OrderVendorSegmentStatus } from '../../src/modules/orders/order-vendor-segment-status.enum';
import { CartGroupType } from '../../src/modules/cart/cart-group-type.enum';
import { BusinessConfigService } from '../../src/modules/business-config/business-config.service';
import { BusinessConfigKey } from '../../src/modules/business-config/business-config-key.enum';
import { SettlementFrequency } from '../../src/modules/finance/settlement-frequency.enum';

/**
 * M2 (Launch-Readiness Gap Audit, G-13) — real PostgreSQL coverage for
 * `SettlementService.closeVendorPeriod`'s gross-sales query. The unit
 * spec (`settlement.service.spec.ts`) mocks `segmentsRepository.
 * createQueryBuilder()` entirely, so it can prove the service SUMS
 * whatever rows come back correctly, but it can never prove the actual
 * SQL predicate excludes CANCELLED segments — only a real query against
 * a real table can. This is the first settlement coverage to run
 * against a real database (no settlement e2e/integration spec existed
 * before M2).
 */
describe('SettlementService.closeVendorPeriod — real gross-sales aggregation', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let data: TestData;
  let settlement: SettlementService;
  // Kept OUTSIDE `data` (a separate `TestData` instance, its own independent
  // tracking list) so the per-test `data.dispose()` in `afterEach` below —
  // which must run after every `it` to clean up that test's own branch/
  // order/segments/period — can never touch this file-scoped config row or
  // the user it references, which both need to outlive every single test.
  let configData: TestData;

  beforeAll(async () => {
    app = await createIntegrationApp();
    ds = app.get(DataSource);
    data = new TestData(ds);
    configData = new TestData(ds);
    settlement = app.get(SettlementService);

    // `VENDOR_SETTLEMENT_FREQUENCY` is deliberately never seeded by any
    // migration ("do not invent a settlement day" — see SettlementService's
    // own top comment) — `closeVendorPeriod` fails loudly via
    // `BusinessConfigService.getRequired` without it. Set once for this
    // whole file, restored to unset in `afterAll` so no other spec in the
    // shared integration DB observes it as configured.
    const businessConfig = app.get(BusinessConfigService);
    const configAdmin = await configData.user();
    const configRow = await businessConfig.set(BusinessConfigKey.VENDOR_SETTLEMENT_FREQUENCY, SettlementFrequency.WEEKLY, configAdmin.id);
    configData.track('business_config', configRow.id);
  });
  afterEach(async () => {
    await data.dispose();
  });
  afterAll(async () => {
    await configData.dispose(); // removes the business_config row, then its referenced user
    await app?.close();
  });

  /**
   * Seeds one earliest `FinancialEvent` for the branch (so `periodStart` is
   * a real past timestamp rather than degenerating to `periodStart ===
   * periodEnd`, which the service correctly refuses as "no new activity"),
   * then the requested segments, all real rows in real tables.
   *
   * The rows are dated explicitly in the PAST (`createdAt`), not left to the
   * database's `now()`: `closeVendorPeriod` takes `periodEnd = new Date()`
   * (millisecond precision) while `created_at` has microseconds, so a row
   * inserted in the same millisecond as the close compares as `>= periodEnd`
   * and belongs to the NEXT period (by design — the next period starts at this
   * `periodEnd`, so nothing is lost). That was this spec's intermittent
   * failure: whether the last seeded row landed in the period depended on how
   * fast the local database answered.
   */
  async function seedBranchWithSegments(
    segmentSpecs: Array<{ subtotalMinor: number; status: OrderVendorSegmentStatus }>,
  ) {
    const branch = await data.vendorBranch();
    const admin = await data.user();
    const customer = await data.user();
    const order = await data.order(customer.id);
    const now = Date.now();

    await data.save<FinancialEvent>(FinancialEvent, {
      createdAt: new Date(now - 60_000),
      type: FinancialEventType.VENDOR_COMMISSION_RECOGNIZED,
      direction: FinancialEventDirection.RECEIVABLE,
      idempotencyKey: `settlement-calc-seed-${branch.id}`,
      vendorBranchId: branch.id,
      amountMinor: 10,
    });

    for (const spec of segmentSpecs) {
      await data.save<OrderVendorSegment>(OrderVendorSegment, {
        orderId: order.id,
        vendorBranchId: branch.id,
        groupType: CartGroupType.CATALOG,
        subtotalMinor: spec.subtotalMinor,
        status: spec.status,
        createdAt: new Date(now - 30_000),
      });
    }

    return { branch, admin };
  }

  it('a CANCELLED segment is excluded from gross sales entirely', async () => {
    const { branch, admin } = await seedBranchWithSegments([
      { subtotalMinor: 5_000, status: OrderVendorSegmentStatus.CANCELLED },
    ]);

    const period = await settlement.closeVendorPeriod(branch.id, admin.id);

    expect(period.grossSalesMinor).toBe(0); // the ONLY segment was cancelled — nothing eligible
    data.track('vendor_settlement_periods', period.id);
  });

  it('a non-cancelled eligible segment remains fully included', async () => {
    const { branch, admin } = await seedBranchWithSegments([
      { subtotalMinor: 3_000, status: OrderVendorSegmentStatus.CONFIRMED },
    ]);

    const period = await settlement.closeVendorPeriod(branch.id, admin.id);

    expect(period.grossSalesMinor).toBe(3_000);
    // the explicit past dating really reached the database (not replaced by now()): the period starts at the seed event, a minute ago
    expect(Date.now() - period.periodStart.getTime()).toBeGreaterThanOrEqual(59_000);
    data.track('vendor_settlement_periods', period.id);
  });

  it('mixed cancelled + eligible segments produce the EXACT expected gross sales — the cancelled amount never leaks in', async () => {
    const { branch, admin } = await seedBranchWithSegments([
      { subtotalMinor: 1_000, status: OrderVendorSegmentStatus.CONFIRMED },
      { subtotalMinor: 2_500, status: OrderVendorSegmentStatus.PREPARING },
      { subtotalMinor: 750, status: OrderVendorSegmentStatus.PICKED_UP },
      { subtotalMinor: 99_999, status: OrderVendorSegmentStatus.CANCELLED }, // must never be counted
    ]);

    const period = await settlement.closeVendorPeriod(branch.id, admin.id);

    expect(period.grossSalesMinor).toBe(1_000 + 2_500 + 750); // exactly 4,250 — NOT +99,999
    data.track('vendor_settlement_periods', period.id);
  });

  it('vendor payable (gross sales - commission) is computed from the corrected, cancellation-safe gross sales figure', async () => {
    const { branch, admin } = await seedBranchWithSegments([
      { subtotalMinor: 4_000, status: OrderVendorSegmentStatus.CONFIRMED },
      { subtotalMinor: 6_000, status: OrderVendorSegmentStatus.CANCELLED },
    ]);
    // A real commission event within the window, distinct from the seed event above.
    await data.save<FinancialEvent>(FinancialEvent, {
      createdAt: new Date(Date.now() - 30_000), // inside the window, before the close (see seedBranchWithSegments)
      type: FinancialEventType.VENDOR_COMMISSION_RECOGNIZED,
      direction: FinancialEventDirection.RECEIVABLE,
      idempotencyKey: `settlement-calc-commission-${branch.id}`,
      vendorBranchId: branch.id,
      amountMinor: 400,
    });

    const period = await settlement.closeVendorPeriod(branch.id, admin.id);

    expect(period.grossSalesMinor).toBe(4_000); // the cancelled 6,000 never counted
    expect(period.totalCommissionOwedMinor).toBe(10 + 400); // seed event (10) + this one (400)
    expect(period.grossSalesMinor - period.totalCommissionOwedMinor).toBe(4_000 - 410); // payable formula holds
    data.track('vendor_settlement_periods', period.id);
  });
});

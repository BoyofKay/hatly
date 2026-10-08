import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { createIntegrationApp } from './support/app';
import { TestData } from './support/test-data';
import { WalletTransaction } from '../../src/modules/wallet/entities/wallet-transaction.entity';
import { WalletTransactionType } from '../../src/modules/wallet/wallet-transaction-type.enum';
import { WalletService } from '../../src/modules/wallet/wallet.service';
import { LoyaltyPointsTransaction } from '../../src/modules/loyalty/entities/loyalty-points-transaction.entity';
import { LoyaltyTransactionType } from '../../src/modules/loyalty/loyalty-transaction-type.enum';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { FinancialEvent } from '../../src/modules/finance/entities/financial-event.entity';
import { FinancialEventDirection, FinancialEventType } from '../../src/modules/finance/financial-event-type.enum';
import { FinancialEventService } from '../../src/modules/finance/financial-event.service';
import { FavoritesService } from '../../src/modules/favorites/favorites.service';
import { Favorite } from '../../src/modules/favorites/entities/favorite.entity';
import { DriverCashRemainder } from '../../src/modules/driver-cash-remainder/entities/driver-cash-remainder.entity';
import { Role } from '../../src/common/enums/role.enum';
import { SettlementService } from '../../src/modules/finance/settlement.service';
import { VendorSettlementPeriod } from '../../src/modules/finance/entities/vendor-settlement-period.entity';
import { DriverSettlementPeriod } from '../../src/modules/finance/entities/driver-settlement-period.entity';
import { BusinessConfigService } from '../../src/modules/business-config/business-config.service';
import { BusinessConfigKey } from '../../src/modules/business-config/business-config-key.enum';
import { SettlementFrequency } from '../../src/modules/finance/settlement-frequency.enum';

const PARALLEL = 10; // the app's pg pool has 10 connections — these really race on separate connections

/**
 * Real unique constraints/indexes under REAL concurrency. Each case
 * launches simultaneous operations on separate PostgreSQL connections,
 * so two callers genuinely can both pass an application-level "does it
 * already exist?" check — the database constraint is the final guard.
 */
describe('Real PostgreSQL uniqueness / idempotency under concurrency', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let data: TestData;
  // Separate from `data` (its own independent tracking list) so the
  // per-test `data.dispose()` in `afterEach` never touches these
  // file-scoped rows, which must outlive every `it` in this file —
  // same reasoning as `settlement-calculation.int-spec.ts`'s `configData`.
  let configData: TestData;

  beforeAll(async () => {
    app = await createIntegrationApp();
    ds = app.get(DataSource);
    data = new TestData(ds);
    configData = new TestData(ds);

    // M2 (audit G-13): `VENDOR_SETTLEMENT_FREQUENCY`/`DRIVER_SETTLEMENT_FREQUENCY`
    // are deliberately never seeded by any migration — required by the new
    // SettlementService concurrency tests below.
    const businessConfig = app.get(BusinessConfigService);
    const configAdmin = await configData.user();
    const vendorFreqRow = await businessConfig.set(BusinessConfigKey.VENDOR_SETTLEMENT_FREQUENCY, SettlementFrequency.WEEKLY, configAdmin.id);
    const driverFreqRow = await businessConfig.set(BusinessConfigKey.DRIVER_SETTLEMENT_FREQUENCY, SettlementFrequency.WEEKLY, configAdmin.id);
    configData.track('business_config', vendorFreqRow.id);
    configData.track('business_config', driverFreqRow.id);
  });
  afterEach(async () => {
    await data.dispose();
  });
  afterAll(async () => {
    await configData.dispose();
    await app?.close();
  });

  const settle = <T>(promises: Promise<T>[]) => Promise.allSettled(promises);
  const rowCount = async (sql: string, params: unknown[]): Promise<number> => (await ds.query(sql, params))[0].n;

  it('WalletTransaction.idempotencyKey: N simultaneous raw inserts → exactly ONE row; every loser fails with PostgreSQL unique_violation 23505', async () => {
    const customer = await data.user();
    const key = `wallet-race-${customer.id}`;
    const results = await settle(
      Array.from({ length: PARALLEL }, () =>
        ds.getRepository(WalletTransaction).insert({
          customerId: customer.id, amountDeltaMinor: 1_000, type: WalletTransactionType.ADMIN_CREDIT, reason: 'race', idempotencyKey: key,
        }),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(PARALLEL - 1);
    for (const r of rejected) expect(r.reason).toMatchObject({ code: '23505' });
    expect(await rowCount('SELECT count(*)::int AS n FROM wallet_transactions WHERE idempotency_key = $1', [key])).toBe(1);
    const [row] = await ds.query('SELECT id FROM wallet_transactions WHERE idempotency_key = $1', [key]);
    data.track('wallet_transactions', row.id);
  });

  it('WalletService.recordTransaction (real service): concurrent retries credit the wallet exactly ONCE — the DB constraint, not an app check, is the guard', async () => {
    const wallet = app.get(WalletService);
    const customer = await data.user();
    const key = `wallet-svc-race-${customer.id}`;
    const results = await settle(
      Array.from({ length: PARALLEL }, () =>
        wallet.recordTransaction({ customerId: customer.id, amountDeltaMinor: 2_500, type: WalletTransactionType.ADMIN_CREDIT, reason: 'race', idempotencyKey: key }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await wallet.getBalance(customer.id)).toBe(2_500); // credited once, and the sum is arithmetic (numbers)
    const [row] = await ds.query('SELECT id FROM wallet_transactions WHERE idempotency_key = $1', [key]);
    data.track('wallet_transactions', row.id);
  });

  it('FinancialEventService.record (real service): concurrent identical events all SUCCEED with the SAME row — exactly one row exists (real check-then-race-fallback)', async () => {
    const svc = app.get(FinancialEventService);
    const key = `fe-race-${data.newId()}`;
    const results = await settle(
      Array.from({ length: PARALLEL }, () =>
        svc.record({ type: FinancialEventType.VENDOR_COMMISSION_RECOGNIZED, direction: FinancialEventDirection.RECEIVABLE, idempotencyKey: key, amountMinor: 4_200 }),
      ),
    );
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<FinancialEvent> => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(PARALLEL); // never surfaces the race as an error
    expect(new Set(fulfilled.map((r) => r.value.id)).size).toBe(1);
    expect(await rowCount('SELECT count(*)::int AS n FROM financial_events WHERE idempotency_key = $1', [key])).toBe(1);
    data.track('financial_events', fulfilled[0].value.id);
  });

  it('LoyaltyService.convertPointsToWallet (real service): concurrent retries of the SAME conversion apply it exactly ONCE and every caller gets the same committed result', async () => {
    const loyalty = app.get(LoyaltyService);
    const customer = await data.user();
    const key = `convert-race-${customer.id}`;
    await data.save<LoyaltyPointsTransaction>(LoyaltyPointsTransaction, {
      customerId: customer.id, pointsDelta: 10_000, type: LoyaltyTransactionType.EARNING, reason: 'seed', idempotencyKey: `seed-${customer.id}`,
    });

    // 500, not an arbitrary smaller amount — the approved V1 conversion minimum (see LoyaltyService.convertPointsToWallet).
    const results = await settle(Array.from({ length: 6 }, () => loyalty.convertPointsToWallet(customer.id, 500, key)));

    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    const values = results.map((r) => (r as PromiseFulfilledResult<{ convertedPoints: number; walletCreditMinor: number }>).value);
    expect(new Set(values.map((v) => `${v.convertedPoints}/${v.walletCreditMinor}`))).toEqual(new Set(['500/500']));
    expect(await rowCount("SELECT count(*)::int AS n FROM loyalty_points_transactions WHERE customer_id = $1 AND type = 'REDEMPTION'", [customer.id])).toBe(1);
    expect(await rowCount('SELECT count(*)::int AS n FROM wallet_transactions WHERE customer_id = $1', [customer.id])).toBe(1);
    expect(await loyalty.getBalance(customer.id)).toBe(9_500);
    for (const row of await ds.query('SELECT id FROM wallet_transactions WHERE customer_id = $1', [customer.id])) data.track('wallet_transactions', row.id);
    for (const row of await ds.query("SELECT id FROM loyalty_points_transactions WHERE customer_id = $1 AND type = 'REDEMPTION'", [customer.id])) {
      data.track('loyalty_points_transactions', row.id);
    }
  });

  it('LoyaltyService (real pessimistic lock): two DIFFERENT conversions racing for the same limited points — exactly one wins, the other gets INSUFFICIENT_POINTS, balance never goes negative', async () => {
    const loyalty = app.get(LoyaltyService);
    // 500 — the approved V1 conversion minimum — seeded as EXACTLY enough for one of the two concurrent
    // conversions below to succeed, proving the pessimistic lock (not merely the below-minimum check).
    const customer = await data.user();
    await data.save<LoyaltyPointsTransaction>(LoyaltyPointsTransaction, {
      customerId: customer.id, pointsDelta: 500, type: LoyaltyTransactionType.EARNING, reason: 'seed', idempotencyKey: `seed-${customer.id}`,
    });

    const results = await settle([
      loyalty.convertPointsToWallet(customer.id, 500, `k1-${customer.id}`),
      loyalty.convertPointsToWallet(customer.id, 500, `k2-${customer.id}`),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const loser = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!;
    expect(loser.reason.getResponse().details.code).toBe('INSUFFICIENT_POINTS');
    expect(await loyalty.getBalance(customer.id)).toBe(0);
    for (const row of await ds.query('SELECT id FROM wallet_transactions WHERE customer_id = $1', [customer.id])) data.track('wallet_transactions', row.id);
    for (const row of await ds.query("SELECT id FROM loyalty_points_transactions WHERE customer_id = $1 AND type = 'REDEMPTION'", [customer.id])) {
      data.track('loyalty_points_transactions', row.id);
    }
  });

  it('Loyalty EARNING partial unique index: a second EARNING for the same order is rejected by PostgreSQL, while other types for that order are allowed', async () => {
    const customer = await data.user();
    const order = await data.order(customer.id);
    const insert = (type: LoyaltyTransactionType, points: number, key: string) =>
      ds.getRepository(LoyaltyPointsTransaction).insert({ customerId: customer.id, orderId: order.id, pointsDelta: points, type, reason: 'x', idempotencyKey: key });

    await insert(LoyaltyTransactionType.EARNING, 50, `e1-${order.id}`);
    await expect(insert(LoyaltyTransactionType.EARNING, 50, `e2-${order.id}`)).rejects.toMatchObject({ code: '23505' });
    await insert(LoyaltyTransactionType.EARNING_REVERSED, -50, `r1-${order.id}`); // predicate is WHERE type = 'EARNING'
    for (const row of await ds.query('SELECT id FROM loyalty_points_transactions WHERE customer_id = $1', [customer.id])) data.track('loyalty_points_transactions', row.id);
  });

  it('Favorites (real service + real driver error class): concurrent duplicate creates all succeed idempotently, exactly ONE row', async () => {
    const svc = app.get(FavoritesService);
    const customer = await data.user();
    const branch = await data.vendorBranch();
    const results = await settle(Array.from({ length: PARALLEL }, () => svc.create(customer.id, branch.vendorId)));

    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    expect(await rowCount('SELECT count(*)::int AS n FROM favorites WHERE customer_id = $1 AND vendor_id = $2', [customer.id, branch.vendorId])).toBe(1);
    for (const row of await ds.query('SELECT id FROM favorites WHERE customer_id = $1', [customer.id])) data.track('favorites', row.id);
    void Favorite;
  });

  it('DriverCashRemainder: a second remainder for the same order is rejected by the unique index (the DB is the double-submit guard)', async () => {
    const customer = await data.user();
    const driverUser = await data.user({ role: Role.DRIVER });
    const driver = await data.driver(driverUser.id);
    const order = await data.order(customer.id);
    const delivery = await data.delivery(order.id, driver.id);
    const base = { orderId: order.id, deliveryId: delivery.id, driverId: driver.id, customerId: customer.id, remainderAmountMinor: 1_000, submittedAt: new Date() };

    await data.save<DriverCashRemainder>(DriverCashRemainder, base);
    await expect(ds.getRepository(DriverCashRemainder).insert(base)).rejects.toMatchObject({ code: '23505' });
  });

  /**
   * M2 (Launch-Readiness Gap Audit, G-13). Same pattern as the
   * `FinancialEventService.record` race test above, applied to
   * `SettlementService.closeVendorPeriod`/`closeDriverPeriod`: both read
   * the same "previous closed period" row before either commits, so both
   * compute the SAME `periodStart` — exactly the overlap the audit
   * flagged. `idx_vendor_settlement_periods_branch_start_unique` /
   * `idx_driver_settlement_periods_driver_start_unique` (see the
   * `SettlementPeriodConcurrencyIndex` migration) make the DB reject every
   * loser; the service's own pre-check/race-fallback (mirroring
   * `FinancialEventService.record` exactly) turns that into "everyone
   * gets the one real, committed period" rather than a raw DB error.
   */
  it('SettlementService.closeVendorPeriod (real service): concurrent closes for the SAME branch all SUCCEED with the SAME period — exactly one row exists', async () => {
    const settlement = app.get(SettlementService);
    const branch = await data.vendorBranch();
    const admin = await data.user();
    // One past event gives closeVendorPeriod a real, non-degenerate window
    // (periodStart = this event's createdAt, strictly before periodEnd = "now").
    await data.save<FinancialEvent>(FinancialEvent, {
      type: FinancialEventType.VENDOR_COMMISSION_RECOGNIZED,
      direction: FinancialEventDirection.RECEIVABLE,
      idempotencyKey: `settlement-vendor-race-seed-${branch.id}`,
      vendorBranchId: branch.id,
      amountMinor: 100,
    });

    const results = await settle(
      Array.from({ length: PARALLEL }, () => settlement.closeVendorPeriod(branch.id, admin.id)),
    );

    const fulfilled = results.filter((r): r is PromiseFulfilledResult<VendorSettlementPeriod> => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(PARALLEL); // never surfaces the race as an error
    expect(new Set(fulfilled.map((r) => r.value.id)).size).toBe(1); // every caller got the SAME row
    expect(await rowCount('SELECT count(*)::int AS n FROM vendor_settlement_periods WHERE vendor_branch_id = $1', [branch.id])).toBe(1);
    data.track('vendor_settlement_periods', fulfilled[0].value.id);
  });

  it('SettlementService.closeDriverPeriod (real service): concurrent closes for the SAME driver all SUCCEED with the SAME period — exactly one row exists', async () => {
    const settlement = app.get(SettlementService);
    const driverUser = await data.user({ role: Role.DRIVER });
    const driver = await data.driver(driverUser.id);
    const admin = await data.user();
    await data.save<FinancialEvent>(FinancialEvent, {
      type: FinancialEventType.DRIVER_COMMISSION_RECOGNIZED,
      direction: FinancialEventDirection.RECEIVABLE,
      idempotencyKey: `settlement-driver-race-seed-${driver.id}`,
      driverId: driver.id,
      amountMinor: 50,
      rateSnapshot: { commissionRateBasisPoints: 1000, baseAmountMinor: 500 },
    });

    const results = await settle(
      Array.from({ length: PARALLEL }, () => settlement.closeDriverPeriod(driver.id, admin.id)),
    );

    const fulfilled = results.filter((r): r is PromiseFulfilledResult<DriverSettlementPeriod> => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(PARALLEL);
    expect(new Set(fulfilled.map((r) => r.value.id)).size).toBe(1);
    expect(await rowCount('SELECT count(*)::int AS n FROM driver_settlement_periods WHERE driver_id = $1', [driver.id])).toBe(1);
    data.track('driver_settlement_periods', fulfilled[0].value.id);
  });

  it('vendor_settlement_periods unique index: a second period at the same (vendor_branch_id, period_start) is rejected by PostgreSQL directly', async () => {
    const branch = await data.vendorBranch();
    const periodStart = new Date('2026-01-01T00:00:00.000Z');
    const base = {
      vendorBranchId: branch.id,
      frequency: SettlementFrequency.WEEKLY,
      periodStart,
      periodEnd: new Date('2026-01-08T00:00:00.000Z'),
      status: 'CLOSED' as const,
    };

    await data.save<VendorSettlementPeriod>(VendorSettlementPeriod, base);
    await expect(ds.getRepository(VendorSettlementPeriod).insert(base)).rejects.toMatchObject({ code: '23505' });
    // A DIFFERENT periodStart for the same branch is a legitimate, unrelated period — never blocked.
    await expect(
      ds.getRepository(VendorSettlementPeriod).insert({ ...base, periodStart: new Date('2026-01-08T00:00:00.000Z'), periodEnd: new Date('2026-01-15T00:00:00.000Z') }),
    ).resolves.toBeDefined();
    for (const row of await ds.query('SELECT id FROM vendor_settlement_periods WHERE vendor_branch_id = $1', [branch.id])) {
      data.track('vendor_settlement_periods', row.id);
    }
  });

  it('driver_settlement_periods unique index: a second period at the same (driver_id, period_start) is rejected by PostgreSQL directly', async () => {
    const driverUser = await data.user({ role: Role.DRIVER });
    const driver = await data.driver(driverUser.id);
    const periodStart = new Date('2026-01-01T00:00:00.000Z');
    const base = {
      driverId: driver.id,
      frequency: SettlementFrequency.WEEKLY,
      periodStart,
      periodEnd: new Date('2026-01-08T00:00:00.000Z'),
      status: 'CLOSED' as const,
    };

    await data.save<DriverSettlementPeriod>(DriverSettlementPeriod, base);
    await expect(ds.getRepository(DriverSettlementPeriod).insert(base)).rejects.toMatchObject({ code: '23505' });
    for (const row of await ds.query('SELECT id FROM driver_settlement_periods WHERE driver_id = $1', [driver.id])) {
      data.track('driver_settlement_periods', row.id);
    }
  });
});

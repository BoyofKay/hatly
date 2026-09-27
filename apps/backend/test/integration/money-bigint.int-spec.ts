import { DataSource } from 'typeorm';
import { TestData } from './support/test-data';
import { WalletTransaction } from '../../src/modules/wallet/entities/wallet-transaction.entity';
import { WalletTransactionType } from '../../src/modules/wallet/wallet-transaction-type.enum';
import { LoyaltyPointsTransaction } from '../../src/modules/loyalty/entities/loyalty-points-transaction.entity';
import { LoyaltyTransactionType } from '../../src/modules/loyalty/loyalty-transaction-type.enum';
import { FinancialEvent } from '../../src/modules/finance/entities/financial-event.entity';
import { FinancialEventDirection, FinancialEventType } from '../../src/modules/finance/financial-event-type.enum';
import { Order } from '../../src/modules/orders/entities/order.entity';
import { WalletService } from '../../src/modules/wallet/wallet.service';
import { RequestContextService } from '../../src/common/request-context/request-context.service';

/**
 * Real PostgreSQL bigint/money behaviour through TypeORM. The domain
 * models every `*_minor` column as a JS `number` (integer minor units);
 * the pg driver, however, returns bigint as a STRING unless told
 * otherwise — so this suite checks what the application actually gets
 * back, not what the TypeScript type claims.
 */
describe('Real PostgreSQL bigint / money round-trips', () => {
  let ds: DataSource;
  let data: TestData;

  beforeAll(async () => {
    const { AppDataSource } = await import('../../src/database/data-source');
    ds = AppDataSource;
    if (!ds.isInitialized) await ds.initialize();
    data = new TestData(ds);
  });

  afterEach(async () => {
    await data.dispose();
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  // 0, tiny, typical, "large realistic" (≈ 1 billion EGP in piasters), and the max integer JS represents exactly.
  const positiveValues = [0, 1, 12_345, 99_999_999_999, Number.MAX_SAFE_INTEGER];

  it('WalletTransaction.amountDeltaMinor returns JS numbers (not strings) for signed values, with no precision loss', async () => {
    const customer = await data.user();
    const values = [1, 12_345, 99_999_999_999, Number.MAX_SAFE_INTEGER, -1, -5_000, -99_999_999_999, -Number.MAX_SAFE_INTEGER];
    const ids: string[] = [];
    for (const [i, amountDeltaMinor] of values.entries()) {
      const row = await data.save<WalletTransaction>(WalletTransaction, {
        customerId: customer.id,
        amountDeltaMinor,
        type: WalletTransactionType.ADJUSTMENT,
        reason: 'round-trip',
        idempotencyKey: `money-${customer.id}-${i}`,
      });
      ids.push(row.id);
    }
    for (const [i, id] of ids.entries()) {
      const reloaded = await ds.getRepository(WalletTransaction).findOneByOrFail({ id });
      expect(typeof reloaded.amountDeltaMinor).toBe('number');
      expect(reloaded.amountDeltaMinor).toBe(values[i]);
    }
  });

  it('WalletService.getBalance sums real ledger rows arithmetically (NOT string concatenation) and handles negatives', async () => {
    const customer = await data.user();
    const svc = new WalletService(ds.getRepository(WalletTransaction), new RequestContextService());
    for (const [i, amountDeltaMinor] of [10_000, 2_500, -1_500, 99_999_999_999].entries()) {
      const row = await svc.recordTransaction({
        customerId: customer.id,
        amountDeltaMinor,
        type: WalletTransactionType.ADJUSTMENT,
        reason: 'balance',
        idempotencyKey: `bal-${customer.id}-${i}`,
      });
      data.track('wallet_transactions', row.id);
    }
    expect(await svc.getBalance(customer.id)).toBe(10_000 + 2_500 - 1_500 + 99_999_999_999);
  });

  it('zero is a legal stored value for nullable/optional money columns but the wallet ledger DB constraint rejects a zero delta', async () => {
    const customer = await data.user();
    await expect(
      ds.getRepository(WalletTransaction).insert({
        customerId: customer.id,
        amountDeltaMinor: 0,
        type: WalletTransactionType.ADJUSTMENT,
        reason: 'zero',
        idempotencyKey: `zero-${customer.id}`,
      }),
    ).rejects.toMatchObject({ code: '23514' }); // check_violation: chk_wallet_amount_nonzero
  });

  it('Order money columns (subtotal/delivery fee/discount/total) round-trip as numbers across the full range, incl. null and 0', async () => {
    const customer = await data.user();
    for (const subtotalMinor of positiveValues) {
      const order = await data.order(customer.id, {
        subtotalMinor,
        deliveryFeeMinor: subtotalMinor === 0 ? null : 1_500,
        discountMinor: 0,
        totalMinor: subtotalMinor,
      });
      const reloaded = await ds.getRepository(Order).findOneByOrFail({ id: order.id });
      expect(reloaded.subtotalMinor).toBe(subtotalMinor);
      expect(typeof reloaded.subtotalMinor).toBe('number');
      expect(reloaded.deliveryFeeMinor).toBe(subtotalMinor === 0 ? null : 1_500);
      expect(reloaded.discountMinor).toBe(0);
      expect(reloaded.totalMinor).toBe(subtotalMinor);
    }
  });

  it('FinancialEvent.amountMinor round-trips as a number, and a stored value is never mangled into floating point', async () => {
    const event = await data.save<FinancialEvent>(FinancialEvent, {
      type: FinancialEventType.VENDOR_COMMISSION_RECOGNIZED,
      direction: FinancialEventDirection.RECEIVABLE,
      idempotencyKey: `fe-money-${data.newId()}`,
      amountMinor: 123_456_789_012,
    });
    const reloaded = await ds.getRepository(FinancialEvent).findOneByOrFail({ id: event.id });
    expect(reloaded.amountMinor).toBe(123_456_789_012);
    expect(Number.isInteger(reloaded.amountMinor as number)).toBe(true);
  });

  it('Loyalty points (integer column) keep their sign; the zero-delta CHECK constraint is enforced by PostgreSQL', async () => {
    const customer = await data.user();
    for (const [i, pointsDelta] of [250, -100, 1].entries()) {
      const row = await data.save<LoyaltyPointsTransaction>(LoyaltyPointsTransaction, {
        customerId: customer.id,
        pointsDelta,
        type: pointsDelta > 0 ? LoyaltyTransactionType.EARNING : LoyaltyTransactionType.REDEMPTION,
        idempotencyKey: `pts-${customer.id}-${i}`,
      });
      const reloaded = await ds.getRepository(LoyaltyPointsTransaction).findOneByOrFail({ id: row.id });
      expect(reloaded.pointsDelta).toBe(pointsDelta);
    }
    await expect(
      ds.getRepository(LoyaltyPointsTransaction).insert({ customerId: customer.id, pointsDelta: 0, type: LoyaltyTransactionType.ADMIN_ADJUSTMENT, reason: 'z' }),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

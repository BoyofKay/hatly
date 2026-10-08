import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { createIntegrationApp } from './support/app';
import { TestData } from './support/test-data';
import { User } from '../../src/modules/users/entities/user.entity';
import { WalletTransaction } from '../../src/modules/wallet/entities/wallet-transaction.entity';
import { WalletTransactionType } from '../../src/modules/wallet/wallet-transaction-type.enum';
import { LoyaltyPointsTransaction } from '../../src/modules/loyalty/entities/loyalty-points-transaction.entity';
import { LoyaltyTransactionType } from '../../src/modules/loyalty/loyalty-transaction-type.enum';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';

/**
 * Real PostgreSQL BEGIN/COMMIT/ROLLBACK through TypeORM's own
 * transaction mechanism — no in-memory snapshots. Each assertion reads
 * the state back through a DIFFERENT connection from the pool (a plain
 * `dataSource.query`), so it can only see what was actually committed.
 */
describe('Real PostgreSQL transaction atomicity', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let data: TestData;

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

  const count = async (table: string, id: string): Promise<number> =>
    (await ds.query(`SELECT count(*)::int AS n FROM "${table}" WHERE id = $1`, [id]))[0].n;

  it('QueryRunner: rows written in a transaction that is rolled back do NOT exist afterwards (parent + child, across tables)', async () => {
    const runner = ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let userId!: string;
    let walletId!: string;
    try {
      const user = await runner.manager.save(User, runner.manager.create(User, { phone: data.uniquePhone(), fullName: 'Rollback Test' }));
      userId = user.id;
      const wallet = await runner.manager.save(
        WalletTransaction,
        runner.manager.create(WalletTransaction, {
          customerId: user.id,
          amountDeltaMinor: 5_000,
          type: WalletTransactionType.ADMIN_CREDIT,
          reason: 'rollback test',
          idempotencyKey: `rb-${user.id}`,
        }),
      );
      walletId = wallet.id;

      // Inside the transaction the rows are visible to the transaction itself…
      expect((await runner.query('SELECT count(*)::int AS n FROM users WHERE id = $1', [userId]))[0].n).toBe(1);
      // …but NOT to any other connection yet (isolation), proving a real open transaction.
      expect(await count('users', userId)).toBe(0);

      throw new Error('deliberate failure mid-transaction');
    } catch {
      await runner.rollbackTransaction();
    } finally {
      await runner.release();
    }

    expect(await count('users', userId)).toBe(0);
    expect(await count('wallet_transactions', walletId)).toBe(0);
  });

  it('dataSource.transaction(): a thrown error rolls EVERYTHING back and is re-thrown to the caller unchanged', async () => {
    let userId!: string;
    await expect(
      ds.transaction(async (manager) => {
        const user = await manager.save(User, manager.create(User, { phone: data.uniquePhone(), fullName: 'Rollback Test 2' }));
        userId = user.id;
        await manager.save(
          WalletTransaction,
          manager.create(WalletTransaction, {
            customerId: user.id,
            amountDeltaMinor: 100,
            type: WalletTransactionType.ADMIN_CREDIT,
            reason: 'x',
            idempotencyKey: `rb2-${user.id}`,
          }),
        );
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await count('users', userId)).toBe(0);
    expect((await ds.query('SELECT count(*)::int AS n FROM wallet_transactions WHERE idempotency_key = $1', [`rb2-${userId}`]))[0].n).toBe(0);
  });

  it('control: the same transaction WITHOUT the error commits and is durable (so the rollback above is meaningful)', async () => {
    let userId!: string;
    await ds.transaction(async (manager) => {
      const user = await manager.save(User, manager.create(User, { phone: data.uniquePhone(), fullName: 'Commit Test' }));
      userId = user.id;
      data.track('users', userId);
    });
    expect(await count('users', userId)).toBe(1);
  });

  it('a database-level failure (constraint violation) in the middle of a transaction rolls back the EARLIER successful writes too', async () => {
    const customer = await data.user();
    const key = `atomic-${customer.id}`;
    await expect(
      ds.transaction(async (manager) => {
        await manager.save(WalletTransaction, manager.create(WalletTransaction, {
          customerId: customer.id, amountDeltaMinor: 700, type: WalletTransactionType.ADMIN_CREDIT, reason: 'first', idempotencyKey: key,
        }));
        // violates chk_wallet_amount_nonzero (a real CHECK) — aborts the whole transaction
        await manager.save(WalletTransaction, manager.create(WalletTransaction, {
          customerId: customer.id, amountDeltaMinor: 0, type: WalletTransactionType.ADMIN_CREDIT, reason: 'second', idempotencyKey: `${key}-2`,
        }));
      }),
    ).rejects.toMatchObject({ code: '23514' });

    expect((await ds.query('SELECT count(*)::int AS n FROM wallet_transactions WHERE customer_id = $1', [customer.id]))[0].n).toBe(0);
  });

  it('REAL BUSINESS OPERATION: LoyaltyService.convertPointsToWallet is atomic — when the wallet write fails, the loyalty REDEMPTION write is rolled back with it', async () => {
    const loyalty = app.get(LoyaltyService);
    const customer = await data.user();
    const key = `atomic-convert-${customer.id}`;
    const earning = await data.save<LoyaltyPointsTransaction>(LoyaltyPointsTransaction, {
      customerId: customer.id, pointsDelta: 500, type: LoyaltyTransactionType.EARNING, reason: 'seed', idempotencyKey: `seed-${customer.id}`,
    });
    // A pre-existing wallet row already owns this idempotency key, so the conversion's SECOND write (wallet) must fail
    // with a genuine unique violation after its FIRST write (loyalty redemption) already succeeded inside the transaction.
    const blocker = await data.save<WalletTransaction>(WalletTransaction, {
      customerId: customer.id, amountDeltaMinor: 1, type: WalletTransactionType.ADMIN_CREDIT, reason: 'blocker', idempotencyKey: key,
    });

    // The wallet unique violation aborts the transaction; the service now answers it as a clear 409 (the key is
    // taken by a row that is not this customer's own conversion) instead of leaking the raw 23505 (Group 8).
    // 500 — the approved V1 conversion minimum — so this actually reaches the wallet write instead of failing
    // earlier on the below-minimum check.
    await expect(loyalty.convertPointsToWallet(customer.id, 500, key)).rejects.toMatchObject({
      response: { details: { code: 'IDEMPOTENCY_KEY_IN_USE' } },
    });

    // No loyalty REDEMPTION survived, the seed earning is untouched, the blocker wallet row is the only wallet row.
    const redemptions = await ds.query("SELECT count(*)::int AS n FROM loyalty_points_transactions WHERE customer_id = $1 AND type = 'REDEMPTION'", [customer.id]);
    expect(redemptions[0].n).toBe(0);
    expect(await loyalty.getBalance(customer.id)).toBe(500);
    expect(await count('loyalty_points_transactions', earning.id)).toBe(1);
    expect(await count('wallet_transactions', blocker.id)).toBe(1);
  });
});

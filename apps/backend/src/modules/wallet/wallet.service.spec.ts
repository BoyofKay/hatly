import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletTransactionType } from './wallet-transaction-type.enum';

function buildHarness() {
  const store = new Map<string, any>();
  const idempotencyKeys = new Set<string>();
  const repository = {
    create: (data: any) => ({ ...data }),
    save: async (entity: any) => {
      if (idempotencyKeys.has(entity.idempotencyKey)) {
        throw new Error('duplicate key value violates unique constraint "idx_wallet_transactions_idempotency_key"');
      }
      idempotencyKeys.add(entity.idempotencyKey);
      const withId = { id: entity.id ?? randomUUID(), createdAt: new Date(), ...entity };
      store.set(withId.id, withId);
      return withId;
    },
    find: async (opts: any) => [...store.values()].filter((t) => t.customerId === opts.where.customerId),
  };
  const requestContextService = { getCorrelationId: jest.fn(() => 'corr-test') };
  const service = new WalletService(repository as any, requestContextService as any);
  return { service, store };
}

describe('WalletService (Customer Wallet Ledger Foundation)', () => {
  it('creates a positive Wallet transaction (credit)', async () => {
    const { service, store } = buildHarness();
    const tx = await service.recordTransaction({
      customerId: 'customer-1',
      amountDeltaMinor: 5000,
      type: WalletTransactionType.ADMIN_CREDIT,
      reason: 'Goodwill credit',
      idempotencyKey: 'key-1',
    });
    expect(tx.amountDeltaMinor).toBe(5000);
    expect(store.size).toBe(1);
  });

  it('creates a negative Wallet transaction (debit)', async () => {
    const { service } = buildHarness();
    const tx = await service.recordTransaction({
      customerId: 'customer-1',
      amountDeltaMinor: -3000,
      type: WalletTransactionType.ORDER_PAYMENT,
      orderId: 'order-1',
      idempotencyKey: 'key-2',
    });
    expect(tx.amountDeltaMinor).toBe(-3000);
  });

  it('CRITICAL: balance is correctly calculated from multiple transactions (positive and negative)', async () => {
    const { service } = buildHarness();
    await service.recordTransaction({
      customerId: 'customer-1',
      amountDeltaMinor: 5000,
      type: WalletTransactionType.ADMIN_CREDIT,
      reason: 'r',
      idempotencyKey: 'key-1',
    });
    await service.recordTransaction({
      customerId: 'customer-1',
      amountDeltaMinor: -2000,
      type: WalletTransactionType.ORDER_PAYMENT,
      orderId: 'order-1',
      idempotencyKey: 'key-2',
    });
    const balance = await service.getBalance('customer-1');
    expect(balance).toBe(3000);
  });

  it('CRITICAL: a customer with no transactions returns a balance of 0', async () => {
    const { service } = buildHarness();
    expect(await service.getBalance('customer-with-no-history')).toBe(0);
  });

  it('orderId is nullable — an ADMIN_CREDIT with no Order is accepted', async () => {
    const { service } = buildHarness();
    const tx = await service.recordTransaction({
      customerId: 'customer-1',
      amountDeltaMinor: 1000,
      type: WalletTransactionType.ADMIN_CREDIT,
      reason: 'r',
      idempotencyKey: 'key-1',
    });
    expect(tx.orderId).toBeNull();
  });

  it('createdByUserId is nullable — a system-generated transaction has no human actor', async () => {
    const { service } = buildHarness();
    const tx = await service.recordTransaction({
      customerId: 'customer-1',
      amountDeltaMinor: -1000,
      type: WalletTransactionType.ORDER_PAYMENT,
      orderId: 'order-1',
      idempotencyKey: 'key-1',
    });
    expect(tx.createdByUserId).toBeNull();
  });

  it('CRITICAL: ADMIN_CREDIT requires a reason', async () => {
    const { service } = buildHarness();
    await expect(
      service.recordTransaction({
        customerId: 'customer-1',
        amountDeltaMinor: 1000,
        type: WalletTransactionType.ADMIN_CREDIT,
        idempotencyKey: 'key-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('CRITICAL: ADJUSTMENT requires a reason', async () => {
    const { service } = buildHarness();
    await expect(
      service.recordTransaction({
        customerId: 'customer-1',
        amountDeltaMinor: -500,
        type: WalletTransactionType.ADJUSTMENT,
        idempotencyKey: 'key-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a zero amountDeltaMinor', async () => {
    const { service } = buildHarness();
    await expect(
      service.recordTransaction({
        customerId: 'customer-1',
        amountDeltaMinor: 0,
        type: WalletTransactionType.ORDER_PAYMENT,
        idempotencyKey: 'key-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('CRITICAL: multiple customers remain fully isolated', async () => {
    const { service } = buildHarness();
    await service.recordTransaction({
      customerId: 'customer-A',
      amountDeltaMinor: 10000,
      type: WalletTransactionType.ADMIN_CREDIT,
      reason: 'r',
      idempotencyKey: 'key-A',
    });
    await service.recordTransaction({
      customerId: 'customer-B',
      amountDeltaMinor: 500,
      type: WalletTransactionType.ADMIN_CREDIT,
      reason: 'r',
      idempotencyKey: 'key-B',
    });
    expect(await service.getBalance('customer-A')).toBe(10000);
    expect(await service.getBalance('customer-B')).toBe(500);
  });

  it('CRITICAL: idempotencyKey is required at the application layer', async () => {
    const { service } = buildHarness();
    await expect(
      service.recordTransaction({
        customerId: 'customer-1',
        amountDeltaMinor: 1000,
        type: WalletTransactionType.ADMIN_CREDIT,
        reason: 'r',
        idempotencyKey: '',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('CRITICAL: a duplicate idempotencyKey cannot create a second transaction — the DB unique constraint is the final protection', async () => {
    const { service, store } = buildHarness();
    await service.recordTransaction({
      customerId: 'customer-1',
      amountDeltaMinor: 1000,
      type: WalletTransactionType.ADMIN_CREDIT,
      reason: 'r',
      idempotencyKey: 'duplicate-key',
    });
    await expect(
      service.recordTransaction({
        customerId: 'customer-1',
        amountDeltaMinor: 1000,
        type: WalletTransactionType.ADMIN_CREDIT,
        reason: 'r',
        idempotencyKey: 'duplicate-key',
      }),
    ).rejects.toThrow();
    expect(store.size).toBe(1);
  });

  it('CRITICAL: no mutable balance is stored anywhere — balance is always recomputed from the ledger', async () => {
    const { service } = buildHarness();
    await service.recordTransaction({
      customerId: 'customer-1',
      amountDeltaMinor: 1000,
      type: WalletTransactionType.ADMIN_CREDIT,
      reason: 'r',
      idempotencyKey: 'key-1',
    });
    const balanceBefore = await service.getBalance('customer-1');
    await service.recordTransaction({
      customerId: 'customer-1',
      amountDeltaMinor: -400,
      type: WalletTransactionType.ORDER_PAYMENT,
      orderId: 'order-1',
      idempotencyKey: 'key-2',
    });
    const balanceAfter = await service.getBalance('customer-1');
    expect(balanceBefore).toBe(1000);
    expect(balanceAfter).toBe(600); // recomputed fresh, not incrementally cached
  });

  it('CRITICAL: no update or delete method is exposed by the service — the ledger is append-only at the business layer', () => {
    const proto = Object.getOwnPropertyNames(WalletService.prototype);
    expect(proto).not.toContain('update');
    expect(proto).not.toContain('updateTransaction');
    expect(proto).not.toContain('delete');
    expect(proto).not.toContain('deleteTransaction');
    expect(proto).not.toContain('remove');
  });

  it('positive and negative transactions correctly net against each other across several entries', async () => {
    const { service } = buildHarness();
    await service.recordTransaction({
      customerId: 'customer-1',
      amountDeltaMinor: 2000,
      type: WalletTransactionType.ADMIN_CREDIT,
      reason: 'r',
      idempotencyKey: 'k1',
    });
    await service.recordTransaction({
      customerId: 'customer-1',
      amountDeltaMinor: -500,
      type: WalletTransactionType.ORDER_PAYMENT,
      orderId: 'order-1',
      idempotencyKey: 'k2',
    });
    await service.recordTransaction({
      customerId: 'customer-1',
      amountDeltaMinor: 500,
      type: WalletTransactionType.ORDER_REFUND,
      orderId: 'order-1',
      idempotencyKey: 'k3',
    });
    expect(await service.getBalance('customer-1')).toBe(2000);
  });
});

describe('WalletService — structured business-event logging (Group 4)', () => {
  it('E: a standalone (no-manager) credit logs wallet.credit with only the integer minor-unit amount — never a floating-point EGP conversion', async () => {
    const { service } = buildHarness();
    const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);

    await service.recordTransaction({
      customerId: 'customer-1',
      amountDeltaMinor: 4321,
      type: WalletTransactionType.ADMIN_CREDIT,
      idempotencyKey: 'admin-credit-1',
      reason: 'Goodwill credit.',
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged.event).toBe('wallet.credit');
    expect(logged.amountDeltaMinor).toBe(4321);
    expect(Number.isInteger(logged.amountDeltaMinor)).toBe(true);
    // Never the free-text admin reason — not on the documented safe-fields list.
    expect(logged.reason).toBeUndefined();
  });

  it('CRITICAL (transaction semantics): a write joining a caller-owned transaction (manager provided) is NOT logged here — every current caller passes manager and owns its own post-commit log instead', async () => {
    const { service } = buildHarness();
    const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    const managerRepository = { create: (d: any) => d, save: async (e: any) => ({ id: 'wt-1', ...e }) };
    const manager = { getRepository: () => managerRepository };

    await service.recordTransaction(
      { customerId: 'customer-1', amountDeltaMinor: 100, type: WalletTransactionType.LOYALTY_REDEMPTION, idempotencyKey: 'k-mid-tx' },
      manager as any,
    );

    expect(logSpy).not.toHaveBeenCalled();
  });
});

import { CustomerWalletController } from './customer-wallet.controller';

describe('CustomerWalletController', () => {
  it('CRITICAL: reads the balance using ONLY the authenticated caller’s id', async () => {
    const walletService = { getBalance: jest.fn(async () => 12345) };
    const controller = new CustomerWalletController(walletService as any);

    const result = await controller.getBalance({ id: 'customer-1', role: 'CUSTOMER' } as any);

    expect(walletService.getBalance).toHaveBeenCalledWith('customer-1');
    expect(result).toEqual({ data: { balanceMinor: 12345 } });
  });

  it('CRITICAL: lists transactions using ONLY the authenticated caller’s id, never a client-supplied one', async () => {
    const walletService = {
      listTransactionsForCustomer: jest.fn(async () => ({
        data: [],
        page: 1,
        limit: 20,
        total: 0,
      })),
    };
    const controller = new CustomerWalletController(walletService as any);

    await controller.listTransactions({ id: 'customer-1', role: 'CUSTOMER' } as any, { page: 2, limit: 10 } as any);

    expect(walletService.listTransactionsForCustomer).toHaveBeenCalledWith('customer-1', { page: 2, limit: 10 });
  });

  it('the response shape mirrors the existing Customer Order History pagination contract (data + meta.page/limit/total)', async () => {
    const walletService = {
      listTransactionsForCustomer: jest.fn(async () => ({
        data: [
          {
            id: 'wt-1',
            amountDeltaMinor: 5000,
            type: 'ORDER_REFUND',
            orderId: 'order-1',
            reason: null,
            createdAt: new Date('2026-01-01T00:00:00Z'),
            createdByUserId: 'staff-1', // must never leak below
          },
        ],
        page: 1,
        limit: 20,
        total: 1,
      })),
    };
    const controller = new CustomerWalletController(walletService as any);

    const result = await controller.listTransactions({ id: 'customer-1', role: 'CUSTOMER' } as any, {} as any);

    expect(result.meta).toEqual({ page: 1, limit: 20, total: 1 });
    expect(result.data).toEqual([
      {
        id: 'wt-1',
        amountDeltaMinor: 5000,
        type: 'ORDER_REFUND',
        orderId: 'order-1',
        reason: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
  });

  it('CRITICAL: never exposes createdByUserId (the internal staff actor, not customer-facing) in the transactions response', async () => {
    const walletService = {
      listTransactionsForCustomer: jest.fn(async () => ({
        data: [
          {
            id: 'wt-1',
            amountDeltaMinor: 10000,
            type: 'ADMIN_CREDIT',
            orderId: null,
            reason: 'Goodwill credit',
            createdAt: new Date(),
            createdByUserId: 'staff-42',
          },
        ],
        page: 1,
        limit: 20,
        total: 1,
      })),
    };
    const controller = new CustomerWalletController(walletService as any);

    const result = await controller.listTransactions({ id: 'customer-1', role: 'CUSTOMER' } as any, {} as any);

    expect(result.data[0]).not.toHaveProperty('createdByUserId');
  });
});

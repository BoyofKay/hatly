import { OrderWalletRefundService } from './order-wallet-refund.service';

function build(walletPaid: number, refunded = 0) {
  const wallet = {
    lockCustomerWallet: jest.fn(async () => undefined),
    getRefundedForOrderMinor: jest.fn(async () => refunded),
    recordTransaction: jest.fn(async () => ({})),
  };
  const service = new OrderWalletRefundService(wallet as any);
  const order = { id: 'o1', customerId: 'c1', walletAmountMinor: walletPaid } as any;
  return { service, wallet, order, manager: {} as any };
}
const refund = (h: ReturnType<typeof build>, owedAfterMinor: number, key = 'order-refund:o1:x') =>
  h.service.refundExcess(h.manager, { order: h.order, owedAfterMinor, idempotencyKey: key, reason: 'r', actorUserId: 'u1' });

describe('OrderWalletRefundService.refundExcess — wallet money goes back to the wallet, only the excess', () => {
  it('whole cancellation (owed 0): everything the wallet paid is credited, as one ORDER_REFUND row on the caller\'s manager', async () => {
    const h = build(5000);
    await expect(refund(h, 0)).resolves.toBe(5000);
    expect(h.wallet.recordTransaction).toHaveBeenCalledWith(
      { customerId: 'c1', amountDeltaMinor: 5000, type: 'ORDER_REFUND', idempotencyKey: 'order-refund:o1:x', orderId: 'o1', reason: 'r', createdByUserId: 'u1' },
      h.manager,
    );
    expect(h.wallet.lockCustomerWallet).toHaveBeenCalledWith('c1', h.manager);
  });

  it('partial reduction: only what the wallet paid BEYOND what is still owed is returned (wallet keeps paying for what stands)', async () => {
    await expect(refund(build(5000), 3000)).resolves.toBe(2000);
    await expect(refund(build(5000), 5000)).resolves.toBe(0);
    await expect(refund(build(5000), 9000)).resolves.toBe(0);
  });

  it('earlier refunds are subtracted — the same money is never credited twice', async () => {
    await expect(refund(build(5000, 2000), 0)).resolves.toBe(3000);
    await expect(refund(build(5000, 5000), 0)).resolves.toBe(0);
  });

  it('an order the wallet did not pay for is untouched — no lock, no ledger row', async () => {
    const h = build(0);
    await expect(refund(h, 0)).resolves.toBe(0);
    expect(h.wallet.lockCustomerWallet).not.toHaveBeenCalled();
    expect(h.wallet.recordTransaction).not.toHaveBeenCalled();
  });

  it('a negative "owed" is treated as 0 (never refunds more than the wallet paid)', async () => {
    await expect(refund(build(5000), -100)).resolves.toBe(5000);
  });

  it('effectiveWalletPaidMinor = paid − already refunded', async () => {
    const h = build(5000, 1200);
    await expect(h.service.effectiveWalletPaidMinor(h.manager, h.order)).resolves.toBe(3800);
    await expect(build(0).service.effectiveWalletPaidMinor({} as any, { id: 'x', walletAmountMinor: 0 } as any)).resolves.toBe(0);
  });
});

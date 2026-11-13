import { SettlementService } from './settlement.service';

/** The close entry points are kept for every existing caller; the arithmetic lives in SettlementClosingService (+ courier-settlement-math.spec). */
describe('SettlementService (facade over SettlementClosingService)', () => {
  const closing = { closeVendor: jest.fn(async () => ({ id: 'vp' })), closeCourier: jest.fn(async () => ({ id: 'dp' })) };
  const service = new SettlementService(closing as any);

  it('closeVendorPeriod delegates with the branch, the acting admin and the options', async () => {
    await expect(service.closeVendorPeriod('b', 'a', { periodEnd: '2026-11-01', previewToken: 't' })).resolves.toEqual({ id: 'vp' });
    expect(closing.closeVendor).toHaveBeenCalledWith('b', 'a', { periodEnd: '2026-11-01', previewToken: 't' });
  });

  it('closeDriverPeriod delegates with the courier, the acting admin and the options (defaults to none)', async () => {
    await expect(service.closeDriverPeriod('d', 'a')).resolves.toEqual({ id: 'dp' });
    expect(closing.closeCourier).toHaveBeenCalledWith('d', 'a', {});
  });
});

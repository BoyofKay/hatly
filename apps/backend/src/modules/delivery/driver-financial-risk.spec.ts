import { cashCapBlocks, driverCashExposure, driverRiskLimits, canTakeFinancialRisk } from './driver-financial-risk';

describe('driver financial risk', () => {
  it('does not impose an invented cap; equality on outstanding blocks new assignments', () => {
    expect(cashCapBlocks(null, 999999, 999999)).toBe(false);
    expect(cashCapBlocks(10000, 10000, 10000)).toBe(true);
    expect(cashCapBlocks(10000, 9000, 10000)).toBe(false);
    expect(cashCapBlocks(10000, 9000, 10001)).toBe(true);
  });
  it('includes closed but unpaid collections and active reservations', async () => {
    const db = { query: jest.fn().mockResolvedValue([{unclosed:'1000',closed_uncollected:'3000',reserved:'2000',candidate:'1000'}]) };
    expect(await driverCashExposure(db,'driver','order')).toMatchObject({outstandingMinor:4000,projectedMinor:7000});
  });
  it('validates configuration values and refuses a projected over-cap assignment', async () => {
    const db = {query:jest.fn().mockResolvedValueOnce([{key:'DRIVER_CASH_CAP_MINOR',value:5000},{key:'DRIVER_ALLOWANCE_CAP_MINOR',value:0}])
      .mockResolvedValueOnce([{unclosed:3000,closed_uncollected:1000,reserved:500,candidate:1000}])};
    expect(await canTakeFinancialRisk(db,'driver','order')).toBe(false);
    const invalid = {query:jest.fn().mockResolvedValue([{key:'DRIVER_CASH_CAP_MINOR',value:'5000'}])};
    expect((await driverRiskLimits(invalid)).capMinor).toBeNull();
  });
});

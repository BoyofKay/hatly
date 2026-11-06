import { splitDriverCompensation } from './driver-compensation-split';

describe('splitDriverCompensation (R28/R31/R40, U1)', () => {
  it('normal order: the whole fee (including the additional-vendor charge) is driver compensation', () => {
    expect(splitDriverCompensation(2500, { deliveryFeeMinor: 2500, additionalVendorChargeMinor: 500 })).toEqual({
      driverCompensationMinor: 2500,
      hatlyServiceRevenueMinor: 0,
      hatlyService: null,
    });
    expect(splitDriverCompensation(1500, null).driverCompensationMinor).toBe(1500);
  });

  it('Hatly Service: base fee to the driver, multiplier premium to Hatly', () => {
    expect(splitDriverCompensation(3000, { chargeMinor: 3000, baseFeeMinor: 2000, multiplierUsed: 1.5, service: 'HATLY' })).toEqual({
      driverCompensationMinor: 2000,
      hatlyServiceRevenueMinor: 1000,
      hatlyService: { chargeMinor: 3000, baseFeeMinor: 2000, multiplierUsed: 1.5, service: 'HATLY' },
    });
  });

  it('multiplier 1 → no Hatly premium; a base above the fee is capped at the fee (never negative revenue)', () => {
    expect(splitDriverCompensation(2000, { chargeMinor: 2000, baseFeeMinor: 2000, multiplierUsed: 1, service: 'WASALLY' }).hatlyServiceRevenueMinor).toBe(0);
    expect(splitDriverCompensation(1800, { chargeMinor: 1800, baseFeeMinor: 2000, multiplierUsed: 0.9, service: 'HATLY' })).toMatchObject({
      driverCompensationMinor: 1800,
      hatlyServiceRevenueMinor: 0,
    });
  });

  it('a snapshot that is not a complete Hatly Service charge is treated as a normal fee', () => {
    expect(splitDriverCompensation(3000, { baseFeeMinor: 2000, service: 'HATLY' }).driverCompensationMinor).toBe(3000);
    expect(splitDriverCompensation(3000, { chargeMinor: 3000, baseFeeMinor: 2000, multiplierUsed: 1.5, service: 'OTHER' }).driverCompensationMinor).toBe(3000);
  });
});

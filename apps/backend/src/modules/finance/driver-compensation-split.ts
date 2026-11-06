/**
 * R28 / R31 / R40 (decision register 2026-11-06, U1). Splits an order's delivery charge into the DRIVER's delivery compensation (the only
 * base the driver's Hatly commission % may apply to) and Hatly's own SERVICE revenue (never subject to the driver %):
 *  - Normal store orders: the whole delivery fee, INCLUDING the additional-vendor delivery charge, is driver compensation.
 *  - Hatly Service (Hatly / Wasally): the charge frozen at checkout is `baseFeeMinor × multiplierUsed`. The ordinary base delivery fee
 *    (`baseFeeMinor`) is driver compensation; the multiplier premium (charge − base fee) is Hatly service revenue.
 * Read only from the order's frozen snapshot — nothing is re-priced, and historic orders are never recalculated (events are recognised
 * once, at delivery, with idempotency keys).
 */
export interface DriverCompensationSplit {
  driverCompensationMinor: number;
  hatlyServiceRevenueMinor: number;
  /** Present only for a Hatly Service charge: the frozen facts the split was taken from. */
  hatlyService: { chargeMinor: number; baseFeeMinor: number; multiplierUsed: number; service: string | null } | null;
}

export function splitDriverCompensation(deliveryFeeMinor: number, breakdownSnapshot: unknown): DriverCompensationSplit {
  const fee = Math.max(0, Math.round(deliveryFeeMinor));
  const b = breakdownSnapshot as { baseFeeMinor?: unknown; multiplierUsed?: unknown; chargeMinor?: unknown; service?: unknown } | null;
  const isHatlyServiceCharge =
    !!b &&
    typeof b.baseFeeMinor === 'number' &&
    Number.isFinite(b.baseFeeMinor) &&
    typeof b.multiplierUsed === 'number' &&
    typeof b.chargeMinor === 'number' &&
    (b.service === 'HATLY' || b.service === 'WASALLY');
  if (!isHatlyServiceCharge) {
    return { driverCompensationMinor: fee, hatlyServiceRevenueMinor: 0, hatlyService: null };
  }
  const base = Math.min(fee, Math.max(0, Math.round(b!.baseFeeMinor as number)));
  return {
    driverCompensationMinor: base,
    hatlyServiceRevenueMinor: fee - base,
    hatlyService: {
      chargeMinor: b!.chargeMinor as number,
      baseFeeMinor: b!.baseFeeMinor as number,
      multiplierUsed: b!.multiplierUsed as number,
      service: typeof b!.service === 'string' ? (b!.service as string) : null,
    },
  };
}

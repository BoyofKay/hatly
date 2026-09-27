/**
 * The confirmed Hatly rounding rule for the TOTAL pricing-route
 * distance (never applied per-leg): round down to the nearest 100m if
 * the remainder is ≤20m, otherwise round up to the next 100m. This is
 * deliberately NOT standard Math.round() behavior (which would round
 * at the 50m midpoint) — verified against every example given across
 * the approved requirement messages, including the corrected 1,240m
 * case (→1,300m, not the earlier-retracted 1,200m).
 */
export function roundPricingDistanceMeters(totalMeters: number): number {
  const lowerBoundary = Math.floor(totalMeters / 100) * 100;
  const remainder = totalMeters - lowerBoundary;
  return remainder <= 20 ? lowerBoundary : lowerBoundary + 100;
}

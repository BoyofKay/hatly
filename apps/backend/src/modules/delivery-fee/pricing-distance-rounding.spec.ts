import { roundPricingDistanceMeters } from './pricing-distance-rounding';

describe('roundPricingDistanceMeters', () => {
  const cases: Array<[number, number]> = [
    [800, 800],
    [820, 800],
    [821, 900],
    [840, 900],
    [849, 900],
    [899, 900],
    [900, 900],
    [1220, 1200],
    [1221, 1300],
    [1240, 1300], // corrected — an earlier draft example said 1200, explicitly retracted
    [1250, 1300],
    [0, 0],
    [20, 0], // remainder exactly 20 -> down
    [21, 100], // remainder 21 -> up
  ];

  it.each(cases)('rounds %im to %im', (input, expected) => {
    expect(roundPricingDistanceMeters(input)).toBe(expected);
  });

  it('never behaves like standard Math.round (which would round at the 50m midpoint)', () => {
    // Math.round(840) would stay at 800 (nearest 100 by classic rounding
    // is 800, since 40 < 50) — the Hatly rule instead rounds this UP to
    // 900, since 40 > 20. This test fails loudly if someone "simplifies"
    // the implementation back to Math.round.
    expect(roundPricingDistanceMeters(840)).not.toBe(Math.round(840 / 100) * 100);
  });
});

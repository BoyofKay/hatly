import { HIGHEST_RATED_MINIMUM_RATING_COUNT, isEligibleForHighestRated } from './highest-rated-threshold';

describe('Highest Rated minimum threshold (data preparation only — no listing implemented)', () => {
  it('the approved threshold is exactly 5', () => {
    expect(HIGHEST_RATED_MINIMUM_RATING_COUNT).toBe(5);
  });

  it('1–4 ratings does NOT qualify', () => {
    expect(isEligibleForHighestRated(0)).toBe(false);
    expect(isEligibleForHighestRated(1)).toBe(false);
    expect(isEligibleForHighestRated(4)).toBe(false);
  });

  it('5+ ratings qualifies', () => {
    expect(isEligibleForHighestRated(5)).toBe(true);
    expect(isEligibleForHighestRated(6)).toBe(true);
    expect(isEligibleForHighestRated(1000)).toBe(true);
  });
});

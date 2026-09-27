/**
 * CONFIRMED business decision (Ratings, section 10): a target needs
 * at least this many submitted ratings before it qualifies for a
 * future "Highest Rated" discovery section. This is the ONLY approved
 * business number here beyond the 1–5 star scale itself — do not
 * invent any other threshold.
 *
 * This does NOT gate a customer's ability to SUBMIT a rating — a
 * target with 1 rating is still fully rateable; this only affects
 * future Highest Rated LISTING eligibility, which is explicitly not
 * implemented in this phase (no controller/query exists for it).
 * Exists now so the later discovery phase has a single, already-
 * agreed constant to import rather than a business number
 * re-invented ad hoc when that phase is built.
 */
export const HIGHEST_RATED_MINIMUM_RATING_COUNT = 5;

/**
 * Pure helper — `VendorBranch.ratingCount` / `Driver.ratingCount` /
 * `Product.ratingCount` (see each entity's own comment) are already
 * exactly what this needs; no separate query or listing logic exists
 * here, deliberately, per the "do not implement Highest Rated listing
 * yet" instruction.
 */
export function isEligibleForHighestRated(ratingCount: number): boolean {
  return ratingCount >= HIGHEST_RATED_MINIMUM_RATING_COUNT;
}

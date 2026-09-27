/**
 * CONFIRMED (Phase F): only WEEKLY or MONTHLY are supported — do not
 * add other frequencies without an explicit new business decision.
 */
export enum SettlementFrequency {
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
}

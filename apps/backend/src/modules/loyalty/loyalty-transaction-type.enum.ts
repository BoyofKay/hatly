/**
 * Loyalty Ledger Foundation (Chunk A). The types the append-only
 * ledger must be ABLE to represent — CONFIRMED per the approved
 * design: only the foundation is built in this chunk; no business
 * logic exists yet that actually creates EARNING/REDEMPTION/
 * ADMIN_ADJUSTMENT/EXPIRATION rows. That logic is explicitly deferred
 * to later chunks (earning on DELIVERED, Admin adjustment endpoint,
 * expiration policy — none of which exist yet).
 */
export enum LoyaltyTransactionType {
  EARNING = 'EARNING',
  EARNING_REVERSED = 'EARNING_REVERSED',
  REDEMPTION = 'REDEMPTION',
  ADMIN_ADJUSTMENT = 'ADMIN_ADJUSTMENT',
  EXPIRATION = 'EXPIRATION',
}

/**
 * Customer Wallet Ledger Foundation (Chunk B). The types the
 * append-only ledger must be ABLE to represent — CONFIRMED per the
 * approved design: only the foundation is built in this chunk. No
 * business logic exists yet that actually creates any of these rows
 * (no checkout debit, no refund, no Admin credit endpoint, no
 * Points-to-Wallet conversion, no Driver cash-remainder workflow —
 * all explicitly deferred to later chunks).
 */
export enum WalletTransactionType {
  LOYALTY_REDEMPTION = 'LOYALTY_REDEMPTION',
  ADMIN_CREDIT = 'ADMIN_CREDIT',
  DRIVER_CASH_REMAINDER = 'DRIVER_CASH_REMAINDER',
  ORDER_PAYMENT = 'ORDER_PAYMENT',
  ORDER_REFUND = 'ORDER_REFUND',
  ADJUSTMENT = 'ADJUSTMENT',
  EXPIRATION = 'EXPIRATION',
}

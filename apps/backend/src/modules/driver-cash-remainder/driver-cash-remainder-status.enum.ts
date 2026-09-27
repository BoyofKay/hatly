/**
 * Admin-mediated Driver Cash Remainder (Chunk E). Minimal state model
 * — CONFIRMED, only the three states the approved workflow actually
 * needs. REJECTED is final in V1 (no reopening path exists).
 */
export enum DriverCashRemainderStatus {
  PENDING_REVIEW = 'PENDING_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum OrderStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  PREPARING = 'PREPARING',
  READY_FOR_PICKUP = 'READY_FOR_PICKUP',
  ASSIGNED_TO_DRIVER = 'ASSIGNED_TO_DRIVER',
  PICKED_UP = 'PICKED_UP',
  ON_THE_WAY = 'ON_THE_WAY',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  /**
   * PHASE F addition. CONFIRMED: "FAILED_DELIVERY is a distinct
   * operational state... do NOT treat it as ordinary CANCELLED."
   * Terminal — no transition is defined out of it, mirroring DELIVERED
   * and CANCELLED's own terminal shape. No automatic financial penalty
   * attaches to reaching this state (confirmed) — any financial
   * consequence is a separate, explicit FinancialEvent (see
   * FailedDeliveryService), never inferred from the status alone.
   */
  FAILED_DELIVERY = 'FAILED_DELIVERY',
}

import { EntityManager } from 'typeorm';

/**
 * Tells the stock ledger WHY and BY WHOM the next change of a tracked product's quantity happens. The ledger itself is written by a database trigger
 * on `products` (so no code path can change stock without a row); this only supplies the context, as a TRANSACTION-LOCAL setting. It therefore must
 * be called with the transaction's own manager, right before the statement that changes the quantity. A change made without a context is still
 * recorded — as UNATTRIBUTED, `source_captured = false` — never guessed.
 */
export interface StockContext {
  reason: 'ORDER_PLACED' | 'ORDER_CANCELLED' | 'MANUAL_ADJUSTMENT' | 'SET_TO_ZERO' | 'STOCKTAKE' | 'IMPORT';
  referenceType?: 'CART' | 'ORDER' | 'STOCKTAKE';
  referenceId?: string;
  actorUserId?: string;
  actorRole?: string;
  note?: string;
}

export async function setStockContext(manager: Pick<EntityManager, 'query'>, ctx: StockContext): Promise<void> {
  await manager.query(`SELECT set_config('hatly.stock_ctx', $1, true)`, [JSON.stringify(ctx)]);
}

/** After the order exists: re-point this transaction's cart-tagged placement movements at the order (same transaction, so never visible half-done). */
export async function linkPlacementMovementsToOrder(manager: Pick<EntityManager, 'query'>, cartId: string, orderId: string): Promise<void> {
  await manager.query(
    `UPDATE stock_movements SET reference_type = 'ORDER', reference_id = $2 WHERE reference_type = 'CART' AND reference_id = $1 AND reason = 'ORDER_PLACED' AND occurred_at = transaction_timestamp()`,
    [cartId, orderId],
  );
}

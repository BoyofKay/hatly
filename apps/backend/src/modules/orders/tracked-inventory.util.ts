import { EntityManager } from 'typeorm';
import { OrderItem } from './entities/order-item.entity';
import { Product } from '../products/entities/product.entity';
import { InventoryMode } from '../products/inventory-mode.enum';
import { PricingUnit } from '../products/pricing-unit.enum';

/**
 * Gives TRACKED catalog stock back for the items of the given order-vendor segments — the exact
 * inverse of the atomic decrement done at order creation (units for PIECE products, grams for
 * WEIGHT products). OPEN-inventory products and product-less custom items are never touched.
 * Runs on the caller's transaction manager so it commits or rolls back with the status change.
 *
 * Callers own the "exactly once" guarantee (an order-level cancellation skips segments that were
 * already cancelled — and therefore already restored — individually; a segment-level cancellation
 * is skipped once the whole order is cancelled).
 */
export async function restoreTrackedInventoryForSegments(manager: EntityManager, segmentIds: string[]): Promise<void> {
  if (segmentIds.length === 0) return;

  const items = await manager
    .createQueryBuilder(OrderItem, 'item')
    .where('item.order_vendor_segment_id IN (:...segmentIds)', { segmentIds })
    .getMany();

  for (const item of items) {
    if (!item.productId) continue; // Custom item — never touches inventory.

    const requestedAmount = item.pricingUnitSnapshot === PricingUnit.WEIGHT ? item.requestedWeightGrams ?? 0 : item.quantity;
    if (requestedAmount <= 0) continue;

    await manager
      .createQueryBuilder()
      .update(Product)
      .set({ quantity: () => 'quantity + :amount' })
      .where('id = :id', { id: item.productId })
      .andWhere('inventory_mode = :mode', { mode: InventoryMode.TRACKED })
      .setParameter('amount', requestedAmount)
      .execute();
  }
}

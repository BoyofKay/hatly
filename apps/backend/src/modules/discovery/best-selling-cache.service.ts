import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrderVendorSegment } from '../orders/entities/order-vendor-segment.entity';
import { OrderVendorSegmentStatus } from '../orders/order-vendor-segment-status.enum';
import { Product } from '../products/entities/product.entity';
import { PricingUnit } from '../products/pricing-unit.enum';

/**
 * CONFIRMED business decisions (Discovery & Ranking — Best Selling, do
 * not reopen): counts only `DELIVERED` orders, excluding any
 * `CANCELLED` segment; PIECE products count `OrderItem.quantity`,
 * WEIGHT products count `OrderItem.actualWeightGrams`.
 *
 * Called from `OrderStateMachineService.transition()`, in that same
 * call site's own try/catch (mirroring the exact convention already
 * established there for `OrderFinancialEventsService.handleTransition()`
 * — see that call site's own comment): a Best Selling cache update is
 * a derived, non-critical side effect, never allowed to block or roll
 * back the driver's actual DELIVERED action. This method itself does
 * NOT swallow its own errors — it propagates them, exactly like
 * `OrderFinancialEventsService.handleTransition()` does, so there is
 * one single, consistent place (the call site) responsible for
 * "log, never re-throw," not two different conventions in this
 * codebase for the same kind of post-transition side effect.
 *
 * IDEMPOTENCY — reuses the existing guarantee rather than inventing a
 * new one: `OrderStateMachineService`'s own transition-rule lookup
 * (`TRANSITIONS.find(t => t.from === order.status && t.to === params.to)`)
 * has no rule with `from: DELIVERED` — once an order is DELIVERED, a
 * second attempt to transition it to DELIVERED again is rejected
 * before this method is ever called a second time for the same order.
 * Combined with the pessimistic row lock already held on `Order`
 * during that check, this makes "this method runs at most once per
 * order" a genuine guarantee, not an assumption — no separate
 * idempotency key or dedupe table was invented here.
 *
 * Internally wrapped in its OWN transaction (separate from the order-
 * status transaction, which has already committed by the time this
 * runs) so that a partial failure across a multi-item order's several
 * `Product` increments can never leave some counted and others not —
 * all-or-nothing for this one order's contribution.
 */
@Injectable()
export class BestSellingCacheService {
  constructor(private readonly dataSource: DataSource) {}

  async recordDeliveredSales(orderId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const segments = await manager.find(OrderVendorSegment, {
        where: { orderId },
        relations: { items: true },
      });

      for (const segment of segments) {
        // CONFIRMED: a cancelled segment never contributes, even
        // though the overall Order reached DELIVERED (the same
        // multi-vendor-partial-cancellation guard already used by
        // Ratings/Offers/the Weighted Products pickup gate).
        if (segment.status === OrderVendorSegmentStatus.CANCELLED) continue;

        for (const item of segment.items) {
          // No catalog product at all (an AD_HOC_SERVICE item) — nothing to credit.
          if (!item.productId) continue;

          if (item.pricingUnitSnapshot === PricingUnit.WEIGHT) {
            // Should already be non-null by the time an order reaches
            // DELIVERED (the PICKED_UP gate enforces this) — skipped,
            // not fabricated, in the defensive case it somehow isn't.
            if (item.actualWeightGrams == null) continue;
            await manager.increment(
              Product,
              { id: item.productId },
              'deliveredWeightGramsCount',
              item.actualWeightGrams,
            );
          } else {
            await manager.increment(Product, { id: item.productId }, 'deliveredQuantityCount', item.quantity);
          }
        }
      }
    });
  }
}

import { BestSellingCacheService } from './best-selling-cache.service';
import { OrderVendorSegment } from '../orders/entities/order-vendor-segment.entity';
import { OrderVendorSegmentStatus } from '../orders/order-vendor-segment-status.enum';
import { Product } from '../products/entities/product.entity';
import { PricingUnit } from '../products/pricing-unit.enum';

function buildHarness(segments: any[]) {
  const products = new Map<string, any>();

  const manager = {
    find: async (EntityClass: any, opts: any) => {
      if (EntityClass === OrderVendorSegment) {
        return segments.filter((s) => s.orderId === opts.where.orderId);
      }
      throw new Error(`unhandled find ${EntityClass.name}`);
    },
    increment: async (EntityClass: any, criteria: any, prop: string, value: number) => {
      if (EntityClass !== Product) throw new Error('unhandled increment');
      const current = products.get(criteria.id) ?? { deliveredQuantityCount: 0, deliveredWeightGramsCount: 0 };
      current[prop] = (current[prop] ?? 0) + value;
      products.set(criteria.id, current);
    },
  };

  const dataSource = { transaction: async (cb: any) => cb(manager) };
  const service = new BestSellingCacheService(dataSource as any);
  return { service, products };
}

function segment(overrides: Partial<any> = {}) {
  return {
    orderId: 'order-1',
    status: OrderVendorSegmentStatus.PICKED_UP,
    items: [],
    ...overrides,
  };
}

function pieceItem(productId: string, quantity: number) {
  return { productId, quantity, pricingUnitSnapshot: PricingUnit.PIECE, actualWeightGrams: null };
}

function weightItem(productId: string, actualWeightGrams: number) {
  return { productId, quantity: 1, pricingUnitSnapshot: PricingUnit.WEIGHT, actualWeightGrams };
}

describe('BestSellingCacheService.recordDeliveredSales', () => {
  it('increments deliveredQuantityCount for a PIECE item', async () => {
    const { service, products } = buildHarness([segment({ items: [pieceItem('product-1', 3)] })]);
    await service.recordDeliveredSales('order-1');
    expect(products.get('product-1').deliveredQuantityCount).toBe(3);
  });

  it('increments deliveredWeightGramsCount (not deliveredQuantityCount) for a WEIGHT item', async () => {
    const { service, products } = buildHarness([segment({ items: [weightItem('product-1', 1150)] })]);
    await service.recordDeliveredSales('order-1');
    expect(products.get('product-1').deliveredWeightGramsCount).toBe(1150);
    expect(products.get('product-1').deliveredQuantityCount).toBe(0);
  });

  it('never treats a WEIGHT item as "1 unit" regardless of its actual weight', async () => {
    const { service, products } = buildHarness([segment({ items: [weightItem('product-1', 5000)] })]);
    await service.recordDeliveredSales('order-1');
    expect(products.get('product-1').deliveredWeightGramsCount).toBe(5000);
  });

  it('excludes a CANCELLED segment entirely, even within an otherwise-DELIVERED order', async () => {
    const { service, products } = buildHarness([
      segment({ status: OrderVendorSegmentStatus.CANCELLED, items: [pieceItem('product-1', 10)] }),
    ]);
    await service.recordDeliveredSales('order-1');
    expect(products.has('product-1')).toBe(false);
  });

  it('skips an AD_HOC_SERVICE item (no productId) — nothing to credit', async () => {
    const { service, products } = buildHarness([
      segment({ items: [{ productId: null, quantity: 1, pricingUnitSnapshot: null, actualWeightGrams: null }] }),
    ]);
    await service.recordDeliveredSales('order-1');
    expect(products.size).toBe(0);
  });

  it('MULTI-VENDOR: Vendor A\'s sales never affect Vendor B\'s product counts', async () => {
    const { service, products } = buildHarness([
      segment({ items: [pieceItem('product-A', 5)] }),
      segment({ items: [pieceItem('product-B', 7)] }),
    ]);
    await service.recordDeliveredSales('order-1');
    expect(products.get('product-A').deliveredQuantityCount).toBe(5);
    expect(products.get('product-B').deliveredQuantityCount).toBe(7);
  });

  it('accumulates across multiple items of the same product within one order', async () => {
    const { service, products } = buildHarness([
      segment({ items: [pieceItem('product-1', 2), pieceItem('product-1', 3)] }),
    ]);
    await service.recordDeliveredSales('order-1');
    expect(products.get('product-1').deliveredQuantityCount).toBe(5);
  });
});

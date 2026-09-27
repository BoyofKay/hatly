import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ProductRatingService } from './product-rating.service';
import { ProductRating } from './entities/product-rating.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { OrderVendorSegment } from '../orders/entities/order-vendor-segment.entity';
import { OrderVendorSegmentStatus } from '../orders/order-vendor-segment-status.enum';
import { Order } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/order-status.enum';
import { Product } from '../products/entities/product.entity';

function buildHarness(seed: { items: any[]; segments: any[]; orders: any[]; products: any[] }) {
  const items = new Map(seed.items.map((i) => [i.id, i]));
  const segments = new Map(seed.segments.map((s) => [s.id, s]));
  const orders = new Map(seed.orders.map((o) => [o.id, o]));
  const products = new Map(seed.products.map((p) => [p.id, p]));
  const ratings = new Map<string, any>();

  const manager = {
    findOne: async (EntityClass: any, opts: any) => {
      if (EntityClass === OrderItem) return items.get(opts.where.id) ?? null;
      if (EntityClass === OrderVendorSegment) return segments.get(opts.where.id) ?? null;
      if (EntityClass === Order) return orders.get(opts.where.id) ?? null;
      if (EntityClass === Product) return products.get(opts.where.id) ?? null;
      if (EntityClass === ProductRating) {
        return (
          [...ratings.values()].find(
            (r) => r.customerId === opts.where.customerId && r.orderItemId === opts.where.orderItemId,
          ) ?? null
        );
      }
      throw new Error(`unhandled findOne ${EntityClass.name}`);
    },
    create: (_EntityClass: any, data: any) => ({ ...data }),
    save: async (EntityClass: any, entity: any) => {
      const withId = { id: entity.id ?? randomUUID(), ...entity };
      if (EntityClass === ProductRating) ratings.set(withId.id, withId);
      return withId;
    },
    increment: async (EntityClass: any, criteria: any, prop: string, value: number) => {
      if (EntityClass === Product) {
        const p = products.get(criteria.id);
        if (p) p[prop] = (p[prop] ?? 0) + value;
      }
    },
  };

  const dataSource = { transaction: async (cb: any) => cb(manager) };
  const service = new ProductRatingService(dataSource as any);
  return { service, items, segments, orders, products, ratings };
}

describe('ProductRatingService', () => {
  it('creates a rating for a purchased OrderItem and increments the product aggregate', async () => {
    const { service, ratings, products } = buildHarness({
      items: [{ id: 'item-1', orderVendorSegmentId: 'seg-1', productId: 'product-1' }],
      segments: [{ id: 'seg-1', orderId: 'order-1', vendorBranchId: 'branch-1', status: OrderVendorSegmentStatus.PICKED_UP }],
      orders: [{ id: 'order-1', customerId: 'customer-1', status: OrderStatus.DELIVERED }],
      products: [{ id: 'product-1', ratingCount: 0, ratingSumStars: 0 }],
    });

    const rating = await service.create({ customerId: 'customer-1', orderItemId: 'item-1', stars: 5, comment: 'Delicious' });

    expect(rating.productId).toBe('product-1');
    expect(rating.vendorBranchId).toBe('branch-1');
    expect(ratings.size).toBe(1);
    expect(products.get('product-1').ratingCount).toBe(1);
    expect(products.get('product-1').ratingSumStars).toBe(5);
  });

  it('rejects an unpurchased product — a customer cannot rate an item they never bought', async () => {
    const { service } = buildHarness({ items: [], segments: [], orders: [], products: [{ id: 'product-1' }] });

    await expect(
      service.create({ customerId: 'customer-1', orderItemId: 'not-a-real-item', stars: 5 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects an AD_HOC_SERVICE item (no productId) — nothing to rate as a "Product"', async () => {
    const { service } = buildHarness({
      items: [{ id: 'item-1', orderVendorSegmentId: 'seg-1', productId: null }],
      segments: [{ id: 'seg-1', orderId: 'order-1', vendorBranchId: null, status: OrderVendorSegmentStatus.PICKED_UP }],
      orders: [{ id: 'order-1', customerId: 'customer-1', status: OrderStatus.DELIVERED }],
      products: [],
    });

    await expect(
      service.create({ customerId: 'customer-1', orderItemId: 'item-1', stars: 5 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a customer who does not own the order', async () => {
    const { service } = buildHarness({
      items: [{ id: 'item-1', orderVendorSegmentId: 'seg-1', productId: 'product-1' }],
      segments: [{ id: 'seg-1', orderId: 'order-1', vendorBranchId: 'branch-1', status: OrderVendorSegmentStatus.PICKED_UP }],
      orders: [{ id: 'order-1', customerId: 'customer-1', status: OrderStatus.DELIVERED }],
      products: [{ id: 'product-1' }],
    });

    await expect(
      service.create({ customerId: 'someone-else', orderItemId: 'item-1', stars: 5 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects when the item\'s segment was cancelled', async () => {
    const { service } = buildHarness({
      items: [{ id: 'item-1', orderVendorSegmentId: 'seg-1', productId: 'product-1' }],
      segments: [{ id: 'seg-1', orderId: 'order-1', vendorBranchId: 'branch-1', status: OrderVendorSegmentStatus.CANCELLED }],
      orders: [{ id: 'order-1', customerId: 'customer-1', status: OrderStatus.DELIVERED }],
      products: [{ id: 'product-1' }],
    });

    await expect(
      service.create({ customerId: 'customer-1', orderItemId: 'item-1', stars: 5 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('still creates the rating when the live Product row is gone (soft-deleted) — history remains valid', async () => {
    const { service, ratings, products } = buildHarness({
      items: [{ id: 'item-1', orderVendorSegmentId: 'seg-1', productId: 'deleted-product' }],
      segments: [{ id: 'seg-1', orderId: 'order-1', vendorBranchId: 'branch-1', status: OrderVendorSegmentStatus.PICKED_UP }],
      orders: [{ id: 'order-1', customerId: 'customer-1', status: OrderStatus.DELIVERED }],
      products: [], // the Product row is gone from this lookup entirely
    });

    const rating = await service.create({ customerId: 'customer-1', orderItemId: 'item-1', stars: 4 });

    expect(rating.productId).toBe('deleted-product'); // snapshot preserved regardless
    expect(ratings.size).toBe(1);
    expect(products.size).toBe(0); // aggregate increment simply skipped, never fabricated
  });

  it('rejects a duplicate rating for the same customer + OrderItem', async () => {
    const { service } = buildHarness({
      items: [{ id: 'item-1', orderVendorSegmentId: 'seg-1', productId: 'product-1' }],
      segments: [{ id: 'seg-1', orderId: 'order-1', vendorBranchId: 'branch-1', status: OrderVendorSegmentStatus.PICKED_UP }],
      orders: [{ id: 'order-1', customerId: 'customer-1', status: OrderStatus.DELIVERED }],
      products: [{ id: 'product-1', ratingCount: 0, ratingSumStars: 0 }],
    });

    await service.create({ customerId: 'customer-1', orderItemId: 'item-1', stars: 5 });
    await expect(
      service.create({ customerId: 'customer-1', orderItemId: 'item-1', stars: 1 }),
    ).rejects.toThrow(ConflictException);
  });
});

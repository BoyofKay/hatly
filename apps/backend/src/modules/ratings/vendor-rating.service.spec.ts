import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { VendorRatingService } from './vendor-rating.service';
import { VendorRating } from './entities/vendor-rating.entity';
import { OrderVendorSegment } from '../orders/entities/order-vendor-segment.entity';
import { OrderVendorSegmentStatus } from '../orders/order-vendor-segment-status.enum';
import { Order } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/order-status.enum';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';

function buildHarness(seed: { segments: any[]; orders: any[]; branches: any[] }) {
  const segments = new Map(seed.segments.map((s) => [s.id, s]));
  const orders = new Map(seed.orders.map((o) => [o.id, o]));
  const branches = new Map(seed.branches.map((b) => [b.id, b]));
  const ratings = new Map<string, any>();

  const manager = {
    findOne: async (EntityClass: any, opts: any) => {
      if (EntityClass === OrderVendorSegment) return segments.get(opts.where.id) ?? null;
      if (EntityClass === Order) return orders.get(opts.where.id) ?? null;
      if (EntityClass === VendorRating) {
        return (
          [...ratings.values()].find(
            (r) => r.customerId === opts.where.customerId && r.orderVendorSegmentId === opts.where.orderVendorSegmentId,
          ) ?? null
        );
      }
      throw new Error(`unhandled findOne ${EntityClass.name}`);
    },
    create: (_EntityClass: any, data: any) => ({ ...data }),
    save: async (EntityClass: any, entity: any) => {
      const withId = { id: entity.id ?? randomUUID(), ...entity };
      if (EntityClass === VendorRating) ratings.set(withId.id, withId);
      return withId;
    },
    increment: async (EntityClass: any, criteria: any, prop: string, value: number) => {
      if (EntityClass === VendorBranch) {
        const b = branches.get(criteria.id);
        if (b) b[prop] = (b[prop] ?? 0) + value;
      }
    },
  };

  const dataSource = { transaction: async (cb: any) => cb(manager) };
  const service = new VendorRatingService(dataSource as any);
  return { service, segments, orders, branches, ratings };
}

describe('VendorRatingService', () => {
  it('creates a rating for a delivered order\'s segment and increments the branch aggregate', async () => {
    const { service, ratings, branches } = buildHarness({
      segments: [{ id: 'seg-1', orderId: 'order-1', vendorBranchId: 'branch-1', status: OrderVendorSegmentStatus.PICKED_UP }],
      orders: [{ id: 'order-1', customerId: 'customer-1', status: OrderStatus.DELIVERED }],
      branches: [{ id: 'branch-1', ratingCount: 0, ratingSumStars: 0 }],
    });

    const rating = await service.create({ customerId: 'customer-1', orderVendorSegmentId: 'seg-1', stars: 5, comment: 'Great!' });

    expect(rating.stars).toBe(5);
    expect(rating.vendorBranchId).toBe('branch-1'); // derived from the segment, never trusted from the client
    expect(ratings.size).toBe(1);
    expect(branches.get('branch-1').ratingCount).toBe(1);
    expect(branches.get('branch-1').ratingSumStars).toBe(5);
  });

  it('rejects a customer who does not own the order', async () => {
    const { service } = buildHarness({
      segments: [{ id: 'seg-1', orderId: 'order-1', vendorBranchId: 'branch-1', status: OrderVendorSegmentStatus.PICKED_UP }],
      orders: [{ id: 'order-1', customerId: 'customer-1', status: OrderStatus.DELIVERED }],
      branches: [{ id: 'branch-1' }],
    });

    await expect(
      service.create({ customerId: 'someone-else', orderVendorSegmentId: 'seg-1', stars: 5 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a CANCELLED order', async () => {
    // The segment itself is deliberately left NON-cancelled (PICKED_UP)
    // here, matching the "rejects FAILED_DELIVERY" test right below —
    // this isolates the order-level `status !== DELIVERED` check
    // (service.create's second guard) from the segment-level CANCELLED
    // check (its own, separately-tested, EARLIER guard — see "rejects
    // a CANCELLED segment even when the overall order is DELIVERED"
    // below). A segment that is ALSO CANCELLED would hit that earlier
    // guard first and throw BadRequestException instead, testing the
    // wrong branch entirely.
    const { service } = buildHarness({
      segments: [{ id: 'seg-1', orderId: 'order-1', vendorBranchId: 'branch-1', status: OrderVendorSegmentStatus.PICKED_UP }],
      orders: [{ id: 'order-1', customerId: 'customer-1', status: OrderStatus.CANCELLED }],
      branches: [{ id: 'branch-1' }],
    });

    await expect(
      service.create({ customerId: 'customer-1', orderVendorSegmentId: 'seg-1', stars: 5 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects FAILED_DELIVERY — not eligible for a normal rating', async () => {
    const { service } = buildHarness({
      segments: [{ id: 'seg-1', orderId: 'order-1', vendorBranchId: 'branch-1', status: OrderVendorSegmentStatus.PICKED_UP }],
      orders: [{ id: 'order-1', customerId: 'customer-1', status: OrderStatus.FAILED_DELIVERY }],
      branches: [{ id: 'branch-1' }],
    });

    await expect(
      service.create({ customerId: 'customer-1', orderVendorSegmentId: 'seg-1', stars: 5 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a CANCELLED segment even when the overall order is DELIVERED (multi-vendor partial cancellation)', async () => {
    const { service } = buildHarness({
      segments: [{ id: 'seg-1', orderId: 'order-1', vendorBranchId: 'branch-1', status: OrderVendorSegmentStatus.CANCELLED }],
      orders: [{ id: 'order-1', customerId: 'customer-1', status: OrderStatus.DELIVERED }],
      branches: [{ id: 'branch-1' }],
    });

    await expect(
      service.create({ customerId: 'customer-1', orderVendorSegmentId: 'seg-1', stars: 3 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an AD_HOC_SERVICE segment (no vendorBranchId) — nothing to rate as a "Vendor"', async () => {
    const { service } = buildHarness({
      segments: [{ id: 'seg-1', orderId: 'order-1', vendorBranchId: null, status: OrderVendorSegmentStatus.PICKED_UP }],
      orders: [{ id: 'order-1', customerId: 'customer-1', status: OrderStatus.DELIVERED }],
      branches: [],
    });

    await expect(
      service.create({ customerId: 'customer-1', orderVendorSegmentId: 'seg-1', stars: 5 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a duplicate rating for the same customer + segment — DB-unique-backed', async () => {
    const { service } = buildHarness({
      segments: [{ id: 'seg-1', orderId: 'order-1', vendorBranchId: 'branch-1', status: OrderVendorSegmentStatus.PICKED_UP }],
      orders: [{ id: 'order-1', customerId: 'customer-1', status: OrderStatus.DELIVERED }],
      branches: [{ id: 'branch-1', ratingCount: 0, ratingSumStars: 0 }],
    });

    await service.create({ customerId: 'customer-1', orderVendorSegmentId: 'seg-1', stars: 4 });
    await expect(
      service.create({ customerId: 'customer-1', orderVendorSegmentId: 'seg-1', stars: 2 }),
    ).rejects.toThrow(ConflictException);
  });

  it('multi-vendor isolation: rating Vendor A never touches Vendor B\'s segment/aggregate', async () => {
    const { service, ratings, branches } = buildHarness({
      segments: [
        { id: 'seg-a', orderId: 'order-1', vendorBranchId: 'branch-a', status: OrderVendorSegmentStatus.PICKED_UP },
        { id: 'seg-b', orderId: 'order-1', vendorBranchId: 'branch-b', status: OrderVendorSegmentStatus.PICKED_UP },
      ],
      orders: [{ id: 'order-1', customerId: 'customer-1', status: OrderStatus.DELIVERED }],
      branches: [
        { id: 'branch-a', ratingCount: 0, ratingSumStars: 0 },
        { id: 'branch-b', ratingCount: 0, ratingSumStars: 0 },
      ],
    });

    await service.create({ customerId: 'customer-1', orderVendorSegmentId: 'seg-a', stars: 5 });

    expect(branches.get('branch-a').ratingCount).toBe(1);
    expect(branches.get('branch-b').ratingCount).toBe(0);
    // Customer can still independently rate Vendor B afterward.
    await service.create({ customerId: 'customer-1', orderVendorSegmentId: 'seg-b', stars: 3 });
    expect(branches.get('branch-b').ratingCount).toBe(1);
    expect(ratings.size).toBe(2);
  });
});

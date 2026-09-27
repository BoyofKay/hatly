import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { OrderItemWeightRecordService } from './order-item-weight-record.service';
import { OrderItem } from './entities/order-item.entity';
import { OrderVendorSegment } from './entities/order-vendor-segment.entity';
import { Order } from './entities/order.entity';
import { OrderItemWeightRecord } from './entities/order-item-weight-record.entity';
import { OrderStatus } from './order-status.enum';
import { OrderVendorSegmentStatus } from './order-vendor-segment-status.enum';
import { PricingUnit } from '../products/pricing-unit.enum';

/**
 * Same style of special-cased in-memory fake used throughout this
 * codebase's specs (see ad-hoc-purchase-record.service.spec.ts) —
 * implements only the exact query shapes this service actually
 * issues.
 */
function buildHarness(seed: { items: any[]; segments: any[]; orders: any[] }) {
  const items = new Map(seed.items.map((i) => [i.id, i]));
  const segments = new Map(seed.segments.map((s) => [s.id, s]));
  const orders = new Map(seed.orders.map((o) => [o.id, o]));
  const weightRecords = new Map<string, any>();

  const manager = {
    findOne: async (EntityClass: any, opts: any) => {
      if (EntityClass === OrderItem) return items.get(opts.where.id) ?? null;
      if (EntityClass === OrderVendorSegment) return segments.get(opts.where.id) ?? null;
      if (EntityClass === Order) return orders.get(opts.where.id) ?? null;
      if (EntityClass === OrderItemWeightRecord) {
        return [...weightRecords.values()].find((r) => r.orderItemId === opts.where.orderItemId) ?? null;
      }
      throw new Error(`unhandled findOne ${EntityClass.name}`);
    },
    create: (_EntityClass: any, data: any) => ({ ...data }),
    save: async (EntityClass: any, entity: any) => {
      const withId = { id: entity.id ?? randomUUID(), ...entity };
      if (EntityClass === OrderItemWeightRecord) weightRecords.set(withId.id, withId);
      else if (EntityClass === OrderItem) items.set(withId.id, withId);
      else if (EntityClass === OrderVendorSegment) segments.set(withId.id, withId);
      else if (EntityClass === Order) orders.set(withId.id, withId);
      return withId;
    },
  };

  const dataSource = { transaction: async (cb: any) => cb(manager) };
  const service = new OrderItemWeightRecordService(dataSource as any);
  return { service, items, segments, orders, weightRecords };
}

function weightItem(overrides: Partial<any> = {}) {
  return {
    id: 'item-1',
    orderVendorSegmentId: 'seg-1',
    pricingUnitSnapshot: PricingUnit.WEIGHT,
    unitPriceMinor: 20000, // 200 EGP/kg in minor units
    estimatedAmountMinor: 20000, // 1.00kg requested
    actualWeightGrams: null,
    finalAmountMinor: null,
    ...overrides,
  };
}

describe('OrderItemWeightRecordService.record — first authorized actor wins', () => {
  it('records a Vendor-submitted weight and applies the delta to segment/order totals', async () => {
    const { service, items, segments, orders, weightRecords } = buildHarness({
      items: [weightItem()],
      segments: [{ id: 'seg-1', orderId: 'order-1', subtotalMinor: 20000, status: OrderVendorSegmentStatus.PREPARING }],
      orders: [{ id: 'order-1', status: OrderStatus.PREPARING, subtotalMinor: 20000, totalMinor: 25000 }],
    });

    const record = await service.record({ orderItemId: 'item-1', weightGrams: 1150, recordedByUserId: 'vendor-user-1' });

    expect(record.weightGrams).toBe(1150);
    expect(record.recordedByUserId).toBe('vendor-user-1');
    expect(record.recordedByDriverId ?? null).toBeNull();
    expect(weightRecords.size).toBe(1);

    // 200 EGP/kg * 1.15kg = 23000 minor units; delta = +3000
    expect(items.get('item-1').actualWeightGrams).toBe(1150);
    expect(items.get('item-1').finalAmountMinor).toBe(23000);
    expect(segments.get('seg-1').subtotalMinor).toBe(23000);
    expect(orders.get('order-1').subtotalMinor).toBe(23000);
    expect(orders.get('order-1').totalMinor).toBe(28000);
  });

  it('records a Driver-submitted weight identically', async () => {
    const { service, items } = buildHarness({
      items: [weightItem()],
      segments: [{ id: 'seg-1', orderId: 'order-1', subtotalMinor: 20000, status: OrderVendorSegmentStatus.READY_FOR_PICKUP }],
      orders: [{ id: 'order-1', status: OrderStatus.READY_FOR_PICKUP, subtotalMinor: 20000, totalMinor: null }],
    });

    const record = await service.record({ orderItemId: 'item-1', weightGrams: 800, recordedByDriverId: 'driver-1' });

    expect(record.recordedByDriverId).toBe('driver-1');
    expect(record.recordedByUserId ?? null).toBeNull();
    expect(items.get('item-1').actualWeightGrams).toBe(800);
  });

  it('rejects a second recording attempt for the same item — immutable to Vendor/Driver', async () => {
    const { service } = buildHarness({
      items: [weightItem()],
      segments: [{ id: 'seg-1', orderId: 'order-1', subtotalMinor: 20000, status: OrderVendorSegmentStatus.PREPARING }],
      orders: [{ id: 'order-1', status: OrderStatus.PREPARING, subtotalMinor: 20000, totalMinor: null }],
    });

    await service.record({ orderItemId: 'item-1', weightGrams: 1150, recordedByUserId: 'vendor-user-1' });

    // A second Vendor attempt...
    await expect(
      service.record({ orderItemId: 'item-1', weightGrams: 1300, recordedByUserId: 'vendor-user-1' }),
    ).rejects.toThrow(ConflictException);

    // ...and a competing Driver attempt are both rejected the same way.
    await expect(
      service.record({ orderItemId: 'item-1', weightGrams: 1300, recordedByDriverId: 'driver-1' }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects recording for a PIECE item', async () => {
    const { service } = buildHarness({
      items: [weightItem({ pricingUnitSnapshot: PricingUnit.PIECE })],
      segments: [{ id: 'seg-1', orderId: 'order-1', subtotalMinor: 20000, status: OrderVendorSegmentStatus.PREPARING }],
      orders: [{ id: 'order-1', status: OrderStatus.PREPARING, subtotalMinor: 20000, totalMinor: null }],
    });

    await expect(
      service.record({ orderItemId: 'item-1', weightGrams: 1000, recordedByUserId: 'vendor-user-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects recording once the order has already been picked up', async () => {
    const { service } = buildHarness({
      items: [weightItem()],
      segments: [{ id: 'seg-1', orderId: 'order-1', subtotalMinor: 20000, status: OrderVendorSegmentStatus.PREPARING }],
      orders: [{ id: 'order-1', status: OrderStatus.PICKED_UP, subtotalMinor: 20000, totalMinor: 25000 }],
    });

    await expect(
      service.record({ orderItemId: 'item-1', weightGrams: 1150, recordedByDriverId: 'driver-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects recording for a cancelled segment', async () => {
    const { service } = buildHarness({
      items: [weightItem()],
      segments: [{ id: 'seg-1', orderId: 'order-1', subtotalMinor: 20000, status: OrderVendorSegmentStatus.CANCELLED }],
      orders: [{ id: 'order-1', status: OrderStatus.PREPARING, subtotalMinor: 20000, totalMinor: null }],
    });

    await expect(
      service.record({ orderItemId: 'item-1', weightGrams: 1150, recordedByUserId: 'vendor-user-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a non-existent order item', async () => {
    const { service } = buildHarness({ items: [], segments: [], orders: [] });
    await expect(
      service.record({ orderItemId: 'missing', weightGrams: 1000, recordedByDriverId: 'driver-1' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects when neither or both recorders are supplied', async () => {
    const { service } = buildHarness({
      items: [weightItem()],
      segments: [{ id: 'seg-1', orderId: 'order-1', subtotalMinor: 20000, status: OrderVendorSegmentStatus.PREPARING }],
      orders: [{ id: 'order-1', status: OrderStatus.PREPARING, subtotalMinor: 20000, totalMinor: null }],
    });

    await expect(service.record({ orderItemId: 'item-1', weightGrams: 1000 })).rejects.toThrow(BadRequestException);
    await expect(
      service.record({ orderItemId: 'item-1', weightGrams: 1000, recordedByUserId: 'u1', recordedByDriverId: 'd1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a non-integer or non-positive weight', async () => {
    const { service } = buildHarness({
      items: [weightItem()],
      segments: [{ id: 'seg-1', orderId: 'order-1', subtotalMinor: 20000, status: OrderVendorSegmentStatus.PREPARING }],
      orders: [{ id: 'order-1', status: OrderStatus.PREPARING, subtotalMinor: 20000, totalMinor: null }],
    });

    await expect(
      service.record({ orderItemId: 'item-1', weightGrams: 0, recordedByUserId: 'u1' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.record({ orderItemId: 'item-1', weightGrams: 1000.5, recordedByUserId: 'u1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('multi-vendor isolation: recording one segment\'s item never affects another segment/order\'s totals', async () => {
    const { service, items, segments, orders } = buildHarness({
      items: [
        weightItem({ id: 'item-a', orderVendorSegmentId: 'seg-a', unitPriceMinor: 20000, estimatedAmountMinor: 20000 }),
        weightItem({ id: 'item-b', orderVendorSegmentId: 'seg-b', unitPriceMinor: 10000, estimatedAmountMinor: 8000 }),
      ],
      segments: [
        { id: 'seg-a', orderId: 'order-1', subtotalMinor: 20000, status: OrderVendorSegmentStatus.PREPARING },
        { id: 'seg-b', orderId: 'order-1', subtotalMinor: 8000, status: OrderVendorSegmentStatus.PREPARING },
      ],
      orders: [{ id: 'order-1', status: OrderStatus.PREPARING, subtotalMinor: 28000, totalMinor: 33000 }],
    });

    await service.record({ orderItemId: 'item-a', weightGrams: 1150, recordedByUserId: 'vendor-a' });

    // Vendor A's segment/item reflects the new final amount...
    expect(items.get('item-a').finalAmountMinor).toBe(23000);
    expect(segments.get('seg-a').subtotalMinor).toBe(23000);
    // ...Vendor B's segment/item is completely untouched.
    expect(items.get('item-b').actualWeightGrams).toBeNull();
    expect(segments.get('seg-b').subtotalMinor).toBe(8000);
    // Order totals reflect only Vendor A's delta (+3000).
    expect(orders.get('order-1').subtotalMinor).toBe(31000);
    expect(orders.get('order-1').totalMinor).toBe(36000);
  });
});


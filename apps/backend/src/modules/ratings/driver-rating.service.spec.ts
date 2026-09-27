import { ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DriverRatingService } from './driver-rating.service';
import { DriverRating } from './entities/driver-rating.entity';
import { Delivery } from '../delivery/entities/delivery.entity';
import { Driver } from '../delivery/entities/driver.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/order-status.enum';

function buildHarness(seed: { deliveries: any[]; orders: any[]; drivers: any[] }) {
  const deliveries = new Map(seed.deliveries.map((d) => [d.id, d]));
  const orders = new Map(seed.orders.map((o) => [o.id, o]));
  const drivers = new Map(seed.drivers.map((d) => [d.id, d]));
  const ratings = new Map<string, any>();

  const manager = {
    findOne: async (EntityClass: any, opts: any) => {
      if (EntityClass === Delivery) return deliveries.get(opts.where.id) ?? null;
      if (EntityClass === Order) return orders.get(opts.where.id) ?? null;
      if (EntityClass === DriverRating) {
        return (
          [...ratings.values()].find(
            (r) => r.customerId === opts.where.customerId && r.deliveryId === opts.where.deliveryId,
          ) ?? null
        );
      }
      throw new Error(`unhandled findOne ${EntityClass.name}`);
    },
    create: (_EntityClass: any, data: any) => ({ ...data }),
    save: async (EntityClass: any, entity: any) => {
      const withId = { id: entity.id ?? randomUUID(), ...entity };
      if (EntityClass === DriverRating) ratings.set(withId.id, withId);
      return withId;
    },
    increment: async (EntityClass: any, criteria: any, prop: string, value: number) => {
      if (EntityClass === Driver) {
        const d = drivers.get(criteria.id);
        if (d) d[prop] = (d[prop] ?? 0) + value;
      }
    },
  };

  const dataSource = { transaction: async (cb: any) => cb(manager) };
  const service = new DriverRatingService(dataSource as any);
  return { service, deliveries, orders, drivers, ratings };
}

describe('DriverRatingService', () => {
  it('creates a rating for the delivered order\'s actual driver, derived from Delivery.driverId', async () => {
    const { service, ratings, drivers } = buildHarness({
      deliveries: [{ id: 'delivery-1', orderId: 'order-1', driverId: 'driver-1' }],
      orders: [{ id: 'order-1', customerId: 'customer-1', status: OrderStatus.DELIVERED }],
      drivers: [{ id: 'driver-1', ratingCount: 0, ratingSumStars: 0 }],
    });

    const rating = await service.create({ customerId: 'customer-1', deliveryId: 'delivery-1', stars: 4 });

    expect(rating.driverId).toBe('driver-1'); // derived, never client-selected
    expect(ratings.size).toBe(1);
    expect(drivers.get('driver-1').ratingCount).toBe(1);
    expect(drivers.get('driver-1').ratingSumStars).toBe(4);
  });

  it('rejects a customer who does not own the order', async () => {
    const { service } = buildHarness({
      deliveries: [{ id: 'delivery-1', orderId: 'order-1', driverId: 'driver-1' }],
      orders: [{ id: 'order-1', customerId: 'customer-1', status: OrderStatus.DELIVERED }],
      drivers: [{ id: 'driver-1' }],
    });

    await expect(
      service.create({ customerId: 'someone-else', deliveryId: 'delivery-1', stars: 4 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a delivery with no assigned driver', async () => {
    const { service } = buildHarness({
      deliveries: [{ id: 'delivery-1', orderId: 'order-1', driverId: null }],
      orders: [{ id: 'order-1', customerId: 'customer-1', status: OrderStatus.DELIVERED }],
      drivers: [],
    });

    await expect(
      service.create({ customerId: 'customer-1', deliveryId: 'delivery-1', stars: 4 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a CANCELLED order', async () => {
    const { service } = buildHarness({
      deliveries: [{ id: 'delivery-1', orderId: 'order-1', driverId: 'driver-1' }],
      orders: [{ id: 'order-1', customerId: 'customer-1', status: OrderStatus.CANCELLED }],
      drivers: [{ id: 'driver-1' }],
    });

    await expect(
      service.create({ customerId: 'customer-1', deliveryId: 'delivery-1', stars: 4 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects FAILED_DELIVERY', async () => {
    const { service } = buildHarness({
      deliveries: [{ id: 'delivery-1', orderId: 'order-1', driverId: 'driver-1' }],
      orders: [{ id: 'order-1', customerId: 'customer-1', status: OrderStatus.FAILED_DELIVERY }],
      drivers: [{ id: 'driver-1' }],
    });

    await expect(
      service.create({ customerId: 'customer-1', deliveryId: 'delivery-1', stars: 4 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a duplicate rating for the same customer + delivery', async () => {
    const { service } = buildHarness({
      deliveries: [{ id: 'delivery-1', orderId: 'order-1', driverId: 'driver-1' }],
      orders: [{ id: 'order-1', customerId: 'customer-1', status: OrderStatus.DELIVERED }],
      drivers: [{ id: 'driver-1', ratingCount: 0, ratingSumStars: 0 }],
    });

    await service.create({ customerId: 'customer-1', deliveryId: 'delivery-1', stars: 4 });
    await expect(
      service.create({ customerId: 'customer-1', deliveryId: 'delivery-1', stars: 1 }),
    ).rejects.toThrow(ConflictException);
  });
});

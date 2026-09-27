import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DriverRating } from './entities/driver-rating.entity';
import { Delivery } from '../delivery/entities/delivery.entity';
import { Driver } from '../delivery/entities/driver.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/order-status.enum';

/**
 * CONFIRMED business decision (Ratings — smallest customer ownership
 * check, distinct from DriverAuthorizationService which authorizes
 * the driver actor, not a customer's rating eligibility): a customer
 * may rate a delivery only if
 *   1. the delivery actually belongs to an Order owned by that customer,
 *   2. that Order is DELIVERED,
 *   3. the delivery has an assigned driver at all,
 *   4. no rating already exists for (customer, delivery).
 *
 * The rated driver is ALWAYS derived from `Delivery.driverId` —
 * customer can never select an arbitrary driver. Safe to treat as
 * final by the time Order.status is DELIVERED — see DriverRating's
 * own comment for why reassignment can never happen after PICKED_UP.
 */
@Injectable()
export class DriverRatingService {
  constructor(private readonly dataSource: DataSource) {}

  async create(params: {
    customerId: string;
    deliveryId: string;
    stars: number;
    comment?: string;
  }): Promise<DriverRating> {
    return this.dataSource.transaction(async (manager) => {
      const delivery = await manager.findOne(Delivery, { where: { id: params.deliveryId } });
      if (!delivery || !delivery.driverId) {
        throw new NotFoundException('Delivery not found.');
      }

      const order = await manager.findOne(Order, { where: { id: delivery.orderId } });
      if (!order || order.customerId !== params.customerId || order.status !== OrderStatus.DELIVERED) {
        throw new NotFoundException('Delivery not found.');
      }

      const existing = await manager.findOne(DriverRating, {
        where: { customerId: params.customerId, deliveryId: params.deliveryId },
      });
      if (existing) {
        throw new ConflictException({
          message: 'You have already rated the driver for this delivery.',
          details: { code: 'ALREADY_RATED' },
        });
      }

      const rating = await manager.save(
        DriverRating,
        manager.create(DriverRating, {
          customerId: params.customerId,
          deliveryId: params.deliveryId,
          driverId: delivery.driverId,
          stars: params.stars,
          comment: params.comment ?? null,
        }),
      );

      await manager.increment(Driver, { id: delivery.driverId }, 'ratingCount', 1);
      await manager.increment(Driver, { id: delivery.driverId }, 'ratingSumStars', params.stars);

      return rating;
    });
  }
}

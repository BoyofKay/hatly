import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderItem } from '../orders/entities/order-item.entity';
import { OrderItemWeightRecord } from '../orders/entities/order-item-weight-record.entity';
import { OrderItemWeightRecordService } from '../orders/order-item-weight-record.service';
import { Delivery } from './entities/delivery.entity';
import { DriverAuthorizationService } from './driver-authorization.service';

/**
 * A thin ownership-checked wrapper — exact same shape as
 * DriverPurchaseService (this project's established pattern for
 * "confirm the calling driver is actually assigned to the order that
 * owns this item, via Delivery.driverId, before delegating to the
 * existing, already-tested immutable-record logic"). Does NOT
 * redesign OrderItemWeightRecordService.record() itself.
 */
@Injectable()
export class DriverWeightRecordService {
  constructor(
    @InjectRepository(OrderItem) private readonly orderItemsRepository: Repository<OrderItem>,
    @InjectRepository(Delivery) private readonly deliveriesRepository: Repository<Delivery>,
    private readonly driverAuthorizationService: DriverAuthorizationService,
    private readonly orderItemWeightRecordService: OrderItemWeightRecordService,
  ) {}

  async recordWeight(params: {
    userId: string;
    orderItemId: string;
    weightGrams: number;
  }): Promise<OrderItemWeightRecord> {
    const driver = await this.driverAuthorizationService.getDriverForUser(params.userId);

    const item = await this.orderItemsRepository.findOne({
      where: { id: params.orderItemId },
      relations: { orderVendorSegment: true },
    });
    if (!item) {
      throw new NotFoundException('Order item not found.');
    }

    const delivery = await this.deliveriesRepository.findOne({
      where: { orderId: item.orderVendorSegment.orderId },
    });
    if (!delivery || delivery.driverId !== driver.id) {
      // Same "don't leak which case" pattern as DriverPurchaseService.
      throw new NotFoundException('Order item not found.');
    }

    return this.orderItemWeightRecordService.record({
      orderItemId: params.orderItemId,
      weightGrams: params.weightGrams,
      recordedByDriverId: driver.id,
    });
  }
}

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrderItem } from './entities/order-item.entity';
import { OrderVendorSegment } from './entities/order-vendor-segment.entity';
import { OrderVendorSegmentStatus } from './order-vendor-segment-status.enum';
import { Order } from './entities/order.entity';
import { OrderStatus } from './order-status.enum';
import { OrderItemWeightRecord } from './entities/order-item-weight-record.entity';
import { PricingUnit } from '../products/pricing-unit.enum';
import { applyOrderItemAmountDelta } from './apply-order-item-amount-delta.util';

/**
 * Order statuses at/after which the driver already physically holds
 * the order — the actual weight recording window is closed by then
 * (decision: "must happen before the order is finally treated as
 * picked up"). Enforced here (not just as a UI hint) so a late
 * recording attempt can never silently create a value the pickup gate
 * in OrderStateMachineService has already moved past.
 */
const WEIGHT_RECORDING_CLOSED_STATUSES: OrderStatus[] = [
  OrderStatus.PICKED_UP,
  OrderStatus.ON_THE_WAY,
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
  OrderStatus.FAILED_DELIVERY,
];

/**
 * The core, ownership-agnostic weight-recording logic — mirrors
 * AdHocPurchaseRecordService's shape exactly. Callers
 * (VendorWeightRecordService, DriverWeightRecordService) are
 * responsible for confirming the caller is actually authorized
 * (VendorStaffAuthorizationService / DriverAuthorizationService)
 * before calling `record()`; this service only enforces the
 * business/immutability rules themselves.
 *
 * CONFIRMED business decision: ADMIN plays no role in weight or
 * weighted-price entry/correction at all — there is no correction
 * path anywhere in this service, deliberately. `record()` is the
 * ONLY way `OrderItem.actualWeightGrams`/`finalAmountMinor` are ever
 * written, and it can only ever run once per item (DB-unique on
 * `order_item_id`, see the migration) — the value is permanent from
 * the moment the first authorized Vendor/Driver records it. No
 * update/correct method exists anywhere in this file; that absence
 * IS the decision, not an oversight.
 */
@Injectable()
export class OrderItemWeightRecordService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Records the actual weight for one WEIGHT order item. Rejects if a
   * record already exists (the unique index on `order_item_id` is the
   * real enforcement; this check just produces a clearer error than a
   * raw DB constraint violation), if the item isn't a WEIGHT item, if
   * its segment is cancelled, or if the order has already moved past
   * the recording window (see WEIGHT_RECORDING_CLOSED_STATUSES).
   *
   * Exactly one of `recordedByUserId` / `recordedByDriverId` must be
   * supplied — see OrderItemWeightRecord's own doc comment. Computes
   * the FINAL amount deterministically from the snapshotted unit price
   * (frozen on OrderItem at order-creation time — a later catalog
   * price change can never retroactively affect an existing order)
   * and the actual weight just recorded — the one approved formula:
   * `round(unitPriceMinor * weightGrams / 1000)`. No other formula is
   * introduced, and nothing here is ever manually overridden by
   * anyone — see this file's own top comment.
   */
  async record(params: {
    orderItemId: string;
    weightGrams: number;
    recordedByUserId?: string;
    recordedByDriverId?: string;
  }): Promise<OrderItemWeightRecord> {
    if (!params.recordedByUserId && !params.recordedByDriverId) {
      throw new BadRequestException('An authorized recorder (Vendor or Driver) is required.');
    }
    if (params.recordedByUserId && params.recordedByDriverId) {
      throw new BadRequestException('Exactly one recorder (Vendor or Driver) is expected, not both.');
    }
    if (!Number.isInteger(params.weightGrams) || params.weightGrams <= 0) {
      throw new BadRequestException({
        message: 'Weight must be a positive integer number of grams.',
        details: { code: 'INVALID_WEIGHT_GRAMS' },
      });
    }

    return this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(OrderItem, {
        where: { id: params.orderItemId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!item) {
        throw new NotFoundException('Order item not found.');
      }
      if (item.pricingUnitSnapshot !== PricingUnit.WEIGHT) {
        throw new BadRequestException({
          message: 'Only WEIGHT items can have an actual weight recorded.',
          details: { code: 'NOT_A_WEIGHT_ITEM' },
        });
      }

      const existing = await manager.findOne(OrderItemWeightRecord, {
        where: { orderItemId: params.orderItemId },
      });
      if (existing) {
        throw new ConflictException({
          message: 'The actual weight has already been recorded for this item and cannot be changed.',
          details: { code: 'WEIGHT_ALREADY_RECORDED' },
        });
      }

      const segment = await manager.findOne(OrderVendorSegment, { where: { id: item.orderVendorSegmentId } });
      if (!segment) {
        throw new NotFoundException('Order segment not found.');
      }
      if (segment.status === OrderVendorSegmentStatus.CANCELLED) {
        throw new BadRequestException({
          message: 'Cannot record weight for a cancelled segment.',
          details: { code: 'SEGMENT_CANCELLED' },
        });
      }

      const order = await manager.findOne(Order, { where: { id: segment.orderId } });
      if (!order) {
        throw new NotFoundException('Order not found.');
      }
      if (WEIGHT_RECORDING_CLOSED_STATUSES.includes(order.status)) {
        throw new BadRequestException({
          message: 'The actual weight can no longer be recorded — this order has already been picked up.',
          details: { code: 'WEIGHT_RECORDING_WINDOW_CLOSED' },
        });
      }

      // The one approved formula (decision 1): actual weight x the
      // unit price already snapshotted on the item at order-creation
      // time — never a live re-read of Product.priceMinor, and never
      // editable by anyone once computed here.
      const finalAmountMinor = Math.round(((item.unitPriceMinor ?? 0) * params.weightGrams) / 1000);

      const newRecord = await manager.save(
        OrderItemWeightRecord,
        manager.create(OrderItemWeightRecord, {
          orderItemId: params.orderItemId,
          weightGrams: params.weightGrams,
          recordedByUserId: params.recordedByUserId ?? null,
          recordedByDriverId: params.recordedByDriverId ?? null,
        }),
      );

      const delta = finalAmountMinor - (item.estimatedAmountMinor ?? 0);

      item.actualWeightGrams = params.weightGrams;
      item.finalAmountMinor = finalAmountMinor;
      await manager.save(OrderItem, item);

      await applyOrderItemAmountDelta(manager, segment, order, delta);

      return newRecord;
    });
  }
}

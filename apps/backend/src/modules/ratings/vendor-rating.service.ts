import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { VendorRating } from './entities/vendor-rating.entity';
import { OrderVendorSegment } from '../orders/entities/order-vendor-segment.entity';
import { OrderVendorSegmentStatus } from '../orders/order-vendor-segment-status.enum';
import { Order } from '../orders/entities/order.entity';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';
import { RATEABLE_ORDER_STATUSES } from './rateable-order-statuses';

/**
 * CONFIRMED business decision (Ratings — smallest customer ownership
 * check, no reuse of VendorStaffAuthorizationService/
 * DriverAuthorizationService — those authorize an OPERATIONAL actor,
 * not a customer's rating eligibility, which is a distinct, new
 * concern): a customer may rate a segment only if
 *   1. the segment actually belongs to an Order owned by that customer,
 *   2. that Order is DELIVERED,
 *   3. the segment itself was not CANCELLED (a cancelled segment in an
 *      otherwise-DELIVERED multi-vendor order was never a completed
 *      interaction with that vendor),
 *   4. no rating already exists for (customer, segment) — the unique
 *      index is the real enforcement; this check just produces a
 *      clearer error than a raw DB constraint violation.
 *
 * "Not found" (never "forbidden") is used throughout for any
 * ownership/eligibility failure — same "don't leak which case"
 * convention as VendorStaffAuthorizationService/DriverAuthorizationService
 * elsewhere in this codebase.
 *
 * The rated vendor identity is ALWAYS derived from the segment
 * (`segment.vendorBranchId`) — never trusted from anything
 * client-supplied — per the "do not create two competing vendor
 * identities" instruction.
 */
@Injectable()
export class VendorRatingService {
  constructor(private readonly dataSource: DataSource) {}

  async create(params: {
    customerId: string;
    orderVendorSegmentId: string;
    stars: number;
    comment?: string;
  }): Promise<VendorRating> {
    return this.dataSource.transaction(async (manager) => {
      const segment = await manager.findOne(OrderVendorSegment, { where: { id: params.orderVendorSegmentId } });
      if (!segment || !segment.vendorBranchId) {
        // No segment, or an AD_HOC_SERVICE segment (no registered
        // vendor at all — nothing to rate as a "Vendor").
        throw new NotFoundException('Order segment not found.');
      }
      if (segment.status === OrderVendorSegmentStatus.CANCELLED) {
        throw new BadRequestException({
          message: 'This vendor segment was cancelled and is not eligible for a rating.',
          details: { code: 'SEGMENT_NOT_ELIGIBLE' },
        });
      }

      const order = await manager.findOne(Order, { where: { id: segment.orderId } });
      if (!order || order.customerId !== params.customerId || !RATEABLE_ORDER_STATUSES.includes(order.status)) {
        throw new NotFoundException('Order segment not found.');
      }

      const existing = await manager.findOne(VendorRating, {
        where: { customerId: params.customerId, orderVendorSegmentId: params.orderVendorSegmentId },
      });
      if (existing) {
        throw new ConflictException({
          message: 'You have already rated this vendor for this order.',
          details: { code: 'ALREADY_RATED' },
        });
      }

      const rating = await manager.save(
        VendorRating,
        manager.create(VendorRating, {
          customerId: params.customerId,
          orderVendorSegmentId: params.orderVendorSegmentId,
          vendorBranchId: segment.vendorBranchId,
          stars: params.stars,
          comment: params.comment ?? null,
        }),
      );

      // Atomic increments — no read-then-write race, safe under
      // concurrency without a lock. Never a stored average (see
      // VendorBranch's own comment) — always derivable from these two
      // integers.
      await manager.increment(VendorBranch, { id: segment.vendorBranchId }, 'ratingCount', 1);
      await manager.increment(VendorBranch, { id: segment.vendorBranchId }, 'ratingSumStars', params.stars);

      return rating;
    });
  }
}

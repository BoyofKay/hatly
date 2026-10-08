import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Order } from '../orders/entities/order.entity';
import { OrderVendorSegmentStatus } from '../orders/order-vendor-segment-status.enum';
import { Delivery } from '../delivery/entities/delivery.entity';
import { VendorRating } from './entities/vendor-rating.entity';
import { DriverRating } from './entities/driver-rating.entity';
import { ProductRating } from './entities/product-rating.entity';
import { RATEABLE_ORDER_STATUSES } from './rateable-order-statuses';

export interface OrderRatingState {
  orderId: string;
  vendorSegments: Array<{
    orderVendorSegmentId: string;
    vendorBranchId: string;
    alreadyRated: boolean;
    rating: { stars: number; comment: string | null } | null;
  }>;
  productItems: Array<{
    orderItemId: string;
    productId: string | null;
    productNameSnapshot: string | null;
    alreadyRated: boolean;
    rating: { stars: number; comment: string | null } | null;
  }>;
  driver: {
    deliveryId: string;
    driverId: string;
    alreadyRated: boolean;
    rating: { stars: number; comment: string | null } | null;
  } | null;
}

/**
 * Read-only — answers "what can this customer rate on this order, and
 * what have they already rated," for the customer app's Order Details
 * screen (never a forced popup — see the requirements' own framing).
 * Same ownership/eligibility rule as the three create() services:
 * order must belong to this customer and be DELIVERED (or COLLECTED — a pickup order). Excludes
 * CANCELLED segments/their items from the eligible list, and excludes
 * AD_HOC_SERVICE segments/items (nothing to rate as a "Vendor"/
 * "Product" there) — mirrors each create() service's own guard
 * exactly, so what this endpoint offers as rateable is always
 * actually accepted by the corresponding create() call.
 */
@Injectable()
export class RatingStateService {
  constructor(
    @InjectRepository(Order) private readonly ordersRepository: Repository<Order>,
    @InjectRepository(Delivery) private readonly deliveriesRepository: Repository<Delivery>,
    @InjectRepository(VendorRating) private readonly vendorRatingsRepository: Repository<VendorRating>,
    @InjectRepository(DriverRating) private readonly driverRatingsRepository: Repository<DriverRating>,
    @InjectRepository(ProductRating) private readonly productRatingsRepository: Repository<ProductRating>,
  ) {}

  async getOrderRatingState(customerId: string, orderId: string): Promise<OrderRatingState> {
    const order = await this.ordersRepository.findOne({
      where: { id: orderId },
      relations: { segments: { items: true } },
    });
    if (!order || order.customerId !== customerId || !RATEABLE_ORDER_STATUSES.includes(order.status)) {
      throw new NotFoundException('Order not found.');
    }

    const eligibleSegments = order.segments.filter(
      (s) => s.vendorBranchId != null && s.status !== OrderVendorSegmentStatus.CANCELLED,
    );
    const eligibleItems = eligibleSegments.flatMap((s) => s.items.filter((i) => i.productId != null));

    const [existingVendorRatings, existingProductRatings, delivery] = await Promise.all([
      eligibleSegments.length > 0
        ? this.vendorRatingsRepository.find({
            where: { customerId, orderVendorSegmentId: In(eligibleSegments.map((s) => s.id)) },
          })
        : Promise.resolve([]),
      eligibleItems.length > 0
        ? this.productRatingsRepository.find({
            where: { customerId, orderItemId: In(eligibleItems.map((i) => i.id)) },
          })
        : Promise.resolve([]),
      this.deliveriesRepository.findOne({ where: { orderId } }),
    ]);

    const vendorRatingBySegmentId = new Map(existingVendorRatings.map((r) => [r.orderVendorSegmentId, r]));
    const productRatingByItemId = new Map(existingProductRatings.map((r) => [r.orderItemId, r]));

    let driverState: OrderRatingState['driver'] = null;
    if (delivery?.driverId) {
      const existingDriverRating = await this.driverRatingsRepository.findOne({
        where: { customerId, deliveryId: delivery.id },
      });
      driverState = {
        deliveryId: delivery.id,
        driverId: delivery.driverId,
        alreadyRated: !!existingDriverRating,
        rating: existingDriverRating
          ? { stars: existingDriverRating.stars, comment: existingDriverRating.comment ?? null }
          : null,
      };
    }

    return {
      orderId: order.id,
      vendorSegments: eligibleSegments.map((s) => {
        const existing = vendorRatingBySegmentId.get(s.id);
        return {
          orderVendorSegmentId: s.id,
          vendorBranchId: s.vendorBranchId!,
          alreadyRated: !!existing,
          rating: existing ? { stars: existing.stars, comment: existing.comment ?? null } : null,
        };
      }),
      productItems: eligibleItems.map((i) => {
        const existing = productRatingByItemId.get(i.id);
        return {
          orderItemId: i.id,
          productId: i.productId ?? null,
          productNameSnapshot: i.productNameSnapshot ?? null,
          alreadyRated: !!existing,
          rating: existing ? { stars: existing.stars, comment: existing.comment ?? null } : null,
        };
      }),
      driver: driverState,
    };
  }
}

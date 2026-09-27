import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ProductRating } from './entities/product-rating.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { OrderVendorSegment } from '../orders/entities/order-vendor-segment.entity';
import { OrderVendorSegmentStatus } from '../orders/order-vendor-segment-status.enum';
import { Order } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/order-status.enum';
import { Product } from '../products/entities/product.entity';

/**
 * CONFIRMED business decision (Ratings — smallest customer ownership
 * check): a customer may rate an OrderItem only if
 *   1. the OrderItem actually has a real Product (an AD_HOC_SERVICE
 *      item has no productId at all — nothing to rate as a "Product"),
 *   2. the item's segment was not CANCELLED,
 *   3. the item's Order is owned by that customer and DELIVERED,
 *   4. no rating already exists for (customer, orderItem).
 *
 * A customer cannot rate an arbitrary catalog Product they never
 * purchased — the rating is always anchored to the specific OrderItem
 * they actually received, never a bare productId supplied by the
 * client for eligibility purposes (productId is only ever read FROM
 * the already-verified OrderItem, then stored as a historical
 * snapshot — see ProductRating's own comment).
 */
@Injectable()
export class ProductRatingService {
  constructor(private readonly dataSource: DataSource) {}

  async create(params: {
    customerId: string;
    orderItemId: string;
    stars: number;
    comment?: string;
  }): Promise<ProductRating> {
    return this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(OrderItem, { where: { id: params.orderItemId } });
      if (!item || !item.productId) {
        // No item, or an AD_HOC_SERVICE item (no catalog product at
        // all — nothing to rate as a "Product").
        throw new NotFoundException('Order item not found.');
      }

      const segment = await manager.findOne(OrderVendorSegment, { where: { id: item.orderVendorSegmentId } });
      if (!segment) {
        throw new NotFoundException('Order item not found.');
      }
      if (segment.status === OrderVendorSegmentStatus.CANCELLED) {
        throw new BadRequestException({
          message: 'This item\'s vendor segment was cancelled and is not eligible for a rating.',
          details: { code: 'ITEM_NOT_ELIGIBLE' },
        });
      }

      const order = await manager.findOne(Order, { where: { id: segment.orderId } });
      if (!order || order.customerId !== params.customerId || order.status !== OrderStatus.DELIVERED) {
        throw new NotFoundException('Order item not found.');
      }

      const existing = await manager.findOne(ProductRating, {
        where: { customerId: params.customerId, orderItemId: params.orderItemId },
      });
      if (existing) {
        throw new ConflictException({
          message: 'You have already rated this product for this order.',
          details: { code: 'ALREADY_RATED' },
        });
      }

      const rating = await manager.save(
        ProductRating,
        manager.create(ProductRating, {
          customerId: params.customerId,
          orderItemId: params.orderItemId,
          productId: item.productId,
          // Guaranteed non-null: item.productId was already verified truthy
          // above, which is only ever true for a CATALOG segment, and a
          // CATALOG segment always has a real VendorBranch (see
          // CartGroupType's own doc comment; order-creation.service.ts only
          // ever builds a CATALOG segment when vendorBranchId is set).
          vendorBranchId: segment.vendorBranchId!,
          stars: params.stars,
          comment: params.comment ?? null,
        }),
      );

      // Fails closed, same discipline as VendorBranch/Driver commission
      // rate lookups elsewhere: if the live Product row is gone
      // (should not normally happen — soft-delete only), the rating
      // itself is still created (it's about the historical
      // interaction, not the live catalog row); only the aggregate
      // cache increment is skipped.
      const product = await manager.findOne(Product, { where: { id: item.productId } });
      if (product) {
        await manager.increment(Product, { id: item.productId }, 'ratingCount', 1);
        await manager.increment(Product, { id: item.productId }, 'ratingSumStars', params.stars);
      }

      return rating;
    });
  }
}

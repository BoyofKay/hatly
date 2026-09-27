import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VendorRating } from './entities/vendor-rating.entity';
import { DriverRating } from './entities/driver-rating.entity';
import { ProductRating } from './entities/product-rating.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderVendorSegment } from '../orders/entities/order-vendor-segment.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { Delivery } from '../delivery/entities/delivery.entity';
import { Driver } from '../delivery/entities/driver.entity';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';
import { Product } from '../products/entities/product.entity';
import { VendorRatingService } from './vendor-rating.service';
import { DriverRatingService } from './driver-rating.service';
import { ProductRatingService } from './product-rating.service';
import { RatingStateService } from './rating-state.service';
import { RatingsController } from './ratings.controller';
import { OrderRatingStateController } from './order-rating-state.controller';

/**
 * Entities-only imports, no service dependency on OrdersModule/
 * DeliveryModule/VendorsModule/ProductsModule — same one-directional
 * "needs entities, not services" shape already established by
 * FinanceModule (see that module's own comment) — no forwardRef
 * needed anywhere in this module.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      VendorRating,
      DriverRating,
      ProductRating,
      Order,
      OrderVendorSegment,
      OrderItem,
      Delivery,
      Driver,
      VendorBranch,
      Product,
    ]),
  ],
  controllers: [RatingsController, OrderRatingStateController],
  providers: [VendorRatingService, DriverRatingService, ProductRatingService, RatingStateService],
})
export class RatingsModule {}

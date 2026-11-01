import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cart } from './entities/cart.entity';
import { CartVendorGroup } from './entities/cart-vendor-group.entity';
import { CartItem } from './entities/cart-item.entity';
import { CartItemOptionValue } from './entities/cart-item-option-value.entity';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';
import { CartService } from './cart.service';
import { CartCompatibilityService } from './cart-compatibility.service';
import { BusinessConfigModule } from '../business-config/business-config.module';
import { CartPricingService } from './cart-pricing.service';
import { CartController } from './cart.controller';
import { UploadsModule } from '../uploads/uploads.module';
import { DeliveryFeeCalculationModule } from '../delivery-fee/delivery-fee-calculation.module';
import { OffersModule } from '../offers/offers.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Cart, CartVendorGroup, CartItem, CartItemOptionValue, VendorBranch]),
    UploadsModule,
    DeliveryFeeCalculationModule,
    OffersModule,
    BusinessConfigModule,
  ],
  controllers: [CartController],
  providers: [CartService, CartPricingService, CartCompatibilityService],
})
export class CartModule {}

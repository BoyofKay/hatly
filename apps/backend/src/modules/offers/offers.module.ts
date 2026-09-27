import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Offer } from './entities/offer.entity';
import { OfferProduct } from './entities/offer-product.entity';
import { OfferCategory } from './entities/offer-category.entity';
import { OfferConsumption } from './entities/offer-consumption.entity';
import { Product } from '../products/entities/product.entity';
import { ProductCategory } from '../products/entities/product-category.entity';
import { OfferConsumptionService } from './offer-consumption.service';
import { AdminOffersService } from './admin-offers.service';
import { AdminOffersController } from './admin-offers.controller';
import { FinanceModule } from '../finance/finance.module';

/**
 * Entities-only cross-module imports (Product/ProductCategory), no
 * service dependency in either direction — same one-directional shape
 * already established by FinanceModule/RatingsModule. FinanceModule IS
 * a real service dependency (OfferConsumptionService needs
 * FinancialEventService) — imported directly, no forwardRef needed
 * since FinanceModule needs nothing back from this module.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Offer, OfferProduct, OfferCategory, OfferConsumption, Product, ProductCategory]),
    FinanceModule,
  ],
  controllers: [AdminOffersController],
  providers: [OfferConsumptionService, AdminOffersService],
  // OfferConsumptionService exported for OrdersModule (OrderCreationService needs it).
  exports: [OfferConsumptionService],
})
export class OffersModule {}

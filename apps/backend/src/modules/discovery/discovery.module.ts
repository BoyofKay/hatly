import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BestSellingCacheService } from './best-selling-cache.service';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';
import { Product } from '../products/entities/product.entity';
import { ServiceAreasModule } from '../service-areas/service-areas.module';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { OffersModule } from '../offers/offers.module';

/**
 * `BestSellingCacheService` only needs `DataSource` (already globally
 * available once `TypeOrmModule.forRoot` is configured in
 * app.module.ts, where every entity is already registered) — no
 * `TypeOrmModule.forFeature` import is needed here, since it never
 * injects a repository directly.
 *
 * Customer Search addition: `SearchService` DOES need repositories
 * (VendorBranch, Product) plus `ServiceAreaResolverService` — imported
 * here rather than duplicating either.
 */
@Module({
  imports: [TypeOrmModule.forFeature([VendorBranch, Product]), ServiceAreasModule, OffersModule],
  controllers: [SearchController],
  providers: [BestSellingCacheService, SearchService],
  exports: [BestSellingCacheService],
})
export class DiscoveryModule {}

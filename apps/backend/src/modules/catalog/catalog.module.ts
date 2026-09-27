import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogProduct } from './entities/catalog-product.entity';
import { Product } from '../products/entities/product.entity';
import { MarketplaceSector } from '../sectors/entities/marketplace-sector.entity';
import { ServiceAreasModule } from '../service-areas/service-areas.module';
import { OffersModule } from '../offers/offers.module';
import { CatalogProductsService } from './catalog-products.service';
import { CatalogDiscoveryService } from './catalog-discovery.service';
import { AdminCatalogProductsController } from './admin-catalog-products.controller';
import { CatalogPublicController } from './catalog-public.controller';

/**
 * Catalog Foundation: the shared marketplace product identity (admin-curated, explicit links only) and the
 * product-first public API on top of the existing vendor listings.
 */
@Module({
  imports: [TypeOrmModule.forFeature([CatalogProduct, Product, MarketplaceSector]), ServiceAreasModule, OffersModule],
  controllers: [AdminCatalogProductsController, CatalogPublicController],
  providers: [CatalogProductsService, CatalogDiscoveryService],
  exports: [CatalogProductsService],
})
export class CatalogModule {}

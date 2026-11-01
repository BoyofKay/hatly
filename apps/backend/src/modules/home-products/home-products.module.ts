import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { SectorsModule } from '../sectors/sectors.module';
import { OffersModule } from '../offers/offers.module';
import { HomeCacheEpochInterceptor } from './home-cache-epoch.interceptor';
import { HomeProductSectionsController } from './home-product-sections.controller';
import { HomeProductSectionsService } from './home-product-sections.service';
import { HomeSectionsCache } from './home-sections.cache';

@Module({
  imports: [SectorsModule, OffersModule],
  controllers: [HomeProductSectionsController],
  providers: [HomeProductSectionsService, HomeSectionsCache, { provide: APP_INTERCEPTOR, useClass: HomeCacheEpochInterceptor }],
  exports: [HomeSectionsCache],
})
export class HomeProductsModule {}

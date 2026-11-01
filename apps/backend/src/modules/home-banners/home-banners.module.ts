import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HomeBanner } from './entities/home-banner.entity';
import { Product } from '../products/entities/product.entity';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';
import { MarketplaceSector } from '../sectors/entities/marketplace-sector.entity';
import { UploadsModule } from '../uploads/uploads.module';
import { HomeBannersService } from './home-banners.service';
import { AdminHomeBannersController } from './admin-home-banners.controller';
import { PublicHomeBannersController } from './public-home-banners.controller';

@Module({
  imports: [TypeOrmModule.forFeature([HomeBanner, Product, VendorBranch, MarketplaceSector]), UploadsModule],
  controllers: [AdminHomeBannersController, PublicHomeBannersController],
  providers: [HomeBannersService],
})
export class HomeBannersModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarketplaceSector } from './entities/marketplace-sector.entity';
import { MarketplaceSubcategory } from './entities/marketplace-subcategory.entity';
import { VendorBranchSubcategory } from './entities/vendor-branch-subcategory.entity';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { Offer } from '../offers/entities/offer.entity';
import { SectorsService } from './sectors.service';
import { SubcategoriesService } from './subcategories.service';
import { MarketplaceVendorsService } from './marketplace-vendors.service';
import { AdminSectorsController } from './admin-sectors.controller';
import { AdminSubcategoriesController } from './admin-subcategories.controller';
import { AdminVendorBranchSectorController } from './admin-vendor-branch-sector.controller';
import { PublicSectorsController } from './public-sectors.controller';
import { PublicSubcategoriesController } from './public-subcategories.controller';
import { MarketplaceVendorsController } from './marketplace-vendors.controller';
import { ServiceAreasModule } from '../service-areas/service-areas.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MarketplaceSector, MarketplaceSubcategory, VendorBranchSubcategory, VendorBranch, Vendor, Offer]),
    ServiceAreasModule,
  ],
  controllers: [
    AdminSectorsController,
    AdminSubcategoriesController,
    AdminVendorBranchSectorController,
    PublicSectorsController,
    PublicSubcategoriesController,
    MarketplaceVendorsController,
  ],
  providers: [SectorsService, SubcategoriesService, MarketplaceVendorsService],
})
export class SectorsModule {}

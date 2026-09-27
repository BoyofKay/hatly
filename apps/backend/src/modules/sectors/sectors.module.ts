import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarketplaceSector } from './entities/marketplace-sector.entity';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { SectorsService } from './sectors.service';
import { MarketplaceVendorsService } from './marketplace-vendors.service';
import { AdminSectorsController } from './admin-sectors.controller';
import { AdminVendorBranchSectorController } from './admin-vendor-branch-sector.controller';
import { PublicSectorsController } from './public-sectors.controller';
import { MarketplaceVendorsController } from './marketplace-vendors.controller';
import { ServiceAreasModule } from '../service-areas/service-areas.module';

@Module({
  imports: [TypeOrmModule.forFeature([MarketplaceSector, VendorBranch, Vendor]), ServiceAreasModule],
  controllers: [
    AdminSectorsController,
    AdminVendorBranchSectorController,
    PublicSectorsController,
    MarketplaceVendorsController,
  ],
  providers: [SectorsService, MarketplaceVendorsService],
})
export class SectorsModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vendor } from './entities/vendor.entity';
import { VendorBranch } from './entities/vendor-branch.entity';
import { VendorStaff } from './entities/vendor-staff.entity';
import { ServiceArea } from '../service-areas/entities/service-area.entity';
import { VendorStaffService } from './vendor-staff.service';
import { VendorStaffAuthorizationService } from './vendor-staff-authorization.service';
import { AdminVendorStaffController } from './admin-vendor-staff.controller';
import { AdminVendorsService } from './admin-vendors.service';
import { AdminVendorsController, AdminVendorBranchesController } from './admin-vendors.controller';
import { VendorBranchesController } from './vendor-branches.controller';

/**
 * Phase 1 scope: entities + module registration only. Vendor catalog
 * CRUD (products, categories, hours management) is Phase 2/4 — see
 * the roadmap in the Phase 0 analysis doc. Stage A adds VendorStaff
 * (admin-only onboarding) — see vendor-staff.service.ts. Phase B adds
 * VendorStaffAuthorizationService (exported for OrdersModule to use).
 * Phase I-A, Chunk 1 adds Vendor/VendorBranch onboarding CRUD — see
 * admin-vendors.service.ts.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Vendor, VendorBranch, VendorStaff, ServiceArea])],
  controllers: [
    AdminVendorStaffController,
    AdminVendorsController,
    AdminVendorBranchesController,
    VendorBranchesController,
  ],
  providers: [VendorStaffService, VendorStaffAuthorizationService, AdminVendorsService],
  exports: [TypeOrmModule, VendorStaffAuthorizationService],
})
export class VendorsModule {}

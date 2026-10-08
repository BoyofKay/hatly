import { Body, Controller, Param, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { SectorsService } from './sectors.service';
import { SubcategoriesService } from './subcategories.service';
import { AssignBranchSectorDto } from './dto/assign-branch-sector.dto';
import { SetBranchSubcategoriesDto } from './dto/set-branch-subcategories.dto';

/**
 * FINAL DECISION: Admin-only assignment of a VendorBranch's sector —
 * Vendors/Vendor Staff never assign their own sector. No general
 * VendorBranch CRUD controller exists in this codebase yet (branches
 * are still seeded directly, per this feature's own Design Review
 * finding) — this is deliberately the minimum single capability
 * needed for this chunk, not a full admin VendorBranch management
 * surface.
 *
 * Consolidated customer-commerce milestone addition: `:id/subcategories`
 * — a full-set-replace assignment, same Admin-only gating, added here
 * (not a new controller) since it addresses the same VendorBranch
 * resource this controller already owns.
 */
@ApiTags('admin-vendor-branches')
@Controller('admin/vendor-branches')
export class AdminVendorBranchSectorController {
  constructor(
    private readonly sectorsService: SectorsService,
    private readonly subcategoriesService: SubcategoriesService,
  ) {}

  @Patch(':id/sector')
  @RequiresPermission(Permission.MANAGE_MARKETPLACE_SECTORS)
  async assignSector(@Param('id') id: string, @Body() dto: AssignBranchSectorDto) {
    const branch = await this.sectorsService.assignBranchSector(id, dto.marketplaceSectorId);
    return { data: branch };
  }

  @Patch(':id/subcategories')
  @RequiresPermission(Permission.MANAGE_MARKETPLACE_SECTORS)
  async setSubcategories(@Param('id') id: string, @Body() dto: SetBranchSubcategoriesDto) {
    const subcategories = await this.subcategoriesService.setBranchSubcategories(id, dto.subcategoryIds);
    return { data: subcategories };
  }
}

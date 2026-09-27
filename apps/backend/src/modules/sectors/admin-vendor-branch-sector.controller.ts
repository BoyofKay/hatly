import { Body, Controller, Param, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { SectorsService } from './sectors.service';
import { AssignBranchSectorDto } from './dto/assign-branch-sector.dto';

/**
 * FINAL DECISION: Admin-only assignment of a VendorBranch's sector —
 * Vendors/Vendor Staff never assign their own sector. No general
 * VendorBranch CRUD controller exists in this codebase yet (branches
 * are still seeded directly, per this feature's own Design Review
 * finding) — this is deliberately the minimum single capability
 * needed for this chunk, not a full admin VendorBranch management
 * surface.
 */
@ApiTags('admin-vendor-branches')
@Controller('admin/vendor-branches')
export class AdminVendorBranchSectorController {
  constructor(private readonly sectorsService: SectorsService) {}

  @Patch(':id/sector')
  @RequiresPermission(Permission.MANAGE_MARKETPLACE_SECTORS)
  async assignSector(@Param('id') id: string, @Body() dto: AssignBranchSectorDto) {
    const branch = await this.sectorsService.assignBranchSector(id, dto.marketplaceSectorId);
    return { data: branch };
  }
}

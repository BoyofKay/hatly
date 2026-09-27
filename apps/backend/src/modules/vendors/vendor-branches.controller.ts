import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { VendorStaffAuthorizationService } from './vendor-staff-authorization.service';

/**
 * CHUNK 12B-3-A. A separate, small controller — same reasoning as
 * `VendorCategoriesController` (Chunk 12B-3): a route at
 * `vendor/branches` cannot live on a controller class already
 * prefixed `vendor/products` without incorrect nesting. This one
 * lives in the `vendors` module itself (not `products`), since it's
 * purely about branch identity, not catalog data — its only
 * dependency is `VendorStaffAuthorizationService`, already local to
 * this module. Read-only: exactly one route, no create/update/
 * delete/activate/deactivate capability anywhere on this class.
 *
 * No `vendorId` query parameter accepted anywhere — the authenticated
 * user's own identity (`@CurrentUser()`) is the only input; there is
 * no way to request another vendor's branches through this endpoint.
 */
@ApiTags('vendor-branches')
@Controller('vendor/branches')
@UseGuards(RolesGuard)
@Roles(Role.VENDOR, Role.VENDOR_MANAGER)
export class VendorBranchesController {
  constructor(private readonly vendorStaffAuthorizationService: VendorStaffAuthorizationService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    const branches = await this.vendorStaffAuthorizationService.getOwnedBranches(user.id);
    return { data: branches };
  }
}

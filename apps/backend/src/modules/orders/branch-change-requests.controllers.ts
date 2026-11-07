import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { BranchChangeKind, BranchChangeRequestsService } from './branch-change-requests.service';

/** R8/R44: a store's own requests (pause / reopen / hours / closure) — list, send, withdraw. */
@ApiTags('vendor-branch-change-requests')
@Controller('vendor/branches/:branchId/change-requests')
@UseGuards(RolesGuard)
@Roles(Role.VENDOR, Role.VENDOR_MANAGER)
export class VendorBranchChangeRequestsController {
  constructor(private readonly requests: BranchChangeRequestsService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Param('branchId') branchId: string) {
    return { data: await this.requests.vendorList(user, branchId) };
  }

  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Param('branchId') branchId: string, @Body() body: { kind?: BranchChangeKind; payload?: Record<string, unknown>; reason?: string }) {
    return { data: await this.requests.request(user, branchId, body?.kind as BranchChangeKind, body?.payload ?? {}, body?.reason) };
  }

  @Post(':requestId/withdraw')
  async withdraw(@CurrentUser() user: AuthenticatedUser, @Param('branchId') branchId: string, @Param('requestId') requestId: string) {
    return { data: await this.requests.withdraw(user, branchId, requestId) };
  }
}

/** R8/R44: Hatly Admin reviews store change requests. Admin can still change hours / open / close / closures directly elsewhere. */
@ApiTags('admin-branch-change-requests')
@Controller('admin/branch-change-requests')
export class AdminBranchChangeRequestsController {
  constructor(private readonly requests: BranchChangeRequestsService) {}

  @Get()
  @RequiresPermission(Permission.MANAGE_VENDORS)
  async list(@Query('status') status?: string) {
    return { data: await this.requests.adminList(status) };
  }

  @Post(':requestId/approve')
  @RequiresPermission(Permission.MANAGE_VENDORS)
  async approve(@CurrentUser() user: AuthenticatedUser, @Param('requestId') requestId: string, @Body() body: { note?: string }) {
    return { data: await this.requests.approve(user, requestId, body?.note) };
  }

  @Post(':requestId/reject')
  @RequiresPermission(Permission.MANAGE_VENDORS)
  async reject(@CurrentUser() user: AuthenticatedUser, @Param('requestId') requestId: string, @Body() body: { note?: string }) {
    return { data: await this.requests.reject(user, requestId, body?.note) };
  }
}

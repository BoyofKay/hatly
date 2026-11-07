import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiresAnyPermission, RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { ProductChangeRequestsService } from './product-change-requests.service';

/**
 * R7: Hatly reviews vendors' new products, price increases and product-detail / option changes. Approving applies the change (a new product
 * goes live as the vendor asked); rejecting changes nothing (a new product stays off). Admin's own product edits never need this.
 */
@ApiTags('admin-product-change-requests')
@Controller('admin/product-change-requests')
export class AdminProductChangeRequestsController {
  constructor(private readonly requests: ProductChangeRequestsService) {}

  @Get()
  @RequiresAnyPermission(Permission.MANAGE_CATALOG, Permission.CATALOG_VIEW)
  async list(@Query('status') status?: string) {
    return { data: await this.requests.adminList(status) };
  }

  @Post(':requestId/approve')
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async approve(@CurrentUser() user: AuthenticatedUser, @Param('requestId') requestId: string, @Body() body: { note?: string }) {
    return { data: await this.requests.approve(user, requestId, body?.note) };
  }

  @Post(':requestId/reject')
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async reject(@CurrentUser() user: AuthenticatedUser, @Param('requestId') requestId: string, @Body() body: { note?: string }) {
    return { data: await this.requests.reject(user, requestId, body?.note) };
  }
}

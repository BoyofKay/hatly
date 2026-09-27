import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { PermissionsService } from '../permissions/permissions.service';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { AdminDispatchService } from './admin-dispatch.service';
import { AssignDriverDto } from './dto/assign-driver.dto';
import { ReassignDriverDto } from './dto/reassign-driver.dto';
import { DispatchAlert } from './entities/dispatch-alert.entity';

/**
 * No @UseGuards here — PermissionsGuard is global (Phase 1 hardening),
 * so @RequiresPermission alone is sufficient, same as every other
 * admin-facing controller in this codebase. Both endpoints below
 * additionally resolve OVERRIDE_DISPATCH directly (a caller must
 * always hold ASSIGN_REASSIGN_ORDERS just to reach this controller at
 * all; OVERRIDE_DISPATCH is a SECOND, separate permission checked only
 * to decide whether a named driver bypasses ranking/eligibility — see
 * AdminDispatchService's own doc comment).
 */
@ApiTags('admin-dispatch')
@Controller('admin/orders')
export class AdminDispatchController {
  constructor(
    private readonly adminDispatchService: AdminDispatchService,
    private readonly permissionsService: PermissionsService,
  ) {}

  @Get('dispatchable')
  @RequiresPermission(Permission.ASSIGN_REASSIGN_ORDERS)
  async listDispatchable() {
    const orders = await this.adminDispatchService.listDispatchable();
    return { data: orders };
  }

  @Post(':orderId/assign-driver')
  @RequiresPermission(Permission.ASSIGN_REASSIGN_ORDERS)
  async assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Body() dto: AssignDriverDto,
  ) {
    const hasOverride = await this.permissionsService.hasPermission(user.id, Permission.OVERRIDE_DISPATCH);
    const delivery = await this.adminDispatchService.assign(orderId, dto.driverId, hasOverride);
    return { data: delivery };
  }

  @Post(':orderId/reassign-driver')
  @RequiresPermission(Permission.ASSIGN_REASSIGN_ORDERS)
  async reassign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Body() dto: ReassignDriverDto,
  ) {
    const hasOverride = await this.permissionsService.hasPermission(user.id, Permission.OVERRIDE_DISPATCH);
    const delivery = await this.adminDispatchService.reassign(orderId, dto.driverId, hasOverride);
    return { data: delivery };
  }
}

@ApiTags('admin-dispatch-alerts')
@Controller('admin/dispatch-alerts')
export class AdminDispatchAlertsController {
  constructor(
    @InjectRepository(DispatchAlert) private readonly dispatchAlertsRepository: Repository<DispatchAlert>,
  ) {}

  @Get()
  @RequiresPermission(Permission.ASSIGN_REASSIGN_ORDERS)
  async list() {
    const alerts = await this.dispatchAlertsRepository.find({ order: { createdAt: 'DESC' } });
    return { data: alerts };
  }
}

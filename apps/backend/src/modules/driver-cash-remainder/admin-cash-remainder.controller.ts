import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { DriverCashRemainderService } from './driver-cash-remainder.service';
import { RejectCashRemainderDto } from './dto/reject-cash-remainder.dto';

/**
 * Admin-mediated Driver Cash Remainder (Chunk E). No @UseGuards here
 * — PermissionsGuard is global, same as every other Admin-facing
 * controller in this codebase (AdminDispatchController's own
 * comment). Gated by MANAGE_CUSTOMER_WALLET — this is the first real
 * operation that permission controls, since it's the first Admin
 * action that actually creates a WalletTransaction.
 */
@ApiTags('admin-cash-remainder')
@Controller('admin/cash-remainders')
export class AdminCashRemainderController {
  constructor(private readonly driverCashRemainderService: DriverCashRemainderService) {}

  @Get()
  @RequiresPermission(Permission.MANAGE_CUSTOMER_WALLET)
  async listPending() {
    const data = await this.driverCashRemainderService.listPending();
    return { data };
  }

  @Get(':id')
  @RequiresPermission(Permission.MANAGE_CUSTOMER_WALLET)
  async getOne(@Param('id') id: string) {
    const data = await this.driverCashRemainderService.getOne(id);
    return { data };
  }

  @Patch(':id/approve')
  @RequiresPermission(Permission.MANAGE_CUSTOMER_WALLET)
  async approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const data = await this.driverCashRemainderService.approve(id, user.id);
    return { data };
  }

  @Patch(':id/reject')
  @RequiresPermission(Permission.MANAGE_CUSTOMER_WALLET)
  async reject(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: RejectCashRemainderDto) {
    const data = await this.driverCashRemainderService.reject(id, user.id, dto.reason);
    return { data };
  }
}

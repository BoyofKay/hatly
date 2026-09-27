import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { DriverCashRemainderService } from './driver-cash-remainder.service';
import { SubmitCashRemainderDto } from './dto/submit-cash-remainder.dto';

/**
 * Admin-mediated Driver Cash Remainder (Chunk E). Same
 * @UseGuards(RolesGuard) @Roles(Role.DRIVER) pattern already used by
 * DriverController — a Driver acting on their own assigned Delivery,
 * ownership enforced inside the service via
 * DriverAuthorizationService, not by role gating alone (the exact gap
 * this codebase's own Driver Phase C design review already identified
 * and fixed elsewhere).
 */
@ApiTags('driver-cash-remainder')
@Controller('driver/deliveries')
@UseGuards(RolesGuard)
@Roles(Role.DRIVER)
export class DriverCashRemainderController {
  constructor(private readonly driverCashRemainderService: DriverCashRemainderService) {}

  @Post(':id/cash-remainder')
  async submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') deliveryId: string,
    @Body() dto: SubmitCashRemainderDto,
  ) {
    const remainder = await this.driverCashRemainderService.submit({
      driverUserId: user.id,
      deliveryId,
      cashReceivedMinor: dto.cashReceivedMinor,
    });
    return { data: remainder };
  }
}

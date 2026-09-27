import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ManualTransferService } from './manual-transfer.service';

@ApiTags('manual-transfer')
@Controller('payments/manual-transfer')
@UseGuards(RolesGuard)
@Roles(Role.CUSTOMER)
export class ManualTransferController {
  constructor(private readonly manualTransferService: ManualTransferService) {}

  @Get('config')
  async getConfig() {
    const config = await this.manualTransferService.getConfig();
    return { data: config };
  }

  @Post('orders/:orderId/claim')
  async claim(@CurrentUser() user: AuthenticatedUser, @Param('orderId') orderId: string) {
    const payment = await this.manualTransferService.claimTransfer(user.id, orderId);
    return { data: payment };
  }
}

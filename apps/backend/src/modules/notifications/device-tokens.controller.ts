import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { DeviceTokensService } from './device-tokens.service';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto';

/**
 * Driver Push Notifications. Role-gated the same way DriverController
 * already is (Role.DRIVER, RolesGuard) — a small, dedicated controller
 * kept in this self-contained notifications module rather than
 * touching the existing (large) DriverController/DeliveryModule.
 * `user.id` (never a request body field) is the sole source of
 * ownership — see RegisterDeviceTokenDto's own comment.
 */
@ApiTags('driver-device-token')
@Controller('driver/device-token')
@UseGuards(RolesGuard)
@Roles(Role.DRIVER)
export class DeviceTokensController {
  constructor(private readonly deviceTokensService: DeviceTokensService) {}

  @Post()
  async register(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterDeviceTokenDto) {
    await this.deviceTokensService.registerToken({
      userId: user.id,
      token: dto.token,
      platform: dto.platform,
    });
    return { message: 'Device registered.' };
  }
}

import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { DeviceTokensService } from './device-tokens.service';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto';

/**
 * Customer Push Notifications (Chunk A). A separate, Customer-scoped
 * controller mirroring DeviceTokensController's exact shape — NOT a
 * generalization of that Driver-only controller (its
 * `@Roles(Role.DRIVER)` restriction is a deliberate existing security
 * boundary and is left completely unchanged). Reuses
 * `DeviceTokensService`/`DeviceToken`/`RegisterDeviceTokenDto`
 * unmodified — all three were already role-agnostic in shape, so no
 * new entity or DTO was needed. `user.id` (never a request body
 * field) is the sole source of ownership, identical to the Driver
 * endpoint's own confirmed pattern.
 */
@ApiTags('customer-device-token')
@Controller('customer/device-token')
@UseGuards(RolesGuard)
@Roles(Role.CUSTOMER)
export class CustomerDeviceTokensController {
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

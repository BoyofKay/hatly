import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { BusinessConfigService } from './business-config.service';

/**
 * PD-012. The configured default route endpoints of Hatly ("هاتلي من مكان") and Wasally ("وصّلي لمكان"), so the customer app can show
 * the resolved origin / destination before the customer confirms. A missing default is `null` — never a guess. The server
 * re-resolves the route at quote and order time; nothing the app sends here can change a price.
 */
@ApiTags('hatly-service')
@Controller('hatly-service')
@UseGuards(RolesGuard)
@Roles(Role.CUSTOMER)
export class ServiceRouteDefaultsController {
  constructor(private readonly businessConfigService: BusinessConfigService) {}

  @Get('route-defaults')
  async routeDefaults() {
    return { data: await this.businessConfigService.getServiceRouteDefaults() };
  }
}

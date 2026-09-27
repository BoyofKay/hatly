import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { HatlyServicePricingService } from './hatly-service-pricing.service';
import { UpsertHatlyServicePricingConfigDto } from './dto/upsert-hatly-service-pricing-config.dto';

/**
 * Scaffold only — see hatly-service-pricing-config.entity.ts. This
 * endpoint stores/retrieves an opaque config blob; it does not price
 * anything, since no ad-hoc Hatly Service pricing formula has been
 * approved yet.
 */
@ApiTags('admin-hatly-service-pricing')
@Controller('admin/hatly-service-pricing-config')
export class HatlyServicePricingController {
  constructor(private readonly hatlyServicePricingService: HatlyServicePricingService) {}

  @Get()
  @RequiresPermission(Permission.MANAGE_HATLY_SERVICE_PRICING)
  async get() {
    const row = await this.hatlyServicePricingService.getCurrent();
    return { data: row };
  }

  @Put()
  @RequiresPermission(Permission.MANAGE_HATLY_SERVICE_PRICING)
  async upsert(@Body() dto: UpsertHatlyServicePricingConfigDto, @CurrentUser() actor: AuthenticatedUser) {
    const row = await this.hatlyServicePricingService.upsert(dto.config, actor.id, dto.isActive);
    return { data: row };
  }
}

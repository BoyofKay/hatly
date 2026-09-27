import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { BusinessConfigService } from './business-config.service';

/**
 * Customer-safe Hatly support contact. Exposes exactly ONE value (the support WhatsApp number) and nothing else from
 * BusinessConfig. Deliberately independent of Manual Transfer: it does not read MANUAL_TRANSFER_DESTINATION and it does
 * not fail when the number is unset — `whatsappNumber` is then `null` and the client hides the support action.
 */
@ApiTags('support')
@Controller('support')
@UseGuards(RolesGuard)
@Roles(Role.CUSTOMER)
export class SupportContactController {
  constructor(private readonly businessConfigService: BusinessConfigService) {}

  @Get('contact')
  async getContact() {
    const whatsappNumber = await this.businessConfigService.getCustomerSupportWhatsappNumber();
    return { data: { whatsappNumber } };
  }
}

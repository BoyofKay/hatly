import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { DeliveryZonesService } from './delivery-zones.service';

/** Read-only zone list for the customer's address form. The fee shown is informational; checkout's quote is authoritative. */
@ApiTags('delivery-zones')
@Controller('delivery-zones')
@UseGuards(RolesGuard)
@Roles(Role.CUSTOMER)
export class DeliveryZonesController {
  constructor(private readonly zonesService: DeliveryZonesService) {}

  @Get()
  async list() {
    const zones = await this.zonesService.listActive();
    return {
      data: zones.map((z) => ({
        id: z.id,
        zoneName: z.zoneName,
        zoneNameAr: z.zoneNameAr,
        name: z.name,
        nameAr: z.nameAr,
        city: z.city,
        cityAr: z.cityAr,
        governorate: z.governorate,
        governorateAr: z.governorateAr,
        deliveryFeeMinor: z.deliveryFeeMinor,
      })),
    };
  }
}

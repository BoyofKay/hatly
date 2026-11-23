import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { DeliveryZonesService } from './delivery-zones.service';
import { CreateDeliveryZoneDto } from './dto/create-delivery-zone.dto';
import { UpdateDeliveryZoneDto } from './dto/update-delivery-zone.dto';
import { UpdateDeliveryZoneFeeDto } from './dto/update-delivery-zone-fee.dto';
import { SaveDeliveryZoneGroupDto } from './dto/save-delivery-zone-group.dto';

/**
 * Zones are service-area structure (MANAGE_SERVICE_AREAS). Anything that sets a PRICE additionally needs the existing
 * delivery-pricing permission (MANAGE_DELIVERY_FEE_MULTIPLIER — AND semantics), exactly like the other delivery-fee config.
 */
@ApiTags('admin-delivery-zones')
@Controller('admin/delivery-zones')
export class AdminDeliveryZonesController {
  constructor(private readonly zonesService: DeliveryZonesService) {}

  @Get()
  @RequiresPermission(Permission.MANAGE_SERVICE_AREAS)
  async list() {
    return { data: await this.zonesService.listAll() };
  }

  @Post('group/save')
  @RequiresPermission(Permission.MANAGE_SERVICE_AREAS, Permission.MANAGE_DELIVERY_FEE_MULTIPLIER)
  async saveGroup(@Body() dto: SaveDeliveryZoneGroupDto) {
    return { data: await this.zonesService.saveGroup(dto) };
  }

  @Delete('group')
  @RequiresPermission(Permission.MANAGE_SERVICE_AREAS)
  async removeGroup(@Query('serviceAreaId') serviceAreaId: string, @Query('zoneName') zoneName: string, @Query('zoneNameAr') zoneNameAr: string) {
    await this.zonesService.removeGroup(serviceAreaId, zoneName, zoneNameAr);
    return { data: { removed: true } };
  }

  @Get(':id')
  @RequiresPermission(Permission.MANAGE_SERVICE_AREAS)
  async getOne(@Param('id') id: string) {
    return { data: await this.zonesService.getOne(id) };
  }

  @Post()
  @RequiresPermission(Permission.MANAGE_SERVICE_AREAS, Permission.MANAGE_DELIVERY_FEE_MULTIPLIER)
  async create(@Body() dto: CreateDeliveryZoneDto) {
    return { data: await this.zonesService.create(dto) };
  }

  @Patch(':id')
  @RequiresPermission(Permission.MANAGE_SERVICE_AREAS)
  async update(@Param('id') id: string, @Body() dto: UpdateDeliveryZoneDto) {
    return { data: await this.zonesService.update(id, dto) };
  }

  @Patch(':id/delivery-fee')
  @RequiresPermission(Permission.MANAGE_SERVICE_AREAS, Permission.MANAGE_DELIVERY_FEE_MULTIPLIER)
  async updateFee(@Param('id') id: string, @Body() dto: UpdateDeliveryZoneFeeDto) {
    return { data: await this.zonesService.updateFee(id, dto.deliveryFeeMinor) };
  }

  @Patch(':id/activate')
  @RequiresPermission(Permission.MANAGE_SERVICE_AREAS)
  async activate(@Param('id') id: string) {
    return { data: await this.zonesService.setActive(id, true) };
  }

  @Patch(':id/deactivate')
  @RequiresPermission(Permission.MANAGE_SERVICE_AREAS)
  async deactivate(@Param('id') id: string) {
    return { data: await this.zonesService.setActive(id, false) };
  }
}

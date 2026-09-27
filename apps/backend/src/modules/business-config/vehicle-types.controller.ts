import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { VehicleTypesService } from './vehicle-types.service';
import { CreateVehicleTypeDto, UpdateVehicleTypeDto } from './dto/vehicle-type.dto';

@ApiTags('admin-vehicle-types')
@Controller('admin/vehicle-types')
export class VehicleTypesController {
  constructor(private readonly vehicleTypesService: VehicleTypesService) {}

  @Get()
  @RequiresPermission(Permission.MANAGE_VEHICLE_TYPES)
  async list(@Query('includeInactive') includeInactive?: string) {
    const rows = await this.vehicleTypesService.list(includeInactive === 'true');
    return { data: rows };
  }

  @Post()
  @RequiresPermission(Permission.MANAGE_VEHICLE_TYPES)
  async create(@Body() dto: CreateVehicleTypeDto) {
    const row = await this.vehicleTypesService.create(dto);
    return { data: row };
  }

  @Patch(':id')
  @RequiresPermission(Permission.MANAGE_VEHICLE_TYPES)
  async update(@Param('id') id: string, @Body() dto: UpdateVehicleTypeDto) {
    const row = await this.vehicleTypesService.update(id, dto);
    return { data: row };
  }
}

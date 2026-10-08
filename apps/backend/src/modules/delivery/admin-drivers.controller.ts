import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { DriversService } from './drivers.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverVerificationDto } from './dto/update-driver-verification.dto';
import { UpdateDriverVehicleTypeDto } from './dto/update-driver-vehicle-type.dto';
import { VehicleTypesService } from '../business-config/vehicle-types.service';

@ApiTags('admin-drivers')
@Controller('admin/drivers')
export class AdminDriversController {
  constructor(
    private readonly driversService: DriversService,
    private readonly vehicleTypesService: VehicleTypesService,
  ) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_DRIVERS)
  async create(@Body() dto: CreateDriverDto) {
    const driver = await this.driversService.create(dto);
    return { data: driver };
  }

  /**
   * PHASE I-A, CHUNK 6 addition — for the Admin Dispatch driver-picker.
   * Reuses MANAGE_DRIVERS (already covers this controller entirely);
   * no new permission introduced.
   */
  @Get()
  @RequiresPermission(Permission.MANAGE_DRIVERS)
  async list() {
    const drivers = await this.driversService.listAll();
    return { data: drivers };
  }

  /**
   * Driver Core + Dispatch Foundation milestone. Same MANAGE_DRIVERS permission as the rest of this
   * controller — no new permission introduced.
   */
  @Patch(':id/verification')
  @RequiresPermission(Permission.MANAGE_DRIVERS)
  async setVerification(@Param('id') id: string, @Body() dto: UpdateDriverVerificationDto) {
    const driver = await this.driversService.setVerificationStatus(id, dto.status);
    return { data: driver };
  }

  /**
   * Operational Completion milestone — the ACTIVE vehicle types an admin can give a driver (the picker on the Drivers page).
   * MANAGE_DRIVERS, like the action it serves: the full catalog (incl. inactive rows and its editing) stays MANAGE_VEHICLE_TYPES.
   * Registered before `:id/…` routes; a static path never collides with them.
   */
  @Get('vehicle-types')
  @RequiresPermission(Permission.MANAGE_DRIVERS)
  async vehicleTypes() {
    const rows = await this.vehicleTypesService.list(false);
    return { data: rows.map((v) => ({ id: v.id, name: v.name, nameAr: v.nameAr ?? null, isBicycle: v.isBicycle })) };
  }

  /** Operational Completion milestone — set or clear (`null`) a driver's vehicle type. Same MANAGE_DRIVERS as the rest. */
  @Patch(':id/vehicle-type')
  @RequiresPermission(Permission.MANAGE_DRIVERS)
  async setVehicleType(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDriverVehicleTypeDto) {
    return { data: await this.driversService.setVehicleType(id, dto.vehicleTypeId) };
  }
}

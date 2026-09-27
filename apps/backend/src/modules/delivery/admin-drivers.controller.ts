import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { DriversService } from './drivers.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverVerificationDto } from './dto/update-driver-verification.dto';

@ApiTags('admin-drivers')
@Controller('admin/drivers')
export class AdminDriversController {
  constructor(private readonly driversService: DriversService) {}

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
}

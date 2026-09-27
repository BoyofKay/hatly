import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { AdminServiceAreasService } from './admin-service-areas.service';
import { CreateServiceAreaDto } from './dto/create-service-area.dto';
import { UpdateServiceAreaDto } from './dto/update-service-area.dto';

@ApiTags('admin-service-areas')
@Controller('admin/service-areas')
export class AdminServiceAreasController {
  constructor(private readonly adminServiceAreasService: AdminServiceAreasService) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_SERVICE_AREAS)
  async create(@Body() dto: CreateServiceAreaDto) {
    const area = await this.adminServiceAreasService.create(dto);
    return { data: area };
  }

  @Get()
  @RequiresPermission(Permission.MANAGE_SERVICE_AREAS)
  async list() {
    const areas = await this.adminServiceAreasService.listAll();
    return { data: areas };
  }

  @Get(':id')
  @RequiresPermission(Permission.MANAGE_SERVICE_AREAS)
  async getOne(@Param('id') id: string) {
    const area = await this.adminServiceAreasService.getOne(id);
    return { data: area };
  }

  @Patch(':id')
  @RequiresPermission(Permission.MANAGE_SERVICE_AREAS)
  async update(@Param('id') id: string, @Body() dto: UpdateServiceAreaDto) {
    const area = await this.adminServiceAreasService.update(id, dto);
    return { data: area };
  }

  @Patch(':id/activate')
  @RequiresPermission(Permission.MANAGE_SERVICE_AREAS)
  async activate(@Param('id') id: string) {
    const area = await this.adminServiceAreasService.activate(id);
    return { data: area };
  }

  @Patch(':id/deactivate')
  @RequiresPermission(Permission.MANAGE_SERVICE_AREAS)
  async deactivate(@Param('id') id: string) {
    const area = await this.adminServiceAreasService.deactivate(id);
    return { data: area };
  }
}

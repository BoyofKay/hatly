import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { SubcategoriesService } from './subcategories.service';
import { CreateSubcategoryDto } from './dto/create-subcategory.dto';
import { UpdateSubcategoryDto } from './dto/update-subcategory.dto';

class ListSubcategoriesAdminQueryDto {
  @IsOptional()
  @IsUUID()
  sectorId?: string;
}

/**
 * Mirrors `AdminSectorsController` exactly: Admin-only (reuses
 * `Permission.MANAGE_MARKETPLACE_SECTORS` — no separate permission was
 * requested or needed for this closely-related sub-resource), no
 * arbitrary/unrestricted PATCH (see `UpdateSubcategoryDto`'s own
 * comment), activation state via dedicated endpoints.
 */
@ApiTags('admin-subcategories')
@Controller('admin/subcategories')
export class AdminSubcategoriesController {
  constructor(private readonly subcategoriesService: SubcategoriesService) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_MARKETPLACE_SECTORS)
  async create(@Body() dto: CreateSubcategoryDto) {
    const subcategory = await this.subcategoriesService.create(dto);
    return { data: subcategory };
  }

  @Get()
  @RequiresPermission(Permission.MANAGE_MARKETPLACE_SECTORS)
  async list(@Query() query: ListSubcategoriesAdminQueryDto) {
    const subcategories = await this.subcategoriesService.listAllForAdmin(query.sectorId);
    return { data: subcategories };
  }

  @Get(':id')
  @RequiresPermission(Permission.MANAGE_MARKETPLACE_SECTORS)
  async getOne(@Param('id') id: string) {
    const subcategory = await this.subcategoriesService.getOne(id);
    return { data: subcategory };
  }

  @Patch(':id')
  @RequiresPermission(Permission.MANAGE_MARKETPLACE_SECTORS)
  async update(@Param('id') id: string, @Body() dto: UpdateSubcategoryDto) {
    const subcategory = await this.subcategoriesService.update(id, dto);
    return { data: subcategory };
  }

  @Patch(':id/activate')
  @RequiresPermission(Permission.MANAGE_MARKETPLACE_SECTORS)
  async activate(@Param('id') id: string) {
    const subcategory = await this.subcategoriesService.activate(id);
    return { data: subcategory };
  }

  @Patch(':id/deactivate')
  @RequiresPermission(Permission.MANAGE_MARKETPLACE_SECTORS)
  async deactivate(@Param('id') id: string) {
    const subcategory = await this.subcategoriesService.deactivate(id);
    return { data: subcategory };
  }
}

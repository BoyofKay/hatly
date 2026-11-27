import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { PromotionInput, PromotionsService } from './promotions.service';

/** Admin › Offers › Promotions: Hatly-wide / per-store codes and delivery-fee campaigns, with their uses (owner decision 2026-11-27). */
@ApiTags('admin-promotions')
@Controller('admin/promotions')
export class AdminPromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get()
  @RequiresPermission(Permission.MANAGE_OFFERS)
  async list() {
    return { data: await this.promotions.list() };
  }

  @Get(':id/redemptions')
  @RequiresPermission(Permission.MANAGE_OFFERS)
  async redemptions(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.promotions.redemptions(id) };
  }

  @Post()
  @RequiresPermission(Permission.MANAGE_OFFERS)
  async create(@CurrentUser() user: AuthenticatedUser, @Body() body: PromotionInput) {
    return { data: await this.promotions.create(body, user.id) };
  }

  @Put(':id')
  @RequiresPermission(Permission.MANAGE_OFFERS)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: PromotionInput) {
    return { data: await this.promotions.update(id, body) };
  }

  @Patch(':id/active')
  @RequiresPermission(Permission.MANAGE_OFFERS)
  async setActive(@Param('id', ParseUUIDPipe) id: string, @Body() body: { active: boolean }) {
    return { data: await this.promotions.setActive(id, body?.active === true) };
  }
}

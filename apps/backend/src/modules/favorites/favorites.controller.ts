import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { FavoritesService } from './favorites.service';
import { CreateFavoriteDto } from './dto/create-favorite.dto';

@ApiTags('favorites')
@Controller('favorites')
@UseGuards(RolesGuard)
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Post()
  @Roles(Role.CUSTOMER)
  @HttpCode(HttpStatus.NO_CONTENT)
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateFavoriteDto): Promise<void> {
    await this.favoritesService.create(user.id, dto.vendorId);
  }

  @Delete(':vendorId')
  @Roles(Role.CUSTOMER)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('vendorId') vendorId: string): Promise<void> {
    await this.favoritesService.remove(user.id, vendorId);
  }

  @Get()
  @Roles(Role.CUSTOMER)
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.favoritesService.listForCustomer(user.id);
  }
}

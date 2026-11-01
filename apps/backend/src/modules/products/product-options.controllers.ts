import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { VendorStaffAuthorizationService } from '../vendors/vendor-staff-authorization.service';
import { Product } from './entities/product.entity';
import { CreateProductOptionDto, ProductOptionValueDto, UpdateProductOptionDto, UpdateProductOptionValueDto } from './dto/product-option.dto';
import { ProductAuthorizer, ProductOptionsService } from './product-options.service';

/**
 * Admin management of product option groups ("modifiers"). `MANAGE_CATALOG` — the same permission as the rest of the admin catalog —
 * is the whole authorization; PermissionsGuard is global (see AdminProductsController).
 */
@ApiTags('admin-product-options')
@Controller('admin')
export class AdminProductOptionsController {
  constructor(private readonly service: ProductOptionsService) {}

  private readonly allow: ProductAuthorizer = async () => undefined;

  @Get('products/:productId/options')
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async list(@Param('productId') productId: string) {
    return { data: await this.service.list(productId, this.allow) };
  }

  @Post('products/:productId/options')
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async create(@Param('productId') productId: string, @Body() dto: CreateProductOptionDto) {
    return { data: await this.service.createOption(productId, dto, this.allow) };
  }

  @Patch('product-options/:optionId')
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async update(@Param('optionId') optionId: string, @Body() dto: UpdateProductOptionDto) {
    return { data: await this.service.updateOption(optionId, dto, this.allow) };
  }

  @Delete('product-options/:optionId')
  @HttpCode(200)
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async remove(@Param('optionId') optionId: string) {
    await this.service.deleteOption(optionId, this.allow);
    return { data: { deleted: true } };
  }

  @Post('product-options/:optionId/values')
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async addValue(@Param('optionId') optionId: string, @Body() dto: ProductOptionValueDto) {
    return { data: await this.service.addValue(optionId, dto, this.allow) };
  }

  @Patch('product-option-values/:valueId')
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async updateValue(@Param('valueId') valueId: string, @Body() dto: UpdateProductOptionValueDto) {
    return { data: await this.service.updateValue(valueId, dto, this.allow) };
  }

  @Delete('product-option-values/:valueId')
  @HttpCode(200)
  @RequiresPermission(Permission.MANAGE_CATALOG)
  async removeValue(@Param('valueId') valueId: string) {
    return { data: await this.service.deleteValue(valueId, this.allow) };
  }
}

/**
 * Vendor management of the option groups of THEIR OWN products. The product's real branch is read from the database and checked with
 * the existing branch-ownership rule; a product that is not theirs is a plain 404 (existence is never leaked).
 */
@ApiTags('vendor-product-options')
@Controller('vendor')
@UseGuards(RolesGuard)
@Roles(Role.VENDOR, Role.VENDOR_MANAGER)
export class VendorProductOptionsController {
  constructor(
    private readonly service: ProductOptionsService,
    private readonly vendorStaffAuthorizationService: VendorStaffAuthorizationService,
  ) {}

  private ownsProduct(userId: string): ProductAuthorizer {
    return async (product: Product) => {
      try {
        await this.vendorStaffAuthorizationService.assertOwnsBranch(userId, product.vendorBranchId);
      } catch {
        throw new NotFoundException('Product not found.');
      }
    };
  }

  @Get('products/:productId/options')
  async list(@CurrentUser() user: AuthenticatedUser, @Param('productId') productId: string) {
    return { data: await this.service.list(productId, this.ownsProduct(user.id)) };
  }

  @Post('products/:productId/options')
  async create(@CurrentUser() user: AuthenticatedUser, @Param('productId') productId: string, @Body() dto: CreateProductOptionDto) {
    return { data: await this.service.createOption(productId, dto, this.ownsProduct(user.id)) };
  }

  @Patch('product-options/:optionId')
  async update(@CurrentUser() user: AuthenticatedUser, @Param('optionId') optionId: string, @Body() dto: UpdateProductOptionDto) {
    return { data: await this.service.updateOption(optionId, dto, this.ownsProduct(user.id)) };
  }

  @Delete('product-options/:optionId')
  @HttpCode(200)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('optionId') optionId: string) {
    await this.service.deleteOption(optionId, this.ownsProduct(user.id));
    return { data: { deleted: true } };
  }

  @Post('product-options/:optionId/values')
  async addValue(@CurrentUser() user: AuthenticatedUser, @Param('optionId') optionId: string, @Body() dto: ProductOptionValueDto) {
    return { data: await this.service.addValue(optionId, dto, this.ownsProduct(user.id)) };
  }

  @Patch('product-option-values/:valueId')
  async updateValue(@CurrentUser() user: AuthenticatedUser, @Param('valueId') valueId: string, @Body() dto: UpdateProductOptionValueDto) {
    return { data: await this.service.updateValue(valueId, dto, this.ownsProduct(user.id)) };
  }

  @Delete('product-option-values/:valueId')
  @HttpCode(200)
  async removeValue(@CurrentUser() user: AuthenticatedUser, @Param('valueId') valueId: string) {
    return { data: await this.service.deleteValue(valueId, this.ownsProduct(user.id)) };
  }
}

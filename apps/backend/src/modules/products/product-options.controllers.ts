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
import { ProductChangeRequestsService, isDirectValueChange } from './product-change-requests.service';

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
    private readonly governance: ProductChangeRequestsService,
  ) {}

  /**
   * R7: option changes are product-detail changes. On a LIVE (approved) product, adding/changing options or values goes to Hatly as a request
   * (`{ request }`), except lowering a value's price modifier and removing options/values, which apply directly. On a product that is not
   * live yet everything applies directly (Hatly reviews the whole product).
   */
  private async reviewed(userId: string, product: Product, op: 'CREATE_OPTION' | 'UPDATE_OPTION' | 'ADD_VALUE' | 'UPDATE_VALUE', ref: string, body: object) {
    await this.ownsProduct(userId)(product);
    if (product.approvalStatus !== 'APPROVED') return null;
    const id = await this.governance.submitOption(product, op, ref, { ...body }, { id: userId, role: 'VENDOR' });
    return { request: await this.governance.view1(id) };
  }

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
    const product = await this.governance.productForOptions(productId);
    const reviewed = await this.reviewed(user.id, product, 'CREATE_OPTION', productId, dto);
    return { data: reviewed ?? (await this.service.createOption(productId, dto, this.ownsProduct(user.id))) };
  }

  @Patch('product-options/:optionId')
  async update(@CurrentUser() user: AuthenticatedUser, @Param('optionId') optionId: string, @Body() dto: UpdateProductOptionDto) {
    const reviewed = await this.reviewed(user.id, await this.governance.productOfOption(optionId), 'UPDATE_OPTION', optionId, dto);
    return { data: reviewed ?? (await this.service.updateOption(optionId, dto, this.ownsProduct(user.id))) };
  }

  @Delete('product-options/:optionId')
  @HttpCode(200)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('optionId') optionId: string) {
    await this.service.deleteOption(optionId, this.ownsProduct(user.id));
    return { data: { deleted: true } };
  }

  @Post('product-options/:optionId/values')
  async addValue(@CurrentUser() user: AuthenticatedUser, @Param('optionId') optionId: string, @Body() dto: ProductOptionValueDto) {
    const reviewed = await this.reviewed(user.id, await this.governance.productOfOption(optionId), 'ADD_VALUE', optionId, dto);
    return { data: reviewed ?? (await this.service.addValue(optionId, dto, this.ownsProduct(user.id))) };
  }

  @Patch('product-option-values/:valueId')
  async updateValue(@CurrentUser() user: AuthenticatedUser, @Param('valueId') valueId: string, @Body() dto: UpdateProductOptionValueDto) {
    const ctx = await this.governance.valueContext(valueId);
    const reviewed = isDirectValueChange(ctx.priceDeltaMinor, dto) ? null : await this.reviewed(user.id, ctx.product, 'UPDATE_VALUE', valueId, dto);
    return { data: reviewed ?? (await this.service.updateValue(valueId, dto, this.ownsProduct(user.id))) };
  }

  @Delete('product-option-values/:valueId')
  @HttpCode(200)
  async removeValue(@CurrentUser() user: AuthenticatedUser, @Param('valueId') valueId: string) {
    return { data: await this.service.deleteValue(valueId, this.ownsProduct(user.id)) };
  }
}

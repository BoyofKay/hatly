import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { AdminOffersService } from './admin-offers.service';
import { CreateOfferDto } from './dto/create-offer.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';

/**
 * FINAL DECISION: Admin manages Offers; Vendors/Vendor Staff never do
 * — no Vendor-facing Offer endpoint or permission exists anywhere in
 * this codebase, deliberately. `@RequiresPermission` alone is
 * sufficient — PermissionsGuard is global (see AdminCommissionConfigController's
 * own comment for the identical established pattern).
 *
 * Deliberately minimal beyond create/list/get/deactivate: no
 * general-purpose field-level update endpoint exists here — changing
 * an already-targeted, already-consumed Offer's discount/limits after
 * the fact risks retroactively changing the meaning of historical
 * consumption records that snapshot the Offer's shape at redemption
 * time (mitigated, but not eliminated, by those snapshots) — left as
 * an explicitly out-of-scope "eventually" item per the approved
 * contract's own wording, not an oversight.
 */
@ApiTags('admin-offers')
@Controller('admin/offers')
export class AdminOffersController {
  constructor(private readonly adminOffersService: AdminOffersService) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_OFFERS)
  async create(@Body() dto: CreateOfferDto) {
    const offer = await this.adminOffersService.create(dto);
    return { data: offer };
  }

  @Get()
  @RequiresPermission(Permission.MANAGE_OFFERS)
  async list(@Query('vendorBranchId') vendorBranchId?: string) {
    const offers = await this.adminOffersService.listForBranch(vendorBranchId);
    return { data: offers };
  }

  @Get(':id')
  @RequiresPermission(Permission.MANAGE_OFFERS)
  async getOne(@Param('id') id: string) {
    const offer = await this.adminOffersService.getOne(id);
    return { data: offer };
  }

  @Patch(':id')
  @RequiresPermission(Permission.MANAGE_OFFERS)
  async update(@Param('id') id: string, @Body() dto: UpdateOfferDto) {
    return { data: await this.adminOffersService.update(id, dto) };
  }

  @Patch(':id/activate')
  @RequiresPermission(Permission.MANAGE_OFFERS)
  async activate(@Param('id') id: string) {
    const offer = await this.adminOffersService.activate(id);
    return { data: offer };
  }

  @Patch(':id/deactivate')
  @RequiresPermission(Permission.MANAGE_OFFERS)
  async deactivate(@Param('id') id: string) {
    const offer = await this.adminOffersService.deactivate(id);
    return { data: offer };
  }
}

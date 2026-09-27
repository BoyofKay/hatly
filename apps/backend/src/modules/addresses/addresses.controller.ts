import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@ApiTags('addresses')
@Controller('addresses')
@UseGuards(RolesGuard)
@Roles(Role.CUSTOMER)
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAddressDto) {
    const address = await this.addressesService.create(user.id, dto);
    return { data: address };
  }

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    const addresses = await this.addressesService.listForCustomer(user.id);
    return { data: addresses };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    const address = await this.addressesService.update(user.id, id, dto);
    return { data: address };
  }

  /**
   * Soft-deactivation, not a real DELETE — see AddressesService's own
   * comment. Kept on the `DELETE` HTTP verb since that's the
   * customer-facing intent ("remove this address from my list"), even
   * though the row itself is only ever deactivated, never destroyed.
   */
  @Delete(':id')
  async deactivate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const address = await this.addressesService.deactivate(user.id, id);
    return { data: address };
  }
}

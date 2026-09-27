import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { LoyaltyService } from './loyalty.service';
import { ConvertPointsToWalletDto } from './dto/convert-points-to-wallet.dto';

/**
 * Points -> Wallet Conversion (Chunk D). Customer self-service only —
 * CONFIRMED, no MANAGE_LOYALTY_CONFIG/MANAGE_CUSTOMER_WALLET
 * permission required, matching the exact same
 * @UseGuards(RolesGuard) @Roles(Role.CUSTOMER)-only pattern already
 * used by RatingsController. Customer identity always comes from
 * @CurrentUser() — never a client-supplied customerId.
 */
@ApiTags('loyalty')
@Controller('customer/loyalty')
@UseGuards(RolesGuard)
@Roles(Role.CUSTOMER)
export class LoyaltyController {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  @Post('convert')
  async convert(@CurrentUser() user: AuthenticatedUser, @Body() dto: ConvertPointsToWalletDto) {
    const result = await this.loyaltyService.convertPointsToWallet(user.id, dto.points, dto.idempotencyKey);
    return { data: result };
  }
}

import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { LoyaltyService } from './loyalty.service';
import { ConvertPointsToWalletDto } from './dto/convert-points-to-wallet.dto';
import { ListLoyaltyTransactionsQueryDto } from './dto/list-loyalty-transactions-query.dto';

/**
 * Points -> Wallet Conversion (Chunk D) + Loyalty Balance/History
 * (consolidated customer-commerce milestone). Customer self-service
 * only — CONFIRMED, no MANAGE_LOYALTY_CONFIG/MANAGE_CUSTOMER_WALLET
 * permission required, matching the exact same
 * @UseGuards(RolesGuard) @Roles(Role.CUSTOMER)-only pattern already
 * used by RatingsController/CustomerWalletController. Customer
 * identity always comes from @CurrentUser() — never a client-supplied
 * customerId.
 */
@ApiTags('loyalty')
@Controller('customer/loyalty')
@UseGuards(RolesGuard)
@Roles(Role.CUSTOMER)
export class LoyaltyController {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  /** Mirrors CustomerWalletController.getBalance's exact shape — no admin-only field (createdByUserId, etc.) is ever exposed here either. */
  @Get()
  async getBalance(@CurrentUser() user: AuthenticatedUser) {
    const pointsBalance = await this.loyaltyService.getBalance(user.id);
    return { data: { pointsBalance } };
  }

  /** Mirrors CustomerWalletController.listTransactions's exact shape (page/limit -> {data, meta}). */
  @Get('transactions')
  async listTransactions(@CurrentUser() user: AuthenticatedUser, @Query() query: ListLoyaltyTransactionsQueryDto) {
    const result = await this.loyaltyService.listTransactionsForCustomer(user.id, { page: query.page, limit: query.limit });
    return {
      data: result.data.map((t) => ({
        id: t.id,
        pointsDelta: t.pointsDelta,
        type: t.type,
        orderId: t.orderId ?? null,
        reason: t.reason ?? null,
        createdAt: t.createdAt,
      })),
      meta: { page: result.page, limit: result.limit, total: result.total },
    };
  }

  @Post('convert')
  async convert(@CurrentUser() user: AuthenticatedUser, @Body() dto: ConvertPointsToWalletDto) {
    const result = await this.loyaltyService.convertPointsToWallet(user.id, dto.points, dto.idempotencyKey);
    return { data: result };
  }
}

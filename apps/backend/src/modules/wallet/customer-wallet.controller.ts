import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { WalletService } from './wallet.service';
import { ListWalletTransactionsQueryDto } from './dto/list-wallet-transactions-query.dto';

/**
 * Customer Wallet (Profile). The first public endpoint on top of the
 * pre-existing `WalletService` ledger (previously read only
 * internally — see checkout's own wallet section and
 * OrderWalletRefundService) — no new balance/ledger source of truth,
 * no second financial model. Ownership is always the authenticated
 * caller's own id, identical to every other Customer-scoped controller
 * in this codebase (CustomerOrdersController, CustomerDeviceTokensController).
 *
 * `createdByUserId` (the internal actor for an ADMIN_CREDIT/ADJUSTMENT
 * row) is deliberately never returned here — it identifies a staff
 * user, not the customer, and has no customer-facing meaning.
 */
@ApiTags('customer-wallet')
@Controller('customer/wallet')
@UseGuards(RolesGuard)
@Roles(Role.CUSTOMER)
export class CustomerWalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  async getBalance(@CurrentUser() user: AuthenticatedUser) {
    const balanceMinor = await this.walletService.getBalance(user.id);
    return { data: { balanceMinor } };
  }

  @Get('transactions')
  async listTransactions(@CurrentUser() user: AuthenticatedUser, @Query() query: ListWalletTransactionsQueryDto) {
    const result = await this.walletService.listTransactionsForCustomer(user.id, {
      page: query.page,
      limit: query.limit,
    });
    return {
      data: result.data.map((t) => ({
        id: t.id,
        amountDeltaMinor: t.amountDeltaMinor,
        type: t.type,
        orderId: t.orderId ?? null,
        reason: t.reason ?? null,
        createdAt: t.createdAt,
      })),
      meta: { page: result.page, limit: result.limit, total: result.total },
    };
  }
}

import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { CheckoutQuoteService } from './checkout-quote.service';
import { CheckoutQuoteDto } from './dto/checkout-quote.dto';

@ApiTags('checkout')
@Controller('checkout')
@UseGuards(RolesGuard)
@Roles(Role.CUSTOMER)
export class CheckoutController {
  constructor(private readonly quoteService: CheckoutQuoteService) {}

  /**
   * The authoritative checkout quote for the caller's active cart: subtotal, discounts, delivery fee (with its parts), wallet,
   * amount due, ETA, payment options and address eligibility — plus a signed `quoteToken` that freezes the delivery fee.
   * Read-only: it creates nothing and holds no locks.
   */
  @Post('quote')
  async quote(@CurrentUser() user: AuthenticatedUser, @Body() dto: CheckoutQuoteDto) {
    return this.quoteService.quote(user.id, dto);
  }
}

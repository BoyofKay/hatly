import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { RatingStateService } from './rating-state.service';

/**
 * Declared in the ratings module but shares OrdersController's own
 * `orders` route prefix — NestJS allows this as long as exact paths
 * don't collide (OrdersController today has no GET route at all).
 * Kept as its own controller rather than added to OrdersController to
 * avoid a cross-module dependency in either direction; this endpoint
 * is purely about rating state, not order management.
 */
@ApiTags('orders')
@Controller('orders')
@UseGuards(RolesGuard)
@Roles(Role.CUSTOMER)
export class OrderRatingStateController {
  constructor(private readonly ratingStateService: RatingStateService) {}

  @Get(':orderId/rating-state')
  async getRatingState(@CurrentUser() user: AuthenticatedUser, @Param('orderId') orderId: string) {
    const state = await this.ratingStateService.getOrderRatingState(user.id, orderId);
    return { data: state };
  }
}

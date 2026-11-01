import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { AuthenticatedUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { OrderExceptionsService } from './order-exceptions.service';
import { CustomerDecision } from './order-exceptions.types';

/**
 * A vendor tells the platform that items of THEIR OWN part of an order are unavailable (PD-016). Another branch's part is answered exactly
 * like a part that does not exist. The vendor never decides what happens next: the customer (or Operations, after speaking to the customer) does.
 */
@ApiTags('vendor-orders')
@Controller('vendor/orders')
@UseGuards(RolesGuard)
@Roles(Role.VENDOR, Role.VENDOR_MANAGER)
export class VendorUnavailableItemsController {
  constructor(private readonly exceptions: OrderExceptionsService) {}

  @Post('segments/:segmentId/unavailable-items')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async markUnavailable(@CurrentUser() user: AuthenticatedUser, @Param('segmentId') segmentId: string, @Body() body: { itemIds: string[]; note?: string }) {
    const view = await this.exceptions.markItemsUnavailable({ segmentId, itemIds: body?.itemIds, note: body?.note, actor: { id: user.id, role: user.role }, vendorScoped: true });
    return { data: { ...view, events: undefined } };
  }
}

/** The customer's side: see the question and answer it. There is no replacement to choose — only "continue without" or "cancel the order". */
@ApiTags('orders')
@Controller('orders')
@UseGuards(RolesGuard)
@Roles(Role.CUSTOMER)
export class CustomerItemUnavailabilityController {
  constructor(private readonly exceptions: OrderExceptionsService) {}

  @Get(':orderId/item-unavailability')
  async current(@CurrentUser() user: AuthenticatedUser, @Param('orderId') orderId: string) {
    return { data: await this.exceptions.customerView(orderId, user.id) };
  }

  @Post(':orderId/item-unavailability/:exceptionId/respond')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async respond(@CurrentUser() user: AuthenticatedUser, @Param('orderId') orderId: string, @Param('exceptionId') exceptionId: string, @Body() body: { decision: CustomerDecision }) {
    const result = await this.exceptions.customerRespond({ orderId, exceptionId, customerId: user.id, decision: body?.decision });
    return { data: { ...result, exception: { ...result.exception, events: undefined } } };
  }
}

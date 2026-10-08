import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { OrderStateMachineService } from './order-state-machine.service';
import { OrderActorAuthorizationService } from './order-actor-authorization.service';
import { OrderStatus } from './order-status.enum';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrderCreationService } from './order-creation.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { CustomerOrdersService } from './customer-orders.service';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { CustomerOrderCancellationService } from './customer-order-cancellation.service';
import { DriverAuthorizationService } from '../delivery/driver-authorization.service';
import { ProofOfDeliveryService } from '../delivery/proof-of-delivery.service';
import { RateLimitPolicies, Throttled } from '../../common/throttling/rate-limit-policies';
import { AutomaticDispatchService } from '../delivery/automatic-dispatch.service';

/**
 * NOTE (Phase 1 scope): the status-transition endpoint was built to
 * demonstrate the state machine end-to-end before order creation
 * existed. Order creation (POST /orders, below) is the Phase 3 Step 4
 * addition, now that cart/checkout exist to build the order from.
 */
@ApiTags('orders')
@Controller('orders')
@UseGuards(RolesGuard)
export class OrdersController {
  constructor(
    private readonly orderStateMachine: OrderStateMachineService,
    private readonly orderCreationService: OrderCreationService,
    private readonly customerOrdersService: CustomerOrdersService,
    private readonly orderActorAuthorizationService: OrderActorAuthorizationService,
    private readonly customerOrderCancellationService: CustomerOrderCancellationService,
    private readonly driverAuthorizationService: DriverAuthorizationService,
    private readonly proofOfDeliveryService: ProofOfDeliveryService,
    private readonly automaticDispatchService: AutomaticDispatchService,
  ) {}

  @Post()
  @Throttled(RateLimitPolicies.orderCreate)
  @Roles(Role.CUSTOMER)
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOrderDto) {
    const order = await this.orderCreationService.createOrder(user.id, dto);
    return { data: order };
  }

  /**
   * Customer Order History. Ownership is always the authenticated
   * caller's own id — see CustomerOrdersService's own comment for why
   * a client-supplied customer id is never trusted or even accepted
   * here.
   */
  @Get()
  @Roles(Role.CUSTOMER)
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListOrdersQueryDto) {
    const result = await this.customerOrdersService.listForCustomer(user.id, {
      page: query.page,
      limit: query.limit,
      status: query.status,
      tab: query.tab,
    });
    return { data: result.data, meta: { page: result.page, limit: result.limit, total: result.total } };
  }

  /** Customer Order Details. */
  @Get(':id')
  @Roles(Role.CUSTOMER)
  async getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const order = await this.customerOrdersService.getForCustomer(user.id, id);
    return { data: order };
  }

  /**
   * Customer cancellation of their own WHOLE order (PD-005) — allowed only while PENDING or CONFIRMED. The customer is the
   * authenticated caller; the body carries at most a reason.
   */
  @Post(':id/cancel')
  @Roles(Role.CUSTOMER)
  async cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CancelOrderDto) {
    await this.customerOrderCancellationService.cancel(user.id, id, dto.cancellationReason);
    const order = await this.customerOrdersService.getForCustomer(user.id, id);
    return { data: order };
  }

  /** V1 tracking: status, ETA, timeline and per-vendor progress. No live map, no driver location. */
  @Get(':id/tracking')
  @Roles(Role.CUSTOMER)
  async track(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const tracking = await this.customerOrdersService.trackForCustomer(user.id, id);
    return { data: tracking };
  }

  @Patch(':id/status')
  @Roles(Role.CUSTOMER, Role.VENDOR, Role.VENDOR_MANAGER, Role.DRIVER, Role.ADMIN, Role.SUPER_ADMIN)
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // The state machine only checks the ROLE; ownership of THIS order is checked here.
    await this.orderActorAuthorizationService.assertMayActOnOrder(user, id);
    if (dto.status === OrderStatus.CANCELLED) {
      // A vendor may cancel only its own segment(s), never the rest of a multi-vendor order (PD-002).
      await this.orderActorAuthorizationService.assertVendorMayCancelWholeOrder(user, id);
    }
    // M4 — Proof of Delivery. This generic endpoint also allows Role.DRIVER (see the
    // @Roles list above and OrderActorAuthorizationService's own DRIVER branch) — the
    // SAME gate DriverOrderActionsService applies on its own dedicated
    // `/driver/deliveries/:id/status` route must apply here too, or a driver could reach
    // DELIVERED via THIS endpoint without ever submitting proof. Never touches
    // OrderStateMachineService itself — mirrors DriverOrderActionsService's own
    // "validate-then-transition, never the reverse" ordering exactly.
    const actingDriver = user.role === Role.DRIVER ? await this.driverAuthorizationService.getDriverForUser(user.id) : null;
    if (dto.status === OrderStatus.DELIVERED && actingDriver) {
      const driver = actingDriver;
      const delivery = await this.driverAuthorizationService.getOwnedDeliveryForOrder(driver.id, id);
      await this.proofOfDeliveryService.recordForDelivery({
        driverUserId: user.id,
        driverId: driver.id,
        deliveryId: delivery.id,
        orderId: id,
        photoUrl: dto.proofPhotoUrl,
        recipientName: dto.recipientName,
      });
    }
    const order = await this.orderStateMachine.transition({
      orderId: id,
      to: dto.status as OrderStatus,
      actorRole: user.role as Role,
      cancellationReason: dto.cancellationReason,
      actorUserId: user.id,
      failureReason: dto.failureReason,
      // a driver's ownership is re-checked under the order lock (an admin may have reassigned since the check above)
      ...(actingDriver ? { actingDriverId: actingDriver.id } : {}),
    });
    // U3: a driver handing the order back through this endpoint gets the same single redispatch (without them).
    if (actingDriver && dto.status === OrderStatus.READY_FOR_PICKUP) {
      await this.automaticDispatchService.redispatchAfterDriverRelease(order.id, actingDriver.id);
    }
    return { data: order };
  }
}

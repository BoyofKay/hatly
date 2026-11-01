import { Body, ConflictException, Controller, ForbiddenException, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RequiresPermission } from '../../permissions/decorators/requires-permission.decorator';
import { Permission } from '../../permissions/permission.enum';
import { PermissionsService } from '../../permissions/permissions.service';
import { AuthenticatedUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ExplicitlyAudited } from '../../audit/admin-mutation-audit.interceptor';
import { OrderExceptionsService } from '../../orders/exceptions/order-exceptions.service';
import { CustomerDecision, DecisionChannel } from '../../orders/exceptions/order-exceptions.types';
import { AdminOrderExtrasService } from './admin-order-extras.service';

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

/**
 * The Operations side of order exceptions (PD-016): the queue, the case, and the actions an Operations employee may take. Every write
 * is audited by the exceptions service itself (hence `@ExplicitlyAudited`).
 *  - view: VIEW_ORDERS · mark items for a vendor / note / escalate / assign / record + execute "continue without": MANAGE_ORDER_FULFILMENT
 *  - record + execute "cancel the entire order": additionally MANAGE_ORDER_ISSUES (the permission the existing admin cancellation needs).
 * Cancelling reuses the existing authorized path (`AdminOrderExtrasService.cancel` → the order state machine); nothing here cancels by itself.
 */
@ApiTags('admin-order-exceptions')
@Controller('admin')
export class AdminOrderExceptionsController {
  constructor(
    private readonly exceptions: OrderExceptionsService,
    private readonly extras: AdminOrderExtrasService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get('order-exceptions')
  @RequiresPermission(Permission.VIEW_ORDERS)
  async list(@Query() q: Record<string, string>) {
    const r = await this.exceptions.list(q);
    return { data: r.items, meta: { page: r.page, limit: r.limit, total: r.total } };
  }

  @Get('order-exceptions/summary')
  @RequiresPermission(Permission.VIEW_ORDERS)
  async summary() {
    return { data: await this.exceptions.summary() };
  }

  @Get(`order-exceptions/:id(${UUID})`)
  @RequiresPermission(Permission.VIEW_ORDERS)
  async one(@Param('id') id: string) {
    return { data: await this.exceptions.getView(id, true) };
  }

  /** Hatly operations act for the vendor (same permission as the existing on-behalf segment status route). */
  @Post(`orders/segments/:segmentId(${UUID})/unavailable-items`)
  @RequiresPermission(Permission.MANAGE_ORDER_FULFILMENT)
  @ExplicitlyAudited()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async markForVendor(@CurrentUser() actor: AuthenticatedUser, @Param('segmentId') segmentId: string, @Body() body: { itemIds: string[]; note?: string }) {
    return { data: await this.exceptions.markItemsUnavailable({ segmentId, itemIds: body?.itemIds, note: body?.note, actor: { id: actor.id, role: actor.role }, vendorScoped: false }) };
  }

  @Post(`order-exceptions/:id(${UUID})/record-decision`)
  @RequiresPermission(Permission.MANAGE_ORDER_FULFILMENT)
  @ExplicitlyAudited()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async recordDecision(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { decision: CustomerDecision; channel?: DecisionChannel; note?: string },
  ) {
    if (body?.decision === 'CANCEL_ORDER' && !(await this.permissions.actorHolds(actor, Permission.MANAGE_ORDER_ISSUES))) {
      throw new ForbiddenException({ message: 'Cancelling an entire order needs supervisor-level authority (the order-issues permission).', details: { code: 'CANCELLATION_NEEDS_SUPERVISOR' } });
    }
    const result = await this.exceptions.recordOperationsDecision({ exceptionId: id, decision: body?.decision, channel: body?.channel, note: body?.note, actor: { id: actor.id, role: actor.role } });
    let cancelled = false;
    if (result.needsCancellation) {
      try {
        await this.extras.cancel(result.orderId, { id: actor.id, role: actor.role }, 'OUT_OF_STOCK', `Customer chose to cancel after an item was unavailable (case ${id}).`);
        cancelled = true;
      } catch (e) {
        // Already cancelled by another path: the customer's wish is fulfilled, the case can close.
        if (e instanceof ConflictException && (e.getResponse() as any)?.details?.code === 'ORDER_ALREADY_CANCELLED') cancelled = true;
        else throw e;
      }
      if (cancelled) await this.exceptions.markCancelledByDecision(id, { id: actor.id, role: actor.role });
    }
    return { data: { executed: result.executed || cancelled, isolated: result.isolated, cancelled, exception: await this.exceptions.getView(id, true) } };
  }

  @Post(`order-exceptions/:id(${UUID})/notes`)
  @RequiresPermission(Permission.MANAGE_ORDER_FULFILMENT)
  @ExplicitlyAudited()
  async note(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: { note: string }) {
    return { data: await this.exceptions.addNote(id, { id: actor.id, role: actor.role }, body?.note) };
  }

  @Post(`order-exceptions/:id(${UUID})/escalate`)
  @RequiresPermission(Permission.MANAGE_ORDER_FULFILMENT)
  @ExplicitlyAudited()
  async escalate(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: { note?: string }) {
    return { data: await this.exceptions.escalate(id, { id: actor.id, role: actor.role }, body?.note) };
  }

  @Post(`order-exceptions/:id(${UUID})/assign`)
  @RequiresPermission(Permission.MANAGE_ORDER_FULFILMENT)
  @ExplicitlyAudited()
  async assign(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: { assigneeUserId: string | null }) {
    return { data: await this.exceptions.assign(id, { id: actor.id, role: actor.role }, body?.assigneeUserId ?? null) };
  }

  /** Closes a case whose order is already over (cancelled / delivered / collected / failed). Nothing is executed. */
  @Post(`order-exceptions/:id(${UUID})/resolve`)
  @RequiresPermission(Permission.MANAGE_ORDER_FULFILMENT)
  @ExplicitlyAudited()
  async resolve(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: { note: string }) {
    return { data: await this.exceptions.resolve(id, { id: actor.id, role: actor.role }, body?.note) };
  }

  /** Asks the vendor of the case's order part to act; the vendor's staff get an alert (never a financial change). */
  @Post(`order-exceptions/:id(${UUID})/request-vendor-action`)
  @RequiresPermission(Permission.MANAGE_ORDER_FULFILMENT)
  @ExplicitlyAudited()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async requestVendorAction(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: { note: string }) {
    return { data: await this.exceptions.requestVendorAction(id, { id: actor.id, role: actor.role }, body?.note) };
  }
}

import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RequiresPermission } from '../../permissions/decorators/requires-permission.decorator';
import { Permission } from '../../permissions/permission.enum';
import { PermissionsService } from '../../permissions/permissions.service';
import { AuthenticatedUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AdminAuditAction, AdminAuditService } from '../../audit/admin-audit.service';
import { ExplicitlyAudited } from '../../audit/admin-mutation-audit.interceptor';
import { AdminOrderExtrasService, AdminCancelReason } from './admin-order-extras.service';

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

/** Order Management additions: administrative cancel, staff notes, merged timeline. All sit beside the existing `admin/orders` routes. */
@ApiTags('admin-orders')
@Controller('admin/orders')
export class AdminOrderExtrasController {
  constructor(
    private readonly extras: AdminOrderExtrasService,
    private readonly permissions: PermissionsService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get(`:id(${UUID})/capabilities`)
  @RequiresPermission(Permission.VIEW_ORDERS)
  async capabilities(@Param('id') id: string) {
    return { data: { adminCanCancel: await this.extras.adminCanCancel(id) } };
  }

  @Post(`:id(${UUID})/cancel`)
  @RequiresPermission(Permission.MANAGE_ORDER_ISSUES)
  @ExplicitlyAudited()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async cancel(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: { reasonCode: AdminCancelReason; reasonText?: string }) {
    const result = await this.extras.cancel(id, actor, body?.reasonCode, body?.reasonText);
    await this.audit.record({
      actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.ORDER_ADMIN_CANCELLED, targetType: 'order', targetId: id,
      metadata: { reasonCode: body.reasonCode, orderNumber: result.orderNumber, walletRefundedMinor: result.money.walletRefundedMinor, transferRefundRecordedMinor: result.money.transferRefundRecordedMinor },
    });
    return { data: result };
  }

  @Get(`:id(${UUID})/notes`)
  @RequiresPermission(Permission.VIEW_ORDERS)
  async notes(@Param('id') id: string) {
    return { data: await this.extras.notes(id) };
  }

  @Post(`:id(${UUID})/notes`)
  @RequiresPermission(Permission.MANAGE_ORDER_ISSUES)
  @ExplicitlyAudited()
  async addNote(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: { body: string }) {
    if (typeof body?.body !== 'string') throw new BadRequestException({ message: 'body is required.', details: { code: 'VALIDATION_FAILED' } });
    const data = await this.extras.addNote(id, body.body, actor.id);
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.ORDER_NOTE_ADDED, targetType: 'order', targetId: id, metadata: { noteId: data.id } });
    return { data };
  }

  @Get(`:id(${UUID})/timeline`)
  @RequiresPermission(Permission.VIEW_ORDERS)
  async timeline(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    const financial = await this.permissions.actorHolds(actor, Permission.VIEW_FINANCIALS);
    return { data: await this.extras.timeline(id, financial) };
  }
}

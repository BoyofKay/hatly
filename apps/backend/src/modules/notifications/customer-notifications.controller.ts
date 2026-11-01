import { Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { CustomerNotificationsService } from './customer-notifications.service';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';

/** The customer's own in-app notifications. The owner is always the authenticated caller (never a request field). */
@ApiTags('customer-notifications')
@Controller('customer/notifications')
@UseGuards(RolesGuard)
@Roles(Role.CUSTOMER)
export class CustomerNotificationsController {
  constructor(private readonly service: CustomerNotificationsService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListNotificationsQueryDto) {
    const result = await this.service.list(user.id, query);
    return { data: result.data, meta: { page: result.page, limit: result.limit, total: result.total, unreadCount: result.unreadCount } };
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return { data: { count: await this.service.unreadCount(user.id) } };
  }

  @Post('read-all')
  @HttpCode(200)
  async markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.service.markAllRead(user.id) };
  }

  @Post(':id/read')
  @HttpCode(200)
  async markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.service.markRead(user.id, id) };
  }
}

import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RequiresAnyPermission, RequiresPermission } from '../../permissions/decorators/requires-permission.decorator';
import { Permission } from '../../permissions/permission.enum';
import { PermissionsService } from '../../permissions/permissions.service';
import { AuthenticatedUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ExecutiveService } from './executive.service';

/** Executive Control Tower — KPIs, time series, unified alerts, delivery SLA, global search. Money figures need VIEW_FINANCIALS. */
@ApiTags('admin-executive')
@Controller('admin')
export class ExecutiveController {
  constructor(
    private readonly executive: ExecutiveService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get('executive/kpis')
  @RequiresPermission(Permission.VIEW_REPORTS)
  async kpis(@CurrentUser() user: AuthenticatedUser, @Query('from') from?: string, @Query('to') to?: string, @Query('compare') compare?: string) {
    const financial = await this.permissions.actorHolds(user, Permission.VIEW_FINANCIALS);
    return { data: await this.executive.kpis(from, to, compare !== 'none', financial) };
  }

  @Get('executive/timeseries')
  @RequiresPermission(Permission.VIEW_REPORTS)
  async timeseries(
    @CurrentUser() user: AuthenticatedUser,
    @Query('metric') metric = 'orders',
    @Query('granularity') granularity = 'day',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!['orders', 'gmv', 'delivered'].includes(metric)) throw new BadRequestException({ message: 'Unknown metric.', details: { code: 'UNKNOWN_METRIC' } });
    if (!['day', 'week', 'month'].includes(granularity)) throw new BadRequestException({ message: 'Unknown granularity.', details: { code: 'UNKNOWN_GRANULARITY' } });
    if (metric === 'gmv' && !(await this.permissions.actorHolds(user, Permission.VIEW_FINANCIALS))) {
      throw new BadRequestException({ message: 'This metric requires financial access.', details: { code: 'FINANCIAL_ACCESS_REQUIRED' } });
    }
    return { data: await this.executive.timeseries(metric as 'orders' | 'gmv' | 'delivered', granularity as 'day' | 'week' | 'month', from, to) };
  }

  @Get('alerts')
  @RequiresPermission(Permission.VIEW_ORDERS)
  async alerts(@CurrentUser() user: AuthenticatedUser) {
    const [system, financial] = await Promise.all([
      this.permissions.actorHolds(user, Permission.VIEW_SYSTEM_HEALTH),
      this.permissions.actorHolds(user, Permission.VIEW_FINANCIALS),
    ]);
    return { data: await this.executive.alerts({ includeSystem: system, includeFinancial: financial }) };
  }

  @Post('alerts/acknowledge')
  @RequiresPermission(Permission.VIEW_ORDERS)
  async acknowledge(@CurrentUser() user: AuthenticatedUser, @Body() body: { key?: string; note?: string }) {
    if (!body?.key || typeof body.key !== 'string') throw new BadRequestException({ message: 'key is required.', details: { code: 'VALIDATION_FAILED' } });
    await this.executive.acknowledge(body.key, user.id, body.note);
    return { message: 'Acknowledged.' };
  }

  @Get('sla/summary')
  @RequiresPermission(Permission.VIEW_REPORTS)
  async sla(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.executive.sla(from, to) };
  }

  @Get('search')
  @RequiresAnyPermission(Permission.VIEW_ORDERS, Permission.VIEW_CUSTOMERS, Permission.VENDORS_VIEW, Permission.MANAGE_VENDORS, Permission.CATALOG_VIEW, Permission.MANAGE_CATALOG, Permission.FLEET_VIEW, Permission.MANAGE_DRIVERS)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async search(@CurrentUser() user: AuthenticatedUser, @Query('q') q = '') {
    if (q.trim().length < 2) throw new BadRequestException({ message: 'Type at least 2 characters.', details: { code: 'QUERY_TOO_SHORT' } });
    const has = (p: Permission[]) => Promise.all(p.map((x) => this.permissions.actorHolds(user, x))).then((r) => r.some(Boolean));
    const [orders, customers, vendors, products, drivers, pii] = await Promise.all([
      has([Permission.VIEW_ORDERS]),
      has([Permission.VIEW_CUSTOMERS]),
      has([Permission.VENDORS_VIEW, Permission.MANAGE_VENDORS]),
      has([Permission.CATALOG_VIEW, Permission.MANAGE_CATALOG]),
      has([Permission.FLEET_VIEW, Permission.MANAGE_DRIVERS]),
      has([Permission.VIEW_CUSTOMER_PII]),
    ]);
    return { data: await this.executive.search(q, { orders, customers, vendors, products, drivers, pii }) };
  }
}

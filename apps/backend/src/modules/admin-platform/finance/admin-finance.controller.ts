import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequiresAnyPermission, RequiresPermission } from '../../permissions/decorators/requires-permission.decorator';
import { Permission } from '../../permissions/permission.enum';
import { PermissionsService } from '../../permissions/permissions.service';
import { AuthenticatedUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AdminAuditAction, AdminAuditService } from '../../audit/admin-audit.service';
import { ExplicitlyAudited } from '../../audit/admin-mutation-audit.interceptor';
import { AdminFinanceService } from './admin-finance.service';

const toList = (v?: string): string[] | undefined => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : undefined);

function requireIdempotencyKey(key: string | undefined): string {
  if (!key || key.length < 8 || key.length > 128) {
    throw new BadRequestException({ message: 'An Idempotency-Key header (8–128 characters) is required for this request.', details: { code: 'IDEMPOTENCY_KEY_REQUIRED' } });
  }
  return key;
}

/** Finance & accounting read models. Sensitive financial access (VIEW_FINANCIALS); settlements keep their own permissions. */
@ApiTags('admin-finance')
@Controller('admin')
export class AdminFinanceController {
  constructor(
    private readonly finance: AdminFinanceService,
    private readonly permissions: PermissionsService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get('finance/ledger')
  @RequiresPermission(Permission.VIEW_FINANCIALS)
  async ledger(@Query() q: Record<string, string>) {
    return { data: await this.finance.ledger({ ...q, type: toList(q.type) }) };
  }

  @Get('finance/ledger/summary')
  @RequiresPermission(Permission.VIEW_FINANCIALS)
  async ledgerSummary(@Query() q: Record<string, string>) {
    return { data: await this.finance.ledgerSummary({ ...q, type: toList(q.type) }) };
  }

  @Get('finance/ledger/:eventId')
  @RequiresPermission(Permission.VIEW_FINANCIALS)
  async ledgerEvent(@Param('eventId') eventId: string) {
    return { data: await this.finance.ledgerEvent(eventId) };
  }

  @Get('finance/revenue')
  @RequiresPermission(Permission.VIEW_FINANCIALS)
  async revenue(@Query('from') from?: string, @Query('to') to?: string, @Query('granularity') granularity = 'day') {
    if (!['day', 'week', 'month'].includes(granularity)) throw new BadRequestException({ message: 'Unknown granularity.', details: { code: 'UNKNOWN_GRANULARITY' } });
    return { data: await this.finance.revenue(from, to, granularity as 'day' | 'week' | 'month') };
  }

  @Get('finance/vendor-receivables')
  @RequiresPermission(Permission.VIEW_FINANCIALS)
  async vendorReceivables(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.finance.vendorReceivables(from, to) };
  }

  @Get('finance/hatly-funded-discounts')
  @RequiresPermission(Permission.VIEW_FINANCIALS)
  async discounts(@Query('from') from?: string, @Query('to') to?: string, @Query('limit') limit?: string) {
    return { data: await this.finance.hatlyFundedDiscounts(from, to, limit) };
  }

  @Get('finance/liabilities')
  @RequiresPermission(Permission.VIEW_FINANCIALS)
  async liabilities() {
    return { data: await this.finance.liabilities() };
  }

  @Get('finance/reconciliation')
  @RequiresPermission(Permission.VIEW_FINANCIALS)
  async reconciliation() {
    return { data: await this.finance.reconciliation() };
  }

  @Get('payments')
  @RequiresAnyPermission(Permission.VERIFY_MANUAL_PAYMENTS, Permission.VIEW_FINANCIALS)
  async payments(@Query() q: Record<string, string>) {
    return { data: await this.finance.payments(q) };
  }

  @Get('refunds')
  @RequiresAnyPermission(Permission.VERIFY_MANUAL_PAYMENTS, Permission.VIEW_FINANCIALS)
  async refunds(@Query() q: Record<string, string>) {
    return { data: await this.finance.refunds({ ...q, state: (q.state as 'TO_SEND' | 'SENT' | 'ALL') ?? 'ALL' }) };
  }

  // ---- settlements: vendor periods are the vendor's commission RECEIVABLE; driver periods follow the net-payable sign ----

  @Get('settlements/vendor-periods')
  @RequiresPermission(Permission.VIEW_VENDOR_FINANCIAL_REPORTS)
  async vendorPeriods(@Query() q: Record<string, string>) {
    const r = await this.finance.listPeriods('VENDOR', { ...q, partyId: q.vendorBranchId });
    return { data: r.items, meta: { page: r.page, limit: r.limit, total: r.total } };
  }

  @Get('settlements/vendor-periods/:id')
  @RequiresPermission(Permission.VIEW_VENDOR_FINANCIAL_REPORTS)
  async vendorPeriod(@Param('id') id: string) {
    return { data: await this.finance.periodStatement('VENDOR', id) };
  }

  @Get('settlements/driver-periods')
  @RequiresPermission(Permission.VIEW_DRIVER_SETTLEMENTS)
  async driverPeriods(@Query() q: Record<string, string>) {
    const r = await this.finance.listPeriods('DRIVER', { ...q, partyId: q.driverId });
    return { data: r.items, meta: { page: r.page, limit: r.limit, total: r.total } };
  }

  @Get('settlements/driver-periods/:id')
  @RequiresPermission(Permission.VIEW_DRIVER_SETTLEMENTS)
  async driverPeriod(@Param('id') id: string) {
    return { data: await this.finance.periodStatement('DRIVER', id) };
  }

  @Get('settlements/summary')
  @RequiresAnyPermission(Permission.VIEW_VENDOR_FINANCIAL_REPORTS, Permission.VIEW_DRIVER_SETTLEMENTS, Permission.VIEW_FINANCIALS)
  async settlementSummary() {
    return { data: await this.finance.summary() };
  }

  @Post('settlements/:party/periods/:periodId/payments')
  @RequiresPermission(Permission.MANAGE_SETTLEMENT_PAYMENTS)
  @ExplicitlyAudited()
  async recordPayment(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('party') partyParam: string,
    @Param('periodId') periodId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: { amountMinor: number; method: string; reference?: string; paidOn: string; allowOverpayment?: boolean; overpaymentReason?: string },
  ) {
    const party = partyParam === 'vendor' ? 'VENDOR' : partyParam === 'driver' ? 'DRIVER' : null;
    if (!party) throw new BadRequestException({ message: 'party must be "vendor" or "driver".', details: { code: 'VALIDATION_FAILED' } });
    const key = requireIdempotencyKey(idempotencyKey);
    const mayAuthorise = await this.permissions.actorHolds(actor, Permission.APPROVE_SETTLEMENT_OVERPAYMENT);
    const result = await this.finance.recordPayment(party, periodId, body ?? ({} as never), actor, key, mayAuthorise);
    if (!result.replayed) {
      await this.audit.record({
        actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.SETTLEMENT_PAYMENT_RECORDED, targetType: `${party.toLowerCase()}_settlement_period`, targetId: periodId,
        metadata: { paymentId: result.payment.id, direction: result.payment.direction, amountMinor: result.payment.amountMinor, overpaid: Boolean((result as any).overpaid) },
      });
    }
    return { data: result };
  }

  @Post('settlement-payments/:id/void')
  @RequiresPermission(Permission.MANAGE_SETTLEMENT_PAYMENTS)
  @ExplicitlyAudited()
  async voidPayment(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: { reason: string }) {
    const payment = await this.finance.voidPayment(id, body?.reason, actor.id);
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.SETTLEMENT_PAYMENT_VOIDED, targetType: 'settlement_payment', targetId: id, metadata: { amountMinor: payment.amountMinor, reason: body.reason } });
    return { data: payment };
  }
}

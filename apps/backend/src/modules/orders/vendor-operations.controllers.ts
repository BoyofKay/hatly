import { BranchChangeRequestsService } from './branch-change-requests.service';
import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ExplicitlyAudited } from '../audit/admin-mutation-audit.interceptor';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { BranchClosuresService } from './branch-closures.service';
import { StockLedgerService } from './stock-ledger.service';
import { VendorFinanceService } from './vendor-finance.service';
import { VendorTeamService } from './vendor-team.service';

/** A branch manager's own-branch team management (operators only). Everything is scoped to the caller's branches; see VendorTeamService. */
@ApiTags('vendor-team')
@Controller('vendor/team/members')
@UseGuards(RolesGuard)
@Roles(Role.VENDOR, Role.VENDOR_MANAGER)
export class VendorTeamController {
  constructor(private readonly team: VendorTeamService) {}

  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return { data: await this.team.createOperator(user, body) };
  }

  @Patch(':userId/active')
  async setActive(@CurrentUser() user: AuthenticatedUser, @Param('userId') userId: string, @Body() body: { isActive?: unknown }) {
    return { data: await this.team.setActive(user, userId, body?.isActive) };
  }

  @Post(':userId/branches/:branchId')
  async assign(@CurrentUser() user: AuthenticatedUser, @Param('userId') userId: string, @Param('branchId') branchId: string) {
    return { data: await this.team.assignBranch(user, userId, branchId) };
  }

  @Delete(':userId/branches/:branchId')
  async unassign(@CurrentUser() user: AuthenticatedUser, @Param('userId') userId: string, @Param('branchId') branchId: string) {
    return { data: await this.team.unassignBranch(user, userId, branchId) };
  }
}

/** Closures / holidays of a vendor's own branch. Anyone linked may read; scheduling and cancelling is a manager's decision. */
@ApiTags('vendor-branch-closures')
@Controller('vendor/branches/:branchId/closures')
@UseGuards(RolesGuard)
@Roles(Role.VENDOR, Role.VENDOR_MANAGER)
export class VendorBranchClosuresController {
  constructor(private readonly closures: BranchClosuresService, private readonly changeRequests: BranchChangeRequestsService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Param('branchId') branchId: string) {
    return { data: await this.closures.vendorList(user, branchId) };
  }

  /** R44: a vendor REQUESTS a closure; Hatly Admin approves it (then it is created) or rejects it. */
  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Param('branchId') branchId: string, @Body() body: any) {
    return { data: { request: await this.changeRequests.request(user, branchId, 'CLOSURE', body ?? {}, body?.reason) } };
  }

  /** R44: cancelling a scheduled/active closure (reopening early) is also a request. */
  @Delete(':closureId')
  async cancel(@CurrentUser() user: AuthenticatedUser, @Param('branchId') branchId: string, @Param('closureId') closureId: string) {
    return { data: { request: await this.changeRequests.request(user, branchId, 'CLOSURE_CANCEL', { closureId }) } };
  }
}

/** The stock-movement ledger and stocktakes of the caller's own branches. */
@ApiTags('vendor-inventory')
@Controller('vendor/inventory')
@UseGuards(RolesGuard)
@Roles(Role.VENDOR, Role.VENDOR_MANAGER)
export class VendorInventoryController {
  constructor(private readonly ledger: StockLedgerService) {}

  @Get('movements')
  async movements(@CurrentUser() user: AuthenticatedUser, @Query() q: Record<string, string>) {
    const r = await this.ledger.movements(user, q);
    return { data: { items: r.items, startedAt: r.startedAt }, meta: { page: r.page, limit: r.limit, total: r.total } };
  }

  @Get('stocktakes')
  async list(@CurrentUser() user: AuthenticatedUser, @Query('branchId') branchId?: string) {
    return { data: await this.ledger.listStocktakes(user, branchId) };
  }

  @Post('stocktakes')
  async start(@CurrentUser() user: AuthenticatedUser, @Body() body: { branchId?: string; note?: string }) {
    return { data: await this.ledger.startStocktake(user, body) };
  }

  @Get('stocktakes/:id')
  async get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.ledger.getStocktake(user, id) };
  }

  @Patch('stocktakes/:id/lines/:productId')
  async count(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('productId') productId: string, @Body() body: { counted?: unknown }) {
    return { data: await this.ledger.setCount(user, id, productId, body?.counted === undefined ? null : body.counted) };
  }

  @Post('stocktakes/:id/apply')
  async apply(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.ledger.apply(user, id) };
  }

  @Post('stocktakes/:id/cancel')
  async cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.ledger.cancel(user, id) };
  }
}

/** The vendor's read-only Financial Centre. */
@ApiTags('vendor-finance')
@Controller('vendor/finance')
@UseGuards(RolesGuard)
@Roles(Role.VENDOR, Role.VENDOR_MANAGER)
export class VendorFinanceController {
  constructor(private readonly finance: VendorFinanceService) {}

  @Get()
  async statement(@CurrentUser() user: AuthenticatedUser, @Query() q: { from?: string; to?: string; branchId?: string }) {
    return { data: await this.finance.statement(user, q) };
  }

  /** The completed parts of the caller's branches as a spreadsheet-safe CSV (no customer data). */
  @Get('export')
  async export(@CurrentUser() user: AuthenticatedUser, @Query() q: { from?: string; to?: string; branchId?: string }, @Res({ passthrough: true }) res: Response) {
    const csv = await this.finance.exportCsv(user, q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="hatly-vendor-statement.csv"');
    res.setHeader('Cache-Control', 'no-store');
    return csv;
  }
}

/** Admin: a vendor's contractual settlement frequency (WEEKLY / MONTHLY, or not configured) — set with the settlement permission, audited. */
@ApiTags('admin-vendor-settlement-terms')
@Controller('admin/vendors/:vendorId/settlement-terms')
export class AdminVendorSettlementTermsController {
  constructor(private readonly finance: VendorFinanceService) {}

  @Get()
  @RequiresPermission(Permission.VIEW_VENDOR_FINANCIAL_REPORTS)
  async get(@Param('vendorId') vendorId: string) {
    return { data: await this.finance.getTerms(vendorId) };
  }

  @Put()
  @ExplicitlyAudited()
  @RequiresPermission(Permission.CLOSE_VENDOR_SETTLEMENTS)
  async set(@Param('vendorId') vendorId: string, @Body() body: { frequency?: unknown }, @CurrentUser() actor: AuthenticatedUser) {
    return { data: await this.finance.setTerms(actor, vendorId, body?.frequency === undefined ? null : body.frequency) };
  }
}

/** Admin: closures of any branch (read with the vendors view permission; schedule/cancel with the open/close-branches permission), audited. */
@ApiTags('admin-branch-closures')
@Controller('admin/vendor-branches/:branchId/closures')
export class AdminBranchClosuresController {
  constructor(private readonly closures: BranchClosuresService) {}

  @Get()
  @RequiresPermission(Permission.VENDORS_VIEW)
  async list(@Param('branchId') branchId: string) {
    await this.closures.assertBranchExists(branchId);
    return { data: { closures: await this.closures.list(branchId), current: await this.closures.current(branchId), canManage: true } };
  }

  @Post()
  @ExplicitlyAudited()
  @RequiresPermission(Permission.OPEN_CLOSE_VENDOR_BRANCHES)
  async create(@Param('branchId') branchId: string, @Body() body: any, @CurrentUser() actor: AuthenticatedUser) {
    await this.closures.assertBranchExists(branchId);
    return { data: await this.closures.create(actor, branchId, body) };
  }

  @Delete(':closureId')
  @ExplicitlyAudited()
  @RequiresPermission(Permission.OPEN_CLOSE_VENDOR_BRANCHES)
  async cancel(@Param('branchId') branchId: string, @Param('closureId') closureId: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.closures.assertBranchExists(branchId);
    return { data: await this.closures.cancel(actor, branchId, closureId) };
  }
}

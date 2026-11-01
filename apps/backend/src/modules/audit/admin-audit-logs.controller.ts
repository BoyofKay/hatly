import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { AdminAuditService } from './admin-audit.service';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';

/**
 * Launch-readiness G-11 — read-only view of the append-only audit trail. Gated by the dedicated VIEW_AUDIT_LOG permission
 * (SUPER_ADMIN bypasses; an ADMIN needs an explicit grant). There is no write, update or delete route for audit rows anywhere.
 */
@ApiTags('admin-audit-logs')
@Controller('admin/audit-logs')
export class AdminAuditLogsController {
  constructor(private readonly audit: AdminAuditService) {}

  @Get()
  @RequiresPermission(Permission.VIEW_AUDIT_LOG)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async list(@Query() query: ListAuditLogsQueryDto) {
    const result = await this.audit.list(query);
    return { data: result.data, meta: { page: result.page, limit: result.limit, total: result.total } };
  }
}

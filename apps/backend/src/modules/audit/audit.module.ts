import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuditLog } from './entities/admin-audit-log.entity';
import { AdminAuditService } from './admin-audit.service';
import { AdminAuditLogsController } from './admin-audit-logs.controller';

/** Global: any module that performs a privileged mutation can inject AdminAuditService without importing this module. */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AdminAuditLog])],
  controllers: [AdminAuditLogsController],
  providers: [AdminAuditService],
  exports: [AdminAuditService],
})
export class AuditModule {}

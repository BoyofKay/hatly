import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';
import { OrdersModule } from '../orders/orders.module';
import { WalletModule } from '../wallet/wallet.module';
import { AuthModule } from '../auth/auth.module';
import { AdminCustomersExtController } from './customers/admin-customers-ext.controller';
import { AdminCustomersExtService } from './customers/admin-customers-ext.service';
import { ExecutiveController } from './executive/executive.controller';
import { ExecutiveService } from './executive/executive.service';
import { PermissionTemplatesController } from './permission-templates/permission-templates.controller';
import { PermissionTemplatesService } from './permission-templates/permission-templates.service';
import { AdminFinanceController } from './finance/admin-finance.controller';
import { AdminFinanceService } from './finance/admin-finance.service';
import { AdminOrderExtrasController } from './orders/admin-order-extras.controller';
import { AdminOrderExceptionsController } from './orders/admin-order-exceptions.controller';
import { AdminOrderExtrasService } from './orders/admin-order-extras.service';
import { ManualTransferExpiryService } from './orders/manual-transfer-expiry.service';
import { UploadsModule } from '../uploads/uploads.module';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { HomeProductsModule } from '../home-products/home-products.module';
import { BusinessConfigModule } from '../business-config/business-config.module';
import { MarketingController, CustomerInboxController } from './marketing/marketing.controller';
import { MarketingService } from './marketing/marketing.service';
import { DirectoryController } from './directory/directory.controller';
import { SystemController, TelemetryController, ConfigOverviewController } from './system/system.controller';
import { MetricsRecorder, RequestMetricsInterceptor, SystemService } from './system/system.service';
import { MediaController } from './media/media.controller';
import { MediaService } from './media/media.service';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';

/**
 * Enterprise Admin Panel — read models and workflows added on top of the existing domain modules (docs/admin-revamp). Everything here
 * reuses the existing services for anything that moves money or changes order state; the SQL in this module is read-side only, plus the
 * new tables' own writes (notes, settlement payments, templates, ...).
 */
@Module({
  imports: [PermissionsModule, UsersModule, OrdersModule, WalletModule, AuthModule, UploadsModule, HomeProductsModule, BusinessConfigModule],
  controllers: [ExecutiveController, PermissionTemplatesController, AdminFinanceController, AdminOrderExtrasController, AdminOrderExceptionsController, AdminCustomersExtController, ReportsController, MediaController, MarketingController, CustomerInboxController, DirectoryController, SystemController, TelemetryController, ConfigOverviewController],
  providers: [ExecutiveService, PermissionTemplatesService, AdminFinanceService, AdminOrderExtrasService, ManualTransferExpiryService, AdminCustomersExtService, ReportsService, MediaService, MarketingService, SystemService, MetricsRecorder, { provide: APP_INTERCEPTOR, useClass: RequestMetricsInterceptor }],
})
export class AdminPlatformModule {}

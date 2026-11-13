import { Module, forwardRef } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { AdminOperationsBoardController } from './admin-operations-board.controller';
import { OperationsBoardService } from './operations-board.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Driver } from './entities/driver.entity';
import { Delivery } from './entities/delivery.entity';
import { DispatchAttempt } from './entities/dispatch-attempt.entity';
import { DispatchAlert } from './entities/dispatch-alert.entity';
import { ProofOfDelivery } from './entities/proof-of-delivery.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { Order } from '../orders/entities/order.entity';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';
import { DeliveryAssignmentService } from './delivery-assignment.service';
import { DriversService } from './drivers.service';
import { DriverAuthorizationService } from './driver-authorization.service';
import { DriverOrderActionsService } from './driver-order-actions.service';
import { ProofOfDeliveryService } from './proof-of-delivery.service';
import { DriverProfileService } from './driver-profile.service';
import { DriverDeliveriesService } from './driver-deliveries.service';
import { DriverPurchaseService } from './driver-purchase.service';
import { DriverEarningsService } from './driver-earnings.service';
import { DriverWeightRecordService } from './driver-weight-record.service';
import { DriverRankingService } from './driver-ranking.service';
import { AutomaticDispatchService } from './automatic-dispatch.service';
import { AdminDispatchService } from './admin-dispatch.service';
import { AdminDriversController } from './admin-drivers.controller';
import { ServiceAreasModule } from '../service-areas/service-areas.module';
import { DriverController } from './driver.controller';
import { AdminDispatchController, AdminDispatchAlertsController } from './admin-dispatch.controller';
import { AdminControlTowerController } from './admin-control-tower.controller';
import { AdminControlTowerService } from './admin-control-tower.service';
import { OrdersModule } from '../orders/orders.module';
import { LocationModule } from '../location/location.module';
import { BusinessConfigModule } from '../business-config/business-config.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Driver, Delivery, DispatchAlert, DispatchAttempt, ProofOfDelivery, OrderItem, Order, VendorBranch]),
    ServiceAreasModule,
    // PHASE 4 DISPATCH addition: forwardRef — see OrdersModule's own
    // comment for why this mutual dependency is genuine, not accidental.
    forwardRef(() => OrdersModule),
    LocationModule,
    BusinessConfigModule,
    // Needed for PermissionsService — AdminDispatchController resolves
    // OVERRIDE_DISPATCH directly (a second, separate permission check
    // beyond the route-level @RequiresPermission guard).
    PermissionsModule,
    NotificationsModule,
    // M4 — Proof of Delivery reuses the existing generic uploads module
    // (UploadsService.findOwnedUrls) rather than inventing new storage.
    UploadsModule,
    // Courier money (Driver App earnings / history) is computed by the settlement closing service — one source with the Admin closing.
    FinanceModule,
  ],
  controllers: [AdminDriversController, DriverController, AdminDispatchController, AdminDispatchAlertsController, AdminControlTowerController, AdminOperationsBoardController],
  providers: [
    OperationsBoardService,
    DeliveryAssignmentService,
    DriversService,
    AdminControlTowerService,
    DriverAuthorizationService,
    DriverOrderActionsService,
    ProofOfDeliveryService,
    DriverProfileService,
    DriverDeliveriesService,
    DriverPurchaseService,
    DriverWeightRecordService,
    DriverEarningsService,
    DriverRankingService,
    AutomaticDispatchService,
    AdminDispatchService,
  ],
  exports: [DeliveryAssignmentService, AutomaticDispatchService, DriverAuthorizationService, ProofOfDeliveryService],
})
export class DeliveryModule {}

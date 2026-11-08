import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeviceToken } from './entities/device-token.entity';
import { CustomerNotification } from './entities/customer-notification.entity';
import { CustomerNotificationsService } from './customer-notifications.service';
import { CustomerNotificationsController } from './customer-notifications.controller';
import { DeviceTokensService } from './device-tokens.service';
import { DeviceTokensController } from './device-tokens.controller';
import { CustomerDeviceTokensController } from './customer-device-tokens.controller';
import { PushNotificationService } from './push-notification.service';
import { PUSH_NOTIFICATION_PROVIDER } from './push-provider.interface';
import { FirebasePushNotificationProvider } from './providers/firebase-push.provider';
import { NotificationOutboxService } from './outbox/notification-outbox.service';
import { StaffAlertsService } from './staff-alerts.service';
import { StaffNotificationsController } from './staff-notifications.controller';
import { AdminNotificationOutboxController } from './admin-notification-outbox.controller';
import { PermissionsModule } from '../permissions/permissions.module';
import { OpsAlertsService } from './ops-alerts.service';
import { AdminOpsAlertsController, AdminPushController, PushReceiptsController } from './ops-alerts.controllers';
import { AdminPushService } from './web-push/admin-push.service';
import { VapidWebPushSender, WEB_PUSH_SENDER } from './web-push/web-push-sender';
import { VendorsModule } from '../vendors/vendors.module';

/**
 * Driver Push Notifications. Self-contained — no dependency on the
 * `delivery` module, so `DeliveryModule` can import THIS module (to
 * call `PushNotificationService`) without any circular-dependency
 * risk. Exports `PushNotificationService` for exactly that.
 */
@Module({
  imports: [TypeOrmModule.forFeature([DeviceToken, CustomerNotification]), PermissionsModule, VendorsModule],
  controllers: [DeviceTokensController, CustomerDeviceTokensController, CustomerNotificationsController, StaffNotificationsController, AdminNotificationOutboxController, AdminOpsAlertsController, AdminPushController, PushReceiptsController],
  providers: [
    DeviceTokensService,
    CustomerNotificationsService,
    PushNotificationService,
    NotificationOutboxService,
    StaffAlertsService,
    FirebasePushNotificationProvider,
    { provide: PUSH_NOTIFICATION_PROVIDER, useClass: FirebasePushNotificationProvider },
    { provide: WEB_PUSH_SENDER, useClass: VapidWebPushSender },
    AdminPushService,
    OpsAlertsService,
  ],
  exports: [PushNotificationService, NotificationOutboxService, StaffAlertsService, OpsAlertsService, AdminPushService],
})
export class NotificationsModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeviceToken } from './entities/device-token.entity';
import { DeviceTokensService } from './device-tokens.service';
import { DeviceTokensController } from './device-tokens.controller';
import { CustomerDeviceTokensController } from './customer-device-tokens.controller';
import { PushNotificationService } from './push-notification.service';
import { PUSH_NOTIFICATION_PROVIDER } from './push-provider.interface';
import { FirebasePushNotificationProvider } from './providers/firebase-push.provider';

/**
 * Driver Push Notifications. Self-contained — no dependency on the
 * `delivery` module, so `DeliveryModule` can import THIS module (to
 * call `PushNotificationService`) without any circular-dependency
 * risk. Exports `PushNotificationService` for exactly that.
 */
@Module({
  imports: [TypeOrmModule.forFeature([DeviceToken])],
  controllers: [DeviceTokensController, CustomerDeviceTokensController],
  providers: [
    DeviceTokensService,
    PushNotificationService,
    FirebasePushNotificationProvider,
    { provide: PUSH_NOTIFICATION_PROVIDER, useClass: FirebasePushNotificationProvider },
  ],
  exports: [PushNotificationService],
})
export class NotificationsModule {}

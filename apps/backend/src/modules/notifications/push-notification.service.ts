import { Inject, Injectable, Logger } from '@nestjs/common';
import { DeviceTokensService } from './device-tokens.service';
import { PUSH_NOTIFICATION_PROVIDER, PushNotificationProvider } from './push-provider.interface';

/**
 * Driver Push Notifications. The single call site both
 * DeliveryAssignmentService's automatic AND manual assignment paths
 * use (they share ONE `assignDriver` method — confirmed by
 * inspection, so calling this from there covers both triggers with
 * zero duplication). Never throws — a push failure must never break
 * a successful assignment (Section 17); every failure path here is
 * logged and swallowed, not propagated.
 */
@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);

  constructor(
    private readonly deviceTokensService: DeviceTokensService,
    @Inject(PUSH_NOTIFICATION_PROVIDER) private readonly provider: PushNotificationProvider,
  ) {}

  /**
   * CONFIRMED payload shape, per this chunk's explicit requirement:
   * `{ type: 'ORDER_ASSIGNED', orderId }` at minimum — `deliveryId` is
   * an additional, small field, added because the Driver app's
   * EXISTING route (`/deliveries/:id`, confirmed by inspection) is
   * keyed by delivery id, not order id. Small and explicit, no
   * sensitive customer data included. Wording is deliberately plain
   * operational language ("assigned", not "awaiting acceptance") —
   * matches the existing no-accept/reject business rule.
   */
  async sendOrderAssignedNotification(driverUserId: string, orderId: string, deliveryId: string): Promise<void> {
    try {
      const tokens = await this.deviceTokensService.getActiveTokensForUser(driverUserId);
      if (tokens.length === 0) {
        return; // no registered device — existing polling remains the fallback
      }

      const result = await this.provider.sendToTokens({
        tokens,
        title: 'New Delivery',
        body: 'A new order has been assigned to you.',
        data: { type: 'ORDER_ASSIGNED', orderId, deliveryId },
      });

      if (result.invalidTokens.length > 0) {
        await this.deviceTokensService.deactivateTokens(result.invalidTokens);
      }

      if (!result.success) {
        this.logger.warn(`Push notification for order ${orderId} was not delivered — Driver will rely on polling.`);
      }
    } catch (error) {
      // CRITICAL: never rethrow. This method is always called AFTER
      // the assignment transaction has already committed (see
      // DeliveryAssignmentService) — nothing here can or should ever
      // undo that.
      this.logger.error(`Unexpected error sending push notification for order ${orderId}.`);
    }
  }

  /**
   * Customer Push Notifications (Chunk A). Five thin methods, one per
   * approved MVP event — CONFIRMED (Product Scope Review): CONFIRMED,
   * CANCELLED, DELIVERED, FAILED_DELIVERY (P0) and ON_THE_WAY (P1).
   * Each mirrors `sendOrderAssignedNotification`'s exact shape
   * (fetch active tokens, send, deactivate any invalid ones, log —
   * never rethrow) rather than a generic parameterized method, since
   * that's the established convention already proven above. Payload
   * intentionally excludes cancellation/failure reason, payment
   * amounts, addresses, or any other sensitive/unnecessary data —
   * only `type` + `orderId`, matching the approved Design Review's
   * payload contract exactly. Title/body use plain operational
   * language consistent with this project's existing
   * `orderStatusLabel` terminology on the Customer side, since the
   * backend has no localization system of its own (no full
   * localization architecture is introduced here, per instruction).
   */
  private async sendCustomerOrderNotification(
    customerId: string,
    orderId: string,
    type: string,
    title: string,
    body: string,
  ): Promise<void> {
    try {
      const tokens = await this.deviceTokensService.getActiveTokensForUser(customerId);
      if (tokens.length === 0) {
        return;
      }

      const result = await this.provider.sendToTokens({
        tokens,
        title,
        body,
        data: { type, orderId },
      });

      if (result.invalidTokens.length > 0) {
        await this.deviceTokensService.deactivateTokens(result.invalidTokens);
      }

      if (!result.success) {
        this.logger.warn(`Customer push notification for order ${orderId} (${type}) was not delivered.`);
      }
    } catch (error) {
      // CRITICAL: never rethrow — same reasoning as
      // sendOrderAssignedNotification above. Every caller of these
      // methods invokes them AFTER the Order transition has already
      // committed (see OrderStateMachineService.transition()) —
      // nothing here can or should ever undo that.
      this.logger.error(`Unexpected error sending customer push notification for order ${orderId} (${type}).`);
    }
  }

  async sendOrderConfirmedNotification(customerId: string, orderId: string): Promise<void> {
    await this.sendCustomerOrderNotification(
      customerId,
      orderId,
      'ORDER_CONFIRMED',
      'Order confirmed',
      'Your order has been confirmed.',
    );
  }

  async sendOrderCancelledNotification(customerId: string, orderId: string): Promise<void> {
    await this.sendCustomerOrderNotification(
      customerId,
      orderId,
      'ORDER_CANCELLED',
      'Order cancelled',
      'Your order has been cancelled.',
    );
  }

  async sendOrderOnTheWayNotification(customerId: string, orderId: string): Promise<void> {
    await this.sendCustomerOrderNotification(
      customerId,
      orderId,
      'ORDER_ON_THE_WAY',
      'Order on the way',
      'Your order is on the way.',
    );
  }

  async sendOrderDeliveredNotification(customerId: string, orderId: string): Promise<void> {
    await this.sendCustomerOrderNotification(
      customerId,
      orderId,
      'ORDER_DELIVERED',
      'Order delivered',
      'Your order has been delivered.',
    );
  }

  async sendOrderFailedDeliveryNotification(customerId: string, orderId: string): Promise<void> {
    await this.sendCustomerOrderNotification(
      customerId,
      orderId,
      'ORDER_FAILED_DELIVERY',
      'Delivery failed',
      'We were unable to deliver your order.',
    );
  }
}

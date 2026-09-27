import { BadRequestException, Injectable } from '@nestjs/common';
import { OrderStateMachineService } from '../orders/order-state-machine.service';
import { OrderStatus } from '../orders/order-status.enum';
import { Order } from '../orders/entities/order.entity';
import { Role } from '../../common/enums/role.enum';
import { DriverAuthorizationService } from './driver-authorization.service';
import { DriverFailedDeliveryReason } from './driver-failed-delivery-reason.enum';

/**
 * A thin wrapper — NOT a new state machine. The existing
 * OrderStateMachineService already has the correct, unmodified
 * transition table for driver actions (ASSIGNED_TO_DRIVER->PICKED_UP
 * ->ON_THE_WAY->DELIVERED, plus the reject/reassignment path); the
 * only thing missing was the ownership check, added here rather than
 * inside that service, per the approved instruction to keep the
 * existing transition table intact.
 */
@Injectable()
export class DriverOrderActionsService {
  constructor(
    private readonly driverAuthorizationService: DriverAuthorizationService,
    private readonly orderStateMachine: OrderStateMachineService,
  ) {}

  async updateStatus(params: {
    userId: string;
    deliveryId: string;
    to: OrderStatus;
    cancellationReason?: string;
    failureReason?: string;
  }): Promise<Order> {
    // Driver Core + Dispatch Foundation milestone: a DRIVER-supplied failure reason must come from the
    // controlled list — still optional (omitting it entirely is unchanged, existing behavior), but a value
    // that IS supplied and isn't one of the known reasons is rejected outright, same "fail closed on an
    // unrecognized value" discipline used everywhere else in this codebase. Only constrains THIS actor
    // (Role.DRIVER) — the ADMIN path through the exact same transition keeps its existing free-text reason.
    if (
      params.to === OrderStatus.FAILED_DELIVERY &&
      params.failureReason !== undefined &&
      !Object.values(DriverFailedDeliveryReason).includes(params.failureReason as DriverFailedDeliveryReason)
    ) {
      throw new BadRequestException({
        message: 'failureReason must be one of the recognized delivery-failure reasons.',
        details: { code: 'INVALID_FAILURE_REASON', allowed: Object.values(DriverFailedDeliveryReason) },
      });
    }

    const driver = await this.driverAuthorizationService.getDriverForUser(params.userId);
    const delivery = await this.driverAuthorizationService.assertOwnsDelivery(driver.id, params.deliveryId);

    return this.orderStateMachine.transition({
      orderId: delivery.orderId,
      to: params.to,
      actorRole: Role.DRIVER,
      cancellationReason: params.cancellationReason,
      failureReason: params.failureReason,
    });
  }
}

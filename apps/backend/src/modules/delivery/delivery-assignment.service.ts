import { recomputeDriverAvailability } from './driver-capacity';
import { BusinessConfigKey } from '../business-config/business-config-key.enum';
import { BusinessConfig } from '../business-config/entities/business-config.entity';
import { resolveAcknowledgementWindowMinutes } from '../business-config/business-config.service';
import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Driver } from './entities/driver.entity';
import { Delivery } from './entities/delivery.entity';
import { DispatchAlert } from './entities/dispatch-alert.entity';
import { Order } from '../orders/entities/order.entity';
import { FulfillmentType } from '../cart/fulfillment-type.enum';
import { OrderStateMachineService } from '../orders/order-state-machine.service';
import { OrderStatus } from '../orders/order-status.enum';
import { Role } from '../../common/enums/role.enum';
import { PushNotificationService } from '../notifications/push-notification.service';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';
import { RequestContextService } from '../../common/request-context/request-context.service';
import { logBusinessEvent } from '../../common/logging/log-business-event';
import { BusinessEvent } from '../../common/logging/business-events';

/**
 * The order is not in the state an assignment (READY_FOR_PICKUP) or reassignment (ASSIGNED_TO_DRIVER) needs — an expected
 * race outcome (someone else already acted), refused BEFORE anything is written. A ConflictException so HTTP callers get a
 * 409, but a distinct type so automatic dispatch can treat it as "nothing to do" instead of "no eligible driver".
 */
export class OrderNotAssignableException extends ConflictException {
  constructor(message: string, code: 'ORDER_NOT_ASSIGNABLE' | 'ORDER_NOT_REASSIGNABLE', currentStatus?: string) {
    super({ message, details: { code, ...(currentStatus ? { currentStatus } : {}) } });
  }
}

/**
 * Driver assignment — the second high-risk area flagged in Phase 0.
 *
 * V1 strategy (deliberately simple, per spec section 13: "do not build
 * an unnecessarily sophisticated optimization algorithm"):
 *   1. Find nearest available, online, verified drivers for the order's
 *      service area.
 *   2. Take a short-lived Redis lock per driver (`driver-lock:<id>`)
 *      before assigning, so two orders can never grab the same driver
 *      in the same instant — this is the concurrency guard called out
 *      in spec section 12.
 *   3. Flip the driver to unavailable and create the Delivery row in
 *      the same DB transaction that advances the order to
 *      ASSIGNED_TO_DRIVER.
 *   4. If the driver doesn't accept within acceptDeadlineAt, a
 *      (not-yet-implemented) reassignment job releases the lock and
 *      tries the next driver — left for Phase 3.
 *
 * Nearest-driver ranking, workload balancing, and timeout-driven
 * reassignment are intentionally out of scope for Phase 1; this
 * service establishes the locking pattern they'll build on.
 */
@Injectable()
export class DeliveryAssignmentService {
  private readonly lockTtlMs = 15_000;
  private readonly logger = new Logger(DeliveryAssignmentService.name);

  constructor(
    @InjectRepository(Driver) private readonly driversRepository: Repository<Driver>,
    @InjectRepository(Delivery) private readonly deliveriesRepository: Repository<Delivery>,
    private readonly orderStateMachine: OrderStateMachineService,
    private readonly dataSource: DataSource,
    private readonly pushNotificationService: PushNotificationService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly requestContextService: RequestContextService,
  ) {}

  private lockKey(driverId: string): string {
    return `driver-lock:${driverId}`;
  }

  /**
   * Reliability & Adversarial Testing milestone fix. This lock previously used a fixed `'1'` as its
   * value and released with a blind, unconditional `DEL` — the SAME class of bug already found and
   * fixed in `AutomaticDispatchService`'s own sweep lock (see that class's own comment for the full
   * reasoning): if the critical section below (DB transaction + the order-state-machine transition +
   * the awaited push-notification call) ever runs longer than `lockTtlMs`, the lock can expire while
   * this call is still working; a DIFFERENT concurrent assignment attempt for the SAME driver then
   * legitimately acquires the now-free lock — and this call's own `finally { releaseLock() }` would
   * blindly delete THAT other attempt's active lock, opening the door to a third, fourth, ... attempt
   * also racing in. That is a direct path to the exact invariant this whole lock exists to protect —
   * "two orders can never grab the same driver in the same instant" — being violated. Reproduced as a
   * genuine, deterministic possibility (not required to reproduce the full multi-second stall to prove
   * the fix — the unit test exercises the CAS logic directly, exactly like the sweep lock's own test).
   * Fixed the same way: an ownership TOKEN as the lock's value, and an atomic Lua compare-and-delete
   * release that only ever removes a lock this exact call set.
   */
  private async acquireLock(driverId: string): Promise<string | null> {
    const token = randomUUID();
    const result = await this.redis.set(this.lockKey(driverId), token, 'PX', this.lockTtlMs, 'NX');
    return result === 'OK' ? token : null;
  }

  private async releaseLock(driverId: string, token: string): Promise<void> {
    const releaseScript = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    const deleted = await this.redis.eval(releaseScript, 1, this.lockKey(driverId), token);
    if (deleted === 0) {
      this.logger.warn(`Driver lock for ${driverId} had already expired/been reclaimed by another attempt before release — no action taken (safe).`);
    }
  }

  async assignDriver(params: { orderId: string; candidateDriverIds: string[] }): Promise<Delivery> {
    for (const driverId of params.candidateDriverIds) {
      const lockToken = await this.acquireLock(driverId);
      if (!lockToken) {
        continue; // another assignment is already mid-flight for this driver
      }

      try {
        // Control Tower milestone fix: the WHOLE assignment — order status check, driver lock-out, delivery row, alert
        // resolution and the READY_FOR_PICKUP→ASSIGNED_TO_DRIVER transition — is ONE transaction. Previously the
        // transition ran after the driver/delivery writes had committed, so assigning an order that was not
        // READY_FOR_PICKUP (already assigned by another admin, cancelled, still preparing) left a driver locked out and
        // the delivery pointing at someone who was never notified, before failing.
        const result = await this.dataSource.transaction(async (manager) => {
          await this.lockAssignableOrder(manager, params.orderId, OrderStatus.READY_FOR_PICKUP);

          const driver = await manager.findOne(Driver, {
            where: { id: driverId },
            lock: { mode: 'pessimistic_write' },
          });

          if (!driver || !driver.isAvailable || !driver.isOnline) {
            return null; // driver went unavailable between candidate list and lock
          }

          const assigned = await this.assignInTransaction(manager, params.orderId, driver);
          return { ...assigned, driverUserId: driver.userId };
        });

        if (!result) {
          continue;
        }

        await this.afterAssignmentCommitted(params.orderId, result, driverId);
        return result.delivery;
      } finally {
        // Lock is intentionally released only after the transaction
        // commits, so no other assignment attempt can touch this
        // driver mid-transaction.
        await this.releaseLock(driverId, lockToken);
      }
    }

    logBusinessEvent(this.logger, 'warn', BusinessEvent.DISPATCH_ASSIGNMENT_FAILED, () => this.requestContextService.getCorrelationId(), {
      orderId: params.orderId,
      candidateCount: params.candidateDriverIds.length,
    });
    throw new ConflictException({
      message: 'No available driver could be assigned.',
      details: { code: 'NO_AVAILABLE_DRIVER' },
    });
  }

  /**
   * Manual reassignment of an ASSIGNED_TO_DRIVER order to a named driver — atomically: either the order ends assigned to
   * the new driver (previous driver freed, timeline records the release and the new assignment), or NOTHING changes. Every
   * check runs before any write, so a refused reassignment (wrong state, new driver unavailable, someone else changed
   * the assignment meanwhile) can never leave the order unassigned or a driver wrongly marked available/busy.
   *
   * `expectedCurrentDriverId` (optional): the driver the caller believes is assigned. If the assignment has changed since
   * (another admin, the timeout sweep, the driver's own release), the request is refused with `ASSIGNMENT_CHANGED` instead
   * of silently overriding a decision the caller never saw. Uses only existing transitions
   * (ASSIGNED_TO_DRIVER→READY_FOR_PICKUP→ASSIGNED_TO_DRIVER); no new state, no accept/reject.
   */
  async reassignDriver(params: { orderId: string; newDriverId: string; expectedCurrentDriverId?: string }): Promise<Delivery> {
    const lockToken = await this.acquireLock(params.newDriverId);
    if (!lockToken) {
      throw new ConflictException({
        message: 'This driver is being assigned to another order right now. Please try again.',
        details: { code: 'DRIVER_UNAVAILABLE' },
      });
    }
    try {
      const result = await this.dataSource.transaction(async (manager) => {
        await this.lockAssignableOrder(manager, params.orderId, OrderStatus.ASSIGNED_TO_DRIVER);
        const delivery = await manager.findOne(Delivery, { where: { orderId: params.orderId }, lock: { mode: 'pessimistic_write' } });
        if (!delivery) {
          throw new OrderNotAssignableException('This order has no delivery to reassign.', 'ORDER_NOT_REASSIGNABLE');
        }
        if (params.expectedCurrentDriverId !== undefined && delivery.driverId !== params.expectedCurrentDriverId) {
          throw new ConflictException({
            message: 'The assignment of this order changed since you loaded it. Review the current driver and try again.',
            details: { code: 'ASSIGNMENT_CHANGED', currentDriverId: delivery.driverId ?? null },
          });
        }
        if (delivery.driverId === params.newDriverId) {
          throw new ConflictException({
            message: 'This driver is already assigned to the order.',
            details: { code: 'DRIVER_ALREADY_ASSIGNED' },
          });
        }
        // Lock BOTH driver rows (previous + new) in a stable id order before the release touches the previous one: two
        // concurrent swaps (X: D1→D2 while Z: D2→D1) would otherwise lock them in opposite orders and deadlock.
        const driverIds = [params.newDriverId, ...(delivery.driverId ? [delivery.driverId] : [])].sort();
        let newDriver: Driver | null = null;
        for (const id of driverIds) {
          const row = await manager.findOne(Driver, { where: { id }, lock: { mode: 'pessimistic_write' } });
          if (id === params.newDriverId) newDriver = row;
        }
        if (!newDriver || !newDriver.isOnline || !newDriver.isAvailable) {
          throw new ConflictException({
            message: 'The selected driver is not online and available right now.',
            details: { code: 'DRIVER_UNAVAILABLE' },
          });
        }

        // Release (frees the previous driver — the state machine's own rule) and re-assign, in this same transaction.
        const release = await this.orderStateMachine.transitionInTransaction(manager, {
          orderId: params.orderId,
          to: OrderStatus.READY_FOR_PICKUP,
          actorRole: Role.ADMIN,
        });
        delivery.reassignmentCount = (delivery.reassignmentCount ?? 0) + 1;
        const assigned = await this.assignInTransaction(manager, params.orderId, newDriver, delivery);
        return { ...assigned, releaseAfterCommit: release.afterCommit, driverUserId: newDriver.userId };
      });

      await result.releaseAfterCommit();
      await this.afterAssignmentCommitted(params.orderId, result, params.newDriverId);
      return result.delivery;
    } finally {
      await this.releaseLock(params.newDriverId, lockToken);
    }
  }

  /** Locks the order row FIRST (this codebase's Order-before-Delivery/Driver lock order) and requires the expected status. */
  private async lockAssignableOrder(manager: EntityManager, orderId: string, expected: OrderStatus): Promise<Order> {
    const order = await manager.findOne(Order, { where: { id: orderId }, lock: { mode: 'pessimistic_write' } });
    if (!order) {
      throw new NotFoundException({ message: 'Order not found.', details: { code: 'ORDER_NOT_FOUND' } });
    }
    // A PICKUP order is collected by the customer at the branch (PD-006.C — no delivery address): it is never a driver's job.
    if (order.fulfillmentType !== FulfillmentType.DELIVERY) {
      throw new OrderNotAssignableException(
        'This is a pickup order — the customer collects it at the branch, so no driver is assigned.',
        expected === OrderStatus.READY_FOR_PICKUP ? 'ORDER_NOT_ASSIGNABLE' : 'ORDER_NOT_REASSIGNABLE',
        order.status,
      );
    }
    if (order.status !== expected) {
      throw expected === OrderStatus.READY_FOR_PICKUP
        ? new OrderNotAssignableException(
            `This order cannot be assigned: it is ${order.status}, not waiting for a driver.`,
            'ORDER_NOT_ASSIGNABLE',
            order.status,
          )
        : new OrderNotAssignableException(
            `This order cannot be reassigned: it is ${order.status}, not assigned to a driver.`,
            'ORDER_NOT_REASSIGNABLE',
            order.status,
          );
    }
    return order;
  }

  /** The single definition of "assign this driver to this READY_FOR_PICKUP order", inside the caller's transaction. */
  private async assignInTransaction(
    manager: EntityManager,
    orderId: string,
    driver: Driver,
    lockedDelivery?: Delivery,
  ): Promise<{ delivery: Delivery; afterCommit: () => Promise<void> }> {
    const existingDelivery =
      lockedDelivery ?? (await manager.findOne(Delivery, { where: { orderId }, lock: { mode: 'pessimistic_write' } }));
    // R16: acknowledge-by deadline = now + the configured window (default 5 min), read at assignment time; same for manual and automatic.
    const windowRow = await manager.findOne(BusinessConfig, { where: { key: BusinessConfigKey.DISPATCH_ACKNOWLEDGEMENT_WINDOW_MINUTES } });
    const acknowledgeBy = new Date(Date.now() + resolveAcknowledgementWindowMinutes(windowRow?.value) * 60_000);
    const delivery = existingDelivery
      ? Object.assign(existingDelivery, {
          driverId: driver.id,
          assignedAt: new Date(),
          acceptDeadlineAt: acknowledgeBy,
          acknowledgedAt: null,
          pickedUpAt: null,
          deliveredAt: null,
        })
      : manager.create(Delivery, {
          orderId,
          driverId: driver.id,
          assignedAt: new Date(),
          acceptDeadlineAt: acknowledgeBy,
          acknowledgedAt: null,
        });
    const savedDelivery = await manager.save(delivery);
    // R18: the driver stays available while they have spare capacity (this order counts — its status is written just after).
    await recomputeDriverAvailability(manager, [driver.id], { includeOrderId: orderId });

    // DispatchAlert's documented contract: an alert is resolved once a driver is successfully assigned for its order.
    await manager
      .createQueryBuilder()
      .update(DispatchAlert)
      .set({ resolvedAt: () => 'now()' })
      .where('order_id = :orderId AND resolved_at IS NULL', { orderId })
      .execute();

    const { afterCommit } = await this.orderStateMachine.transitionInTransaction(manager, {
      orderId,
      to: OrderStatus.ASSIGNED_TO_DRIVER,
      actorRole: Role.ADMIN, // system-initiated transition
    });
    return { delivery: savedDelivery, afterCommit };
  }

  private async afterAssignmentCommitted(
    orderId: string,
    result: { delivery: Delivery; afterCommit: () => Promise<void>; driverUserId: string },
    driverId: string,
  ): Promise<void> {
    await result.afterCommit();

    logBusinessEvent(this.logger, 'log', BusinessEvent.DISPATCH_DRIVER_ASSIGNED, () => this.requestContextService.getCorrelationId(), {
      orderId,
      deliveryId: result.delivery.id,
      driverId,
    });

    // Never awaited-and-failed into the caller's control flow — PushNotificationService itself never throws; a push failure
    // can never roll back or affect this already-committed assignment.
    await this.pushNotificationService.sendOrderAssignedNotification(result.driverUserId, orderId, result.delivery.id);
  }
}

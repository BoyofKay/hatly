import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { DataSource, Repository } from 'typeorm';
import { Driver } from './entities/driver.entity';
import { Delivery } from './entities/delivery.entity';
import { OrderStateMachineService } from '../orders/order-state-machine.service';
import { OrderStatus } from '../orders/order-status.enum';
import { Role } from '../../common/enums/role.enum';
import { PushNotificationService } from '../notifications/push-notification.service';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';
import { RequestContextService } from '../../common/request-context/request-context.service';
import { logBusinessEvent } from '../../common/logging/log-business-event';
import { BusinessEvent } from '../../common/logging/business-events';

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
        const result = await this.dataSource.transaction(async (manager) => {
          const driver = await manager.findOne(Driver, {
            where: { id: driverId },
            lock: { mode: 'pessimistic_write' },
          });

          if (!driver || !driver.isAvailable || !driver.isOnline) {
            return null; // driver went unavailable between candidate list and lock
          }

          driver.isAvailable = false;
          await manager.save(driver);

          // `deliveries.order_id` is UNIQUE (one delivery per order for its whole life). An order that
          // is handed to a new driver — after the previous driver rejected it or an admin reassigned
          // it — therefore keeps its delivery row and gets the new driver written into it; a plain
          // INSERT here failed with `duplicate key ... idx_deliveries_order` (HTTP 500), which made
          // reassign-driver and every re-dispatch after a rejection impossible (Group 8 finding).
          const existingDelivery = await manager.findOne(Delivery, {
            where: { orderId: params.orderId },
            lock: { mode: 'pessimistic_write' },
          });
          const delivery = existingDelivery
            ? Object.assign(existingDelivery, {
                driverId,
                assignedAt: new Date(),
                acceptDeadlineAt: new Date(Date.now() + 30_000),
                pickedUpAt: null,
                deliveredAt: null,
              })
            : manager.create(Delivery, {
                orderId: params.orderId,
                driverId,
                assignedAt: new Date(),
                acceptDeadlineAt: new Date(Date.now() + 30_000),
              });
          const savedDelivery = await manager.save(delivery);
          return { delivery: savedDelivery, driverUserId: driver.userId };
        });

        if (!result) {
          await this.releaseLock(driverId, lockToken);
          continue;
        }

        await this.orderStateMachine.transition({
          orderId: params.orderId,
          to: OrderStatus.ASSIGNED_TO_DRIVER,
          actorRole: Role.ADMIN, // system-initiated transition
        });

        // Business-event log (Group 4). Post-commit — the per-driver
        // transaction above has already committed (`result` was
        // returned from it) AND the order transition just above has
        // also succeeded. Single chokepoint: every dispatch path
        // (automatic ranking AND Admin manual assign/reassign) shares
        // this one `assignDriver` method, so this is the one place
        // `dispatch.driver_assigned` is ever emitted.
        logBusinessEvent(this.logger, 'log', BusinessEvent.DISPATCH_DRIVER_ASSIGNED, () => this.requestContextService.getCorrelationId(), {
          orderId: params.orderId,
          deliveryId: result.delivery.id,
          driverId,
        });

        // Driver Push Notifications. Fired only after BOTH the
        // assignment transaction has committed AND the state-machine
        // transition has succeeded — never before, never on a failed
        // assignment. This single call site is shared by every caller
        // of assignDriver() (automatic dispatch AND Admin manual
        // assignment/reassignment — confirmed by inspection, both
        // call this same method), so no duplicate wiring was needed
        // in either caller. Never awaited-and-failed into this
        // method's own control flow — PushNotificationService itself
        // never throws (see its own comment); a push failure can
        // never roll back or affect this already-committed assignment.
        await this.pushNotificationService.sendOrderAssignedNotification(
          result.driverUserId,
          params.orderId,
          result.delivery.id,
        );

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
    throw new ConflictException('No available driver could be assigned.');
  }
}

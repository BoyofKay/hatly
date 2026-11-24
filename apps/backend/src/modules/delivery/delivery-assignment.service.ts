import { canTakeFinancialRisk, driverRiskLimits, driverCashExposure, cashCapBlocks } from './driver-financial-risk';
import { driverLoad, recomputeDriverAvailability } from './driver-capacity';
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

          if (!driver || !driver.isAvailable || !driver.isOnline || driver.acceptingNewOrders === false) {
            return null; // driver went unavailable between candidate list and lock
          }

          if (!(await canTakeFinancialRisk(manager,driver.id,params.orderId))) return null;
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
    // One named driver (a manual assignment): say exactly why — full (with the numbers) or offline — instead of the generic refusal.
    if (params.candidateDriverIds.length === 1) await this.throwNamedDriverRefusal(params.candidateDriverIds[0], 'NO_AVAILABLE_DRIVER');
    throw new ConflictException({
      message: 'No available driver could be assigned.',
      details: { code: 'NO_AVAILABLE_DRIVER' },
    });
  }

  /**
   * R18: why a named driver could not take the order, in plain words. The error CODE stays the one each endpoint always returned
   * (`code`: NO_AVAILABLE_DRIVER for an assignment, DRIVER_UNAVAILABLE for a reassignment — existing clients keep working); the reason is
   * added in `details.reason`: AT_CAPACITY (with the configured capacity and the active count — every active order of the driver, not only
   * those on any screen) or OFFLINE. Returns quietly if neither applies (e.g. another assignment for the same driver was mid-flight).
   */
  private async throwNamedDriverRefusal(driverId: string, code: 'NO_AVAILABLE_DRIVER' | 'DRIVER_UNAVAILABLE', db: { query: (sql: string, params?: unknown[]) => Promise<any> } = this.dataSource): Promise<void> {
    let d: { is_online: boolean } | undefined;
    let load: { active: number; capacity: number } | undefined;
    try {
      [d] = await db.query(`SELECT is_online FROM drivers WHERE id = $1`, [driverId]);
      if (d?.is_online) load = await driverLoad(db, driverId);
    } catch {
      return; // the explanation is best-effort; the caller's own refusal stands
    }
    if (!d) return;
    if (!d.is_online) {
      throw new ConflictException({ message: 'This driver is offline. Ask them to go online, or choose another driver.', details: { code, reason: 'OFFLINE' } });
    }
    const limits=await driverRiskLimits(db);
    if(limits.capMinor!==null){
      const e=await driverCashExposure(db,driverId);
      if(cashCapBlocks(limits.capMinor,e.outstandingMinor,e.projectedMinor)) throw new ConflictException({message:'Driver cash exposure cap reached.',details:{code,reason:'CASH_CAP',outstandingMinor:e.outstandingMinor,capMinor:limits.capMinor}});
    }
    if (load && load.active >= load.capacity) {
      throw new ConflictException({
        message: `This driver already has ${load.active} active order(s) — their limit is ${load.capacity}. Choose another driver, or change their capacity first.`,
        details: { code, reason: 'AT_CAPACITY', active: load.active, capacity: load.capacity },
      });
    }
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
        if (!newDriver || !newDriver.isOnline || !newDriver.isAvailable || newDriver.acceptingNewOrders === false) {
          if (newDriver) await this.throwNamedDriverRefusal(newDriver.id, 'DRIVER_UNAVAILABLE', manager);
          throw new ConflictException({
            message: 'The selected driver is not online and available right now.',
            details: { code: 'DRIVER_UNAVAILABLE' },
          });
        }

        if (!(await canTakeFinancialRisk(manager,newDriver.id,params.orderId))) throw new ConflictException({message:'Driver cash exposure cap reached.',details:{code:'DRIVER_UNAVAILABLE',reason:'CASH_CAP'}});
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

  /**
   * Early dispatch (owner decision 2026-11-22): attach the first available candidate to an order the store is still preparing
   * (Confirmed / Preparing). The order keeps its status; the delivery carries `early_assigned_at`, the driver counts as busy and gets the
   * usual acknowledgement window. Returns the delivery, or null when no candidate could take it (nothing changed). Never touches an order
   * that already has a driver.
   */
  async assignEarly(params: { orderId: string; candidateDriverIds: string[] }): Promise<Delivery | null> {
    for (const driverId of params.candidateDriverIds) {
      const lockToken = await this.acquireLock(driverId);
      if (!lockToken) continue;
      try {
        const result = await this.dataSource.transaction(async (manager) => {
          const [order] = await manager.query(`SELECT id, status::text AS status FROM orders WHERE id = $1 FOR UPDATE`, [params.orderId]);
          // The order's own status stays PENDING while the stores prepare it (it only moves on when every part is ready).
          if (!order || !['PENDING', 'CONFIRMED', 'PREPARING'].includes(order.status)) return 'ORDER_GONE' as const;
          const existing = await manager.findOne(Delivery, { where: { orderId: params.orderId }, lock: { mode: 'pessimistic_write' } });
          if (existing?.driverId && existing.earlyAssignedAt) return 'ORDER_GONE' as const; // someone was attached meanwhile
          const driver = await manager.findOne(Driver, { where: { id: driverId }, lock: { mode: 'pessimistic_write' } });
          if (!driver || !driver.isAvailable || !driver.isOnline || driver.acceptingNewOrders === false) return null;
          if (!(await canTakeFinancialRisk(manager,driver.id,params.orderId))) return null;
          const windowRow = await manager.findOne(BusinessConfig, { where: { key: BusinessConfigKey.DISPATCH_ACKNOWLEDGEMENT_WINDOW_MINUTES } });
          const acknowledgeBy = new Date(Date.now() + resolveAcknowledgementWindowMinutes(windowRow?.value) * 60_000);
          const fields = { driverId: driver.id, assignedAt: new Date(), acceptDeadlineAt: acknowledgeBy, acknowledgedAt: null, pickedUpAt: null, deliveredAt: null, earlyAssignedAt: new Date() };
          const delivery = existing ? Object.assign(existing, fields) : manager.create(Delivery, { orderId: params.orderId, ...fields });
          const saved = await manager.save(delivery);
          await recomputeDriverAvailability(manager, [driver.id], { includeOrderId: params.orderId });
          return { delivery: saved, driverUserId: driver.userId };
        });
        if (result === 'ORDER_GONE') return null;
        if (!result) continue;
        logBusinessEvent(this.logger, 'log', BusinessEvent.DISPATCH_DRIVER_ASSIGNED, () => this.requestContextService.getCorrelationId(), {
          orderId: params.orderId,
          deliveryId: result.delivery.id,
          driverId,
        });
        await this.pushNotificationService.sendOrderAssignedNotification(result.driverUserId, params.orderId, result.delivery.id);
        return result.delivery;
      } finally {
        await this.releaseLock(driverId, lockToken);
      }
    }
    return null;
  }

  /**
   * The order became Ready and a driver was pre-assigned while it was prepared: that pre-assignment becomes the normal assignment
   * (READY_FOR_PICKUP → ASSIGNED_TO_DRIVER) with no new search. Keeps the driver's acknowledgement. Returns false when there was no
   * pre-assignment (the caller then dispatches as usual).
   */
  async promoteEarlyAssignment(orderId: string): Promise<boolean> {
    const result = await this.dataSource.transaction(async (manager) => {
      const [order] = await manager.query(`SELECT id, status::text AS status FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
      if (!order || order.status !== OrderStatus.READY_FOR_PICKUP) return null;
      const delivery = await manager.findOne(Delivery, { where: { orderId }, lock: { mode: 'pessimistic_write' } });
      if (!delivery?.driverId || !delivery.earlyAssignedAt) return null;
      delivery.earlyAssignedAt = null;
      await manager.save(delivery);
      await manager.query(`UPDATE dispatch_alerts SET resolved_at = now(), updated_at = now() WHERE order_id = $1 AND resolved_at IS NULL AND reason IN ('NO_ELIGIBLE_DRIVER','AUTO_ASSIGN_DISABLED','ASSIGNMENT_ERROR')`, [orderId]);
      const { afterCommit } = await this.orderStateMachine.transitionInTransaction(manager, {
        orderId,
        to: OrderStatus.ASSIGNED_TO_DRIVER,
        actorRole: Role.ADMIN, // system-initiated transition
      });
      return afterCommit;
    });
    if (!result) return false;
    await result();
    return true;
  }

  /**
   * Takes a pre-assignment away from a driver (they did not acknowledge in time, or Operations decided) before the order is Ready. The
   * delivery no longer names them (so the order leaves their app) and their capacity is recomputed. `expectedDriverId` makes it a no-op if
   * the assignment changed meanwhile. Returns true when something was released.
   */
  async releaseEarlyAssignment(orderId: string, expectedDriverId: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT id FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
      const delivery = await manager.findOne(Delivery, { where: { orderId }, lock: { mode: 'pessimistic_write' } });
      if (!delivery || !delivery.earlyAssignedAt || delivery.driverId !== expectedDriverId) return false;
      Object.assign(delivery, { driverId: null, earlyAssignedAt: null, acceptDeadlineAt: null, acknowledgedAt: null, assignedAt: null });
      await manager.save(delivery);
      await recomputeDriverAvailability(manager, [expectedDriverId], { excludeOrderId: orderId });
      return true;
    });
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

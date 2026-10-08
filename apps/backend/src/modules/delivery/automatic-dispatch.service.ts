import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import { Order } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/order-status.enum';
import { Role } from '../../common/enums/role.enum';
import { Delivery } from './entities/delivery.entity';
import { DispatchAlert } from './entities/dispatch-alert.entity';
import { FulfillmentType } from '../cart/fulfillment-type.enum';
import { DriverRankingService } from './driver-ranking.service';
import { DeliveryAssignmentService, OrderNotAssignableException } from './delivery-assignment.service';
import { OrderStateMachineService } from '../orders/order-state-machine.service';
import { BusinessConfigService } from '../business-config/business-config.service';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';
import { RequestContextService } from '../../common/request-context/request-context.service';
import { logBusinessEvent } from '../../common/logging/log-business-event';
import { BusinessEvent } from '../../common/logging/business-events';

/**
 * CONFIRMED BUSINESS DECISION (no-driver behavior): keep the order in
 * its current ready state (no new status invented — READY_FOR_PICKUP
 * already IS "available for dispatch/retry"), and record a
 * DispatchAlert for Admin visibility (see that entity's own doc
 * comment for why this is the honest buildable form of "notify
 * Admin" — no notification infrastructure exists in this codebase).
 *
 * "Retry when appropriate": this method is idempotent and safe to
 * call again for the same order — no scheduler/cron exists anywhere
 * in this codebase to hook an automatic retry timer into, so an
 * actual scheduled retry is NOT built here (would be new
 * infrastructure beyond Phase D's scope) — but the same method a
 * future scheduler would call is exactly this one, ready to be
 * invoked again. Manual Admin retry (AdminDispatchService) already
 * works today via the same underlying primitive.
 *
 * Timeout-driven reassignment milestone addition (below,
 * `reassignTimedOutDeliveries`): that future scheduler now exists —
 * see this class's own `onModuleInit`/`onModuleDestroy`.
 *
 * Dispatch Hardening milestone (multi-instance safety, this class's biggest addition): the Redis
 * lock is now an OWNERSHIP-TOKEN compare-and-delete, not a blind DEL — see `acquireSweepLock`/
 * `releaseSweepLock`'s own comments for the exact failure mode this closes (a lock that outlives its
 * TTL while a sweep is still working, then gets deleted out from under whichever OTHER instance
 * legitimately acquired it next). The sweep query is now batch-limited and index-backed (see the
 * `DeliveryAcceptDeadlineIndex` migration), the interval/lock-TTL/batch-size are environment-
 * configurable technical constants (`configuration.ts`'s `dispatch.*`, never BusinessConfig), and
 * `onModuleDestroy` now awaits any in-flight sweep before the module (and the DB/Redis connections
 * under it) tears down.
 */
@Injectable()
export class AutomaticDispatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutomaticDispatchService.name);

  /** Same NX+PX mutual-exclusion pattern DeliveryAssignmentService already uses for per-driver locks — here it serializes the WHOLE sweep, so an overlapping tick (a slow previous run, or more than one app instance) can never process the same expired delivery twice. */
  private static readonly SWEEP_LOCK_KEY = 'dispatch-timeout-sweep-lock';

  private sweepTimer?: NodeJS.Timeout;
  /** Tracks the currently-running sweep (if any) so `onModuleDestroy` can wait for it instead of abandoning it mid-transaction. */
  private inFlightSweep?: Promise<unknown>;
  private shuttingDown = false;

  constructor(
    @InjectRepository(Order) private readonly ordersRepository: Repository<Order>,
    @InjectRepository(DispatchAlert) private readonly dispatchAlertsRepository: Repository<DispatchAlert>,
    private readonly driverRankingService: DriverRankingService,
    private readonly deliveryAssignmentService: DeliveryAssignmentService,
    private readonly businessConfigService: BusinessConfigService,
    private readonly requestContextService: RequestContextService,
    @InjectRepository(Delivery) private readonly deliveriesRepository: Repository<Delivery>,
    private readonly orderStateMachine: OrderStateMachineService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private get sweepIntervalMs(): number {
    return this.configService.get<number>('dispatch.sweepIntervalMs')!;
  }
  private get sweepLockTtlMs(): number {
    return this.configService.get<number>('dispatch.sweepLockTtlMs')!;
  }
  private get sweepBatchLimit(): number {
    return this.configService.get<number>('dispatch.sweepBatchLimit')!;
  }

  /**
   * The periodic trigger for `reassignTimedOutDeliveries()` below — a plain Node `setInterval`,
   * not a new library/dependency (no scheduler/cron/queue package existed anywhere in this
   * codebase — confirmed by inspection before adding this). Never started under `NODE_ENV=test`:
   * every existing dispatch/order e2e and unit test already asserts an ASSIGNED_TO_DRIVER delivery
   * stays exactly as assigned for the whole (sub-30-second) duration of its own test; an
   * autonomous timer firing mid-test would be a real, non-deterministic source of failure
   * unrelated to what each test is actually checking. Tests exercise the reassignment behavior by
   * calling `reassignTimedOutDeliveries()` directly instead — deterministic, no real waiting.
   */
  onModuleInit(): void {
    if (this.configService.get<string>('env') === 'test') {
      return;
    }
    this.sweepTimer = setInterval(() => {
      if (this.shuttingDown) return; // never start new work once shutdown has begun (Dispatch Hardening)
      this.inFlightSweep = this.reassignTimedOutDeliveries().catch((error) => {
        this.logger.error(`Unexpected error during timeout-driven reassignment sweep: ${(error as Error).message}`);
      });
    }, this.sweepIntervalMs);
    this.sweepTimer.unref?.();
  }

  /**
   * Dispatch Hardening milestone: graceful shutdown now (1) stops any FUTURE tick immediately
   * (`clearInterval` + the `shuttingDown` flag, belt-and-suspenders against a tick already queued on
   * the event loop when `clearInterval` runs) and (2) AWAITS whatever sweep is currently in flight,
   * so the module's underlying DB/Redis connections are never torn down out from under an in-progress
   * transaction. Bounded by the same lock TTL the sweep itself is bounded by — a sweep that's
   * somehow still running past its own lock's expiry is, by definition, already past the point where
   * waiting longer helps; shutdown proceeds rather than hanging indefinitely.
   */
  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    if (this.inFlightSweep) {
      // Plain `Promise.race` would leave its losing timer alive (a real, if
      // small, leak — the timeout still fires `sweepLockTtlMs` later even
      // after the in-flight sweep already won the race) — cleared explicitly
      // here instead so shutdown never leaves a dangling handle behind it.
      let timeoutHandle: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise((resolve) => {
        timeoutHandle = setTimeout(resolve, this.sweepLockTtlMs);
      });
      try {
        await Promise.race([this.inFlightSweep, timeoutPromise]);
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
    }
  }

  /**
   * Called once an order becomes fully ready (all segments
   * READY_FOR_PICKUP — see OrderReadinessService). If
   * AUTOMATIC_DISPATCH_ENABLED is false, does nothing at all — the
   * order stays at READY_FOR_PICKUP, available for the manual Admin
   * flow, per the confirmed rule.
   *
   * `excludeDriverIds` (U3): drivers this ONE attempt must not offer the order to — the driver who just handed it back.
   * Applied to the unchanged ranking's output; if it leaves nobody, the existing "no eligible driver" alert is raised.
   */
  async attemptAutomaticDispatch(orderId: string, options: { excludeDriverIds?: string[] } = {}): Promise<void> {
    const isEnabled = await this.businessConfigService.isAutomaticDispatchEnabled();
    if (!isEnabled) {
      return;
    }

    const order = await this.ordersRepository.findOne({ where: { id: orderId }, relations: { segments: true } });
    if (!order) return;
    // A PICKUP order is collected by the customer (PD-006.C): never dispatched, and not a "no eligible driver" situation.
    if (order.fulfillmentType !== FulfillmentType.DELIVERY) return;

    const excluded = new Set(options.excludeDriverIds ?? []);
    const candidateDriverIds = (await this.driverRankingService.rankCandidates(order)).filter((id) => !excluded.has(id));

    if (candidateDriverIds.length === 0) {
      // Ranking itself produced nothing — distinct from
      // DeliveryAssignmentService's own `dispatch.assignment_failed`
      // (which means candidates existed but every one of them was
      // unavailable/lost the lock race); no assignment attempt was
      // even made here.
      logBusinessEvent(this.logger, 'warn', BusinessEvent.DISPATCH_NO_ELIGIBLE_DRIVER, () => this.requestContextService.getCorrelationId(), {
        orderId,
      });
      await this.raiseAlert(orderId);
      return;
    }

    try {
      await this.deliveryAssignmentService.assignDriver({ orderId, candidateDriverIds });
    } catch (error) {
      if (error instanceof OrderNotAssignableException) {
        // The order is no longer waiting for a driver (an admin assigned it, or it was cancelled) — nothing to do, and
        // certainly not a "no eligible driver" alert.
        return;
      }
      if (error instanceof ConflictException) {
        // Every ranked candidate was unavailable by the time the lock
        // was attempted (a real race, not a ranking mistake) — same
        // outcome as "no eligible driver."
        await this.raiseAlert(orderId);
        return;
      }
      throw error;
    }
  }

  /**
   * U3 (approved): a DRIVER handed an assigned order back (ASSIGNED_TO_DRIVER → READY_FOR_PICKUP, already committed).
   * One immediate attempt through the SAME automatic dispatch (ranking, atomic assignment, locks, push, alerts, the
   * AUTOMATIC_DISPATCH_ENABLED switch), never re-offering it to that driver. No delay, no retry loop: if nobody else is
   * eligible the existing NO_ELIGIBLE_DRIVER alert is raised and an admin takes over. An admin who assigned it in the
   * meantime simply wins (the attempt sees ORDER_NOT_ASSIGNABLE and stops). Never fails the driver's own request: the
   * release already happened; an unexpected error is logged, and the order stays visible as "released" in the Control Tower.
   */
  async redispatchAfterDriverRelease(orderId: string, releasingDriverId: string): Promise<void> {
    try {
      await this.attemptAutomaticDispatch(orderId, { excludeDriverIds: [releasingDriverId] });
    } catch (error) {
      this.logger.error(`Redispatch after driver release failed for order ${orderId}: ${(error as Error).message}`);
    }
  }

  /**
   * Timeout-driven reassignment milestone. Finds every Delivery whose `acceptDeadlineAt` has
   * passed while its Order is STILL exactly `ASSIGNED_TO_DRIVER` (an order that already moved on —
   * PICKED_UP, cancelled, reassigned by an Admin, etc. — is never touched: the query itself
   * excludes it, and the per-item re-check below excludes it again under lock), and, for each one:
   * releases the assigned driver via the EXISTING, already-permitted `ASSIGNED_TO_DRIVER →
   * READY_FOR_PICKUP` transition (the same one the driver-reject path and
   * `AdminDispatchService.reassign()` already use — nothing new in `OrderStateMachineService`), then
   * re-ranks and reassigns through the EXISTING `DriverRankingService`/`DeliveryAssignmentService`
   * primitives, exactly as `attemptAutomaticDispatch` above already does. No new order/driver state,
   * no new distance/pricing/ranking value — this method is a new TRIGGER for entirely existing
   * machinery.
   *
   * Deliberately does NOT exclude the just-timed-out driver from the fresh ranking call — that
   * would be inventing a new ranking rule ("never re-offer to the same driver") the approved
   * ranking rules don't have; if that driver is still the only/best eligible candidate (e.g. a
   * solo-driver service area), being offered the same delivery again, with a fresh
   * `acceptDeadlineAt`, is the correct, unmodified behavior of re-running the existing ranking.
   *
   * Batch-limited (`dispatch.sweepBatchLimit`, oldest-expired-first): bounds how long a single
   * sweep — and therefore its Redis lock and its per-item Postgres row locks — can run for. A
   * backlog larger than the batch drains over multiple ticks rather than one unbounded pass;
   * nothing "gets lost," it's just picked up on a later tick, in the same oldest-first order.
   *
   * Idempotent and concurrency-safe: a whole-sweep Redis lock (NX+PX, ownership-token compare-
   * and-delete release — see `acquireSweepLock`/`releaseSweepLock`) means only one sweep ever
   * *actively* runs at a time, and a sweep that outlives its own lock's TTL can never delete a lock
   * a DIFFERENT, legitimately-running sweep already re-acquired. Within a sweep, each candidate
   * Delivery row is pessimistic-locked and its `acceptDeadlineAt` re-verified as still-expired
   * BEFORE anything is released — a delivery an Admin (or a previous/overlapping sweep) already
   * reassigned in the meantime is silently skipped, never double-reassigned. Returned counts are
   * for tests/observability only — no caller currently depends on them.
   */
  async reassignTimedOutDeliveries(): Promise<{ processed: number; reassigned: number; alerted: number; skipped: number }> {
    const result = { processed: 0, reassigned: 0, alerted: 0, skipped: 0 };
    const startedAt = Date.now();

    const isEnabled = await this.businessConfigService.isAutomaticDispatchEnabled();
    if (!isEnabled) {
      return result;
    }

    const lockToken = await this.acquireSweepLock();
    if (!lockToken) {
      // Another sweep (a slow previous tick, or another app instance) is already running, OR Redis
      // itself is unavailable right now — either way, never process the same expired deliveries
      // twice in parallel, and never let a Redis outage crash the caller. Fails closed: existing
      // delivery data is untouched, and the NEXT tick (this instance or another) tries again.
      return result;
    }

    try {
      const expired = await this.deliveriesRepository
        .createQueryBuilder('delivery')
        .innerJoin(Order, 'order', 'order.id = delivery.order_id')
        .where('delivery.accept_deadline_at IS NOT NULL')
        .andWhere('delivery.accept_deadline_at < NOW()')
        .andWhere('order.status = :status', { status: OrderStatus.ASSIGNED_TO_DRIVER })
        .select('delivery.id', 'id')
        .orderBy('delivery.accept_deadline_at', 'ASC')
        .limit(this.sweepBatchLimit)
        .getRawMany<{ id: string }>();

      for (const { id: deliveryId } of expired) {
        result.processed++;
        const released = await this.releaseIfStillExpired(deliveryId);
        if (!released) {
          // Already handled by an Admin, a driver's own action, or a previous tick in the meantime —
          // a benign, expected race outcome (Section 11: "safely treated as no-op"), never an error.
          result.skipped++;
          this.logger.debug(`Skipped delivery ${deliveryId} in timeout sweep: no longer expired/ASSIGNED_TO_DRIVER.`);
          continue;
        }

        logBusinessEvent(this.logger, 'log', BusinessEvent.DISPATCH_DRIVER_TIMEOUT, () => this.requestContextService.getCorrelationId(), {
          orderId: released.orderId,
          deliveryId,
          previousDriverId: released.previousDriverId,
        });

        const order = await this.ordersRepository.findOne({ where: { id: released.orderId }, relations: { segments: true } });
        if (!order) continue; // structurally shouldn't happen (the Order row backing an existing Delivery), never assumed away

        const candidateDriverIds = await this.driverRankingService.rankCandidates(order);
        if (candidateDriverIds.length === 0) {
          logBusinessEvent(this.logger, 'warn', BusinessEvent.DISPATCH_NO_ELIGIBLE_DRIVER, () => this.requestContextService.getCorrelationId(), {
            orderId: released.orderId,
          });
          await this.raiseAlert(released.orderId);
          result.alerted++;
          continue;
        }

        try {
          await this.deliveryAssignmentService.assignDriver({ orderId: released.orderId, candidateDriverIds });
          result.reassigned++;
        } catch (error) {
          if (error instanceof OrderNotAssignableException) {
            // Someone else acted on the released order in the meantime (e.g. an admin assigned it) — a benign race.
            result.skipped++;
            continue;
          }
          if (error instanceof ConflictException) {
            await this.raiseAlert(released.orderId);
            result.alerted++;
            continue;
          }
          throw error;
        }
      }
    } finally {
      await this.releaseSweepLock(lockToken);
    }

    logBusinessEvent(this.logger, 'log', BusinessEvent.DISPATCH_TIMEOUT_SWEEP_COMPLETED, () => this.requestContextService.getCorrelationId(), {
      ...result,
      durationMs: Date.now() - startedAt,
    });

    return result;
  }

  /**
   * NX+PX acquisition with a per-attempt ownership TOKEN as the lock's value (never a fixed `'1'`) —
   * `releaseSweepLock` uses this token to guarantee it only ever deletes a lock IT set. Returns the
   * token on success, `null` on failure to acquire (someone else holds it) OR on a Redis error
   * (logged via the SAME `EXTERNAL_PROVIDER_FAILED` event every other external dependency in this
   * codebase already uses for its own outages — Redis is exactly that here, not a special case).
   */
  private async acquireSweepLock(): Promise<string | null> {
    const token = randomUUID();
    try {
      const acquired = await this.redis.set(AutomaticDispatchService.SWEEP_LOCK_KEY, token, 'PX', this.sweepLockTtlMs, 'NX');
      return acquired === 'OK' ? token : null;
    } catch (error) {
      logBusinessEvent(this.logger, 'error', BusinessEvent.EXTERNAL_PROVIDER_FAILED, () => this.requestContextService.getCorrelationId(), {
        provider: 'redis',
        operation: 'dispatch_timeout_sweep_lock_acquire',
        reason: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Compare-and-delete: only removes the lock key if its current value is STILL this exact token —
   * i.e. only if this call is the one that actually set it, and nothing (a TTL expiry followed by
   * another instance's successful re-acquisition) has replaced it since. This is the fix for a real,
   * proven bug an earlier, simpler `DEL` unconditionally would have: if THIS sweep somehow runs
   * longer than `sweepLockTtlMs` (a large batch, a slow database), the lock can expire while it is
   * still working; a SECOND instance's next tick then legitimately acquires the (now-free) lock and
   * starts its own sweep — a blind `DEL` from the FIRST (stale) sweep's `finally` block would delete
   * the SECOND sweep's still-active lock, opening the door to a THIRD tick starting concurrently
   * with the second. The Lua script makes the read-compare-delete atomic (Redis executes it as one
   * operation) — a plain JS `GET` then `DEL` would itself race against another client between the
   * two calls.
   *
   * Never throws: a failed release (Redis down, or the CAS legitimately not matching) is logged and
   * swallowed — the lock's own TTL guarantees it is freed eventually regardless (Section 11: a
   * degraded-but-recoverable condition must not be surfaced as a hard failure of an otherwise-
   * successful sweep).
   */
  private async releaseSweepLock(token: string): Promise<void> {
    const releaseScript = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    try {
      const deleted = await this.redis.eval(releaseScript, 1, AutomaticDispatchService.SWEEP_LOCK_KEY, token);
      if (deleted === 0) {
        this.logger.warn('Timeout sweep lock had already expired/been reclaimed by another sweep before release — no action taken (safe).');
      }
    } catch (error) {
      logBusinessEvent(this.logger, 'error', BusinessEvent.EXTERNAL_PROVIDER_FAILED, () => this.requestContextService.getCorrelationId(), {
        provider: 'redis',
        operation: 'dispatch_timeout_sweep_lock_release',
        reason: (error as Error).message,
      });
    }
  }

  /**
   * Locks the Order, THEN the Delivery row (in that order — see below), re-verifies under those
   * locks that the delivery is STILL expired (nobody else refreshed/handled it since the outer query
   * ran), and — only if so — releases it via the existing state-machine transition, in the SAME
   * transaction as the locks. Returns `null` when there was nothing to do (already handled), so the
   * caller treats it as a no-op rather than an error — the same "benign, expected replay" discipline
   * this codebase already applies to other idempotent operations (e.g. `FinancialEventService`'s
   * duplicate-key path).
   *
   * Dispatch Hardening milestone fix (lock ordering, Section 4): this method used to lock the
   * Delivery row FIRST and only reach the Order lock afterward (inside `transitionInTransaction`).
   * `DriverOrderActionsService.updateStatus()`'s own path (`OrderStateMachineService.applyTransition`)
   * locks the Order row FIRST and only touches Delivery afterward (setting `pickedUpAt`/`deliveredAt`)
   * — the exact OPPOSITE order. Two transactions locking the same two rows in reverse order is a
   * textbook Postgres deadlock, genuinely reproduced under true concurrency (a driver progressing
   * their own delivery at the same moment this sweep processes it — see this class's own e2e test).
   * This codebase's own established discipline for exactly this situation is consistent lock
   * ORDERING, never a generic retry-on-deadlock wrapper (see e.g.
   * `customer-order-cancellation.service.ts`'s own comment on why it locks order before payment) — so
   * the fix here is the same: always Order before Delivery, matching every other concurrent path.
   */
  private async releaseIfStillExpired(deliveryId: string): Promise<{ orderId: string; previousDriverId: string | null } | null> {
    const outcome = await this.deliveriesRepository.manager.transaction(async (manager) => {
      // An UNLOCKED peek just to learn which Order this Delivery belongs to (a Delivery id alone
      // doesn't say) — never itself a source of stale data, since the fields that actually matter
      // (current order status, current deadline) are re-verified below UNDER the real locks, in the
      // same Order-then-Delivery order every other concurrent path in this codebase already uses.
      const deliveryPeek = await manager.findOne(Delivery, { where: { id: deliveryId } });
      if (!deliveryPeek) return null;

      const order = await manager.findOne(Order, { where: { id: deliveryPeek.orderId }, lock: { mode: 'pessimistic_write' } });
      if (!order || order.status !== OrderStatus.ASSIGNED_TO_DRIVER) {
        return null; // already progressed/released by someone else since the outer query ran
      }

      const delivery = await manager.findOne(Delivery, { where: { id: deliveryId }, lock: { mode: 'pessimistic_write' } });
      if (!delivery || !delivery.acceptDeadlineAt || delivery.acceptDeadlineAt.getTime() > Date.now()) {
        return null; // already refreshed (reassigned) since the outer query ran, or somehow cleared — nothing to release
      }

      try {
        const { afterCommit } = await this.orderStateMachine.transitionInTransaction(manager, {
          orderId: delivery.orderId,
          to: OrderStatus.READY_FOR_PICKUP,
          actorRole: Role.ADMIN, // system-initiated release, same convention already used for READY_FOR_PICKUP→ASSIGNED_TO_DRIVER
        });
        return { orderId: delivery.orderId, previousDriverId: delivery.driverId ?? null, afterCommit };
      } catch (error) {
        if (error instanceof BadRequestException) {
          // The order already left ASSIGNED_TO_DRIVER (picked up, cancelled, or already released by
          // someone else) between the outer query and this lock — never reassign an order that has
          // already progressed. A benign, expected race outcome, not an error.
          return null;
        }
        throw error;
      }
    });

    if (!outcome) return null;

    // Per `transitionInTransaction`'s own contract: only call `afterCommit()` once this transaction
    // has actually committed (guaranteed here — we're past the `await ... .transaction(...)` call).
    // For THIS transition (ASSIGNED_TO_DRIVER→READY_FOR_PICKUP) it is a documented no-op today —
    // `OrderFinancialEventsService.handleTransition` has no case for it and
    // `OrderStateMachineService`'s own push-notification switch explicitly lists this exact
    // transition as one that "intentionally sends nothing" — but calling it keeps this path
    // byte-for-byte consistent with `AdminDispatchService.reassign()`, which uses the plain
    // `transition()` (= `applyTransition` + `runAfterCommit` together) for the identical
    // transition, rather than silently diverging from it.
    await outcome.afterCommit();
    return { orderId: outcome.orderId, previousDriverId: outcome.previousDriverId };
  }

  private async raiseAlert(orderId: string): Promise<void> {
    await this.dispatchAlertsRepository.save(
      this.dispatchAlertsRepository.create({ orderId, reason: 'NO_ELIGIBLE_DRIVER' }),
    );
  }
}

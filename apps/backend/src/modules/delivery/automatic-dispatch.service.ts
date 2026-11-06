import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { StaffAlertsService } from '../notifications/staff-alerts.service';
import { Permission } from '../permissions/permission.enum';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { IsNull, Repository } from 'typeorm';
import { Order } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/order-status.enum';
import { Role } from '../../common/enums/role.enum';
import { Delivery } from './entities/delivery.entity';
import { DispatchAlert, DispatchAlertReason } from './entities/dispatch-alert.entity';
import { DispatchAttempt, DispatchAttemptOutcome } from './entities/dispatch-attempt.entity';
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

  /** A still-open automatic-dispatch alert is retried at most this often (no retry storm; the sweep tick may be much faster). */
  static readonly ALERT_RETRY_INTERVAL_MS = 60_000;

  /** Same NX+PX mutual-exclusion pattern DeliveryAssignmentService already uses for per-driver locks — here it serializes the WHOLE sweep, so an overlapping tick (a slow previous run, or more than one app instance) can never process the same expired delivery twice. */
  private static readonly SWEEP_LOCK_KEY = 'dispatch-timeout-sweep-lock';

  private sweepTimer?: NodeJS.Timeout;
  /** Tracks the currently-running sweep (if any) so `onModuleDestroy` can wait for it instead of abandoning it mid-transaction. */
  private inFlightSweep?: Promise<unknown>;
  private shuttingDown = false;

  constructor(
    @InjectRepository(Order) private readonly ordersRepository: Repository<Order>,
    @InjectRepository(DispatchAlert) private readonly dispatchAlertsRepository: Repository<DispatchAlert>,
    @InjectRepository(DispatchAttempt) private readonly dispatchAttemptsRepository: Repository<DispatchAttempt>,
    private readonly driverRankingService: DriverRankingService,
    private readonly deliveryAssignmentService: DeliveryAssignmentService,
    private readonly businessConfigService: BusinessConfigService,
    private readonly requestContextService: RequestContextService,
    @InjectRepository(Delivery) private readonly deliveriesRepository: Repository<Delivery>,
    private readonly orderStateMachine: OrderStateMachineService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    // Staff inbox (Operations notification centre). Optional so unit tests that build this service by hand keep working unchanged.
    @Optional() private readonly staffAlerts?: StaffAlertsService,
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
      this.inFlightSweep = this.alertUnacknowledgedAssignments()
        .then(() => this.retryOpenAlerts())
        .catch((error) => {
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
    const order = await this.ordersRepository.findOne({ where: { id: orderId }, relations: { segments: true } });
    if (!order) return;
    // A PICKUP order is collected by the customer (PD-006.C): never dispatched, and not a "no eligible driver" situation.
    if (order.fulfillmentType !== FulfillmentType.DELIVERY) return;
    // Only an order that is actually waiting for a driver is dispatchable (cancelled / already assigned: nothing to do, no alert).
    if (order.status !== OrderStatus.READY_FOR_PICKUP) return;

    if (!isEnabled) {
      // Never silent: the order waits for the manual fallback and operations are told so (resolved once a driver is assigned).
      await this.recordAttempt(orderId, 'AUTO_ASSIGN_DISABLED', null, 'Automatic assignment is switched off.');
      await this.raiseAlert(orderId, 'AUTO_ASSIGN_DISABLED', 'Automatic assignment is switched off — assign a driver manually.');
      return;
    }
    // Automatic assignment is on: an earlier "switched off" alert no longer describes the situation.
    await this.resolveAlerts(orderId, ['AUTO_ASSIGN_DISABLED']);

    try {
      const excluded = new Set(options.excludeDriverIds ?? []);
      const candidateDriverIds = (await this.driverRankingService.rankCandidates(order)).filter((id) => !excluded.has(id));

      if (candidateDriverIds.length === 0) {
        // Ranking itself produced nothing — distinct from DeliveryAssignmentService's own `dispatch.assignment_failed` (candidates existed
        // but every one of them was unavailable/lost the lock race); no assignment attempt was even made here.
        logBusinessEvent(this.logger, 'warn', BusinessEvent.DISPATCH_NO_ELIGIBLE_DRIVER, () => this.requestContextService.getCorrelationId(), {
          orderId,
        });
        await this.recordAttempt(orderId, 'NO_ELIGIBLE_DRIVER', null, 'No online, available driver could be ranked for this order.');
        await this.raiseAlert(orderId, 'NO_ELIGIBLE_DRIVER', 'No eligible driver is online and available.');
        return;
      }

      const delivery = await this.deliveryAssignmentService.assignDriver({ orderId, candidateDriverIds });
      await this.recordAttempt(orderId, 'ASSIGNED', delivery.driverId ?? null, null);
    } catch (error) {
      if (error instanceof OrderNotAssignableException) {
        // The order is no longer waiting for a driver (an admin assigned it, or it was cancelled) — nothing to do, and
        // certainly not a "no eligible driver" alert.
        return;
      }
      if (error instanceof ConflictException) {
        // Every ranked candidate was unavailable by the time the lock was attempted (a real race, not a ranking mistake) — same
        // outcome as "no eligible driver."
        await this.recordAttempt(orderId, 'NO_ELIGIBLE_DRIVER', null, 'Every ranked driver became unavailable before the assignment.');
        await this.raiseAlert(orderId, 'NO_ELIGIBLE_DRIVER', 'Every ranked driver became unavailable before the assignment.');
        return;
      }
      // Anything else is an infrastructure/programming failure: never swallowed silently and never allowed to fail the caller (the
      // business transition that led here has already committed) — it is logged, persisted and raised to operations.
      await this.recordAssignmentError(orderId, error);
    }
  }

  /** Persists an unexpected dispatch failure: log (with the error), an attempt row, and ONE open ASSIGNMENT_ERROR alert. Never throws. */
  async recordAssignmentError(orderId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`Automatic dispatch failed for order ${orderId}: ${message}`);
    try {
      await this.recordAttempt(orderId, 'ASSIGNMENT_ERROR', null, message);
      await this.raiseAlert(orderId, 'ASSIGNMENT_ERROR', `Automatic assignment failed: ${message}`.slice(0, 480));
    } catch (inner) {
      this.logger.error(`Could not persist the dispatch failure of order ${orderId}: ${inner instanceof Error ? inner.message : String(inner)}`);
    }
  }

  /**
   * Bounded retry of automatic dispatch for orders that still carry an open NO_ELIGIBLE_DRIVER / ASSIGNMENT_ERROR /
   * AUTO_ASSIGN_DISABLED alert: a driver may have come online, a transient error may have passed, or automatic assignment may have
   * been switched back on. At most once per alert per ALERT_RETRY_INTERVAL_MS, a limited batch per tick; DRIVER_NOT_RESPONDING alerts are
   * NEVER retried automatically (an unresponsive driver needs a person). A successful assignment resolves the alert.
   */
  async retryOpenAlerts(): Promise<{ retried: number }> {
    if (!(await this.businessConfigService.isAutomaticDispatchEnabled())) return { retried: 0 };
    const cutoff = new Date(Date.now() - AutomaticDispatchService.ALERT_RETRY_INTERVAL_MS);
    const alerts = await this.dispatchAlertsRepository
      .createQueryBuilder('alert')
      .where('alert.resolved_at IS NULL')
      .andWhere('alert.deleted_at IS NULL')
      .andWhere('alert.reason IN (:...reasons)', { reasons: ['NO_ELIGIBLE_DRIVER', 'ASSIGNMENT_ERROR', 'AUTO_ASSIGN_DISABLED'] })
      .andWhere('alert.updated_at < :cutoff', { cutoff })
      .orderBy('alert.updated_at', 'ASC')
      .limit(this.sweepBatchLimit)
      .getMany();
    let retried = 0;
    for (const alert of alerts) {
      // Touch first so a slow or failing attempt cannot be retried again before the interval has passed.
      await this.dispatchAlertsRepository.update({ id: alert.id }, { updatedAt: new Date() });
      await this.attemptAutomaticDispatch(alert.orderId);
      retried++;
    }
    return { retried };
  }

  /**
   * R16 (decision register 2026-11-06) — replaces the former 30-second timeout-driven reassignment. Drivers acknowledge an
   * assignment (manual OR automatic, so this runs whatever AUTOMATIC_DISPATCH_ENABLED says); when the acknowledge-by time
   * (`acceptDeadlineAt`, default 5 minutes after assignment, BusinessConfig DISPATCH_ACKNOWLEDGEMENT_WINDOW_MINUTES) passes with
   * no acknowledgement, Operations get ONE ACKNOWLEDGEMENT_OVERDUE alert per assignment. Nothing is released, re-ranked or
   * reassigned: only Operations release and reassign (R17). Toggling the dispatch mode therefore never touches an assignment (R13).
   *
   * Same whole-sweep Redis lock as before (one sweep at a time across instances; a Redis outage skips the tick). Idempotent:
   * an assignment that already produced an acknowledgement alert (open or since resolved) is never alerted again, so an
   * admin closing the alert does not bring it back every tick. Batch-limited, oldest deadline first, index-backed.
   */
  async alertUnacknowledgedAssignments(): Promise<{ processed: number; alerted: number }> {
    const result = { processed: 0, alerted: 0 };
    const lockToken = await this.acquireSweepLock();
    if (!lockToken) return result;
    try {
      const overdue = await this.deliveriesRepository
        .createQueryBuilder('delivery')
        .innerJoin(Order, 'order', 'order.id = delivery.order_id')
        .where('delivery.accept_deadline_at IS NOT NULL')
        .andWhere('delivery.accept_deadline_at < NOW()')
        .andWhere('delivery.acknowledged_at IS NULL')
        .andWhere('order.status = :status', { status: OrderStatus.ASSIGNED_TO_DRIVER })
        .andWhere(
          `NOT EXISTS (SELECT 1 FROM dispatch_alerts a WHERE a.order_id = delivery.order_id AND a.reason = 'ACKNOWLEDGEMENT_OVERDUE'
             AND a.deleted_at IS NULL AND (a.resolved_at IS NULL OR a.created_at >= delivery.assigned_at))`,
        )
        .select('delivery.order_id', 'orderId')
        .addSelect('delivery.driver_id', 'driverId')
        .orderBy('delivery.accept_deadline_at', 'ASC')
        .limit(this.sweepBatchLimit)
        .getRawMany<{ orderId: string; driverId: string | null }>();
      for (const row of overdue) {
        result.processed++;
        await this.recordAttempt(row.orderId, 'ACKNOWLEDGEMENT_OVERDUE', row.driverId, 'The assigned driver did not acknowledge in time.');
        await this.raiseAlert(
          row.orderId,
          'ACKNOWLEDGEMENT_OVERDUE',
          'The assigned driver has not acknowledged this order. Contact the driver; release or reassign it if needed.',
        );
        result.alerted++;
      }
    } finally {
      await this.releaseSweepLock(lockToken);
    }
    if (result.processed > 0) {
      logBusinessEvent(this.logger, 'log', BusinessEvent.DISPATCH_TIMEOUT_SWEEP_COMPLETED, () => this.requestContextService.getCorrelationId(), { ...result });
    }
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

  /** ONE open alert per (order, reason): repeating the same situation refreshes it instead of stacking duplicates. */
  private async raiseAlert(orderId: string, reason: DispatchAlertReason, detail: string): Promise<void> {
    const open = await this.dispatchAlertsRepository.findOne({ where: { orderId, reason, resolvedAt: IsNull() } });
    if (open) {
      await this.dispatchAlertsRepository.update({ id: open.id }, { detail, updatedAt: new Date() });
      return;
    }
    let created: DispatchAlert;
    try {
      created = await this.dispatchAlertsRepository.save(this.dispatchAlertsRepository.create({ orderId, reason, detail }));
    } catch (error) {
      // A concurrent attempt created the same open alert first (partial unique index) — exactly what we wanted.
      if ((error as { code?: string }).code !== '23505') throw error;
      return;
    }
    // Only a NEW open alert tells Operations (a refreshed one already did); never fails the dispatch path.
    if (this.staffAlerts) {
      const manager = this.dispatchAlertsRepository.manager;
      const [order] = await manager.query(`SELECT order_number FROM orders WHERE id = $1`, [orderId]);
      if (order) {
        await this.staffAlerts.alert(manager, {
          eventKey: `dispatch-alert:${created.id}`, category: 'OPS_DISPATCH_NEEDED', requiredAction: 'ASSIGN_DRIVER', note: reason,
          recipients: await this.staffAlerts.recipientsHolding(manager, [Permission.ASSIGN_REASSIGN_ORDERS, Permission.OVERRIDE_DISPATCH]),
          orderId, orderNumber: order.order_number,
        });
      }
    }
  }

  private async resolveAlerts(orderId: string, reasons: DispatchAlertReason[]): Promise<void> {
    await this.dispatchAlertsRepository
      .createQueryBuilder()
      .update(DispatchAlert)
      .set({ resolvedAt: () => 'now()' })
      .where('order_id = :orderId AND resolved_at IS NULL AND reason IN (:...reasons)', { orderId, reasons })
      .execute();
  }

  private async recordAttempt(orderId: string, outcome: DispatchAttemptOutcome, driverId: string | null, detail: string | null): Promise<void> {
    await this.dispatchAttemptsRepository.insert({ orderId, outcome, driverId, detail: detail ? detail.slice(0, 500) : null });
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { FinancialEvent } from './entities/financial-event.entity';
import { FinancialEventDirection, FinancialEventType } from './financial-event-type.enum';
import { RequestContextService } from '../../common/request-context/request-context.service';
import { logBusinessEvent } from '../../common/logging/log-business-event';
import { BusinessEvent } from '../../common/logging/business-events';

export interface RecordFinancialEventParams {
  type: FinancialEventType;
  direction: FinancialEventDirection;
  idempotencyKey: string;
  amountMinor?: number | null;
  orderId?: string | null;
  orderVendorSegmentId?: string | null;
  deliveryId?: string | null;
  paymentId?: string | null;
  vendorBranchId?: string | null;
  driverId?: string | null;
  rateSnapshot?: unknown | null;
  relatedEventId?: string | null;
  actorUserId?: string | null;
  reason?: string | null;
}

/**
 * The ONLY writer of FinancialEvent rows in this codebase — no other
 * service should ever call `financialEventsRepository.save()`
 * directly, so that "append-only, never updated" is enforced at one
 * chokepoint, not by convention scattered across callers.
 *
 * Idempotent by construction: `record()` checks for an existing row
 * with the same `idempotencyKey` first, and falls back to the same
 * check on a unique-constraint violation (a concurrent double-call
 * racing the same event) — mirrors PermissionsService.grant()'s exact
 * pattern for the same reason (never error on "this already happened,"
 * just return the existing fact).
 */
@Injectable()
export class FinancialEventService {
  private readonly logger = new Logger(FinancialEventService.name);

  constructor(
    @InjectRepository(FinancialEvent) private readonly financialEventsRepository: Repository<FinancialEvent>,
    private readonly requestContextService: RequestContextService,
  ) {}

  /**
   * Transaction-Compatible Financial Event Recording (Chunk B1).
   * `manager` is optional and purely additive — CONFIRMED, every
   * existing caller (none of which pass a second argument) compiles
   * and behaves EXACTLY as before, since `manager` defaults to
   * `undefined` and the code below falls back to the original
   * injected repository in that case. When provided, the write goes
   * through `manager.getRepository(FinancialEvent)` instead — the
   * SAME repository API, just sourced from the caller's own active
   * transaction rather than this service's own connection — so this
   * call can finally participate in another service's transaction
   * (e.g. an Order cancellation) instead of always committing
   * independently. No second transaction is ever opened here in
   * either case. Every existing behavior is otherwise byte-for-byte
   * unchanged: same idempotency check-then-race-fallback shape, same
   * fields, same validation, same event semantics.
   */
  async record(params: RecordFinancialEventParams, manager?: EntityManager): Promise<FinancialEvent> {
    const repo = manager ? manager.getRepository(FinancialEvent) : this.financialEventsRepository;

    const existing = await repo.findOne({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existing) {
      // Reflects an already-durable prior fact (a row that already
      // exists), never new pending state — safe to log regardless of
      // whether THIS call is itself joining a caller's still-open
      // transaction.
      this.logDuplicate(existing, params);
      return existing;
    }

    try {
      const saved = await repo.save(repo.create(params));
      // Business-event log (Group 4). Only when this call is its OWN
      // committed unit of work (`manager` undefined) — when `manager`
      // is provided, this write is participating in a caller-owned
      // transaction that has NOT committed yet at this point, so
      // logging "recorded" here could describe state that is later
      // rolled back. Callers that pass `manager` (e.g. a Manual
      // Transfer refund recorded during order cancellation) are
      // themselves the transaction owner and are responsible for their
      // own post-commit business-event log — see that call site's own
      // comment for why this specific case is a documented, deliberate
      // gap rather than a duplicate log.
      if (!manager) {
        logBusinessEvent(this.logger, 'log', BusinessEvent.FINANCIAL_EVENT_RECORDED, () => this.requestContextService.getCorrelationId(), {
          financialEventId: saved.id,
          type: saved.type,
          direction: saved.direction,
          amountMinor: saved.amountMinor ?? null,
          orderId: saved.orderId ?? null,
          orderVendorSegmentId: saved.orderVendorSegmentId ?? null,
          deliveryId: saved.deliveryId ?? null,
          paymentId: saved.paymentId ?? null,
          vendorBranchId: saved.vendorBranchId ?? null,
          driverId: saved.driverId ?? null,
        });
      }
      return saved;
    } catch (error) {
      // Inside a CALLER-OWNED transaction any failed statement aborts it: PostgreSQL then answers every
      // further query with "current transaction is aborted, commands ignored until end of transaction
      // block", so the race re-check below would throw that instead of — and hide — the real cause
      // (found by the Group 8 failure-injection journeys). Surface the original error; the caller's
      // transaction rolls back and a retry is idempotent via the pre-check above.
      if (manager) throw error;
      const existingAfterRace = await repo.findOne({
        where: { idempotencyKey: params.idempotencyKey },
      });
      if (existingAfterRace) {
        this.logDuplicate(existingAfterRace, params);
        return existingAfterRace;
      }
      throw error;
    }
  }

  private logDuplicate(existing: FinancialEvent, params: RecordFinancialEventParams): void {
    logBusinessEvent(this.logger, 'warn', BusinessEvent.FINANCIAL_EVENT_DUPLICATE, () => this.requestContextService.getCorrelationId(), {
      financialEventId: existing.id,
      type: params.type,
      idempotencyKey: params.idempotencyKey,
      orderId: params.orderId ?? null,
      paymentId: params.paymentId ?? null,
    });
  }

  /**
   * PD-015 - the Hatly-funded promotional cost of an order, NET of what was restored by rejections/cancellations:
   * recorded (the original, immutable event) - restored (the compensating events). Both are INFORMATIONAL facts; this is the only
   * place a report should read the cost from, so a restored discount is never counted as still funded and never subtracted twice.
   */
  async hatlyFundedDiscountSummary(orderId: string, manager?: EntityManager): Promise<{ recordedMinor: number; restoredMinor: number; netMinor: number }> {
    const repo = manager ? manager.getRepository(FinancialEvent) : this.financialEventsRepository;
    const rows: Array<{ type: string; total: string | null }> = await repo
      .createQueryBuilder('e')
      .select('e.type', 'type')
      .addSelect('COALESCE(SUM(e.amount_minor), 0)', 'total')
      .where('e.order_id = :orderId', { orderId })
      .andWhere('e.type IN (:...types)', {
        types: [FinancialEventType.HATLY_FUNDED_OFFER_DISCOUNT_RECORDED, FinancialEventType.HATLY_FUNDED_OFFER_DISCOUNT_RESTORED],
      })
      .groupBy('e.type')
      .getRawMany();
    const sum = (type: FinancialEventType) => Number(rows.find((r) => r.type === type)?.total ?? 0);
    const recordedMinor = sum(FinancialEventType.HATLY_FUNDED_OFFER_DISCOUNT_RECORDED);
    const restoredMinor = sum(FinancialEventType.HATLY_FUNDED_OFFER_DISCOUNT_RESTORED);
    return { recordedMinor, restoredMinor, netMinor: recordedMinor - restoredMinor };
  }

  async findByOrderId(orderId: string): Promise<FinancialEvent[]> {
    return this.financialEventsRepository.find({ where: { orderId }, order: { createdAt: 'ASC' } });
  }
}

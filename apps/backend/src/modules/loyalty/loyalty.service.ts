import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { LoyaltyPointsTransaction } from './entities/loyalty-points-transaction.entity';
import { LoyaltyTransactionType } from './loyalty-transaction-type.enum';
import { Order } from '../orders/entities/order.entity';
import { OrderVendorSegment } from '../orders/entities/order-vendor-segment.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { OrderVendorSegmentStatus } from '../orders/order-vendor-segment-status.enum';
import { CartGroupType } from '../cart/cart-group-type.enum';
import { PricingUnit } from '../products/pricing-unit.enum';
import { BusinessConfigService } from '../business-config/business-config.service';
import { User } from '../users/entities/user.entity';
import { WalletService } from '../wallet/wallet.service';
import { WalletTransactionType } from '../wallet/wallet-transaction-type.enum';
import { RequestContextService } from '../../common/request-context/request-context.service';
import { logBusinessEvent } from '../../common/logging/log-business-event';
import { BusinessEvent } from '../../common/logging/business-events';

// Loyalty Balance/History (consolidated customer-commerce milestone). Same contract as
// WalletService.listTransactionsForCustomer/CustomerOrdersService.listForCustomer — no new
// pagination shape invented.
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/**
 * Loyalty Ledger Foundation (Chunk A). CONFIRMED scope: this service
 * only creates ledger rows and derives a balance from them — it
 * contains NO earning rule, NO Points->Wallet conversion, NO Admin-
 * facing endpoint, NO Order-DELIVERED hook. Those are explicitly
 * deferred to later chunks, per the approved design.
 *
 * There is no update/delete method here, deliberately — that absence
 * IS the append-only guarantee at the service layer (mirrors
 * EmployeeLoan/OfferConsumption's own "no mutation method exists"
 * discipline exactly). A correction is always a new, separate
 * `recordTransaction` call with an opposite-signed delta and a
 * different type (e.g. EARNING_REVERSED), never an update to an
 * existing row.
 */
@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger(LoyaltyService.name);

  constructor(
    @InjectRepository(LoyaltyPointsTransaction)
    private readonly loyaltyTransactionsRepository: Repository<LoyaltyPointsTransaction>,
    private readonly businessConfigService: BusinessConfigService,
    private readonly dataSource: DataSource,
    private readonly walletService: WalletService,
    private readonly requestContextService: RequestContextService,
  ) {}

  /**
   * Appends one immutable ledger row. `manager`, when provided, lets a
   * future caller (e.g. the eventual DELIVERED-earning hook, or a
   * Points->Wallet conversion needing both ledgers updated atomically)
   * compose this write into its own transaction — same optional-
   * manager pattern already established by
   * `ProductsService.adminUpdateProduct` for exactly this reason.
   * Falls back to the injected repository (its own implicit
   * transaction) when omitted, which is the only way Chunk A itself
   * ever calls this (nothing transactional exists yet to compose with).
   */
  async recordTransaction(
    params: {
      customerId: string;
      pointsDelta: number;
      type: LoyaltyTransactionType;
      orderId?: string | null;
      reason?: string | null;
      createdByUserId?: string | null;
      idempotencyKey?: string | null;
    },
    manager?: EntityManager,
  ): Promise<LoyaltyPointsTransaction> {
    if (params.pointsDelta === 0) {
      throw new BadRequestException({
        message: 'A loyalty transaction must have a non-zero pointsDelta.',
        details: { code: 'INVALID_POINTS_DELTA' },
      });
    }
    if (params.type === LoyaltyTransactionType.ADMIN_ADJUSTMENT && !params.reason) {
      throw new BadRequestException({
        message: 'A reason is required for an Admin loyalty adjustment.',
        details: { code: 'ADMIN_ADJUSTMENT_REASON_REQUIRED' },
      });
    }

    const repo = manager ? manager.getRepository(LoyaltyPointsTransaction) : this.loyaltyTransactionsRepository;
    return repo.save(
      repo.create({
        customerId: params.customerId,
        pointsDelta: params.pointsDelta,
        type: params.type,
        orderId: params.orderId ?? null,
        reason: params.reason ?? null,
        createdByUserId: params.createdByUserId ?? null,
        idempotencyKey: params.idempotencyKey ?? null,
      }),
    );
  }

  /**
   * A customer's current points balance, ALWAYS derived from the
   * ledger — never a stored field. Mirrors
   * `EmployeeLoanService.getStatus()`'s own JS-side reduce exactly
   * (rather than a raw SQL SUM aggregate), which is what makes this
   * safe against the bigint-as-string risk a raw SUM over a bigint
   * column could otherwise carry in this codebase (no global pg type
   * parser is configured — confirmed by inspection) — moot here in
   * practice since `points_delta` is `int`, but kept consistent with
   * the established pattern regardless.
   *
   * A customer with no transactions correctly returns 0 — confirmed,
   * `reduce` over an empty array with the `0` seed does exactly that,
   * no special-case branch needed.
   */
  async getBalance(customerId: string): Promise<number> {
    const transactions = await this.loyaltyTransactionsRepository.find({ where: { customerId } });
    return transactions.reduce((sum, t) => sum + t.pointsDelta, 0);
  }

  /**
   * Loyalty Balance/History (consolidated customer-commerce
   * milestone) — paginated ledger history for the customer's own
   * `LoyaltyController`. Mirrors `WalletService.
   * listTransactionsForCustomer` exactly (same DEFAULT_PAGE/
   * DEFAULT_LIMIT/MAX_LIMIT, same `findAndCount` + newest-first
   * ordering, same `{data, page, limit, total}` shape) — no second
   * pagination convention invented.
   */
  async listTransactionsForCustomer(
    customerId: string,
    params: { page?: number; limit?: number },
  ): Promise<{ data: LoyaltyPointsTransaction[]; page: number; limit: number; total: number }> {
    const page = params.page && params.page > 0 ? params.page : DEFAULT_PAGE;
    const limit = params.limit && params.limit > 0 ? Math.min(params.limit, MAX_LIMIT) : DEFAULT_LIMIT;

    const [data, total] = await this.loyaltyTransactionsRepository.findAndCount({
      where: { customerId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, page, limit, total };
  }

  /**
   * Loyalty Earning (Chunk C). Called from
   * OrderStateMachineService.transition() INSIDE the SAME locked
   * transaction as the DELIVERED status update itself — CONFIRMED,
   * unlike BestSellingCacheService/OrderFinancialEventsService's own
   * "outside the transaction, logged not re-thrown" convention. This
   * is a deliberate, considered difference: those two are derived
   * caches/analytics that must never block a driver's DELIVERED
   * action; Loyalty earning is itself a real financial ledger write,
   * so it must either commit together with the delivery or not exist
   * at all — never a half-completed state where the order is
   * DELIVERED but earning silently failed, and never a loyalty
   * transaction for an order that didn't actually complete the
   * transition.
   *
   * ELIGIBLE SPENDING (CONFIRMED, historical-snapshot-only, per the
   * approved rule):
   *   - Only CATALOG segments contribute — AD_HOC_SERVICE segments
   *     (Hatly Service / custom errands) are excluded ENTIRELY in
   *     this chunk, not merely their fee portion. This is a
   *     deliberately conservative simplification: this codebase has
   *     no clean, already-existing way to separate "real product
   *     value the errand purchased" from "the service fee for
   *     performing it" within one AD_HOC_SERVICE segment, and
   *     guessing at a split risks awarding points on a fee, which the
   *     approved rule explicitly forbids. Excluding the whole segment
   *     never over-awards; it may under-award the rare ad-hoc-
   *     purchase-with-real-product-value case, which is disclosed
   *     here rather than silently assumed away.
   *   - Cancelled segments are excluded (their items were never
   *     actually fulfilled).
   *   - Per CATALOG item: WEIGHT items use `finalAmountMinor ??
   *     estimatedAmountMinor` directly (the already-existing final
   *     eligible order value for that item — WEIGHT items are never
   *     Offer-eligible per the existing Offers rule, so no discount
   *     subtraction applies to them). Non-WEIGHT items use
   *     `unitPriceMinor * quantity - (offerDiscountAmountMinor ?? 0)`
   *     — the FLASH_SALE-adjusted payable amount when a Flash Sale
   *     applied (offerDiscountAmountMinor already equals
   *     discountedQuantity * (unitPrice - specialPrice), so
   *     subtracting it correctly nets down to exactly the Flash Sale
   *     final selling price for the discounted units and the normal
   *     price for the rest).
   *   - Per segment: sum of its items' amounts, then subtract
   *     `segment.offerDiscountAmountMinor ?? 0` (the SUBTOTAL_DISCOUNT
   *     amount, which applies once per segment, never per item).
   *   - Total eligible spending = sum across all included segments.
   *     Delivery fee, additional-vendor fee, and Hatly Service fee
   *     never enter this calculation at all (none of them live on
   *     OrderItem/OrderVendorSegment — they live on Order itself,
   *     which this method never reads for the eligible-amount
   *     calculation).
   *
   * POINTS CALCULATION: `Math.floor((eligibleMinor / 100) *
   * pointsPerEgp)` — integer EGP truncation before applying the
   * rate, exactly matching the approved example (12550 minor = 125.50
   * EGP -> 125 points, the 0.50 EGP producing no partial point).
   *
   * If the resulting points are 0, no transaction is created at all
   * (the ledger already rejects zero-delta rows; this method simply
   * never attempts one).
   *
   * DUPLICATE PROTECTION: relies on the partial unique index on
   * `(order_id) WHERE type = 'EARNING'` (see the Chunk C migration) —
   * a retried/concurrent call for the same order hits that DB
   * constraint. Postgres reports this as error code `23505`; that
   * specific case is caught and swallowed here (a benign "already
   * earned," not a real failure) — anything else propagates
   * unchanged.
   */
  async awardOrderEarning(manager: EntityManager, orderId: string): Promise<void> {
    const order = await manager.findOne(Order, { where: { id: orderId } });
    if (!order) return;

    const segments = await manager.find(OrderVendorSegment, { where: { orderId } });
    const eligibleSegments = segments.filter(
      (s) => s.groupType === CartGroupType.CATALOG && s.status !== OrderVendorSegmentStatus.CANCELLED,
    );
    if (eligibleSegments.length === 0) return;

    const segmentIds = eligibleSegments.map((s) => s.id);
    const items = await manager
      .createQueryBuilder(OrderItem, 'item')
      .where('item.order_vendor_segment_id IN (:...segmentIds)', { segmentIds })
      .getMany();

    const itemAmountBySegmentId = new Map<string, number>();
    for (const item of items) {
      const amount =
        item.pricingUnitSnapshot === PricingUnit.WEIGHT
          ? item.finalAmountMinor ?? item.estimatedAmountMinor ?? 0
          : (item.unitPriceMinor ?? 0) * item.quantity - (item.offerDiscountAmountMinor ?? 0);
      itemAmountBySegmentId.set(item.orderVendorSegmentId, (itemAmountBySegmentId.get(item.orderVendorSegmentId) ?? 0) + amount);
    }

    let eligibleMinor = 0;
    for (const segment of eligibleSegments) {
      const itemsTotal = itemAmountBySegmentId.get(segment.id) ?? 0;
      eligibleMinor += Math.max(0, itemsTotal - (segment.offerDiscountAmountMinor ?? 0));
    }
    if (eligibleMinor <= 0) return;

    const pointsPerEgp = await this.businessConfigService.getLoyaltyPointsPerEgp();
    const earnedPoints = Math.floor((eligibleMinor / 100) * pointsPerEgp);
    if (earnedPoints <= 0) return;

    try {
      await this.recordTransaction(
        {
          customerId: order.customerId,
          pointsDelta: earnedPoints,
          type: LoyaltyTransactionType.EARNING,
          orderId: order.id,
        },
        manager,
      );
    } catch (error: any) {
      if (error?.code === '23505') {
        // Already earned for this order (retried/concurrent DELIVERED
        // processing) — CONFIRMED benign, idempotent no-op. NOTE: this
        // fires from inside the order DELIVERED transition's OWN
        // transaction (this method is always called with `manager`,
        // joining that caller's transaction — see this method's own
        // top comment), so strictly this log line is emitted before
        // that outer transaction has committed. Accepted as a
        // documented, low-risk exception to the "log after commit"
        // rule: this branch returns normally (never throws), so
        // whatever the outer transaction does next proceeds
        // unaffected — the only way this log could describe a
        // decision that "didn't happen" is an unrelated, unrecoverable
        // failure elsewhere in that same transaction, which the
        // caller's own error path (HttpExceptionFilter) already
        // surfaces separately.
        logBusinessEvent(this.logger, 'warn', BusinessEvent.LOYALTY_EARNING_DUPLICATE, () => this.requestContextService.getCorrelationId(), {
          orderId,
        });
        return;
      }
      throw error;
    }
  }

  /**
   * Points -> Wallet Conversion (Chunk D). Customer self-service,
   * one-way, irreversible. Wraps BOTH ledger writes in ONE
   * transaction it owns itself (unlike `awardOrderEarning`, which
   * joins a transaction the CALLER already started) — there is no
   * pre-existing transaction to join here, since this is a new,
   * standalone customer-initiated operation.
   *
   * CONCURRENCY: locks the customer's own `User` row
   * (`pessimistic_write`) for the duration of the transaction — the
   * same technique already used to serialize concurrent access to a
   * contended resource elsewhere in this codebase (`Offer` row
   * locking). There is no natural "balance row" to lock for a pure
   * ledger, so the customer's own User row stands in for "the thing
   * concurrent conversions for this customer must serialize against."
   * Available points are re-read INSIDE the lock (via `manager`, not
   * the injected repository) so two concurrent requests can never both
   * observe the same pre-lock balance and both succeed.
   *
   * MINIMUM CONVERSION (consolidated customer-commerce milestone,
   * approved V1 rule): 5 EGP worth of points — `5 * pointsPerEgp`, not
   * a bare hardcoded "500" independent of the rate, so this stays
   * correct even if `pointsPerEgp` is ever reconfigured (at the
   * approved default of 100 points/EGP this is exactly 500 points, the
   * literal approved number). Distinct from, and now stricter than,
   * the earlier "at least enough to produce 1 EGP" (`pointsPerEgp`)
   * rule this replaces.
   *
   * MULTIPLE-OF-RATE REQUIREMENT (same milestone, approved V1 rule):
   * `requestedPoints` must be an EXACT multiple of `pointsPerEgp` (100
   * at the approved default) — REJECTED otherwise, replacing the
   * earlier behavior of silently accepting any amount above the
   * minimum and forfeiting its fractional-EGP remainder. A customer
   * converting a non-multiple now gets a clear, actionable error
   * instead of unknowingly losing points.
   *
   * AMOUNT: `walletCreditMinor = (requestedPoints / pointsPerEgp) *
   * 100` — always exact now that non-multiples are rejected upfront
   * (no floor/forfeiture is reachable).
   *
   * RATE SNAPSHOT: recorded as a plain, human-readable `reason` string
   * on both rows (e.g. "Converted 250 points to 200 minor units at
   * rate 100 points = 100 minor units.") — CONFIRMED, reusing the
   * existing `reason` field rather than inventing a new metadata
   * column/JSON framework, per the explicit instruction.
   *
   * IDEMPOTENCY: the SAME `idempotencyKey` is written to both the
   * Loyalty REDEMPTION row (new column, this chunk) and the Wallet
   * LOYALTY_REDEMPTION row (existing column, Chunk B) — each
   * independently unique at the DB level. A retry after a genuine
   * prior success hits one of those two unique constraints, is caught
   * here, and the ALREADY-COMMITTED result is looked up and returned
   * — never a fabricated fresh result, never a silent no-op with an
   * empty response.
   */
  async convertPointsToWallet(
    customerId: string,
    requestedPoints: number,
    idempotencyKey: string,
  ): Promise<{ convertedPoints: number; walletCreditMinor: number; pointsBalance: number; walletBalance: number }> {
    if (!Number.isInteger(requestedPoints) || requestedPoints <= 0) {
      throw new BadRequestException({
        message: 'requestedPoints must be a positive integer.',
        details: { code: 'INVALID_CONVERSION_POINTS' },
      });
    }
    if (!idempotencyKey) {
      throw new BadRequestException({
        message: 'A conversion requires an idempotencyKey.',
        details: { code: 'IDEMPOTENCY_KEY_REQUIRED' },
      });
    }

    const pointsPerEgp = await this.businessConfigService.getLoyaltyWalletConversionPointsPerEgp();
    const minimumPoints = 5 * pointsPerEgp; // approved V1 rule: 5 EGP worth of points (500 at the default 100 pts/EGP)
    if (requestedPoints < minimumPoints) {
      throw new BadRequestException({
        message: `A minimum of ${minimumPoints} points is required to convert.`,
        details: { code: 'BELOW_MINIMUM_CONVERSION', minimum: minimumPoints },
      });
    }
    if (requestedPoints % pointsPerEgp !== 0) {
      throw new BadRequestException({
        message: `The conversion amount must be a multiple of ${pointsPerEgp} points.`,
        details: { code: 'INVALID_CONVERSION_MULTIPLE', multipleOf: pointsPerEgp },
      });
    }

    const walletCreditMinor = (requestedPoints / pointsPerEgp) * 100;
    const reason = `Converted ${requestedPoints} points to ${walletCreditMinor} minor units at rate ${pointsPerEgp} points = 100 minor units.`;

    // Robustness fix (found while extending this milestone's own tests): a genuine RETRY of the
    // exact same idempotencyKey, arriving AFTER the first attempt already committed and reduced the
    // customer's balance, could otherwise see an insufficient CURRENT balance and be wrongly refused
    // — even though the conversion itself already succeeded. Checking for the existing row FIRST,
    // before the balance check, mirrors FinancialEventService.record's own "pre-check, then a
    // race-fallback re-check on 23505" shape (see this class's own top comment) exactly — this is
    // just the missing "pre-check" half of that same pattern for THIS method.
    const precheckExisting = await this.loyaltyTransactionsRepository.findOne({ where: { idempotencyKey, customerId } });
    if (precheckExisting) {
      logBusinessEvent(this.logger, 'warn', BusinessEvent.LOYALTY_REDEMPTION_DUPLICATE, () => this.requestContextService.getCorrelationId(), {
        customerId,
        idempotencyKey,
      });
      const pointsBalance = await this.getBalance(customerId);
      const walletBalance = await this.walletService.getBalance(customerId);
      return {
        convertedPoints: Math.abs(precheckExisting.pointsDelta),
        walletCreditMinor: (Math.abs(precheckExisting.pointsDelta) / pointsPerEgp) * 100,
        pointsBalance,
        walletBalance,
      };
    }

    let wasNewlyCommitted = false;
    try {
      await this.dataSource.transaction(async (manager) => {
        // Serializes concurrent conversions for THIS customer — see
        // this method's own top comment.
        await manager.findOne(User, { where: { id: customerId }, lock: { mode: 'pessimistic_write' } });

        // Re-checked INSIDE the lock — a concurrent request for the SAME key could have committed
        // between the pre-check above and acquiring this lock.
        const existingInsideLock = await manager.findOne(LoyaltyPointsTransaction, { where: { idempotencyKey, customerId } });
        if (existingInsideLock) return;

        const transactions = await manager.find(LoyaltyPointsTransaction, { where: { customerId } });
        const availablePoints = transactions.reduce((sum, t) => sum + t.pointsDelta, 0);
        if (availablePoints < requestedPoints) {
          throw new BadRequestException({
            message: 'Insufficient available points for this conversion.',
            details: { code: 'INSUFFICIENT_POINTS', available: availablePoints, requested: requestedPoints },
          });
        }

        await this.recordTransaction(
          {
            customerId,
            pointsDelta: -requestedPoints,
            type: LoyaltyTransactionType.REDEMPTION,
            reason,
            idempotencyKey,
          },
          manager,
        );

        await this.walletService.recordTransaction(
          {
            customerId,
            amountDeltaMinor: walletCreditMinor,
            type: WalletTransactionType.LOYALTY_REDEMPTION,
            reason,
            idempotencyKey,
          },
          manager,
        );
        wasNewlyCommitted = true;
      });

      // Business-event log (Group 4). Post-commit only — this method
      // owns its own transaction (`this.dataSource.transaction(...)`
      // above), so reaching this line means BOTH ledger writes
      // (LoyaltyPointsTransaction REDEMPTION + WalletTransaction
      // LOYALTY_REDEMPTION) are already durable. Emitted here, not
      // inside WalletService.recordTransaction itself — see that
      // method's own comment for why the transaction owner logs a
      // `wallet.credit`/`wallet.debit` post-commit rather than the
      // thin ledger-write helper it calls mid-transaction.
      if (wasNewlyCommitted) {
        logBusinessEvent(this.logger, 'log', BusinessEvent.LOYALTY_REDEMPTION, () => this.requestContextService.getCorrelationId(), {
          customerId,
          pointsRedeemed: requestedPoints,
          walletCreditMinor,
          idempotencyKey,
        });
        logBusinessEvent(this.logger, 'log', BusinessEvent.WALLET_CREDIT, () => this.requestContextService.getCorrelationId(), {
          customerId,
          amountDeltaMinor: walletCreditMinor,
          type: WalletTransactionType.LOYALTY_REDEMPTION,
        });
      } else {
        // The in-lock re-check found it already committed (a genuine concurrent race with another
        // request for this exact key) — same benign, idempotent outcome as the pre-check above.
        logBusinessEvent(this.logger, 'warn', BusinessEvent.LOYALTY_REDEMPTION_DUPLICATE, () => this.requestContextService.getCorrelationId(), {
          customerId,
          idempotencyKey,
        });
      }
    } catch (error: any) {
      if (error?.code === '23505') {
        // A genuine retry of an already-successful conversion —
        // CONFIRMED, look up and return the EXISTING result rather
        // than fabricating one or silently no-op'ing.
        const existing = await this.loyaltyTransactionsRepository.findOne({ where: { idempotencyKey, customerId } });
        if (!existing) {
          // The key exists but belongs to ANOTHER customer's conversion. Treating that as a replay
          // returned a success (and the other customer's amounts) for a conversion that never happened
          // for this caller (Group 8 finding). The unique index is global, so refuse explicitly.
          throw new ConflictException({
            message: 'This idempotency key is already in use. Please retry with a new key.',
            details: { code: 'IDEMPOTENCY_KEY_IN_USE' },
          });
        }
        // Reflects an already-committed prior conversion — safe to
        // log unconditionally, it is not new pending state.
        logBusinessEvent(this.logger, 'warn', BusinessEvent.LOYALTY_REDEMPTION_DUPLICATE, () => this.requestContextService.getCorrelationId(), {
          customerId,
          idempotencyKey,
        });
        const pointsBalance = await this.getBalance(customerId);
        const walletBalance = await this.walletService.getBalance(customerId);
        return {
          convertedPoints: Math.abs(existing.pointsDelta),
          walletCreditMinor: Math.floor(Math.abs(existing.pointsDelta) / pointsPerEgp) * 100,
          pointsBalance,
          walletBalance,
        };
      }
      throw error;
    }

    const pointsBalance = await this.getBalance(customerId);
    const walletBalance = await this.walletService.getBalance(customerId);
    return { convertedPoints: requestedPoints, walletCreditMinor, pointsBalance, walletBalance };
  }

  /**
   * Loyalty Reversal on Post-DELIVERED Refund (consolidated customer-
   * commerce milestone, approved rule: "If a delivered order is
   * subsequently refunded/partially refunded, the corresponding
   * loyalty entitlement must be reversed according to the refunded
   * eligible merchandise amount").
   *
   * CALLED FROM `ManualTransferRefundService.recordRefund` — the ONE
   * place in this codebase that can record a refund against a payment
   * with NO order-status gate at all (unlike the automatic partial-
   * cancellation refund path, or the Failed-Delivery refund path,
   * both of which only ever apply to an order that never reached
   * DELIVERED and therefore never earned anything to reverse in the
   * first place). Always joins the CALLER's own transaction (never
   * opens its own) — same shape as `awardOrderEarning`.
   *
   * PROPORTIONAL, DISCLOSED SIMPLIFICATION: this codebase's data model
   * does not cleanly separate "refunded eligible merchandise" from
   * "refunded delivery fee/other charges" within one raw refund
   * amount (the admin-recorded `amountMinor` is a single number — see
   * `RecordRefundDto`). Rather than inventing a new breakdown model
   * (explicitly out of scope — "do not invent a new location model"
   * applies by the same spirit here: do not invent a new financial
   * breakdown model), the reversal is proportional to the refund's
   * share of the order's own frozen `totalMinor`:
   *   pointsToReverse = floor(originallyEarnedPoints * min(1, refundedAmountMinor / order.totalMinor))
   * This can never OVER-reverse (the fraction is capped at 1, and the
   * result is additionally capped at whatever remains un-reversed —
   * see below), and a full-order refund correctly reverses the FULL
   * amount originally earned.
   *
   * IDEMPOTENT: no-op if this order never earned anything (most
   * refunds — pre-DELIVERED cancellations — hit exactly this, safely).
   * No-op if this exact `idempotencyKey` was already used for a
   * reversal (the SAME unique index REDEMPTION rows already rely on —
   * see the entity's own doc comment — covers EARNING_REVERSED too,
   * since it isn't scoped by `type`). Never reverses more than remains
   * of the original award, even under a hypothetical multiple-partial-
   * refund sequence (each call sums every prior EARNING_REVERSED row
   * for this order first).
   */
  async reverseEarningForRefund(
    manager: EntityManager,
    params: { orderId: string; refundedAmountMinor: number; idempotencyKey: string },
  ): Promise<void> {
    if (params.refundedAmountMinor <= 0) return;

    const order = await manager.findOne(Order, { where: { id: params.orderId } });
    if (!order || order.totalMinor == null || Number(order.totalMinor) <= 0) return;

    const earningTx = await manager.findOne(LoyaltyPointsTransaction, {
      where: { orderId: params.orderId, type: LoyaltyTransactionType.EARNING },
    });
    if (!earningTx) return; // this order never earned anything (e.g. refunded before DELIVERED) — nothing to reverse

    const priorReversals = await manager.find(LoyaltyPointsTransaction, {
      where: { orderId: params.orderId, type: LoyaltyTransactionType.EARNING_REVERSED },
    });
    const alreadyReversedPoints = priorReversals.reduce((sum, t) => sum + Math.abs(t.pointsDelta), 0);
    const remainingReversiblePoints = earningTx.pointsDelta - alreadyReversedPoints;
    if (remainingReversiblePoints <= 0) return;

    const fraction = Math.min(1, params.refundedAmountMinor / Number(order.totalMinor));
    const pointsToReverse = Math.min(remainingReversiblePoints, Math.floor(earningTx.pointsDelta * fraction));
    if (pointsToReverse <= 0) return;

    try {
      await this.recordTransaction(
        {
          customerId: earningTx.customerId,
          pointsDelta: -pointsToReverse,
          type: LoyaltyTransactionType.EARNING_REVERSED,
          orderId: params.orderId,
          reason: `Reversed ${pointsToReverse} of ${earningTx.pointsDelta} points earned, for a refund of ${params.refundedAmountMinor} minor units against an order total of ${order.totalMinor}.`,
          idempotencyKey: params.idempotencyKey,
        },
        manager,
      );
    } catch (error: any) {
      if (error?.code === '23505') {
        // Already reversed for this exact refund (retried call) — benign, idempotent no-op.
        return;
      }
      throw error;
    }
  }
}

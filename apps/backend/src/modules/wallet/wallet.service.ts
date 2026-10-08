import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { WalletTransactionType } from './wallet-transaction-type.enum';
import { RequestContextService } from '../../common/request-context/request-context.service';
import { logBusinessEvent } from '../../common/logging/log-business-event';
import { BusinessEvent } from '../../common/logging/business-events';

// Customer Wallet (Profile). Same pagination defaults/ceiling as
// CustomerOrdersService's own DEFAULT_PAGE/DEFAULT_LIMIT/MAX_LIMIT —
// not a new convention.
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export interface CustomerWalletTransactionsResult {
  data: WalletTransaction[];
  page: number;
  limit: number;
  total: number;
}

/**
 * Customer Wallet Ledger Foundation (Chunk B). CONFIRMED scope: this
 * service only creates ledger rows and derives a balance from them —
 * NO checkout debit, NO refund flow, NO Admin-facing endpoint, NO
 * Points->Wallet conversion, NO Driver cash-remainder workflow. All
 * of those are explicitly deferred to later chunks.
 *
 * Kept as its own module/service, deliberately never merged with
 * `LoyaltyService` — CONFIRMED, the two ledgers stay fully separate
 * per the approved design, even though their shapes are structurally
 * similar.
 *
 * No update/delete method exists here, deliberately — that absence IS
 * the append-only guarantee at the service layer, same discipline as
 * `LoyaltyService`/`EmployeeLoan`/`OfferConsumption`. A correction is
 * always a new, separate `recordTransaction` call with an
 * opposite-signed amount and a distinct type (e.g. `ADJUSTMENT`),
 * never an update to an existing row.
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectRepository(WalletTransaction)
    private readonly walletTransactionsRepository: Repository<WalletTransaction>,
    private readonly requestContextService: RequestContextService,
  ) {}

  /**
   * Appends one immutable ledger row. `manager`, when provided, lets a
   * future caller (checkout debit, refund, Points->Wallet conversion
   * needing both ledgers updated atomically) compose this write into
   * its own transaction — same optional-manager pattern already
   * established by `ProductsService.adminUpdateProduct` and Chunk A's
   * `LoyaltyService.recordTransaction`. Falls back to the injected
   * repository when omitted, which is the only way Chunk B itself
   * ever calls this (nothing transactional exists yet to compose
   * with).
   *
   * `idempotencyKey` is required here at the application layer too
   * (not only the DB constraint) so a missing key fails with a clear
   * business error rather than a generic NOT NULL violation — the
   * unique DB index (see the migration) remains the actual, final
   * protection against a genuine duplicate.
   */
  async recordTransaction(
    params: {
      customerId: string;
      amountDeltaMinor: number;
      type: WalletTransactionType;
      idempotencyKey: string;
      orderId?: string | null;
      reason?: string | null;
      createdByUserId?: string | null;
    },
    manager?: EntityManager,
  ): Promise<WalletTransaction> {
    if (params.amountDeltaMinor === 0) {
      throw new BadRequestException({
        message: 'A wallet transaction must have a non-zero amountDeltaMinor.',
        details: { code: 'INVALID_WALLET_AMOUNT' },
      });
    }
    if (!params.idempotencyKey) {
      throw new BadRequestException({
        message: 'A wallet transaction requires an idempotencyKey.',
        details: { code: 'IDEMPOTENCY_KEY_REQUIRED' },
      });
    }
    if (
      (params.type === WalletTransactionType.ADMIN_CREDIT || params.type === WalletTransactionType.ADJUSTMENT) &&
      !params.reason
    ) {
      throw new BadRequestException({
        message: 'A reason is required for this Wallet transaction type.',
        details: { code: 'WALLET_REASON_REQUIRED' },
      });
    }

    const repo = manager ? manager.getRepository(WalletTransaction) : this.walletTransactionsRepository;
    const saved = await repo.save(
      repo.create({
        customerId: params.customerId,
        amountDeltaMinor: params.amountDeltaMinor,
        type: params.type,
        idempotencyKey: params.idempotencyKey,
        orderId: params.orderId ?? null,
        reason: params.reason ?? null,
        createdByUserId: params.createdByUserId ?? null,
      }),
    );

    // Business-event log (Group 4). Only when this call is its OWN
    // committed unit of work (`manager` undefined) — every current
    // caller (LoyaltyService.convertPointsToWallet,
    // DriverCashRemainderService.approve) passes `manager`, joining a
    // transaction THIS method does not own and cannot know will
    // commit; those callers own the post-commit `wallet.credit`/
    // `wallet.debit` log themselves instead (see each call site's own
    // comment). Kept here too so a future standalone (no-manager)
    // caller gets correct logging automatically, with no new code.
    if (!manager) {
      logBusinessEvent(
        this.logger,
        'log',
        saved.amountDeltaMinor >= 0 ? BusinessEvent.WALLET_CREDIT : BusinessEvent.WALLET_DEBIT,
        () => this.requestContextService.getCorrelationId(),
        {
          walletTransactionId: saved.id,
          customerId: saved.customerId,
          amountDeltaMinor: saved.amountDeltaMinor,
          type: saved.type,
          orderId: saved.orderId ?? null,
        },
      );
    }

    return saved;
  }

  /**
   * A customer's current Wallet balance (EGP minor units), ALWAYS
   * derived from the ledger — never a stored field. Uses the exact
   * same direct JS-side summation already used throughout this
   * codebase for bigint `*Minor` columns (e.g.
   * `EmployeeLoanService.getStatus()`, `OfferConsumptionService`'s own
   * cache updates) — the established convention for monetary values,
   * not a new one invented here.
   *
   * A customer with no transactions correctly returns 0 — `reduce`
   * over an empty array with the `0` seed does exactly that, no
   * special-case branch needed.
   */
  async getBalance(customerId: string, manager?: EntityManager): Promise<number> {
    const repo = manager ? manager.getRepository(WalletTransaction) : this.walletTransactionsRepository;
    const transactions = await repo.find({ where: { customerId } });
    return transactions.reduce((sum, t) => sum + Number(t.amountDeltaMinor), 0);
  }

  /**
   * Serializes every wallet SPEND for one customer for the rest of the caller's transaction (a PostgreSQL advisory lock on
   * the customer), so "read the balance, then debit it" can never race another spend into a negative balance.
   */
  async lockCustomerWallet(customerId: string, manager: EntityManager): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`wallet:${customerId}`]);
  }

  /** The ledger row written under [idempotencyKey], if any (used to recognise an already-executed refund). */
  async findByIdempotencyKey(idempotencyKey: string, manager: EntityManager): Promise<WalletTransaction | null> {
    return manager.getRepository(WalletTransaction).findOne({ where: { idempotencyKey } });
  }

  /**
   * Credits back an explicit part of what an order paid from the wallet (failed-delivery refund). Caller holds the ORDER lock;
   * this takes the customer's wallet lock, so the check-then-credit below cannot race another refund of the same money.
   * NEVER credits more than `walletPaidMinor − everything already refunded for the order`; idempotent by key (a replay
   * credits nothing and returns 0).
   */
  async refundOrderPayment(
    manager: EntityManager,
    params: {
      customerId: string;
      orderId: string;
      walletPaidMinor: number;
      amountMinor: number;
      idempotencyKey: string;
      reason: string;
      actorUserId?: string | null;
    },
  ): Promise<number> {
    if (!Number.isInteger(params.amountMinor) || params.amountMinor <= 0) return 0;
    await this.lockCustomerWallet(params.customerId, manager);
    if (await this.findByIdempotencyKey(params.idempotencyKey, manager)) return 0;
    const refundable = params.walletPaidMinor - (await this.getRefundedForOrderMinor(params.orderId, manager));
    if (params.amountMinor > refundable) {
      throw new BadRequestException({
        message: 'The wallet refund exceeds what the wallet actually paid for this order.',
        details: { code: 'REFUND_EXCEEDS_PAYMENT_AMOUNT' },
      });
    }
    await this.recordTransaction(
      {
        customerId: params.customerId,
        amountDeltaMinor: params.amountMinor,
        type: WalletTransactionType.ORDER_REFUND,
        idempotencyKey: params.idempotencyKey,
        orderId: params.orderId,
        reason: params.reason,
        createdByUserId: params.actorUserId ?? null,
      },
      manager,
    );
    return params.amountMinor;
  }

  /**
   * Customer Wallet (Profile). Paginated, newest-first — the exact
   * immutable ledger rows `getBalance` already sums, now exposed
   * read-only to their own owner. Deliberately returns the
   * `WalletTransaction` entity itself (not a separate view/DTO): every
   * column on it is already customer-safe (see that entity's own
   * comment) EXCEPT `createdByUserId`, which the controller strips
   * before responding — never a second parallel ledger or projection
   * table, just a narrower read of the one that already exists.
   */
  async listTransactionsForCustomer(
    customerId: string,
    params: { page?: number; limit?: number },
  ): Promise<CustomerWalletTransactionsResult> {
    const page = params.page && params.page > 0 ? params.page : DEFAULT_PAGE;
    const limit = params.limit && params.limit > 0 ? Math.min(params.limit, MAX_LIMIT) : DEFAULT_LIMIT;

    const [data, total] = await this.walletTransactionsRepository.findAndCount({
      where: { customerId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, page, limit, total };
  }

  /** Everything already credited back to the wallet for one order (ORDER_REFUND rows) — the basis of wallet refund idempotency. */
  async getRefundedForOrderMinor(orderId: string, manager: EntityManager): Promise<number> {
    const rows = await manager
      .getRepository(WalletTransaction)
      .find({ where: { orderId, type: WalletTransactionType.ORDER_REFUND } });
    return rows.reduce((sum, t) => sum + Number(t.amountDeltaMinor), 0);
  }
}

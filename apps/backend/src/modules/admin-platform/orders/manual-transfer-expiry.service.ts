import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { BusinessConfigService } from '../../business-config/business-config.service';
import { AdminOrderExtrasService, ADMIN_CANCELLABLE_STATUSES } from './admin-order-extras.service';
import { Role } from '../../../common/enums/role.enum';

/**
 * R21 (decision register 2026-11-06): an InstaPay / Vodafone Cash (MANUAL_TRANSFER) order whose money Operations have not verified
 * within the Admin-configured window (`MANUAL_TRANSFER_VERIFICATION_WINDOW_MINUTES`, counted from when the order was placed) is cancelled
 * automatically and its stock released. It goes through the ordinary Operations cancellation (same state machine, same money handling):
 * the payment keeps its pending refund entitlement, so money that arrives LATER is reviewed and refunded when Operations approve it — the
 * order is never reactivated. Unset window = the feature is off (no value is invented). A payment already PAID or REJECTED is never touched.
 *
 * Runs every minute (never under NODE_ENV=test — tests call `cancelExpired()` directly), a small batch per tick, oldest first; a
 * Postgres advisory lock keeps two app instances from working the same batch. Every failure is logged and the next tick retries.
 */
@Injectable()
export class ManualTransferExpiryService implements OnModuleInit, OnModuleDestroy {
  static readonly INTERVAL_MS = 60_000;
  static readonly BATCH = 25;
  private static readonly LOCK_KEY = 760021; // pg_try_advisory_lock key for this sweep only
  private readonly logger = new Logger(ManualTransferExpiryService.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<unknown>;

  constructor(
    private readonly ds: DataSource,
    private readonly businessConfig: BusinessConfigService,
    private readonly orders: AdminOrderExtrasService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('env') === 'test') return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.cancelExpired()
        .catch((error) => this.logger.error(`Manual transfer expiry sweep failed: ${(error as Error).message}`))
        .finally(() => (this.running = undefined));
    }, ManualTransferExpiryService.INTERVAL_MS);
    this.timer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  async cancelExpired(): Promise<{ cancelled: string[]; skipped: number }> {
    const result = { cancelled: [] as string[], skipped: 0 };
    const minutes = await this.businessConfig.getManualTransferVerificationWindowMinutes();
    if (minutes === null) return result;

    const runner = this.ds.createQueryRunner();
    await runner.connect();
    try {
      const [{ locked }] = await runner.query(`SELECT pg_try_advisory_lock($1) AS locked`, [ManualTransferExpiryService.LOCK_KEY]);
      if (!locked) return result;
      try {
        const due: Array<{ id: string }> = await runner.query(
          `SELECT o.id FROM orders o
             JOIN payments p ON p.order_id = o.id
            WHERE o.payment_method = 'MANUAL_TRANSFER'
              AND p.status IN ('PENDING', 'CUSTOMER_CLAIMED_TRANSFER', 'UNDER_REVIEW')
              AND o.status::text = ANY($1)
              AND o.created_at < now() - make_interval(mins => $2)
            ORDER BY o.created_at ASC
            LIMIT $3`,
          [ADMIN_CANCELLABLE_STATUSES, minutes, ManualTransferExpiryService.BATCH],
        );
        for (const { id } of due) {
          try {
            await this.orders.cancel(id, { id: null, role: Role.ADMIN }, 'PAYMENT_NOT_VERIFIED', `transfer not verified within ${minutes} minutes`);
            result.cancelled.push(id);
          } catch (error) {
            // Approved, cancelled or progressed meanwhile — never retried into a different state; logged for the record.
            result.skipped++;
            this.logger.warn(`Manual transfer expiry skipped order ${id}: ${(error as Error).message}`);
          }
        }
      } finally {
        await runner.query(`SELECT pg_advisory_unlock($1)`, [ManualTransferExpiryService.LOCK_KEY]);
      }
    } finally {
      await runner.release();
    }
    if (result.cancelled.length > 0) this.logger.log(`Cancelled ${result.cancelled.length} unverified Manual Transfer order(s) after ${minutes} minutes.`);
    return result;
  }
}

import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { SettlementFrequency } from '../settlement-frequency.enum';

/**
 * CONFIRMED (Phase F, decision 5): "Vendor... settlements can be
 * configured... WEEKLY/MONTHLY... the architecture must allow the
 * applicable settlement configuration to be changed from the
 * Dashboard without changing historical settlement records." —
 * `frequency` here is a SNAPSHOT of whatever was configured when this
 * period was opened/closed, never re-read from BusinessConfig later.
 *
 * "Closing a settlement freezes its contents/configuration" — once
 * `status` is CLOSED, nothing ever writes to this row again
 * (SettlementService enforces this, not a DB trigger, but no update
 * path exists for a closed period at all).
 *
 * This row aggregates FinancialEvent rows within [periodStart,
 * periodEnd) — it never recreates or mutates those events (see
 * SettlementService's own comment for how double-counting across
 * periods is prevented by construction, without ever tagging
 * individual events).
 */
@Entity({ name: 'vendor_settlement_periods' })
@Index(['vendorBranchId'])
export class VendorSettlementPeriod extends BaseEntity {
  @Column({ type: 'uuid', name: 'vendor_branch_id' })
  vendorBranchId: string;

  @Column({ type: 'varchar', length: 20 })
  frequency: SettlementFrequency;

  @Column({ name: 'period_start', type: 'timestamptz' })
  periodStart: Date;

  @Column({ name: 'period_end', type: 'timestamptz' })
  periodEnd: Date;

  @Column({ type: 'varchar', length: 20, default: 'OPEN' })
  status: 'OPEN' | 'CLOSED';

  @Column({ name: 'gross_sales_minor', type: 'bigint', default: 0 })
  grossSalesMinor: number;

  @Column({ name: 'total_commission_owed_minor', type: 'bigint', default: 0 })
  totalCommissionOwedMinor: number;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt?: Date | null;

  @Column({ name: 'closed_by_user_id', type: 'uuid', nullable: true })
  closedByUserId?: string | null;
}

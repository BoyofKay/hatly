import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { SettlementFrequency } from '../settlement-frequency.enum';

/**
 * Same discipline as VendorSettlementPeriod — see that entity's own
 * doc comment. `netPayableMinor` = totalEarningsMinor -
 * totalCommissionOwedMinor + totalReimbursementsOwedMinor, computed
 * once at close time and frozen (never a live-recalculated field).
 */
@Entity({ name: 'driver_settlement_periods' })
@Index(['driverId'])
export class DriverSettlementPeriod extends BaseEntity {
  @Column({ type: 'uuid', name: 'driver_id' })
  driverId: string;

  @Column({ type: 'varchar', length: 20 })
  frequency: SettlementFrequency;

  @Column({ name: 'period_start', type: 'timestamptz' })
  periodStart: Date;

  @Column({ name: 'period_end', type: 'timestamptz' })
  periodEnd: Date;

  @Column({ type: 'varchar', length: 20, default: 'OPEN' })
  status: 'OPEN' | 'CLOSED';

  @Column({ name: 'total_earnings_minor', type: 'bigint', default: 0 })
  totalEarningsMinor: number;

  @Column({ name: 'total_commission_owed_minor', type: 'bigint', default: 0 })
  totalCommissionOwedMinor: number;

  @Column({ name: 'total_reimbursements_owed_minor', type: 'bigint', default: 0 })
  totalReimbursementsOwedMinor: number;

  @Column({ name: 'net_payable_minor', type: 'bigint', default: 0 })
  netPayableMinor: number;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt?: Date | null;

  @Column({ name: 'closed_by_user_id', type: 'uuid', nullable: true })
  closedByUserId?: string | null;
}

import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { EmployeeLoan } from './employee-loan.entity';

/**
 * One repayment against an EmployeeLoan. Immutable once created — no
 * update/delete path exists, same discipline as the loan itself and
 * as AdHocPurchaseRecord. Multiple repayments may exist per loan
 * (confirmed: "one or more repayments").
 */
@Entity({ name: 'employee_loan_repayments' })
@Index(['employeeLoanId'])
export class EmployeeLoanRepayment extends BaseEntity {
  @ManyToOne(() => EmployeeLoan)
  @JoinColumn({ name: 'employee_loan_id' })
  employeeLoan: EmployeeLoan;

  @Column({ name: 'employee_loan_id' })
  employeeLoanId: string;

  @Column({ name: 'amount_minor', type: 'bigint' })
  amountMinor: number;

  @Column({ name: 'repaid_at', type: 'timestamptz' })
  repaidAt: Date;

  @Column({ type: 'varchar', nullable: true })
  reason?: string | null;

  @Column({ type: 'uuid', name: 'recorded_by_user_id' })
  recordedByUserId: string;
}

import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { User } from '../../users/entities/user.entity';

/**
 * CONFIRMED (Phase F, decision 4): "There is NO Driver Float / Daily
 * Advance / Cash Custody system... instead, a generic employee
 * loan/advance record" — usable by a Driver or any other employee,
 * since `employeeUserId` references `User` directly (the identity
 * common to every role), not `Driver`.
 *
 * Immutable once created — no update method exists on
 * EmployeeLoanService for this row. Outstanding amount and
 * fully-repaid status are DELIBERATELY NOT stored fields here — they
 * are always derived by summing EmployeeLoanRepayment rows against
 * `borrowedAmountMinor` (see EmployeeLoanService.getStatus()), the
 * same "never a mutable balance" discipline as everything else in
 * Phase F. No opening balance, minimum/maximum, replenishment, or
 * daily-limit concept exists — confirmed explicitly excluded.
 */
@Entity({ name: 'employee_loans' })
@Index(['employeeUserId'])
export class EmployeeLoan extends BaseEntity {
  @ManyToOne(() => User)
  @JoinColumn({ name: 'employee_user_id' })
  employee: User;

  @Column({ name: 'employee_user_id' })
  employeeUserId: string;

  @Column({ name: 'borrowed_amount_minor', type: 'bigint' })
  borrowedAmountMinor: number;

  @Column({ name: 'issued_at', type: 'timestamptz' })
  issuedAt: Date;

  @Column({ type: 'varchar', nullable: true })
  reason?: string | null;

  @Column({ type: 'uuid', name: 'issued_by_user_id' })
  issuedByUserId: string;
}

import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { BusinessConfigService } from '../business-config/business-config.service';
import { BusinessConfigKey } from '../business-config/business-config-key.enum';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmployeeLoan } from './entities/employee-loan.entity';
import { EmployeeLoanRepayment } from './entities/employee-loan-repayment.entity';

export interface EmployeeLoanStatus {
  loan: EmployeeLoan;
  repayments: EmployeeLoanRepayment[];
  totalRepaidMinor: number;
  outstandingMinor: number;
  fullyRepaid: boolean;
}

/**
 * CONFIRMED: "outstanding amount must derive from recorded loan/
 * repayment history" — never a stored, separately-mutated field.
 * Every method here reads the loan + its repayments and computes the
 * status fresh; nothing writes an "outstanding" or "fullyRepaid"
 * column anywhere.
 */
@Injectable()
export class EmployeeLoanService {
  constructor(
    @InjectRepository(EmployeeLoan) private readonly loansRepository: Repository<EmployeeLoan>,
    @InjectRepository(EmployeeLoanRepayment)
    private readonly repaymentsRepository: Repository<EmployeeLoanRepayment>,
    @Optional() private readonly businessConfig?: BusinessConfigService,
  ) {}

  /** What this person owes across all their loans right now (borrowed − repaid). */
  async outstandingForEmployee(employeeUserId: string): Promise<number> {
    const loans = await this.loansRepository.find({ where: { employeeUserId } });
    let total = 0;
    for (const loan of loans) total += (await this.getStatus(loan.id)).outstandingMinor;
    return total;
  }

  async issueLoan(params: {
    employeeUserId: string;
    borrowedAmountMinor: number;
    issuedAt: Date;
    reason?: string;
    issuedByUserId: string;
  }): Promise<EmployeeLoan> {
    // Owner decision 2026-11-22: an optional cap on what one person may owe; unset = no cap (the supervisor decides).
    const cap = this.businessConfig ? await this.businessConfig.get<number | null>(BusinessConfigKey.EMPLOYEE_LOAN_MAX_OUTSTANDING_MINOR, null) : null;
    if (typeof cap === 'number' && cap > 0) {
      const owed = await this.outstandingForEmployee(params.employeeUserId);
      if (owed + params.borrowedAmountMinor > cap) {
        throw new BadRequestException({
          message: `This loan would bring what this person owes to ${((owed + params.borrowedAmountMinor) / 100).toFixed(2)} EGP, above the maximum of ${(cap / 100).toFixed(2)} EGP (already owed: ${(owed / 100).toFixed(2)} EGP).`,
          details: { code: 'LOAN_ABOVE_MAXIMUM', capMinor: cap, outstandingMinor: owed },
        });
      }
    }
    return this.loansRepository.save(
      this.loansRepository.create({
        employeeUserId: params.employeeUserId,
        borrowedAmountMinor: params.borrowedAmountMinor,
        issuedAt: params.issuedAt,
        reason: params.reason ?? null,
        issuedByUserId: params.issuedByUserId,
      }),
    );
  }

  async recordRepayment(params: {
    employeeLoanId: string;
    amountMinor: number;
    repaidAt: Date;
    reason?: string;
    recordedByUserId: string;
  }): Promise<EmployeeLoanRepayment> {
    const loan = await this.loansRepository.findOne({ where: { id: params.employeeLoanId } });
    if (!loan) {
      throw new NotFoundException('Employee loan not found.');
    }
    const { outstandingMinor } = await this.getStatus(loan.id);
    if (params.amountMinor > outstandingMinor) {
      throw new BadRequestException({ message: `The repayment is more than what is still owed on this loan (${(outstandingMinor / 100).toFixed(2)} EGP).`, details: { code: 'REPAYMENT_ABOVE_OUTSTANDING', outstandingMinor } });
    }
    return this.repaymentsRepository.save(
      this.repaymentsRepository.create({
        employeeLoanId: params.employeeLoanId,
        amountMinor: params.amountMinor,
        repaidAt: params.repaidAt,
        reason: params.reason ?? null,
        recordedByUserId: params.recordedByUserId,
      }),
    );
  }

  async getStatus(employeeLoanId: string): Promise<EmployeeLoanStatus> {
    const loan = await this.loansRepository.findOne({ where: { id: employeeLoanId } });
    if (!loan) {
      throw new NotFoundException('Employee loan not found.');
    }
    const repayments = await this.repaymentsRepository.find({
      where: { employeeLoanId },
      order: { repaidAt: 'ASC' },
    });
    const totalRepaidMinor = repayments.reduce((sum, r) => sum + r.amountMinor, 0);
    const outstandingMinor = Math.max(0, loan.borrowedAmountMinor - totalRepaidMinor);
    return { loan, repayments, totalRepaidMinor, outstandingMinor, fullyRepaid: outstandingMinor === 0 };
  }

  async listForEmployee(employeeUserId: string): Promise<EmployeeLoan[]> {
    return this.loansRepository.find({ where: { employeeUserId }, order: { issuedAt: 'DESC' } });
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
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
  ) {}

  async issueLoan(params: {
    employeeUserId: string;
    borrowedAmountMinor: number;
    issuedAt: Date;
    reason?: string;
    issuedByUserId: string;
  }): Promise<EmployeeLoan> {
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

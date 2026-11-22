import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { EmployeeLoanService } from './employee-loan.service';
import { IssueEmployeeLoanDto } from './dto/issue-employee-loan.dto';
import { RecordLoanRepaymentDto } from './dto/record-loan-repayment.dto';

@ApiTags('admin-employee-loans')
@Controller('admin/employee-loans')
export class AdminEmployeeLoansController {
  constructor(
    private readonly employeeLoanService: EmployeeLoanService,
    private readonly ds: DataSource,
  ) {}

  /**
   * The people a loan can be given to (active drivers), with what each owes now — so the screen picks a driver by name instead of a raw
   * account id. Same permission as issuing a loan (operations supervisor and above); no customer data.
   */
  @Get('people')
  @RequiresPermission(Permission.MANAGE_EMPLOYEE_LOANS)
  async people() {
    const rows = await this.ds.query(
      `SELECT u.id AS user_id, u.full_name, u.phone,
              COALESCE((SELECT sum(l.borrowed_amount_minor) - COALESCE((SELECT sum(r.amount_minor) FROM employee_loan_repayments r JOIN employee_loans l2 ON l2.id = r.employee_loan_id WHERE l2.employee_user_id = u.id AND l2.deleted_at IS NULL), 0)
                          FROM employee_loans l WHERE l.employee_user_id = u.id AND l.deleted_at IS NULL), 0) AS outstanding
         FROM drivers d JOIN users u ON u.id = d.user_id
        WHERE d.deleted_at IS NULL AND u.deleted_at IS NULL AND u.is_active
        ORDER BY u.full_name`,
    );
    return { data: rows.map((r: any) => ({ userId: r.user_id, fullName: r.full_name, phone: r.phone, outstandingMinor: Number(r.outstanding) })) };
  }

  @Post()
  @RequiresPermission(Permission.MANAGE_EMPLOYEE_LOANS)
  async issue(@CurrentUser() user: AuthenticatedUser, @Body() dto: IssueEmployeeLoanDto) {
    const loan = await this.employeeLoanService.issueLoan({
      employeeUserId: dto.employeeUserId,
      borrowedAmountMinor: dto.borrowedAmountMinor,
      issuedAt: new Date(dto.issuedAt),
      reason: dto.reason,
      issuedByUserId: user.id,
    });
    return { data: loan };
  }

  @Post(':loanId/repayments')
  @RequiresPermission(Permission.MANAGE_EMPLOYEE_LOANS)
  async recordRepayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('loanId') loanId: string,
    @Body() dto: RecordLoanRepaymentDto,
  ) {
    const repayment = await this.employeeLoanService.recordRepayment({
      employeeLoanId: loanId,
      amountMinor: dto.amountMinor,
      repaidAt: new Date(dto.repaidAt),
      reason: dto.reason,
      recordedByUserId: user.id,
    });
    return { data: repayment };
  }

  @Get(':loanId')
  @RequiresPermission(Permission.MANAGE_EMPLOYEE_LOANS)
  async getStatus(@Param('loanId') loanId: string) {
    const status = await this.employeeLoanService.getStatus(loanId);
    return { data: status };
  }

  @Get('employee/:employeeUserId')
  @RequiresPermission(Permission.MANAGE_EMPLOYEE_LOANS)
  async listForEmployee(@Param('employeeUserId') employeeUserId: string) {
    const loans = await this.employeeLoanService.listForEmployee(employeeUserId);
    return { data: loans };
  }
}

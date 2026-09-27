import { Body, Controller, Get, Param, Post } from '@nestjs/common';
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
  constructor(private readonly employeeLoanService: EmployeeLoanService) {}

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

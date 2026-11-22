import 'reflect-metadata';
import { AdminEmployeeLoansController } from './admin-employee-loans.controller';
import { Permission } from '../permissions/permission.enum';
import { REQUIRED_PERMISSIONS_KEY } from '../permissions/decorators/requires-permission.decorator';

function buildHarness() {
  const employeeLoanService = {
    issueLoan: jest.fn(async (params: any) => ({ id: 'loan-1', ...params })),
    recordRepayment: jest.fn(async (params: any) => ({ id: 'repayment-1', ...params })),
    getStatus: jest.fn(async () => ({ outstandingMinor: 500, fullyRepaid: false })),
    listForEmployee: jest.fn(async () => [{ id: 'loan-1' }, { id: 'loan-2' }]),
  };
  const controller = new AdminEmployeeLoansController(employeeLoanService as any, {} as any);
  return { controller, employeeLoanService };
}

const adminUser = { id: 'admin-1', role: 'ADMIN' };

describe('AdminEmployeeLoansController', () => {
  describe('issue', () => {
    it('forwards the DTO to the service, converting issuedAt to a real Date and attributing issuedByUserId to the acting admin', async () => {
      const { controller, employeeLoanService } = buildHarness();

      await controller.issue(adminUser as any, {
        employeeUserId: 'user-1',
        borrowedAmountMinor: 5000,
        issuedAt: '2026-01-15T00:00:00.000Z',
        reason: 'Emergency advance',
      });

      expect(employeeLoanService.issueLoan).toHaveBeenCalledWith({
        employeeUserId: 'user-1',
        borrowedAmountMinor: 5000,
        issuedAt: new Date('2026-01-15T00:00:00.000Z'),
        reason: 'Emergency advance',
        issuedByUserId: 'admin-1',
      });
    });

    it('is gated by exactly MANAGE_EMPLOYEE_LOANS', () => {
      const permissions = Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, AdminEmployeeLoansController.prototype.issue);
      expect(permissions).toEqual([Permission.MANAGE_EMPLOYEE_LOANS]);
    });
  });

  describe('recordRepayment', () => {
    it('forwards the loan id (from the URL param, not the body) and converts repaidAt to a real Date', async () => {
      const { controller, employeeLoanService } = buildHarness();

      await controller.recordRepayment(adminUser as any, 'loan-1', {
        amountMinor: 1000,
        repaidAt: '2026-02-01T00:00:00.000Z',
        reason: 'Partial repayment',
      });

      expect(employeeLoanService.recordRepayment).toHaveBeenCalledWith({
        employeeLoanId: 'loan-1',
        amountMinor: 1000,
        repaidAt: new Date('2026-02-01T00:00:00.000Z'),
        reason: 'Partial repayment',
        recordedByUserId: 'admin-1',
      });
    });

    it('is gated by exactly MANAGE_EMPLOYEE_LOANS', () => {
      const permissions = Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        AdminEmployeeLoansController.prototype.recordRepayment,
      );
      expect(permissions).toEqual([Permission.MANAGE_EMPLOYEE_LOANS]);
    });
  });

  describe('getStatus', () => {
    it('delegates to EmployeeLoanService.getStatus with the loan id', async () => {
      const { controller, employeeLoanService } = buildHarness();

      const result = await controller.getStatus('loan-1');

      expect(employeeLoanService.getStatus).toHaveBeenCalledWith('loan-1');
      expect(result.data.outstandingMinor).toBe(500);
    });

    it('is gated by exactly MANAGE_EMPLOYEE_LOANS', () => {
      const permissions = Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        AdminEmployeeLoansController.prototype.getStatus,
      );
      expect(permissions).toEqual([Permission.MANAGE_EMPLOYEE_LOANS]);
    });
  });

  describe('listForEmployee', () => {
    it('delegates to EmployeeLoanService.listForEmployee with the employee user id', async () => {
      const { controller, employeeLoanService } = buildHarness();

      const result = await controller.listForEmployee('user-1');

      expect(employeeLoanService.listForEmployee).toHaveBeenCalledWith('user-1');
      expect(result.data).toHaveLength(2);
    });

    it('is gated by exactly MANAGE_EMPLOYEE_LOANS', () => {
      const permissions = Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        AdminEmployeeLoansController.prototype.listForEmployee,
      );
      expect(permissions).toEqual([Permission.MANAGE_EMPLOYEE_LOANS]);
    });
  });
});

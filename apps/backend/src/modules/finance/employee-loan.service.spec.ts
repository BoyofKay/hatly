import { NotFoundException } from '@nestjs/common';
import { EmployeeLoanService } from './employee-loan.service';

function buildHarness(loans: any[] = [], repayments: any[] = []) {
  const loansRepository = {
    save: jest.fn(async (l: any) => {
      const withId = { id: l.id ?? `loan-${loans.length + 1}`, ...l };
      loans.push(withId);
      return withId;
    }),
    create: jest.fn((data: any) => ({ ...data })),
    findOne: jest.fn(async ({ where }: any) => loans.find((l) => l.id === where.id) ?? null),
    find: jest.fn(async ({ where }: any) => loans.filter((l) => l.employeeUserId === where.employeeUserId)),
  };
  const repaymentsRepository = {
    save: jest.fn(async (r: any) => {
      const withId = { id: r.id ?? `repayment-${repayments.length + 1}`, ...r };
      repayments.push(withId);
      return withId;
    }),
    create: jest.fn((data: any) => ({ ...data })),
    find: jest.fn(async ({ where }: any) => repayments.filter((r) => r.employeeLoanId === where.employeeLoanId)),
  };
  const service = new EmployeeLoanService(loansRepository as any, repaymentsRepository as any);
  return { service, loans, repayments };
}

describe('EmployeeLoanService', () => {
  it('issues a loan usable by a non-driver employee (any User id)', async () => {
    const { service } = buildHarness();
    const loan = await service.issueLoan({
      employeeUserId: 'user-1',
      borrowedAmountMinor: 10000,
      issuedAt: new Date('2026-01-01'),
      issuedByUserId: 'admin-1',
    });
    expect(loan.borrowedAmountMinor).toBe(10000);
  });

  it('CONFIRMED RULE: outstanding amount is derived from history, never a stored mutable field', async () => {
    const { service } = buildHarness();
    const loan = await service.issueLoan({
      employeeUserId: 'user-1',
      borrowedAmountMinor: 10000,
      issuedAt: new Date('2026-01-01'),
      issuedByUserId: 'admin-1',
    });
    await service.recordRepayment({
      employeeLoanId: loan.id,
      amountMinor: 4000,
      repaidAt: new Date('2026-01-10'),
      recordedByUserId: 'admin-1',
    });

    const status = await service.getStatus(loan.id);
    expect(status.totalRepaidMinor).toBe(4000);
    expect(status.outstandingMinor).toBe(6000);
    expect(status.fullyRepaid).toBe(false);
  });

  it('is fully repaid once repayments equal the borrowed amount, across multiple repayments', async () => {
    const { service } = buildHarness();
    const loan = await service.issueLoan({
      employeeUserId: 'user-1',
      borrowedAmountMinor: 5000,
      issuedAt: new Date('2026-01-01'),
      issuedByUserId: 'admin-1',
    });
    await service.recordRepayment({
      employeeLoanId: loan.id,
      amountMinor: 3000,
      repaidAt: new Date('2026-01-05'),
      recordedByUserId: 'admin-1',
    });
    await service.recordRepayment({
      employeeLoanId: loan.id,
      amountMinor: 2000,
      repaidAt: new Date('2026-01-10'),
      recordedByUserId: 'admin-1',
    });

    const status = await service.getStatus(loan.id);
    expect(status.outstandingMinor).toBe(0);
    expect(status.fullyRepaid).toBe(true);
    expect(status.repayments).toHaveLength(2);
  });

  it('recordRepayment throws NotFoundException for a non-existent loan', async () => {
    const { service } = buildHarness();
    await expect(
      service.recordRepayment({
        employeeLoanId: 'missing',
        amountMinor: 100,
        repaidAt: new Date(),
        recordedByUserId: 'admin-1',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it("listForEmployee returns only that employee's loans", async () => {
    const { service } = buildHarness();
    await service.issueLoan({
      employeeUserId: 'user-1',
      borrowedAmountMinor: 1000,
      issuedAt: new Date(),
      issuedByUserId: 'admin-1',
    });
    await service.issueLoan({
      employeeUserId: 'user-2',
      borrowedAmountMinor: 2000,
      issuedAt: new Date(),
      issuedByUserId: 'admin-1',
    });

    const loans = await service.listForEmployee('user-1');
    expect(loans).toHaveLength(1);
    expect(loans[0].employeeUserId).toBe('user-1');
  });
});

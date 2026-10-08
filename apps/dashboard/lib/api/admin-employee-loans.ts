import { apiClient } from './client';

/** Mirrors the real backend `EmployeeLoan` entity exactly (finance/entities/employee-loan.entity.ts). */
export interface EmployeeLoan {
  id: string;
  employeeUserId: string;
  borrowedAmountMinor: number;
  issuedAt: string;
  reason: string | null;
  issuedByUserId: string;
}

/** Mirrors the real backend `EmployeeLoanRepayment` entity exactly. */
export interface EmployeeLoanRepayment {
  id: string;
  employeeLoanId: string;
  amountMinor: number;
  repaidAt: string;
  reason: string | null;
  recordedByUserId: string;
}

/** Mirrors `EmployeeLoanService.getStatus`'s exact return shape. */
export interface EmployeeLoanStatus {
  loan: EmployeeLoan;
  repayments: EmployeeLoanRepayment[];
  totalRepaidMinor: number;
  outstandingMinor: number;
  fullyRepaid: boolean;
}

/**
 * M3a (Launch-Readiness Gap Audit, G-29). Reuses the existing, unchanged
 * `admin/employee-loans` endpoints exactly. Deliberately no employee
 * picker/search — no such backend endpoint exists, and building one
 * would drift into G-08 (Admin user management), explicitly out of
 * scope for M3a; the Admin enters the employee's user id directly.
 */
export async function issueEmployeeLoan(input: {
  employeeUserId: string;
  borrowedAmountMinor: number;
  issuedAt: string;
  reason?: string;
}): Promise<EmployeeLoan> {
  const res = await apiClient.post('/admin/employee-loans', input);
  return res.data.data;
}

export async function recordLoanRepayment(
  loanId: string,
  input: { amountMinor: number; repaidAt: string; reason?: string },
): Promise<EmployeeLoanRepayment> {
  const res = await apiClient.post(`/admin/employee-loans/${loanId}/repayments`, input);
  return res.data.data;
}

export async function getEmployeeLoanStatus(loanId: string): Promise<EmployeeLoanStatus> {
  const res = await apiClient.get(`/admin/employee-loans/${loanId}`);
  return res.data.data;
}

export async function listLoansForEmployee(employeeUserId: string): Promise<EmployeeLoan[]> {
  const res = await apiClient.get(`/admin/employee-loans/employee/${employeeUserId}`);
  return res.data.data;
}

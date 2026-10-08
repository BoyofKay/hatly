'use client';

import { useState } from 'react';
import {
  EmployeeLoan,
  EmployeeLoanStatus,
  getEmployeeLoanStatus,
  issueEmployeeLoan,
  listLoansForEmployee,
  recordLoanRepayment,
} from '../../../lib/api/admin-employee-loans';
import { apiErrorMessage } from '../../../lib/api/errors';

function minor(amount: number): string {
  return (amount / 100).toFixed(2);
}

/**
 * M3a (Launch-Readiness Gap Audit, G-29). Reuses the existing, unchanged
 * `admin/employee-loans` endpoints exactly. Deliberately simple — no
 * employee picker (no such backend endpoint; building one would drift
 * into G-08 user management, out of scope) and no full ledger table,
 * just the three operations the backend actually supports: issue,
 * record a repayment, and look up status.
 */
export default function EmployeeLoansPage() {
  // Issue loan
  const [employeeUserId, setEmployeeUserId] = useState('');
  const [borrowedAmount, setBorrowedAmount] = useState('');
  const [issuedAt, setIssuedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [issueReason, setIssueReason] = useState('');
  const [isIssuing, setIsIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issuedLoan, setIssuedLoan] = useState<EmployeeLoan | null>(null);

  // Look up by employee
  const [lookupEmployeeId, setLookupEmployeeId] = useState('');
  const [employeeLoans, setEmployeeLoans] = useState<EmployeeLoan[] | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);

  // Loan status + repayment
  const [loanId, setLoanId] = useState('');
  const [status, setStatus] = useState<EmployeeLoanStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [repaymentAmount, setRepaymentAmount] = useState('');
  const [repaidAt, setRepaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [repaymentReason, setRepaymentReason] = useState('');
  const [isRepaying, setIsRepaying] = useState(false);
  const [repaymentError, setRepaymentError] = useState<string | null>(null);

  async function handleIssue(e: React.FormEvent) {
    e.preventDefault();
    if (isIssuing) return;
    setIssueError(null);
    setIssuedLoan(null);
    const amount = Number(borrowedAmount);
    if (!employeeUserId.trim() || !borrowedAmount || !Number.isInteger(amount) || amount <= 0) {
      setIssueError('Employee user id and a positive integer amount (minor units) are required.');
      return;
    }
    if (!window.confirm(`Issue a loan of ${minor(amount)} to this employee? This is a financial record and cannot be deleted.`)) {
      return;
    }
    setIsIssuing(true);
    try {
      const loan = await issueEmployeeLoan({
        employeeUserId: employeeUserId.trim(),
        borrowedAmountMinor: amount,
        issuedAt: new Date(issuedAt).toISOString(),
        reason: issueReason || undefined,
      });
      setIssuedLoan(loan);
      setBorrowedAmount('');
      setIssueReason('');
    } catch (err: any) {
      setIssueError(apiErrorMessage(err, 'Failed to issue loan.'));
    } finally {
      setIsIssuing(false);
    }
  }

  async function handleLookupByEmployee(e: React.FormEvent) {
    e.preventDefault();
    if (isLookingUp) return;
    setLookupError(null);
    setIsLookingUp(true);
    try {
      setEmployeeLoans(await listLoansForEmployee(lookupEmployeeId.trim()));
    } catch (err: any) {
      setLookupError(apiErrorMessage(err, 'Failed to load loans.'));
    } finally {
      setIsLookingUp(false);
    }
  }

  async function loadStatus() {
    setStatusError(null);
    setIsLoadingStatus(true);
    try {
      setStatus(await getEmployeeLoanStatus(loanId.trim()));
    } catch (err: any) {
      setStatusError(apiErrorMessage(err, 'Failed to load loan status.'));
      setStatus(null);
    } finally {
      setIsLoadingStatus(false);
    }
  }

  async function handleLoadStatus(e: React.FormEvent) {
    e.preventDefault();
    if (!loanId.trim() || isLoadingStatus) return;
    await loadStatus();
  }

  async function handleRecordRepayment(e: React.FormEvent) {
    e.preventDefault();
    if (isRepaying || !status) return;
    setRepaymentError(null);
    const amount = Number(repaymentAmount);
    if (!repaymentAmount || !Number.isInteger(amount) || amount <= 0) {
      setRepaymentError('Enter a positive integer amount (minor units).');
      return;
    }
    if (!window.confirm(`Record a repayment of ${minor(amount)}? This is a financial record and cannot be deleted.`)) {
      return;
    }
    setIsRepaying(true);
    try {
      await recordLoanRepayment(status.loan.id, {
        amountMinor: amount,
        repaidAt: new Date(repaidAt).toISOString(),
        reason: repaymentReason || undefined,
      });
      setRepaymentAmount('');
      setRepaymentReason('');
      await loadStatus(); // refresh/reconcile from the server, not local arithmetic
    } catch (err: any) {
      setRepaymentError(apiErrorMessage(err, 'Failed to record repayment.'));
    } finally {
      setIsRepaying(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold">Employee Loans</h1>

      <section className="rounded border bg-white p-4">
        <h2 className="font-semibold">Issue Loan</h2>
        <form onSubmit={handleIssue} className="mt-3 space-y-2">
          <input value={employeeUserId} onChange={(e) => setEmployeeUserId(e.target.value)} placeholder="Employee user id" className="w-full rounded border px-2 py-1.5 text-sm" />
          <input type="number" min={1} step={1} value={borrowedAmount} onChange={(e) => setBorrowedAmount(e.target.value)} placeholder="Amount (minor units)" className="w-full rounded border px-2 py-1.5 text-sm" />
          <input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} className="w-full rounded border px-2 py-1.5 text-sm" />
          <input value={issueReason} onChange={(e) => setIssueReason(e.target.value)} placeholder="Reason (optional)" className="w-full rounded border px-2 py-1.5 text-sm" />
          {issueError && <p className="text-sm text-red-600">{issueError}</p>}
          {issuedLoan && <p className="text-sm text-green-700">Loan issued: {minor(issuedLoan.borrowedAmountMinor)} (id {issuedLoan.id.slice(0, 8)}).</p>}
          <button type="submit" disabled={isIssuing} className="rounded bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {isIssuing ? 'Issuing...' : 'Issue Loan'}
          </button>
        </form>
      </section>

      <section className="rounded border bg-white p-4">
        <h2 className="font-semibold">Loans for an Employee</h2>
        <form onSubmit={handleLookupByEmployee} className="mt-3 flex gap-2">
          <input value={lookupEmployeeId} onChange={(e) => setLookupEmployeeId(e.target.value)} placeholder="Employee user id" className="flex-1 rounded border px-2 py-1.5 text-sm" />
          <button type="submit" disabled={isLookingUp || !lookupEmployeeId.trim()} className="rounded bg-gray-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {isLookingUp ? 'Loading...' : 'Look Up'}
          </button>
        </form>
        {lookupError && <p className="mt-2 text-sm text-red-600">{lookupError}</p>}
        {employeeLoans !== null && employeeLoans.length === 0 && <p className="mt-2 text-sm text-gray-500">No loans for this employee.</p>}
        {employeeLoans !== null && employeeLoans.length > 0 && (
          <ul className="mt-2 divide-y">
            {employeeLoans.map((loan) => (
              <li key={loan.id} className="py-2 text-sm">
                <button onClick={() => setLoanId(loan.id)} className="text-hatly-orange underline">
                  {loan.id.slice(0, 8)}
                </button>{' '}
                — {minor(loan.borrowedAmountMinor)} — issued {new Date(loan.issuedAt).toLocaleDateString()}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded border bg-white p-4">
        <h2 className="font-semibold">Loan Status &amp; Repayment</h2>
        <form onSubmit={handleLoadStatus} className="mt-3 flex gap-2">
          <input value={loanId} onChange={(e) => setLoanId(e.target.value)} placeholder="Loan id" className="flex-1 rounded border px-2 py-1.5 text-sm" />
          <button type="submit" disabled={isLoadingStatus || !loanId.trim()} className="rounded bg-gray-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {isLoadingStatus ? 'Loading...' : 'Look Up'}
          </button>
        </form>
        {statusError && <p className="mt-2 text-sm text-red-600">{statusError}</p>}

        {status && (
          <div className="mt-3 space-y-3">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-gray-600">Borrowed</dt>
              <dd>{minor(status.loan.borrowedAmountMinor)}</dd>
              <dt className="text-gray-600">Repaid</dt>
              <dd>{minor(status.totalRepaidMinor)}</dd>
              <dt className="text-gray-600">Outstanding</dt>
              <dd className="font-medium">{minor(status.outstandingMinor)}</dd>
              <dt className="text-gray-600">Fully repaid</dt>
              <dd>{status.fullyRepaid ? 'Yes' : 'No'}</dd>
            </dl>

            {!status.fullyRepaid && (
              <form onSubmit={handleRecordRepayment} className="space-y-2 border-t pt-3">
                <p className="text-sm font-medium">Record Repayment</p>
                <input type="number" min={1} step={1} value={repaymentAmount} onChange={(e) => setRepaymentAmount(e.target.value)} placeholder="Amount (minor units)" className="w-full rounded border px-2 py-1.5 text-sm" />
                <input type="date" value={repaidAt} onChange={(e) => setRepaidAt(e.target.value)} className="w-full rounded border px-2 py-1.5 text-sm" />
                <input value={repaymentReason} onChange={(e) => setRepaymentReason(e.target.value)} placeholder="Reason (optional)" className="w-full rounded border px-2 py-1.5 text-sm" />
                {repaymentError && <p className="text-sm text-red-600">{repaymentError}</p>}
                <button type="submit" disabled={isRepaying} className="rounded bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                  {isRepaying ? 'Recording...' : 'Record Repayment'}
                </button>
              </form>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

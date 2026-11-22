'use client';

import { useEffect, useState } from 'react';
import {
  EmployeeLoan,
  EmployeeLoanStatus,
  getEmployeeLoanStatus,
  issueEmployeeLoan,
  listLoansForEmployee,
  recordLoanRepayment,
} from '../../../lib/api/admin-employee-loans';
import { apiErrorMessage } from '../../../lib/api/errors';
import { parseEgpToMinor } from '../../../lib/money';
import { useLang } from '../../../lib/ui/lang';
import { useApi } from '../../../lib/ui/api';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, inputCls, KpiCard, LabeledInput, LabeledTextarea, PageHeader, Tabs, useToast } from '../../../components/ui';

/**
 * Employee Loans. Reuses the existing `admin/employee-loans` endpoints exactly: issue a loan, record a repayment, read a loan's status, list an
 * employee's loans. There is deliberately no employee picker (the backend has no such endpoint; building one would drift into user management), so
 * an employee is found by user id. Loans and repayments are financial records that cannot be deleted: each is confirmed first, amounts are entered in
 * EGP and converted to minor units by string parsing only, and everything shown is re-read from the backend.
 */
const today = () => new Date().toISOString().slice(0, 10);
const asMinor = (v: string): number | null => { const r = parseEgpToMinor(v); return r.ok ? r.minor : null; };

export default function EmployeeLoansPage() {
  const { t, money, date } = useLang();
  const toast = useToast();
  const [tab, setTab] = useState<'loans' | 'issue'>('loans');

  // Look up
  const [employeeId, setEmployeeId] = useState('');
  // Drivers to choose from (name, phone, what they owe now) — no raw account ids typed by hand.
  const people = useApi<Array<{ userId: string; fullName: string; phone: string; outstandingMinor: number }>>('/admin/employee-loans/people');
  const [loans, setLoans] = useState<EmployeeLoan[] | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);

  // Selected loan
  const [status, setStatus] = useState<EmployeeLoanStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [repayAmount, setRepayAmount] = useState('');
  const [repaidAt, setRepaidAt] = useState(today);
  const [repayReason, setRepayReason] = useState('');
  const [repayError, setRepayError] = useState<string | null>(null);
  const [confirmRepay, setConfirmRepay] = useState(false);
  const [repaying, setRepaying] = useState(false);

  // Issue
  const [issueEmployee, setIssueEmployee] = useState('');
  const [borrowed, setBorrowed] = useState('');
  const [issuedAt, setIssuedAt] = useState(today);
  const [issueReason, setIssueReason] = useState('');
  const [issueError, setIssueError] = useState<string | null>(null);
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [issuing, setIssuing] = useState(false);

  // Opened from a courier's shift closing (?person=<user id>): show that person's loans straight away.
  useEffect(() => {
    const person = new URLSearchParams(window.location.search).get('person');
    if (person && /^[0-9a-f-]{36}$/i.test(person)) { setEmployeeId(person); void lookup(undefined, person); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function lookup(e?: React.FormEvent, id = employeeId) {
    e?.preventDefault();
    if (!id.trim() || looking) return;
    setLookupError(null);
    setLooking(true);
    try {
      setLoans(await listLoansForEmployee(id.trim()));
      setStatus(null);
    } catch (err: any) {
      setLoans(null);
      setLookupError(apiErrorMessage(err, t('Failed to load loans.', 'تعذّر تحميل السلف.')));
    } finally {
      setLooking(false);
    }
  }

  async function openLoan(id: string) {
    setStatusError(null);
    try {
      setStatus(await getEmployeeLoanStatus(id));
      setRepayAmount(''); setRepayReason(''); setRepayError(null);
    } catch (err: any) {
      setStatus(null);
      setStatusError(apiErrorMessage(err, t('Failed to load loan status.', 'تعذّر تحميل حالة السلفة.')));
    }
  }

  function askRepay(e: React.FormEvent) {
    e.preventDefault();
    setRepayError(null);
    if (asMinor(repayAmount) === null) return setRepayError(t('Enter a repayment amount in EGP, for example 250 or 250.50.', 'أدخل مبلغ السداد بالجنيه، مثل 250 أو 250.50.'));
    setConfirmRepay(true);
  }

  async function repay() {
    const amount = asMinor(repayAmount);
    if (!status || amount === null || repaying) return;
    setRepaying(true);
    try {
      await recordLoanRepayment(status.loan.id, { amountMinor: amount, repaidAt: new Date(repaidAt).toISOString(), reason: repayReason || undefined });
      toast.push('success', t('Repayment recorded.', 'تم تسجيل السداد.'));
      setConfirmRepay(false);
      await openLoan(status.loan.id);
    } catch (err: any) {
      setConfirmRepay(false);
      setRepayError(apiErrorMessage(err, t('Failed to record repayment.', 'تعذّر تسجيل السداد.')));
    } finally {
      setRepaying(false);
    }
  }

  function askIssue(e: React.FormEvent) {
    e.preventDefault();
    setIssueError(null);
    if (!issueEmployee.trim()) return setIssueError(t('The employee’s user id is required.', 'معرّف المستخدم للموظف مطلوب.'));
    if (asMinor(borrowed) === null) return setIssueError(t('Enter the loan amount in EGP, for example 1000 or 1000.50.', 'أدخل مبلغ السلفة بالجنيه، مثل 1000 أو 1000.50.'));
    setConfirmIssue(true);
  }

  async function issue() {
    const amount = asMinor(borrowed);
    if (amount === null || issuing) return;
    setIssuing(true);
    try {
      const loan = await issueEmployeeLoan({ employeeUserId: issueEmployee.trim(), borrowedAmountMinor: amount, issuedAt: new Date(issuedAt).toISOString(), reason: issueReason || undefined });
      toast.push('success', t('Loan issued.', 'تم إصدار السلفة.'));
      setConfirmIssue(false);
      setBorrowed(''); setIssueReason('');
      setEmployeeId(loan.employeeUserId);
      setTab('loans');
      await lookup(undefined, loan.employeeUserId);
      await openLoan(loan.id);
    } catch (err: any) {
      setConfirmIssue(false);
      setIssueError(apiErrorMessage(err, t('Failed to issue loan.', 'تعذّر إصدار السلفة.')));
    } finally {
      setIssuing(false);
    }
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={t('Employee Loans', 'سلف الموظفين')}
        subtitle={t('Issue a loan to an employee, record repayments, and see what is still outstanding. Loans and repayments are permanent financial records.', 'أصدر سلفة لموظف، وسجّل السداد، وتابع المتبقي. السلف والسداد سجلات مالية دائمة.')}
      />
      <div className="mb-4"><Tabs value={tab} onChange={(id) => setTab(id as 'loans' | 'issue')} tabs={[{ id: 'loans', label: t('Look up loans', 'البحث عن السلف') }, { id: 'issue', label: t('Issue a loan', 'إصدار سلفة') }]} /></div>

      {tab === 'issue' && (
        <Card title={t('Issue a loan', 'إصدار سلفة')}>
          <form onSubmit={askIssue} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="loan-issue-driver" className="mb-1 block text-xs font-medium text-gray-700">{t('Driver', 'المندوب')}</label>
              <select id="loan-issue-driver" required value={issueEmployee} onChange={(e) => setIssueEmployee(e.target.value)} className={`${inputCls} min-h-[44px]`}>
                <option value="">{t('Choose a driver…', 'اختر مندوبًا…')}</option>
                {(people.data ?? []).map((d) => <option key={d.userId} value={d.userId}>{d.fullName} · {d.phone}{d.outstandingMinor > 0 ? ` · ${t('owes', 'عليه')} ${money(d.outstandingMinor)}` : ''}</option>)}
              </select>
            </div>
            <LabeledInput label={t('Amount (EGP)', 'المبلغ (ج.م)')} inputMode="decimal" dir="ltr" placeholder="0.00" value={borrowed} onChange={(e) => setBorrowed(e.target.value)} hint={asMinor(borrowed) !== null ? `= ${money(asMinor(borrowed))}` : undefined} required />
            <LabeledInput label={t('Issued on', 'تاريخ الإصدار')} type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} required />
            <div className="sm:col-span-2"><LabeledTextarea label={t('Reason (optional)', 'السبب (اختياري)')} rows={2} value={issueReason} onChange={(e) => setIssueReason(e.target.value)} /></div>
            {issueError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{issueError}</p>}
            <div className="sm:col-span-2"><Button type="submit" variant="primary" className="min-h-[44px] w-full sm:w-auto">{t('Issue loan', 'إصدار السلفة')}</Button></div>
          </form>
        </Card>
      )}

      {tab === 'loans' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="space-y-4 lg:col-span-2">
            <Card title={t('Find an employee’s loans', 'ابحث عن سلف موظف')}>
              <form onSubmit={lookup} className="space-y-2">
                <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} aria-label={t('Driver', 'المندوب')} className={`${inputCls} min-h-[44px]`}>
                  <option value="">{t('Choose a driver…', 'اختر مندوبًا…')}</option>
                  {(people.data ?? []).map((d) => <option key={d.userId} value={d.userId}>{d.fullName} · {d.phone}{d.outstandingMinor > 0 ? ` · ${t('owes', 'عليه')} ${money(d.outstandingMinor)}` : ''}</option>)}
                </select>
                <Button type="submit" variant="primary" loading={looking} disabled={!employeeId.trim()} className="min-h-[44px] w-full">{t('Look up', 'بحث')}</Button>
              </form>

            </Card>
            {lookupError && <ErrorState message={lookupError} onRetry={() => void lookup()} />}
            {loans && (
              <Card title={t(`Loans (${loans.length})`, `السلف (${loans.length})`)} pad={false}>
                {loans.length === 0 ? <EmptyState title={t('This employee has no loans.', 'لا توجد سلف لهذا الموظف.')} action={<Button onClick={() => { setIssueEmployee(employeeId); setTab('issue'); }}>{t('Issue a loan', 'إصدار سلفة')}</Button>} /> : (
                  <ul className="divide-y divide-gray-100">
                    {loans.map((l) => (
                      <li key={l.id}>
                        <button onClick={() => void openLoan(l.id)} className={`flex min-h-[56px] w-full items-center justify-between gap-3 px-4 py-2 text-start hover:bg-gray-50 ${status?.loan.id === l.id ? 'bg-orange-50' : ''}`}>
                          <span><span className="block font-semibold tabular-nums">{money(l.borrowedAmountMinor)}</span><span className="text-xs text-gray-500">{t('Issued', 'أُصدرت')} {date(l.issuedAt)}</span></span>
                          <span className="font-mono text-xs text-gray-500" dir="ltr">#{l.id.slice(0, 8)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
          </div>

          <div className="space-y-4 lg:col-span-3">
            {statusError && <ErrorState message={statusError} />}
            {!status && !statusError && <Card><EmptyState title={t('Pick a loan', 'اختر سلفة')} hint={t('Look up an employee, then choose a loan to see its repayments.', 'ابحث عن موظف ثم اختر سلفة لعرض سدادها.')} /></Card>}
            {status && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <KpiCard label={t('Borrowed', 'المقترَض')} value={money(status.loan.borrowedAmountMinor)} />
                  <KpiCard label={t('Repaid', 'المسدَّد')} value={money(status.totalRepaidMinor)} tone="good" />
                  <KpiCard label={t('Outstanding', 'المتبقي')} value={money(status.outstandingMinor)} tone={status.fullyRepaid ? 'good' : 'bad'} />
                </div>
                <Card title={t('Repayments', 'السداد')} actions={status.fullyRepaid ? <Badge tone="green">{t('Fully repaid', 'تم السداد بالكامل')}</Badge> : undefined}>
                  {status.loan.reason && <p className="mb-2 text-sm text-gray-600">{t('Loan reason', 'سبب السلفة')}: {status.loan.reason}</p>}
                  {status.repayments.length === 0 ? <p className="text-sm text-gray-500">{t('No repayments yet.', 'لا يوجد سداد بعد.')}</p> : (
                    <ul className="divide-y divide-gray-100 text-sm">
                      {status.repayments.map((r) => <li key={r.id} className="flex items-center justify-between gap-3 py-2"><span>{date(r.repaidAt)}{r.reason && <span className="ms-2 text-xs text-gray-500">{r.reason}</span>}</span><span className="tabular-nums font-medium">{money(r.amountMinor)}</span></li>)}
                    </ul>
                  )}
                </Card>
                {!status.fullyRepaid && (
                  <Card title={t('Record a repayment', 'تسجيل سداد')}>
                    <form onSubmit={askRepay} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <LabeledInput label={t('Amount (EGP)', 'المبلغ (ج.م)')} inputMode="decimal" dir="ltr" placeholder="0.00" value={repayAmount} onChange={(e) => setRepayAmount(e.target.value)} hint={asMinor(repayAmount) !== null ? `= ${money(asMinor(repayAmount))}` : undefined} required />
                      <LabeledInput label={t('Repaid on', 'تاريخ السداد')} type="date" value={repaidAt} onChange={(e) => setRepaidAt(e.target.value)} required />
                      <div className="sm:col-span-2"><LabeledInput label={t('Note (optional)', 'ملاحظة (اختياري)')} value={repayReason} onChange={(e) => setRepayReason(e.target.value)} /></div>
                      {repayError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{repayError}</p>}
                      <div className="sm:col-span-2"><Button type="submit" variant="primary" className="min-h-[44px] w-full sm:w-auto">{t('Record repayment', 'تسجيل السداد')}</Button></div>
                    </form>
                  </Card>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog open={confirmIssue} title={t('Issue this loan?', 'إصدار هذه السلفة؟')} message={t(`Issue a loan of ${money(asMinor(borrowed))} to this employee. It is a financial record and cannot be deleted.`, `إصدار سلفة بقيمة ${money(asMinor(borrowed))} لهذا الموظف. هي سجل مالي ولا يمكن حذفها.`)} confirmLabel={t('Issue loan', 'إصدار السلفة')} busy={issuing} onConfirm={() => void issue()} onClose={() => setConfirmIssue(false)} />
      <ConfirmDialog open={confirmRepay} title={t('Record this repayment?', 'تسجيل هذا السداد؟')} message={t(`Record a repayment of ${money(asMinor(repayAmount))}. It is a financial record and cannot be deleted.`, `تسجيل سداد بقيمة ${money(asMinor(repayAmount))}. هو سجل مالي ولا يمكن حذفه.`)} confirmLabel={t('Record repayment', 'تسجيل السداد')} busy={repaying} onConfirm={() => void repay()} onClose={() => setConfirmRepay(false)} />
    </div>
  );
}

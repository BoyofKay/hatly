'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, PageHeader, Tabs, useToast } from '../../../components/ui';
import { useLang } from '../../../lib/ui/lang';
import { apiErrorMessage } from '../../../lib/api/errors';
import { decideBranchRequest, describeRequest, listBranchRequests, type BranchChangeRequest } from '../../../lib/api/branch-change-requests';

/**
 * R8/R44 (decision register 2026-11-07): stores ask Hatly to pause or reopen, change weekly hours, or schedule / end a temporary closure.
 * Operations approve (the change is applied at once and affects new orders only) or reject (nothing changes). Admin can still make these
 * changes directly on the Branches page.
 */
export default function BranchRequestsPage() {
  const { t, dateTime } = useLang();
  const toast = useToast();
  const [status, setStatus] = useState('PENDING');
  const [rows, setRows] = useState<BranchChangeRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    setError(null);
    try { setRows(await listBranchRequests(status)); } catch (e) { setError(apiErrorMessage(e, t('Could not load the requests.', 'تعذّر تحميل الطلبات.'))); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  useEffect(() => { void load(); }, [load]);

  async function decide(r: BranchChangeRequest, decision: 'approve' | 'reject') {
    setBusy(r.id);
    try {
      await decideBranchRequest(r.id, decision, notes[r.id]);
      toast.push('success', decision === 'approve' ? t('Approved and applied.', 'تمت الموافقة والتطبيق.') : t('Rejected — nothing changed.', 'تم الرفض — لم يتغير شيء.'));
      await load();
    } catch (e) { toast.push('error', apiErrorMessage(e, t('The decision could not be saved.', 'تعذّر حفظ القرار.'))); await load(); } finally { setBusy(null); }
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t('Store requests', 'طلبات المتاجر')} subtitle={t('Stores ask to pause or reopen, change their hours, or close temporarily. Approving applies the change to new orders only.', 'تطلب المتاجر الإيقاف المؤقت أو إعادة الفتح أو تغيير المواعيد أو الإغلاق المؤقت. الموافقة تطبق التغيير على الطلبات الجديدة فقط.')} />
      <Tabs tabs={[{ id: 'PENDING', label: t('Waiting', 'بالانتظار') }, { id: 'APPROVED', label: t('Approved', 'موافق عليها') }, { id: 'REJECTED', label: t('Rejected', 'مرفوضة') }, { id: 'WITHDRAWN', label: t('Withdrawn', 'مسحوبة') }]} value={status} onChange={setStatus} />
      <Card pad={false}>
        {error && <p role="alert" className="p-4 text-sm text-red-700">{error}</p>}
        {!error && rows && rows.length === 0 && <p className="p-4 text-sm text-gray-500" data-testid="branch-requests-empty">{t('No requests here.', 'لا توجد طلبات هنا.')}</p>}
        <ul className="divide-y divide-gray-100" data-testid="branch-requests-list">
          {(rows ?? []).map((r) => (
            <li key={r.id} className="flex flex-col gap-2 p-4 text-sm sm:flex-row sm:items-center sm:justify-between" data-testid={`branch-request-${r.id}`}>
              <div className="min-w-0">
                <p className="font-medium"><bdi>{r.vendorName}</bdi> · <bdi>{r.branchName}</bdi></p>
                <p>{describeRequest(r, t, (iso) => dateTime(iso))}</p>
                <p className="text-xs text-gray-500">{t('Asked by', 'بواسطة')} {r.requestedBy} · {dateTime(r.createdAt)}{r.reason ? ` · ${r.reason}` : ''}</p>
                {r.status !== 'PENDING' && <p className="text-xs text-gray-500">{r.decidedBy ? `${r.decidedBy} · ` : ''}{r.decidedAt ? dateTime(r.decidedAt) : ''}{r.decisionNote ? ` · ${r.decisionNote}` : ''}</p>}
              </div>
              {r.status === 'PENDING' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input aria-label={t('Note (optional)', 'ملاحظة (اختيارية)')} placeholder={t('Note (optional)', 'ملاحظة (اختيارية)')} value={notes[r.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} className="min-h-[40px] w-48 rounded-lg border border-gray-300 px-2 text-sm" />
                  <Button variant="primary" size="sm" loading={busy === r.id} onClick={() => decide(r, 'approve')} data-testid={`approve-${r.id}`}>{t('Approve', 'موافقة')}</Button>
                  <Button size="sm" disabled={busy === r.id} onClick={() => decide(r, 'reject')} data-testid={`reject-${r.id}`}>{t('Reject', 'رفض')}</Button>
                </div>
              ) : <Badge tone={r.status === 'APPROVED' ? 'green' : r.status === 'REJECTED' ? 'red' : 'gray'}>{r.status}</Badge>}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

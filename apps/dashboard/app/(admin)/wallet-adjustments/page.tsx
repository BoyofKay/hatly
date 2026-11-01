'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, Card, ConfirmDialog, DataTable, FilterBar, LabeledSelect, PageHeader, Pagination, StatusPill, useToast, usePaging } from '../../../components/ui';
import { send, useApi } from '../../../lib/ui/api';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useLang } from '../../../lib/ui/lang';
import { usePermissions } from '../../../lib/ui/permissions';

export default function WalletAdjustmentsPage() {
  const { t, money, dateTime } = useLang();
  const { can } = usePermissions();
  const toast = useToast();
  const [status, setStatus] = useState('PENDING');
  const { page, setPage, limit } = usePaging(status);
  const list = useApi<any[]>('/admin/wallet-adjustments', { status: status || undefined, page, limit });
  const [target, setTarget] = useState<{ id: string; kind: 'approve' | 'reject' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decide = async (note: string) => {
    if (!target) return;
    setBusy(true); setError(null);
    try { await send('post', `/admin/wallet-adjustments/${target.id}/${target.kind}`, { note: note || undefined }); toast.push('success', target.kind === 'approve' ? t('Approved and applied to the wallet ledger.', 'تمت الموافقة والتطبيق على سجل المحفظة.') : t('Rejected.', 'تم الرفض.')); setTarget(null); list.reload(); }
    catch (e) { setError(apiErrorMessage(e, t('The decision failed.', 'فشل القرار.'))); } finally { setBusy(false); }
  };
  return (
    <div>
      <PageHeader title={t('Wallet adjustments', 'تعديلات المحفظة')} subtitle={t('Adjustments above the approval threshold wait here for a second admin. You can never approve one you requested. Approved adjustments create exactly one wallet ledger row.', 'التعديلات فوق حد الموافقة تنتظر هنا مسؤولًا ثانيًا. لا يمكنك الموافقة على تعديل طلبته. التعديل المعتمد ينشئ قيدًا واحدًا فقط في سجل المحفظة.')} />
      <FilterBar><div className="w-48"><LabeledSelect label={t('Status', 'الحالة')} value={status} onChange={(e) => setStatus(e.target.value)}><option value="PENDING">{t('Waiting for approval', 'بانتظار الموافقة')}</option><option value="APPLIED">{t('Applied', 'مطبّقة')}</option><option value="REJECTED">{t('Rejected', 'مرفوضة')}</option><option value="">{t('All', 'الكل')}</option></LabeledSelect></div></FilterBar>
      <Card pad={false}>
        <DataTable rows={list.data} rowKey={(r) => r.id} loading={list.loading} error={list.error} status={list.status} onRetry={list.reload} emptyTitle={t('No adjustments', 'لا توجد تعديلات')} columns={[
          { key: 'at', header: t('Requested', 'الطلب'), cell: (r) => dateTime(r.createdAt) },
          { key: 'c', header: t('Customer', 'العميل'), cell: (r) => <Link className="text-hatly-orangeDark hover:underline" href={`/customers/${r.customerId}`}><bdi>{r.customerName}</bdi></Link> },
          { key: 'a', header: t('Amount', 'المبلغ'), align: 'end', cell: (r) => <span className={r.amountMinor < 0 ? 'text-red-700' : 'text-green-700'}>{money(r.amountMinor)}</span> },
          { key: 'why', header: t('Reason', 'السبب'), cell: (r) => <span>{r.reasonCode.replace(/_/g, ' ')}{r.note ? <span className="text-gray-500"> · <bdi>{r.note}</bdi></span> : null}</span> },
          { key: 'by', header: t('Requested by', 'طلبها'), cell: (r) => <bdi>{r.requestedByName}</bdi> },
          { key: 's', header: t('Status', 'الحالة'), cell: (r) => <StatusPill status={r.status} /> },
          { key: 'act', header: '', align: 'end', cell: (r) => r.status === 'PENDING' && can('WALLET_ADJUST_APPROVE') ? <span className="flex justify-end gap-2"><Button size="sm" variant="primary" onClick={() => { setError(null); setTarget({ id: r.id, kind: 'approve' }); }}>{t('Approve', 'موافقة')}</Button><Button size="sm" onClick={() => { setError(null); setTarget({ id: r.id, kind: 'reject' }); }}>{t('Reject', 'رفض')}</Button></span> : null },
        ]} />
        {list.meta && <Pagination page={page} limit={limit} total={list.meta.total} onPage={setPage} />}
      </Card>
      <ConfirmDialog open={Boolean(target)} title={target?.kind === 'approve' ? t('Approve this adjustment?', 'الموافقة على هذا التعديل؟') : t('Reject this adjustment?', 'رفض هذا التعديل؟')} message={target?.kind === 'approve' ? t('It is applied to the wallet ledger immediately. A debit that would take the wallet below zero is refused.', 'يُطبَّق فورًا على سجل المحفظة. يُرفض الخصم الذي يجعل الرصيد سالبًا.') : t('The customer wallet is not changed.', 'لا يتغير رصيد العميل.')} confirmLabel={target?.kind === 'approve' ? t('Approve', 'موافقة') : t('Reject', 'رفض')} reasonLabel={target?.kind === 'reject' ? t('Reason (required)', 'السبب (مطلوب)') : t('Note (optional)', 'ملاحظة (اختياري)')} reasonMin={target?.kind === 'reject' ? 5 : 0} busy={busy} error={error} onConfirm={decide} onClose={() => setTarget(null)} />
    </div>
  );
}

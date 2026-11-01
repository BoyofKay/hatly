'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Async, Button, Card, ConfirmDialog, DataTable, KpiCard, PageHeader, Pagination, StatusPill, usePaging, useToast } from '../../../../components/ui';
import { send, useApi } from '../../../../lib/ui/api';
import { apiErrorCode, apiErrorMessage } from '../../../../lib/api/errors';
import { useLang } from '../../../../lib/ui/lang';
import { usePermissions } from '../../../../lib/ui/permissions';
import { BroadcastForm } from '../../../../components/marketing/BroadcastForm';

export default function BroadcastDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, num, dateTime } = useLang();
  const { can } = usePermissions();
  const toast = useToast();
  const b = useApi<any>(`/admin/broadcasts/${id}`, undefined, { refreshInterval: 15000 });
  const { page, setPage, limit } = usePaging(id, 25);
  const rec = useApi<any[]>(`/admin/broadcasts/${id}/recipients`, { page, limit });
  const [edit, setEdit] = useState(false);
  const [dlg, setDlg] = useState<null | 'reject' | 'cancel' | 'quiet'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = b.data;

  const act = async (path: string, body?: unknown, okMsg?: string) => {
    setBusy(true); setError(null);
    try { await send('post', `/admin/broadcasts/${id}/${path}`, body); if (okMsg) toast.push('success', okMsg); setDlg(null); b.reload(); rec.reload(); }
    catch (e) { if (apiErrorCode(e) === 'QUIET_HOURS') { setDlg('quiet'); setError(apiErrorMessage(e, '')); } else setError(apiErrorMessage(e, t('The action failed.', 'فشل الإجراء.'))); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <p className="mb-2 text-sm"><Link className="text-hatly-orangeDark hover:underline" href="/broadcasts">← {t('Broadcasts', 'الرسائل الجماعية')}</Link></p>
      <Async state={b} rows={4}>
        {d && (
          <>
            <PageHeader title={d.titleEn} subtitle={`${t('Audience', 'الجمهور')}: ${d.audienceName} · ${d.channels.join(' + ')} · ${d.status.replace(/_/g, ' ')}`} actions={
              <span className="flex flex-wrap gap-2">
                {d.status === 'DRAFT' && can('MANAGE_BROADCASTS') && <><Button onClick={() => setEdit(true)}>{t('Edit', 'تعديل')}</Button><Button variant="primary" loading={busy} onClick={() => act('submit', undefined, t('Submitted for approval.', 'أُرسلت للموافقة.'))}>{t('Submit for approval', 'إرسال للموافقة')}</Button></>}
                {d.status === 'PENDING_APPROVAL' && can('BROADCAST_APPROVE') && <><Button variant="primary" loading={busy} onClick={() => act('approve', {}, t('Approved.', 'تمت الموافقة.'))}>{t('Approve & send', 'موافقة وإرسال')}</Button><Button onClick={() => { setError(null); setDlg('reject'); }}>{t('Reject…', 'رفض…')}</Button></>}
                {['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'SENDING'].includes(d.status) && can('MANAGE_BROADCASTS') && <Button variant="danger" onClick={() => { setError(null); setDlg('cancel'); }}>{t('Cancel', 'إلغاء')}</Button>}
              </span>
            } />
            {error && !dlg && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            {d.rejectionReason && d.status === 'DRAFT' && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{t('Returned by the reviewer:', 'أعادها المراجع:')} <bdi>{d.rejectionReason}</bdi></p>}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card title="English"><p className="font-medium"><bdi>{d.titleEn}</bdi></p><p className="mt-1 whitespace-pre-wrap text-sm"><bdi>{d.bodyEn}</bdi></p></Card>
              <Card title="العربية"><div dir="rtl"><p className="font-medium">{d.titleAr}</p><p className="mt-1 whitespace-pre-wrap text-sm">{d.bodyAr}</p></div></Card>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:max-w-xl">
              <dt className="text-gray-500">{t('Opens', 'يفتح')}</dt><dd>{d.deepLink ?? '—'}</dd>
              <dt className="text-gray-500">{t('Scheduled', 'مجدولة')}</dt><dd>{d.scheduledAt ? dateTime(d.scheduledAt) : t('Immediately after approval', 'فور الموافقة')}</dd>
              <dt className="text-gray-500">{t('Created by', 'أنشأها')}</dt><dd><bdi>{d.createdByName}</bdi> · {dateTime(d.createdAt)}</dd>
              {d.approvedAt && <><dt className="text-gray-500">{t('Approved', 'اعتُمدت')}</dt><dd>{dateTime(d.approvedAt)}</dd></>}
            </dl>
            {d.stats.recipients > 0 && (
              <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
                <KpiCard label={t('Recipients', 'المستلمون')} value={num(d.stats.recipients)} />
                <KpiCard label={t('Delivered', 'سُلّمت')} value={num(d.stats.sent)} />
                <KpiCard label={t('Opened', 'فُتحت')} value={num(d.stats.opened)} />
                <KpiCard label={t('Failed', 'فشلت')} value={num(d.stats.failed)} tone={d.stats.failed ? 'bad' : 'neutral'} />
                <KpiCard label={t('Skipped (limits)', 'تُخطيت (الحدود)')} value={num(d.stats.skipped)} hint={t('Customers already messaged today or opted out.', 'عملاء راسلناهم اليوم أو ألغوا الاشتراك.')} />
              </div>
            )}
            <Card title={t('Recipients', 'المستلمون')} className="mt-4" pad={false}>
              <DataTable rows={rec.data} rowKey={(r: any) => r.id} loading={rec.loading} error={rec.error} status={rec.status} onRetry={rec.reload} emptyTitle={t('No recipients yet — they are chosen when the broadcast is sent.', 'لا مستلمون بعد — يُختارون عند الإرسال.')} columns={[
                { key: 'c', header: t('Customer', 'العميل'), cell: (r: any) => <Link className="text-hatly-orangeDark hover:underline" href={`/customers/${r.customerId}`}>{r.customerId.slice(0, 8)}…</Link> },
                { key: 's', header: t('Status', 'الحالة'), cell: (r: any) => <StatusPill status={r.status} /> },
                { key: 'a', header: t('Attempts', 'المحاولات'), align: 'end', cell: (r: any) => num(r.attempts) },
                { key: 'e', header: t('Note', 'ملاحظة'), cell: (r: any) => r.lastError ?? '' },
                { key: 't', header: t('Sent', 'أُرسلت'), cell: (r: any) => (r.sentAt ? dateTime(r.sentAt) : '—') },
              ]} />
              {rec.meta && <Pagination page={page} limit={limit} total={rec.meta.total} onPage={setPage} />}
            </Card>
            {edit && <BroadcastForm open initial={d} onClose={() => setEdit(false)} onSaved={() => b.reload()} />}
            <ConfirmDialog open={dlg === 'reject'} title={t('Return to the author?', 'إعادتها إلى كاتبها؟')} message={t('It goes back to draft with your reason.', 'تعود مسودة مع سببك.')} confirmLabel={t('Reject', 'رفض')} reasonLabel={t('Reason (required)', 'السبب (مطلوب)')} reasonMin={5} busy={busy} error={error} onConfirm={(reason) => act('reject', { reason }, t('Returned.', 'أُعيدت.'))} onClose={() => setDlg(null)} />
            <ConfirmDialog open={dlg === 'cancel'} danger title={t('Cancel this broadcast?', 'إلغاء هذه الرسالة؟')} message={t('Messages not yet delivered will not be sent. Already delivered messages stay in customers’ inboxes.', 'لن تُرسل الرسائل التي لم تُسلَّم بعد. تبقى المسلَّمة في صناديق العملاء.')} confirmLabel={t('Cancel broadcast', 'إلغاء الرسالة')} busy={busy} error={error} onConfirm={() => act('cancel', undefined, t('Cancelled.', 'أُلغيت.'))} onClose={() => setDlg(null)} />
            <ConfirmDialog open={dlg === 'quiet'} danger title={t('Quiet hours', 'ساعات الهدوء')} message={error ?? ''} confirmLabel={t('Approve anyway', 'موافقة رغم ذلك')} busy={busy} onConfirm={() => act('approve', { overrideQuietHours: true }, t('Approved with a quiet-hours override.', 'تمت الموافقة مع تجاوز ساعات الهدوء.'))} onClose={() => { setDlg(null); setError(null); }} />
          </>
        )}
      </Async>
    </div>
  );
}

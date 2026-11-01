'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, Card, DataTable, FilterBar, LabeledSelect, PageHeader, Pagination, StatusPill, usePaging, useToast } from '../../../../components/ui';
import { send, useApi } from '../../../../lib/ui/api';
import { apiErrorMessage } from '../../../../lib/api/errors';
import { useLang } from '../../../../lib/ui/lang';
import { usePermissions } from '../../../../lib/ui/permissions';

export default function JobsPage() {
  const { t, dateTime } = useLang();
  const { can } = usePermissions();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const { page, setPage, limit } = usePaging(status);
  const list = useApi<any[]>('/admin/system/jobs', { status: status || undefined, page, limit }, { refreshInterval: 15000 });
  const retry = async (id: string) => { try { await send('post', `/admin/system/jobs/${id}/retry`); toast.push('success', t('Queued again.', 'أُعيدت إلى الطابور.')); list.reload(); } catch (e) { toast.push('error', apiErrorMessage(e, t('Could not retry.', 'تعذّرت إعادة المحاولة.'))); } };
  return (
    <div>
      <PageHeader title={t('Background jobs', 'المهام الخلفية')} subtitle={t('Report exports are the only background jobs run from this panel. Failed ones can be queued again; the retry is audited.', 'تصدير التقارير هو المهام الخلفية الوحيدة المشغَّلة من هذه اللوحة. يمكن إعادة جدولة الفاشلة، وتُسجَّل في التدقيق.')} actions={<Link className="text-sm text-hatly-orangeDark hover:underline" href="/exports">{t('My exports', 'تصديراتي')}</Link>} />
      <FilterBar><div className="w-44"><LabeledSelect label={t('Status', 'الحالة')} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{t('All', 'الكل')}</option>{['QUEUED', 'RUNNING', 'READY', 'FAILED', 'EXPIRED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s}</option>)}</LabeledSelect></div></FilterBar>
      <Card pad={false}>
        <DataTable rows={list.data} rowKey={(r: any) => r.id} loading={list.loading} error={list.error} status={list.status} onRetry={list.reload} emptyTitle={t('No jobs', 'لا مهام')} columns={[
          { key: 'l', header: t('Job', 'المهمة'), cell: (r: any) => r.label },
          { key: 's', header: t('Status', 'الحالة'), cell: (r: any) => <StatusPill status={r.status} /> },
          { key: 'p', header: t('Progress', 'التقدم'), align: 'end', cell: (r: any) => `${r.progress}%` },
          { key: 'a', header: t('Attempts', 'المحاولات'), align: 'end', cell: (r: any) => r.attempts },
          { key: 'e', header: t('Error', 'الخطأ'), cell: (r: any) => r.errorCode ?? '' },
          { key: 'by', header: t('Requested by', 'طلبها'), cell: (r: any) => <bdi>{r.requestedBy}</bdi> },
          { key: 'at', header: t('Created', 'أُنشئت'), cell: (r: any) => dateTime(r.createdAt) },
          { key: 'x', header: '', align: 'end', cell: (r: any) => (r.status === 'FAILED' && can('MANAGE_SYSTEM_JOBS') ? <Button size="sm" onClick={() => retry(r.id)}>{t('Retry', 'إعادة')}</Button> : null) },
        ]} />
        {list.meta && <Pagination page={page} limit={limit} total={list.meta.total} onPage={setPage} />}
      </Card>
    </div>
  );
}

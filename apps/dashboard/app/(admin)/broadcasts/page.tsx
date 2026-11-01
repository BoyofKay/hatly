'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, Card, DataTable, FilterBar, LabeledSelect, PageHeader, Pagination, StatusPill, usePaging } from '../../../components/ui';
import { useApi } from '../../../lib/ui/api';
import { BroadcastForm } from '../../../components/marketing/BroadcastForm';
import { useLang } from '../../../lib/ui/lang';
import { usePermissions } from '../../../lib/ui/permissions';

export default function BroadcastsPage() {
  const { t, dateTime } = useLang();
  const { can } = usePermissions();
  const [status, setStatus] = useState('');
  const { page, setPage, limit } = usePaging(status);
  const list = useApi<any[]>('/admin/broadcasts', { status: status || undefined, page, limit });
  const [open, setOpen] = useState(false);
  return (
    <div>
      <PageHeader title={t('Broadcasts', 'الرسائل الجماعية')} subtitle={t('Messages to a saved audience through the in-app inbox (and push where configured). A second admin must approve every broadcast before it sends. Max one per customer per day; quiet hours apply.', 'رسائل لجمهور محفوظ عبر صندوق الوارد داخل التطبيق (والإشعارات حيث تتوفر). يجب أن يوافق مسؤول آخر قبل الإرسال. بحد أقصى رسالة لكل عميل يوميًا مع مراعاة ساعات الهدوء.')} actions={can('MANAGE_BROADCASTS') ? <Button variant="primary" onClick={() => setOpen(true)}>{t('New broadcast', 'رسالة جديدة')}</Button> : undefined} />
      <FilterBar>
        <div className="w-52"><LabeledSelect label={t('Status', 'الحالة')} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{t('All', 'الكل')}</option>{['DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'APPROVED', 'SENDING', 'SENT', 'CANCELLED'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</LabeledSelect></div>
      </FilterBar>
      <Card pad={false}>
        <DataTable rows={list.data} rowKey={(r: any) => r.id} loading={list.loading} error={list.error} status={list.status} onRetry={list.reload} emptyTitle={t('No broadcasts yet', 'لا توجد رسائل بعد')} columns={[
          { key: 't', header: t('Title', 'العنوان'), cell: (r: any) => <Link className="font-medium text-hatly-orangeDark hover:underline" href={`/broadcasts/${r.id}`}><bdi>{r.titleEn}</bdi></Link> },
          { key: 'a', header: t('Audience', 'الجمهور'), cell: (r: any) => <bdi>{r.audienceName}</bdi> },
          { key: 'c', header: t('Channels', 'القنوات'), cell: (r: any) => r.channels.join(' + ') },
          { key: 's', header: t('Status', 'الحالة'), cell: (r: any) => <StatusPill status={r.status} /> },
          { key: 'w', header: t('Scheduled', 'مجدولة'), cell: (r: any) => (r.scheduledAt ? dateTime(r.scheduledAt) : '—') },
          { key: 'by', header: t('Created by', 'أنشأها'), cell: (r: any) => <bdi>{r.createdByName}</bdi> },
        ]} />
        {list.meta && <Pagination page={page} limit={limit} total={list.meta.total} onPage={setPage} />}
      </Card>
      <BroadcastForm open={open} onClose={() => setOpen(false)} onSaved={() => list.reload()} />
    </div>
  );
}

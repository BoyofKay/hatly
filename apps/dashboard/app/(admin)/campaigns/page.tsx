'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card, DataTable, FilterBar, LabeledInput, LabeledSelect, Modal, PageHeader, Pagination, StatusPill, usePaging, useToast } from '../../../components/ui';
import { send, useApi } from '../../../lib/ui/api';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useLang } from '../../../lib/ui/lang';
import { usePermissions } from '../../../lib/ui/permissions';

export default function CampaignsPage() {
  const { t, dateTime } = useLang();
  const { can } = usePermissions();
  const router = useRouter();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const { page, setPage, limit } = usePaging(status);
  const list = useApi<any[]>('/admin/campaigns', { status: status || undefined, page, limit });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ nameEn: '', nameAr: '', startsAt: '', endsAt: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setBusy(true); setError(null);
    try {
      const r = await send<any>('post', '/admin/campaigns', { nameEn: f.nameEn, nameAr: f.nameAr, startsAt: new Date(f.startsAt).toISOString(), endsAt: new Date(f.endsAt).toISOString() });
      toast.push('success', t('Campaign draft created.', 'تم إنشاء مسودة الحملة.')); router.push(`/campaigns/${r.id}`);
    } catch (e) { setError(apiErrorMessage(e, t('Could not create the campaign.', 'تعذّر إنشاء الحملة.'))); } finally { setBusy(false); }
  };
  const valid = f.nameEn.trim() && f.nameAr.trim() && f.startsAt && f.endsAt;
  return (
    <div>
      <PageHeader title={t('Campaigns', 'الحملات')} subtitle={t('A campaign groups existing offers, banners and broadcasts on one schedule and switches them on and off together. It never calculates a discount itself. A second admin approves it before it goes live.', 'تجمع الحملة عروضًا ولافتات ورسائل قائمة في جدول واحد وتشغّلها وتوقفها معًا. لا تحسب أي خصم بنفسها. يوافق عليها مسؤول آخر قبل البدء.')} actions={can('MANAGE_CAMPAIGNS') ? <Button variant="primary" onClick={() => { setError(null); setOpen(true); }}>{t('New campaign', 'حملة جديدة')}</Button> : undefined} />
      <FilterBar>
        <div className="w-52"><LabeledSelect label={t('Status', 'الحالة')} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{t('All', 'الكل')}</option>{['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</LabeledSelect></div>
      </FilterBar>
      <Card pad={false}>
        <DataTable rows={list.data} rowKey={(r: any) => r.id} loading={list.loading} error={list.error} status={list.status} onRetry={list.reload} emptyTitle={t('No campaigns yet', 'لا توجد حملات بعد')} columns={[
          { key: 'n', header: t('Campaign', 'الحملة'), cell: (r: any) => <Link className="font-medium text-hatly-orangeDark hover:underline" href={`/campaigns/${r.id}`}><bdi>{r.nameEn}</bdi><span className="block text-xs text-gray-500" dir="rtl">{r.nameAr}</span></Link> },
          { key: 's', header: t('Status', 'الحالة'), cell: (r: any) => <StatusPill status={r.status} /> },
          { key: 'a', header: t('Starts', 'تبدأ'), cell: (r: any) => dateTime(r.startsAt) },
          { key: 'e', header: t('Ends', 'تنتهي'), cell: (r: any) => dateTime(r.endsAt) },
          { key: 'by', header: t('Created by', 'أنشأها'), cell: (r: any) => <bdi>{r.createdByName}</bdi> },
        ]} />
        {list.meta && <Pagination page={page} limit={limit} total={list.meta.total} onPage={setPage} />}
      </Card>
      <Modal open={open} title={t('New campaign', 'حملة جديدة')} onClose={() => !busy && setOpen(false)} footer={<><Button onClick={() => setOpen(false)} disabled={busy}>{t('Cancel', 'إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!valid} onClick={create}>{t('Create draft', 'إنشاء مسودة')}</Button></>}>
        <div className="space-y-3">
          <LabeledInput label={t('Name (English)', 'الاسم (إنجليزي)')} maxLength={80} value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} />
          <LabeledInput label={t('Name (Arabic)', 'الاسم (عربي)')} dir="rtl" maxLength={80} value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} />
          <LabeledInput label={t('Starts', 'تبدأ')} type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} />
          <LabeledInput label={t('Ends', 'تنتهي')} type="datetime-local" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} />
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>
      </Modal>
    </div>
  );
}

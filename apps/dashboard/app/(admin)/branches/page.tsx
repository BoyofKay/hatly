'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Async, Badge, Card, DataTable, FilterBar, LabeledInput, LabeledSelect, Modal, PageHeader, Pagination, Button, DateRange, cairoDate, useDebounced, usePaging } from '../../../components/ui';
import { useApi } from '../../../lib/ui/api';
import { useLang } from '../../../lib/ui/lang';
import { usePermissions } from '../../../lib/ui/permissions';
import { DeleteRecordButton } from '../../../components/admin/DeleteRecordButton';

export default function BranchesPage() {
  const { t, num } = useLang();
  const [q, setQ] = useState('');
  const [active, setActive] = useState('');
  const [open, setOpen] = useState('');
  const search = useDebounced(q);
  const { page, setPage, limit } = usePaging(JSON.stringify([search, active, open]));
  const canManage = usePermissions().can('MANAGE_VENDORS');
  const list = useApi<any[]>('/admin/branch-directory', { q: search || undefined, active: active || undefined, open: open || undefined, page, limit });
  const [perf, setPerf] = useState<any>(null);

  return (
    <div>
      <PageHeader title={t('Branches', 'الفروع')} subtitle={t('Every vendor branch with its live state. Open the performance view for acceptance time and rejection reasons. Editing a vendor or branch stays on the Vendors page.', 'كل فرع مع حالته الحالية. افتح عرض الأداء لزمن القبول وأسباب الرفض. تعديل المورد أو الفرع يتم من صفحة الموردين.')} actions={<Link href="/vendors" className="text-sm font-medium text-hatly-orangeDark hover:underline">{t('Manage vendors', 'إدارة الموردين')}</Link>} />
      <FilterBar onClear={() => { setQ(''); setActive(''); setOpen(''); }}>
        <div className="w-56"><LabeledInput label={t('Search', 'بحث')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="w-40"><LabeledSelect label={t('Active', 'نشط')} value={active} onChange={(e) => setActive(e.target.value)}><option value="">{t('All', 'الكل')}</option><option value="true">{t('Active', 'نشط')}</option><option value="false">{t('Inactive', 'غير نشط')}</option></LabeledSelect></div>
        <div className="w-40"><LabeledSelect label={t('Open now', 'مفتوح الآن')} value={open} onChange={(e) => setOpen(e.target.value)}><option value="">{t('All', 'الكل')}</option><option value="true">{t('Open', 'مفتوح')}</option><option value="false">{t('Closed', 'مغلق')}</option></LabeledSelect></div>
      </FilterBar>
      <Card pad={false}>
        <DataTable rows={list.data} rowKey={(r) => r.id} loading={list.loading} error={list.error} status={list.status} onRetry={list.reload} emptyTitle={t('No branches match', 'لا توجد فروع مطابقة')} columns={[
          { key: 'n', header: t('Branch', 'الفرع'), cell: (r) => <span><Link className="font-medium text-hatly-orangeDark hover:underline" href={`/branches/${r.id}`}><bdi>{r.name}</bdi></Link><span className="block text-xs text-gray-500"><bdi>{r.vendorName}{r.sector ? ` · ${r.sector}` : ''}</bdi></span></span> },
          { key: 's', header: t('State', 'الحالة'), cell: (r) => <span className="flex flex-wrap gap-1">{r.isActive ? <Badge tone="green">{t('Active', 'نشط')}</Badge> : <Badge tone="red">{t('Inactive', 'غير نشط')}</Badge>}{r.isOpen ? <Badge tone="green">{t('Open', 'مفتوح')}</Badge> : <Badge>{t('Closed', 'مغلق')}</Badge>}{!r.vendorActive && <Badge tone="red">{t('Vendor inactive', 'المورد غير نشط')}</Badge>}</span> },
          { key: 'pp', header: t('Pending parts', 'أجزاء معلقة'), align: 'end', cell: (r) => (r.pendingParts > 0 ? <Badge tone="amber">{num(r.pendingParts)}</Badge> : '0') },
          { key: 'pr', header: t('Products', 'المنتجات'), align: 'end', cell: (r) => <Link className="text-hatly-orangeDark hover:underline" href={`/catalog?branch=${r.id}`}>{num(r.products)}</Link> },
          { key: 'rt', header: t('Rating', 'التقييم'), align: 'end', cell: (r) => (r.rating === null ? <span className="text-gray-400">{t('No ratings', 'لا تقييمات')}</span> : <span title={`${r.ratingCount}`}>{r.rating} ★ <span className="text-xs text-gray-500">({num(r.ratingCount)})</span></span>) },
          { key: 'cm', header: t('Commission', 'العمولة'), align: 'end', cell: (r) => `${r.commissionPercent}%` },
          { key: 'ac', header: t('Accepts orders', 'قبول الطلبات'), cell: (r) => { const m = r.acceptanceMode ?? (r.autoAccept ? 'AUTO' : 'VENDOR'); return m === 'AUTO' ? t('Automatic', 'تلقائي') : m === 'HATLY' ? <Badge tone="amber">{t('Hatly', 'هاتلي')}</Badge> : t('Vendor', 'البائع'); } },
          { key: 'a', header: '', align: 'end', cell: (r) => <span className="flex justify-end gap-1.5"><Button size="sm" onClick={() => setPerf(r)}>{t('Performance', 'الأداء')}</Button>{canManage && <Link href={`/branches/${r.id}#sec-details`} className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">{t('Edit', 'تعديل')}</Link>}{canManage && <DeleteRecordButton path={`/admin/vendor-branches/${r.id}`} name={r.name} what={['Branch', 'الفرع']} consequence={['Its menu and offers are switched off with it. Refused while it has orders in progress.', 'يتم إيقاف المنيو والعروض الخاصة به. يُرفض الحذف إذا كانت لديه طلبات جارية.']} onDeleted={list.reload} />}</span> },
        ]} />
        {list.meta && <Pagination page={page} limit={limit} total={list.meta.total} onPage={setPage} />}
      </Card>
      <Modal open={Boolean(perf)} wide title={perf ? t(`Performance — ${perf.name}`, `الأداء — ${perf.name}`) : ''} onClose={() => setPerf(null)}>{perf && <Performance branch={perf} />}</Modal>
    </div>
  );
}

function Performance({ branch }: { branch: any }) {
  const { t, money, num } = useLang();
  const [from, setFrom] = useState(cairoDate(-29));
  const [to, setTo] = useState(cairoDate(0));
  const data = useApi<any>(`/admin/branch-directory/${branch.id}/performance`, { from, to });
  return (
    <div className="space-y-3">
      <DateRange from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); }} />
      <Async state={data} rows={3}>
        {data.data && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-gray-500">{t('Parts received', 'الأجزاء المستلمة')}</dt><dd className="text-end tabular-nums">{num(data.data.received)}</dd>
            <dt className="text-gray-500">{t('Completed (picked up)', 'المكتملة (استُلمت)')}</dt><dd className="text-end tabular-nums">{num(data.data.completed)}</dd>
            <dt className="text-gray-500">{t('Rejected / cancelled', 'المرفوضة / الملغاة')}</dt><dd className="text-end tabular-nums">{num(data.data.rejected)}{data.data.rejectionRatePct !== null ? ` (${data.data.rejectionRatePct}%)` : ''}</dd>
            <dt className="text-gray-500">{t('Median time to accept (min)', 'وسيط زمن القبول (د)')}</dt><dd className="text-end tabular-nums">{data.data.medianAcceptanceMinutes ?? t('No data', 'لا بيانات')}</dd>
            {data.data.grossSalesMinor !== undefined && <><dt className="text-gray-500">{t('Goods value in period (not owed by Hatly)', 'قيمة البضائع في الفترة (لا تستحق على حاتلي)')}</dt><dd className="text-end tabular-nums">{money(data.data.grossSalesMinor)}</dd></>}
            {data.data.commissionRecognisedAllTimeMinor !== undefined && <><dt className="text-gray-500">{t('Commission recognised (all time)', 'العمولة المعترف بها (الإجمالي)')}</dt><dd className="text-end tabular-nums">{money(data.data.commissionRecognisedAllTimeMinor)}</dd></>}
          </dl>
        )}
      </Async>
      {data.data?.topRejectionReasons?.length > 0 && (
        <div>
          <h4 className="mb-1 text-sm font-semibold">{t('Top rejection reasons', 'أهم أسباب الرفض')}</h4>
          <ul className="text-sm">{data.data.topRejectionReasons.map((r: any) => <li key={r.reason} className="flex justify-between border-t border-gray-100 py-1"><bdi>{r.reason}</bdi><span className="tabular-nums">{num(r.n)}</span></li>)}</ul>
        </div>
      )}
    </div>
  );
}

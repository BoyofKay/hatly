'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Async, Badge, Card, DataTable, Modal, PageHeader } from '../../../components/ui';
import { useApi } from '../../../lib/ui/api';
import { useLang } from '../../../lib/ui/lang';
import { AutoDispatchCard } from '../../../components/ops/AutoDispatchCard';

export default function ConfigPage() {
  const { t, dateTime } = useLang();
  const ov = useApi<any[]>('/admin/config/overview');
  const [key, setKey] = useState<string | null>(null);
  const hist = useApi<any[]>(key ? `/admin/config/${key}/history` : null);
  return (
    <div>
      <PageHeader title={t('Configuration overview', 'نظرة عامة على الإعدادات')} subtitle={t('Which business settings are set, when each last changed and by whom. Values are not shown here (a setting can hold a payment destination) and are never written to the history. Edit values on the Settings page.', 'أي إعدادات الأعمال مضبوطة، ومتى تغيّر كل منها وبواسطة من. لا تظهر القيم هنا (قد يحمل الإعداد وجهة دفع) ولا تُسجَّل في السجل. عدّل القيم من صفحة الإعدادات.')} actions={<Link className="text-sm font-medium text-hatly-orangeDark hover:underline" href="/settings">{t('Open Settings', 'فتح الإعدادات')}</Link>} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card pad={false} className="xl:col-span-2">
          <DataTable rows={ov.data} rowKey={(r: any) => r.key} loading={ov.loading} error={ov.error} status={ov.status} onRetry={ov.reload} emptyTitle={t('No settings', 'لا إعدادات')} columns={[
            { key: 'k', header: t('Setting', 'الإعداد'), cell: (r: any) => <span><code className="text-xs" dir="ltr">{r.key}</code>{r.description && <span className="block text-xs text-gray-500"><bdi>{r.description}</bdi></span>}</span> },
            { key: 's', header: t('State', 'الحالة'), cell: (r: any) => (r.isSet ? <Badge tone="green">{t('Set', 'مضبوط')}</Badge> : <Badge>{t('Using default', 'الافتراضي')}</Badge>) },
            { key: 'u', header: t('Last changed', 'آخر تغيير'), cell: (r: any) => (r.lastChangeAt ? dateTime(r.lastChangeAt) : r.updatedAt ? dateTime(r.updatedAt) : '—') },
            { key: 'h', header: '', align: 'end', cell: (r: any) => (r.isSet ? <button className="text-xs text-hatly-orangeDark hover:underline" onClick={() => setKey(r.key)}>{t('History', 'السجل')}</button> : null) },
          ]} />
        </Card>
        <AutoDispatchCard />
      </div>
      <Modal open={Boolean(key)} title={key ?? ''} onClose={() => setKey(null)}>
        <Async state={hist} empty={hist.data && hist.data.length === 0} emptyTitle={t('No recorded changes', 'لا تغييرات مسجلة')} rows={2}>
          <ul className="text-sm">{(hist.data ?? []).map((h: any, i: number) => <li key={i} className="flex justify-between border-t border-gray-100 py-1.5"><span><bdi>{h.by ?? '—'}</bdi> <span className="text-xs text-gray-500">({h.role})</span></span><span className="text-xs text-gray-500">{dateTime(h.at)}</span></li>)}</ul>
        </Async>
        <p className="mt-2 text-xs text-gray-500">{t('Only who and when are recorded — never the value.', 'يُسجَّل من ومتى فقط — وليس القيمة.')}</p>
      </Modal>
    </div>
  );
}

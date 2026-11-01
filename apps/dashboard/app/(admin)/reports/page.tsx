'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Async, Badge, Card, LabeledInput, PageHeader } from '../../../components/ui';
import { useApi } from '../../../lib/ui/api';
import { useLang } from '../../../lib/ui/lang';

const FAMILIES: Record<string, [string, string]> = {
  EXECUTIVE: ['Executive', 'تنفيذي'], SALES: ['Sales & orders', 'المبيعات والطلبات'], OPERATIONS: ['Operations', 'العمليات'], CATALOG: ['Catalog', 'الكتالوج'], CUSTOMERS: ['Customers', 'العملاء'],
  FLEET: ['Fleet & delivery', 'الأسطول والتوصيل'], FINANCE: ['Finance', 'المالية'], MARKETING: ['Marketing', 'التسويق'], SECURITY: ['Security & audit', 'الأمان والتدقيق'],
};

export default function ReportCataloguePage() {
  const { t, locale } = useLang();
  const [q, setQ] = useState('');
  const cat = useApi<any[]>('/admin/reports');
  const list = (cat.data ?? []).filter((r) => `${r.en} ${r.ar} ${r.descriptionEn}`.toLowerCase().includes(q.toLowerCase()));
  const groups = Object.keys(FAMILIES).map((f) => ({ f, items: list.filter((r) => r.family === f) })).filter((g) => g.items.length > 0);
  return (
    <div>
      <PageHeader title={t('Reports', 'التقارير')} subtitle={t('Each report is defined once on the server: the screen, CSV, Excel and PDF all run the same definition, with Africa/Cairo date ranges. You only see reports you may view.', 'كل تقرير معرَّف مرة واحدة على الخادم: الشاشة وCSV وExcel وPDF تستخدم التعريف نفسه، بنطاقات تواريخ بتوقيت القاهرة. تظهر لك فقط التقارير المسموح بها.')} actions={<Link href="/exports" className="text-sm font-medium text-hatly-orangeDark hover:underline">{t('My exports →', 'تصديراتي ←')}</Link>} />
      <div className="mb-4 max-w-sm"><LabeledInput label={t('Search reports', 'بحث في التقارير')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <Async state={cat} empty={cat.data && groups.length === 0} emptyTitle={t('No reports available for your permissions', 'لا توجد تقارير متاحة لصلاحياتك')}>
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.f}>
              <h2 className="mb-2 text-sm font-semibold text-gray-700">{t(...(FAMILIES[g.f] as [string, string]))}</h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {g.items.map((r) => (
                  <Link key={r.id} href={`/reports/${r.id}`} className="block">
                    <Card className="h-full transition hover:border-hatly-orange">
                      <div className="flex items-start justify-between gap-2"><h3 className="text-sm font-semibold text-gray-900">{locale === 'ar' ? r.ar : r.en}</h3><Badge>{r.id}</Badge></div>
                      <p className="mt-1 text-xs text-gray-500">{locale === 'ar' ? r.descriptionAr : r.descriptionEn}</p>
                      <p className="mt-2 text-[11px] text-gray-400">{r.canExport ? t('CSV · Excel · PDF', 'CSV · Excel · PDF') : t('View only (no export permission)', 'عرض فقط (بلا صلاحية تصدير)')}</p>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </Async>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { Async, Badge, Card, DataTable, KpiCard, PageHeader, StatusPill } from '../../../components/ui';
import { useApi } from '../../../lib/ui/api';
import { useLang } from '../../../lib/ui/lang';

export default function InventoryPage() {
  const { t, num } = useLang();
  const board = useApi<any>('/admin/inventory-board');
  const d = board.data;
  return (
    <div>
      <PageHeader title={t('Inventory', 'المخزون')} subtitle={t(`Only tracked products have a quantity. “Low” means at or below the product's threshold (default ${d?.defaultThreshold ?? 5}). Vendors update their own stock; admins can set stock in bulk from Products.`, `للمنتجات المتتبَّعة فقط كمية. «منخفض» يعني عند حد المنتج أو أقل (الافتراضي ${d?.defaultThreshold ?? 5}). يحدّث الموردون مخزونهم، ويمكن للمسؤولين ضبطه جماعيًا من المنتجات.`)} actions={<Link href="/catalog?state=LOW" className="text-sm font-medium text-hatly-orangeDark hover:underline">{t('Open products', 'فتح المنتجات')}</Link>} />
      <Async state={board} rows={2}>
        {d && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard label={t('Out of stock', 'نفد المخزون')} value={num(d.counts.out)} tone={d.counts.out ? 'bad' : 'neutral'} />
              <KpiCard label={t('Low stock', 'مخزون منخفض')} value={num(d.counts.low)} tone={d.counts.low ? 'bad' : 'neutral'} />
              <KpiCard label={t('In stock', 'متوفر')} value={num(d.counts.ok)} tone="good" />
              <KpiCard label={t('Not tracked', 'غير متتبَّع')} value={num(d.counts.unlimited)} hint={t('Always available while switched on.', 'متاح دائمًا ما دام مفعّلًا.')} />
            </div>
            <Card title={t('Needs restocking', 'يحتاج إعادة تخزين')} className="mt-4" pad={false}>
              <DataTable rows={d.items} rowKey={(r: any) => r.id} emptyTitle={t('Nothing is out or low', 'لا يوجد ما نفد أو انخفض')} columns={[
                { key: 'n', header: t('Product', 'المنتج'), cell: (r: any) => <span><bdi className="font-medium">{r.name}</bdi><span className="block text-xs text-gray-500"><bdi>{r.vendorName} — {r.branchName}</bdi></span></span> },
                { key: 'q', header: t('Quantity', 'الكمية'), align: 'end', cell: (r: any) => num(r.quantity) },
                { key: 't', header: t('Threshold', 'الحد'), align: 'end', cell: (r: any) => num(r.threshold) },
                { key: 's', header: t('State', 'الحالة'), cell: (r: any) => <StatusPill status={r.state} /> },
                { key: 'a', header: t('Listed', 'معروض'), cell: (r: any) => (r.available ? <Badge tone="green">{t('Yes', 'نعم')}</Badge> : <Badge tone="red">{t('No', 'لا')}</Badge>) },
              ]} />
              {d.items.length >= 200 && <p className="px-4 py-2 text-xs text-gray-500">{t('Showing the 200 lowest. Filter Products by stock state to see the rest.', 'يُعرض أقل 200. صفِّ المنتجات بحسب حالة المخزون لرؤية الباقي.')}</p>}
            </Card>
          </>
        )}
      </Async>
    </div>
  );
}

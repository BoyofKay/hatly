'use client';

import { useState } from 'react';
import { Async, Card, DataTable, DateRange, FilterBar, KpiCard, PageHeader, cairoDate } from '../../../../components/ui';
import { ICONS } from '../../../../components/ui/icons';
import { useApi } from '../../../../lib/ui/api';
import { useLang } from '../../../../lib/ui/lang';

export default function ReceivablesPage() {
  const { t, money } = useLang();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const r = useApi<any>('/admin/finance/vendor-receivables', { from: from || undefined, to: to || undefined });
  const d = r.data;
  return (
    <div>
      <PageHeader title={t('Vendor receivables', 'مستحقات الموردين')} subtitle={t('What each vendor owes HATLY as commission (the VendorLedger). Recognised is not collected: a closed period is only settled when collections are recorded against it. Gross sales are not an amount owed to the vendor.', 'ما يدين به كل مورد لحاتلي كعمولة (دفتر الموردين). المعترف به ليس محصّلًا: لا تُسوّى الفترة المغلقة إلا بتسجيل تحصيلات عليها. إجمالي المبيعات ليس مبلغًا مستحقًا للمورد.')} />
      <FilterBar onClear={() => { setFrom(''); setTo(''); }}><DateRange from={from} to={to || cairoDate(0)} onChange={(f, tt) => { setFrom(f); setTo(tt); }} /></FilterBar>
      <Async state={r} empty={d && d.items.length === 0} emptyTitle={t('No commission recognised yet', 'لا توجد عمولات معترف بها بعد')}>
        {d && (
          <>
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="receivables-kpis">
              {([['Commission recognised', 'عمولة معترف بها', d.totals.recognisedMinor, ICONS.coins], ['Due in closed periods', 'مستحق في فترات مغلقة', d.totals.closedDueMinor, ICONS.receipt], ['Collected', 'المحصّل', d.totals.collectedMinor, ICONS.check], ['Outstanding (closed periods)', 'المتبقي (فترات مغلقة)', d.totals.outstandingMinor, ICONS.alert]] as const).map(([en, ar, v, icon]) => (
                <KpiCard key={en} label={t(en, ar)} value={money(v)} icon={icon} />
              ))}
            </div>
            <Card pad={false}>
              <DataTable rows={d.items} rowKey={(i: any) => i.vendorBranchId} columns={[
                { key: 'v', header: t('Vendor', 'المورد'), cell: (i: any) => <bdi>{i.vendorName}</bdi> },
                { key: 'b', header: t('Branch', 'الفرع'), cell: (i: any) => <bdi>{i.branchName}</bdi> },
                { key: 'r', header: t('Recognised', 'معترف به'), align: 'end', cell: (i: any) => money(i.recognisedMinor) },
                { key: 'd', header: t('Due (closed)', 'مستحق (مغلق)'), align: 'end', cell: (i: any) => money(i.closedDueMinor) },
                { key: 'c', header: t('Collected', 'محصّل'), align: 'end', cell: (i: any) => money(i.collectedMinor) },
                { key: 'o', header: t('Outstanding', 'المتبقي'), align: 'end', cell: (i: any) => <strong>{money(i.outstandingMinor)}</strong> },
              ]} />
            </Card>
          </>
        )}
      </Async>
    </div>
  );
}

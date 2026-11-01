'use client';

import { Async, Card, KpiCard, PageHeader, StatusPill } from '../../../../components/ui';
import { ICONS } from '../../../../components/ui/icons';
import { useApi } from '../../../../lib/ui/api';
import { useLang } from '../../../../lib/ui/lang';

const NAMES: Record<string, [string, string]> = {
  R2: ['Refunds: every payout belongs to a recorded refund', 'المستردات: كل دفعة تخص استردادًا مسجلًا'],
  R3: ['Vendor settlements: stored totals equal their ledger events and segments', 'تسويات الموردين: الإجماليات المخزنة تساوي أحداثها وأجزاءها'],
  R3D: ['Driver settlements: stored totals equal their ledger events', 'تسويات السائقين: الإجماليات المخزنة تساوي أحداثها'],
  R4: ['Hatly-funded discounts: restored never exceeds recorded and links to its original', 'الخصومات الممولة: المسترد لا يتجاوز المسجل ويرتبط بأصله'],
  R5: ['Customer wallets: no ledger balance below zero', 'محافظ العملاء: لا رصيد سالب'],
  R6: ['Settlement payments: nothing overpaid without authorisation', 'مدفوعات التسوية: لا زيادة دون تفويض'],
};

export default function ReconciliationPage() {
  const { t, num, dateTime } = useLang();
  const r = useApi<any>('/admin/finance/reconciliation');
  const d = r.data;
  return (
    <div>
      <PageHeader title={t('Reconciliation', 'المطابقة')} subtitle={t('Independent checks that the books agree with each other. A mismatch is listed with the records involved — nothing is hidden or auto-corrected.', 'فحوصات مستقلة للتأكد من اتفاق السجلات. يُعرض أي اختلاف مع السجلات المعنية دون إخفاء أو تصحيح تلقائي.')} />
      <Async state={r}>
        {d && (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="reconciliation-kpis">
              <KpiCard label={t('Checks run', 'الفحوصات المنفذة')} value={num(d.checks.length)} icon={ICONS.list} />
              <KpiCard label={t('Balanced', 'متوازنة')} value={num(d.checks.filter((c: any) => c.discrepancies.length === 0).length)} icon={ICONS.shield} />
              <KpiCard label={t('With mismatches', 'بها اختلافات')} value={num(d.checks.filter((c: any) => c.discrepancies.length > 0).length)} icon={ICONS.alert} tone={d.balanced ? undefined : 'bad'} />
              <KpiCard label={t('Records checked', 'السجلات المفحوصة')} value={num(d.checks.reduce((n: number, c: any) => n + c.checked, 0))} icon={ICONS.scale} />
            </div>
            <p className="mb-3 flex items-center gap-2 text-sm"><StatusPill status={d.balanced ? 'BALANCED' : 'MISMATCH'} label={d.balanced ? t('All checks balanced', 'كل الفحوصات متوازنة') : t('Mismatches found', 'توجد اختلافات')} /><span className="text-xs text-gray-500">{dateTime(d.asOf)}</span></p>
            <div className="space-y-3">
              {d.checks.map((c: any) => (
                <Card key={c.id} title={<span className="flex items-center gap-2"><span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">{c.id}</span>{t(NAMES[c.id]?.[0] ?? c.title, NAMES[c.id]?.[1] ?? c.title)}</span>} actions={<span className="flex items-center gap-2 text-xs text-gray-500">{num(c.checked)} {t('checked', 'تم فحصها')}<StatusPill status={c.status} /></span>}>
                  {c.discrepancies.length === 0 ? <p className="text-sm text-gray-500">{t('No discrepancies.', 'لا توجد اختلافات.')}</p> : (
                    <ul className="space-y-1 text-xs">{c.discrepancies.slice(0, 20).map((x: any, i: number) => <li key={i} className="break-all rounded bg-red-50 px-2 py-1 font-mono text-red-800"><bdi>{JSON.stringify(x)}</bdi></li>)}</ul>
                  )}
                </Card>
              ))}
            </div>
          </>
        )}
      </Async>
    </div>
  );
}

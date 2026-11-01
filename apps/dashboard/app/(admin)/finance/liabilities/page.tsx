'use client';

import { Async, Card, PageHeader } from '../../../../components/ui';
import { useApi } from '../../../../lib/ui/api';
import { useLang } from '../../../../lib/ui/lang';
import { usePermissions } from '../../../../lib/ui/permissions';
import { ExportButton } from '../../../../components/reports/ExportButton';

export default function LiabilitiesPage() {
  const { t, money, num, dateTime } = useLang();
  const { can } = usePermissions();
  const s = useApi<any>('/admin/finance/liabilities');
  const d = s.data;
  const row = (en: string, ar: string, value: string, hint: string, hintAr: string) => (
    <div key={en} className="flex items-start justify-between gap-4 border-b border-gray-100 py-3 last:border-0">
      <div><p className="text-sm font-medium text-gray-900">{t(en, ar)}</p><p className="text-xs text-gray-500">{t(hint, hintAr)}</p></div>
      <p className="whitespace-nowrap text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
  return (
    <div>
      <PageHeader title={t('Liabilities & receivables', 'الالتزامات والمستحقات')} subtitle={d ? `${t('As of', 'حتى')} ${dateTime(d.asOf)}` : undefined} actions={can('FINANCE_EXPORT') ? <ExportButton report="S13" params={{}} /> : undefined} />
      <Async state={s}>
        {d && (
          <Card>
            {row('Customer wallet balances', 'أرصدة محافظ العملاء', money(d.walletBalancesMinor), `${num(d.walletsWithBalance)} wallets with a positive balance — what Hatly owes customers.`, `${num(d.walletsWithBalance)} محفظة برصيد موجب — ما تدين به حاتلي للعملاء.`)}
            {row('Loyalty points outstanding', 'نقاط الولاء القائمة', d.loyaltyLiabilityMinor === null ? `${num(d.loyaltyPointsOutstanding)} ${t('pts', 'نقطة')}` : `${num(d.loyaltyPointsOutstanding)} ${t('pts', 'نقطة')} ≈ ${money(d.loyaltyLiabilityMinor)}`, 'Valued at the configured conversion rate; shown as points when no rate is set.', 'تُقيَّم بمعدل التحويل المضبوط؛ تظهر كنقاط إن لم يُضبط معدل.')}
            {row('Refunds recorded, not yet sent', 'مستردات مسجلة لم تُرسل', money(d.refundsOutstandingMinor), `${num(d.refundsOutstandingCount)} refund(s) — recorded is an obligation, not proof that money was sent.`, `${num(d.refundsOutstandingCount)} استرداد — المسجل التزام وليس دليلًا على إرسال المال.`)}
            {row('Vendor commission receivable', 'عمولات الموردين المستحقة', money(d.vendorCommissionReceivableMinor), 'Closed vendor periods, not yet collected.', 'فترات موردين مغلقة لم تُحصَّل بعد.')}
            {row('Driver payable', 'مستحقات السائقين', money(d.driverPayableMinor), 'Closed driver periods where Hatly owes the driver, not yet paid.', 'فترات سائقين مغلقة تدين فيها حاتلي للسائق ولم تُدفع.')}
            {row('Driver receivable', 'مستحقات على السائقين', money(d.driverReceivableMinor), 'Closed driver periods where the driver owes Hatly, not yet collected.', 'فترات سائقين مغلقة يدين فيها السائق لحاتلي ولم تُحصَّل.')}
            {d.negativeWalletBalances > 0 && <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{t(`${d.negativeWalletBalances} wallet(s) have a negative balance — see Reconciliation.`, `${d.negativeWalletBalances} محفظة برصيد سالب — راجع المطابقة.`)}</p>}
          </Card>
        )}
      </Async>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  DriverCashRemainder,
  approveCashRemainder,
  listPendingCashRemainders,
  rejectCashRemainder,
} from '../../../lib/api/admin-cash-remainders';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useLang } from '../../../lib/ui/lang';
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, KpiCard, PageHeader, Skeleton, StatusPill, useToast } from '../../../components/ui';

/**
 * Driver Cash Remainders — a driver reports money left over from a cash order; an admin approves it (which credits the customer's wallet at once) or
 * rejects it with a reason. Both are confirmed in a dialog that states the consequence. The backend's own PENDING_REVIEW-only guard is what prevents
 * a double decision, not this page; the list is re-read after every action. No detail page: the backend returns nothing beyond what the card shows.
 */
export default function CashRemaindersPage() {
  const { t, money, dateTime } = useLang();
  const toast = useToast();
  const [remainders, setRemainders] = useState<DriverCashRemainder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<{ kind: 'approve' | 'reject'; item: DriverCashRemainder } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      setRemainders(await listPendingCashRemainders());
    } catch (err: any) {
      setError(apiErrorMessage(err, t('Failed to load cash remainders.', 'تعذّر تحميل باقي النقدية.')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function confirm(reason: string) {
    if (!action || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      if (action.kind === 'approve') await approveCashRemainder(action.item.id);
      else await rejectCashRemainder(action.item.id, reason);
      toast.push('success', action.kind === 'approve' ? t('Remainder approved and credited to the customer’s wallet.', 'تمت الموافقة وأُضيف المبلغ إلى محفظة العميل.') : t('Remainder rejected.', 'تم رفض باقي النقدية.'));
      setAction(null);
      await refresh();
    } catch (err: any) {
      setActionError(apiErrorMessage(err, action.kind === 'approve' ? t('Failed to approve.', 'تعذّرت الموافقة.') : t('Failed to reject.', 'تعذّر الرفض.')));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('Driver Cash Remainders', 'باقي نقدية السائقين')}
        subtitle={t('Money drivers report as left over from cash orders. Approving credits the customer’s wallet immediately.', 'مبالغ يُبلغ السائقون أنها متبقية من طلبات نقدية. الموافقة تضيف المبلغ فورًا إلى محفظة العميل.')}
        actions={<Button onClick={refresh} loading={loading}>{t('Refresh', 'تحديث')}</Button>}
      />

      {remainders && remainders.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label={t('Awaiting review', 'بانتظار المراجعة')} value={remainders.length} tone="bad" />
        </div>
      )}

      {error && !remainders ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : !remainders ? (
        <div className="space-y-3" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : remainders.length === 0 ? (
        <Card><EmptyState title={t('No cash remainders awaiting review.', 'لا يوجد باقي نقدية بانتظار المراجعة.')} hint={t('New reports from drivers appear here.', 'تظهر هنا البلاغات الجديدة من السائقين.')} /></Card>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {remainders.map((r) => (
            <li key={r.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-2xl font-semibold tabular-nums text-gray-900">{money(r.remainderAmountMinor)}</p>
                  <p className="mt-0.5 text-xs text-gray-500">{t('Submitted', 'أُرسل')} {dateTime(r.submittedAt)}</p>
                </div>
                <StatusPill status={r.status} label={r.status === 'PENDING_REVIEW' ? t('Awaiting review', 'بانتظار المراجعة') : undefined} />
              </div>
              <p className="mt-2 text-sm text-gray-600">
                {t('Order', 'الطلب')}{' '}
                <Link href={`/order-search/${r.orderId}`} className="font-mono text-xs font-semibold text-hatly-orangeDark hover:underline" dir="ltr">#{r.orderId.slice(0, 8)}</Link>
                {' · '}{t('Driver', 'السائق')} <span className="font-mono text-xs" dir="ltr">#{r.driverId.slice(0, 8)}</span>
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="primary" className="min-h-[44px] flex-1 sm:flex-none" onClick={() => { setActionError(null); setAction({ kind: 'approve', item: r }); }}>{t('Approve', 'موافقة')}</Button>
                <Button className="min-h-[44px] flex-1 sm:flex-none" onClick={() => { setActionError(null); setAction({ kind: 'reject', item: r }); }}>{t('Reject', 'رفض')}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!action}
        title={action?.kind === 'approve' ? t('Approve this cash remainder?', 'الموافقة على باقي النقدية؟') : t('Reject this cash remainder?', 'رفض باقي النقدية؟')}
        message={action ? (action.kind === 'approve'
          ? t(`Approving ${money(action.item.remainderAmountMinor)} credits the customer's wallet immediately and cannot be undone.`, `الموافقة على ${money(action.item.remainderAmountMinor)} تضيف المبلغ فورًا إلى محفظة العميل ولا يمكن التراجع عنها.`)
          : t('The driver’s claim will be rejected. This cannot be undone.', 'سيُرفض بلاغ السائق ولا يمكن التراجع عن ذلك.')) : ''}
        confirmLabel={action?.kind === 'approve' ? t('Approve', 'موافقة') : t('Reject', 'رفض')}
        danger={action?.kind === 'reject'}
        reasonLabel={action?.kind === 'reject' ? t('Rejection reason (required)', 'سبب الرفض (مطلوب)') : undefined}
        reasonMin={action?.kind === 'reject' ? 1 : 0}
        busy={busy}
        error={actionError}
        onConfirm={(reason) => void confirm(reason)}
        onClose={() => setAction(null)}
      />
    </div>
  );
}

'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ErrorState, PageHeader, cairoDate, useToast } from '../../../components/ui';
import { Drawer } from '../../../components/ui/Drawer';
import { newKey, send, useApi } from '../../../lib/ui/api';
import { apiErrorCode, apiErrorMessage } from '../../../lib/api/errors';
import { useLang } from '../../../lib/ui/lang';
import { usePermissions } from '../../../lib/ui/permissions';
import { parseEgpToMinor } from '../../../lib/money';
import { CourierBreakdown, CourierNet, UnresolvedList } from '../../../components/settlement/CourierMoney';

/**
 * Stage 3 of the Admin simplification (2026-11-13): "Drivers today" — the office's view of every courier: today's work, what the next closing
 * would settle, and what is still unpaid on earlier closings. "Close" opens the preview in a side panel; with the approved shortcut the cash
 * handed over (or paid out) at the desk is recorded in the SAME step — still two separate records, each through its existing endpoint and
 * permission: the closing (preview token, unique reference) and then a settlement payment against that closing (its own idempotency key,
 * method CASH, the closing reference as its reference). If the payment is refused after the closing was saved, the closing stays and the
 * panel says so, with a retry (same key — never a double payment) and the statement link. This page computes no money.
 */
export default function DriversTodayPage() {
  const { t, money } = useLang();
  const { can } = usePermissions();
  const today = useApi<any[]>('/admin/settlement/couriers/today', undefined, { refreshInterval: 30_000 });
  const [all, setAll] = useState(false);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (today.data ?? []).filter((r) => (all || r.relevant) && (!s || r.name.toLowerCase().includes(s) || (r.phone ?? '').includes(s)));
  }, [today.data, all, q]);
  const sums = useMemo(() => {
    let collect = 0, pay = 0, orders = 0;
    for (const r of today.data ?? []) {
      const net = r.open.netToCourierMinor as number;
      if (net < 0) collect += -net; else pay += net;
      orders += r.open.orders;
      for (const u of r.unpaidClosings) if (u.direction === 'COLLECTION') collect += u.remainingMinor; else pay += u.remainingMinor;
    }
    return { collect, pay, orders };
  }, [today.data]);
  const current = (today.data ?? []).find((r) => r.id === openId) ?? null;

  if (!can('CLOSE_DRIVER_SETTLEMENTS') && today.status === 403) return <ErrorState message={today.error ?? ''} status={403} />;
  return (
    <div className="max-w-6xl space-y-4" data-testid="drivers-today">
      <PageHeader title={t('Drivers today', 'المندوبون اليوم')}
        subtitle={t('Each courier: today’s work, what the next closing settles and what is still unpaid. Close and record the cash in one step.', 'كل مندوب: شغل النهارده، وما سيسوّيه التقفيل التالي، وما زال غير مدفوع. قفّل وسجّل النقدية في خطوة واحدة.')}
        actions={<Link href="/settlement" className="text-sm font-medium text-hatly-orangeDark hover:underline">{t('Full closing page →', 'صفحة التقفيل الكاملة ←')}</Link>} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-red-100 bg-red-50 p-3" data-testid="dt-sum-collect"><p className="text-xs text-red-800">{t('To collect from couriers', 'مطلوب تحصيله من المندوبين')}</p><p className="text-lg font-bold tabular-nums text-red-900">{money(sums.collect)}</p></div>
        <div className="rounded-xl border border-green-100 bg-green-50 p-3" data-testid="dt-sum-pay"><p className="text-xs text-green-800">{t('To pay couriers', 'مطلوب دفعه للمندوبين')}</p><p className="text-lg font-bold tabular-nums text-green-900">{money(sums.pay)}</p></div>
        <div className="rounded-xl border border-gray-200 bg-white p-3" data-testid="dt-sum-orders"><p className="text-xs text-gray-600">{t('Delivered orders waiting for a closing', 'طلبات مُسلّمة تنتظر التقفيل')}</p><p className="text-lg font-bold tabular-nums text-gray-900">{sums.orders}</p></div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {[{ v: false, en: 'Today', ar: 'اليوم' }, { v: true, en: 'All couriers', ar: 'كل المندوبين' }].map((f) => (
          <button key={String(f.v)} type="button" aria-pressed={all === f.v} onClick={() => setAll(f.v)} data-testid={`dt-filter-${f.v ? 'all' : 'today'}`}
            className={`min-h-[40px] rounded-full border px-3.5 text-sm font-medium ${all === f.v ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}>{t(f.en, f.ar)}</button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Name or phone', 'الاسم أو الهاتف')} aria-label={t('Search', 'بحث')} data-testid="dt-search"
          className="ms-auto min-h-[40px] w-full rounded-lg border border-gray-300 px-3 text-sm sm:w-64" />
      </div>

      {today.error && <ErrorState message={today.error} status={today.status} onRetry={today.reload} />}
      {!today.data && today.loading && <p className="py-10 text-center text-sm text-gray-500">{t('Loading…', 'جارٍ التحميل…')}</p>}
      {today.data && rows.length === 0 && <p className="rounded-xl bg-gray-50 px-4 py-8 text-center text-sm text-gray-500" data-testid="dt-empty">{t('No courier worked today.', 'لا يوجد مندوب اشتغل النهارده.')}</p>}

      <ul className="space-y-2">
        {rows.map((r) => {
          const owedBefore = r.unpaidClosings.reduce((n: number, u: any) => n + (u.direction === 'COLLECTION' ? -u.remainingMinor : u.remainingMinor), 0);
          return (
            <li key={r.id} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm" data-testid={`dt-row-${r.id}`}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="min-w-[12rem] flex-1">
                  <p className="flex items-center gap-2">
                    <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${r.online ? 'bg-green-500' : 'bg-gray-300'}`} />
                    <bdi className="font-semibold text-gray-900">{r.name}</bdi>
                    <span className="text-xs text-gray-500">{r.online ? t('online', 'متصل') : t('offline', 'غير متصل')}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-gray-600">
                    {t(`${r.deliveredToday} delivered today`, `${r.deliveredToday} تسليم اليوم`)} · {t(`on the road ${r.inProgress}/${r.capacity}`, `بالطريق ${r.inProgress}/${r.capacity}`)}
                    {r.lastClosing && <> · {t('last closing', 'آخر تقفيل')} <bdi className="font-mono">{r.lastClosing.reference}</bdi></>}
                  </p>
                </div>
                <div className="min-w-[12rem] text-sm" data-testid="dt-open">
                  {r.open.orders > 0 ? (
                    <>
                      <p className="text-xs text-gray-500">{t(`To close now: ${r.open.orders} order(s)`, `للتقفيل الآن: ${r.open.orders} طلب`)}</p>
                      <CourierNet minor={r.open.netToCourierMinor} />
                    </>
                  ) : <p className="text-xs text-gray-400">{t('Nothing to close', 'لا شيء للتقفيل')}</p>}
                  {r.open.held > 0 && <p className="text-xs text-amber-800">{t(`${r.open.held} held back`, `${r.open.held} مؤجل`)}</p>}
                </div>
                {r.unpaidClosings.length > 0 && (
                  <div className="min-w-[10rem] text-sm" data-testid="dt-unpaid">
                    <p className="text-xs text-gray-500">{t(`Unpaid on ${r.unpaidClosings.length} earlier closing(s)`, `غير مدفوع من ${r.unpaidClosings.length} تقفيل سابق`)}</p>
                    <CourierNet minor={owedBefore} />
                  </div>
                )}
                <div className="flex gap-2">
                  {r.phone && <a href={`tel:${r.phone}`} className="inline-flex min-h-[40px] items-center rounded-lg border border-gray-300 px-3 text-sm text-gray-800">{t('Call', 'اتصال')}</a>}
                  {(r.open.orders > 0 || r.unpaidClosings.length > 0) && (
                    <button type="button" onClick={() => setOpenId(r.id)} data-testid="dt-close"
                      className="min-h-[40px] rounded-lg bg-hatly-orange px-4 text-sm font-semibold text-white hover:bg-hatly-orangeDark">
                      {r.open.orders > 0 ? t('Close shift', 'تقفيل') : t('Settle', 'تسوية')}
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <Drawer open={Boolean(current)} onClose={() => setOpenId(null)} title={current ? t(`Close — ${current.name}`, `تقفيل — ${current.name}`) : ''} testId="dt-drawer">
        {current && <ClosePanel key={current.id} courier={current} onDone={() => today.reload()} />}
      </Drawer>
    </div>
  );
}

function ClosePanel({ courier, onDone }: { courier: any; onDone: () => void }) {
  const { t, money, dateTime } = useLang();
  const { can } = usePermissions();
  const toast = useToast();
  const canPay = can('MANAGE_SETTLEMENT_PAYMENTS');
  const preview = useApi<any>(courier.open.orders > 0 ? `/admin/settlement/drivers/${courier.id}/close-preview` : null, undefined, { keepPreviousData: false });
  const p = preview.data;
  const net: number = p?.totals?.netToCourierMinor ?? 0;
  const collection = net < 0;
  const [withCash, setWithCash] = useState(true);
  const [amount, setAmount] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState<any>(null);
  const [payment, setPayment] = useState<{ ok: boolean; message: string; minor?: number } | null>(null);
  const payKey = useRef(newKey());
  const needsAck = (p?.unresolved?.length ?? 0) > 0;
  const amountText = amount ?? (net !== 0 ? (Math.abs(net) / 100).toFixed(2) : '');
  const parsed = parseEgpToMinor(amountText);
  const cashOn = canPay && withCash && net !== 0;
  const amountBad = cashOn && (!parsed.ok || parsed.minor > Math.abs(net));

  const recordCash = async (period: { id: string; reference: string }, minor: number) => {
    try {
      await send('post', `/admin/settlements/driver/periods/${period.id}/payments`, { amountMinor: minor, method: 'CASH', reference: period.reference, paidOn: cairoDate(0) }, { 'Idempotency-Key': payKey.current });
      setPayment({ ok: true, minor, message: collection ? t(`Cash received ${money(minor)} — recorded on ${period.reference}.`, `تم تسجيل استلام ${money(minor)} نقدًا على ${period.reference}.`) : t(`Cash paid ${money(minor)} — recorded on ${period.reference}.`, `تم تسجيل دفع ${money(minor)} نقدًا على ${period.reference}.`) });
    } catch (e) {
      setPayment({ ok: false, minor, message: apiErrorMessage(e, t('The payment could not be recorded.', 'تعذّر تسجيل الدفعة.')) });
    }
  };

  const go = async () => {
    setBusy(true); setError(null);
    try {
      const res = await send<any>('post', `/admin/settlement/drivers/${courier.id}/close`, { previewToken: p.previewToken });
      setClosed(res); setConfirming(false);
      if (cashOn && parsed.ok) await recordCash(res, parsed.minor);
      toast.push('success', t(`Shift closed: ${res.reference}`, `تم التقفيل: ${res.reference}`));
      onDone();
    } catch (e) {
      const code = apiErrorCode(e);
      setError(code === 'PREVIEW_CHANGED' || code === 'ALREADY_SETTLED'
        ? t('The orders changed since this preview. It was refreshed — review it and confirm again.', 'تغيّرت الطلبات منذ هذه المعاينة. حُدّثت — راجعها وأكّد مرة أخرى.')
        : apiErrorMessage(e, t('The closing could not be saved.', 'تعذّر حفظ التقفيل.')));
      setConfirming(false); preview.reload();
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4 p-4" data-testid="dt-panel">
      {closed ? (
        <div className="space-y-3" data-testid="dt-done">
          <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-4">
            <p className="font-semibold text-green-900">{t('Shift closed', 'تم تقفيل الوردية')} · <bdi className="font-mono" data-testid="dt-reference">{closed.reference}</bdi></p>
            <p className="mt-1 text-sm text-green-900">{t(`${closed.totals.orders} orders`, `${closed.totals.orders} طلب`)} · <CourierNet minor={closed.netPayableMinor} /></p>
          </div>
          {payment && (
            <div role={payment.ok ? 'status' : 'alert'} data-testid={payment.ok ? 'dt-paid' : 'dt-pay-failed'} className={`rounded-xl border p-4 text-sm ${payment.ok ? 'border-green-200 bg-green-50 text-green-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
              {payment.ok ? payment.message : (
                <>
                  <p className="font-semibold">{t('The closing is saved, but the cash was NOT recorded:', 'التقفيل محفوظ، لكن لم يُسجَّل المبلغ:')}</p>
                  <p className="mt-1">{payment.message}</p>
                  <button type="button" disabled={busy} onClick={async () => { setBusy(true); await recordCash(closed, payment.minor!); setBusy(false); onDone(); }} data-testid="dt-pay-retry"
                    className="mt-2 min-h-[40px] rounded-lg bg-hatly-orange px-3 text-sm font-semibold text-white disabled:opacity-50">{t('Try recording it again', 'أعد محاولة التسجيل')}</button>
                </>
              )}
            </div>
          )}
          <Link href={`/settlements/driver/${closed.id}`} className="inline-block text-sm font-medium text-hatly-orangeDark hover:underline">{t('Open the saved statement →', 'افتح الكشف المحفوظ ←')}</Link>
        </div>
      ) : courier.open.orders > 0 ? (
        <>
          {preview.error && <ErrorState message={preview.error} onRetry={preview.reload} />}
          {!p && preview.loading && <p className="text-sm text-gray-500">{t('Preparing the preview…', 'جارٍ تجهيز المعاينة…')}</p>}
          {p && (
            <>
              <p className="text-xs text-gray-500">
                {p.previousClosing ? t(`Since ${p.previousClosing.reference} (${dateTime(p.previousClosing.periodEnd)}) until now · ${p.totals.orders} order(s): ${p.totals.codOrders} cash, ${p.totals.electronicOrders} electronic.`, `من ${p.previousClosing.reference} (${dateTime(p.previousClosing.periodEnd)}) حتى الآن · ${p.totals.orders} طلب: ${p.totals.codOrders} نقدي، ${p.totals.electronicOrders} إلكتروني.`) : t(`First closing · ${p.totals.orders} order(s).`, `أول تقفيل · ${p.totals.orders} طلب.`)}
              </p>
              <CourierBreakdown totals={p.totals} testId="dt-totals" />
              {p.unresolved.length > 0 && (
                <div className="rounded-lg bg-amber-50 p-3">
                  <p className="mb-1 text-sm font-semibold text-amber-900">{t(`Held for the next closing (${p.unresolved.length})`, `مؤجل للتقفيل التالي (${p.unresolved.length})`)}</p>
                  <UnresolvedList items={p.unresolved} />
                  <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="dt-ack" />{t('I reviewed the held orders', 'راجعت الطلبات المؤجلة')}</label>
                </div>
              )}

              {canPay && net !== 0 && (
                <div className="rounded-lg border border-gray-200 p-3" data-testid="dt-cash">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={withCash} onChange={(e) => setWithCash(e.target.checked)} data-testid="dt-cash-toggle" className="h-5 w-5 accent-hatly-orange" />
                    {collection ? t('I received the cash from the courier now', 'استلمت المبلغ من المندوب نقدًا الآن') : t('I paid the courier in cash now', 'دفعت المبلغ للمندوب نقدًا الآن')}
                  </label>
                  {withCash && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input value={amountText} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-label={t('Amount', 'المبلغ')} data-testid="dt-cash-amount"
                        className="min-h-[40px] w-36 rounded-lg border border-gray-300 px-3 text-sm tabular-nums" />
                      <span className="text-xs text-gray-500">{t(`Due ${money(Math.abs(net))}. Less = a partial payment; the rest stays due on the statement.`, `المستحق ${money(Math.abs(net))}. أقل = دفعة جزئية؛ الباقي يظل مستحقًا على الكشف.`)}</span>
                      {amountBad && <span className="w-full text-xs text-red-700" data-testid="dt-cash-invalid">{t('Enter an amount from 0.01 up to the due amount.', 'أدخل مبلغًا من 0.01 حتى المستحق.')}</span>}
                    </div>
                  )}
                </div>
              )}

              {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="dt-error">{error}</p>}
              {!confirming ? (
                <button type="button" disabled={p.lines.length === 0 || (needsAck && !ack) || amountBad} onClick={() => setConfirming(true)} data-testid="dt-submit"
                  className="min-h-[48px] w-full rounded-lg bg-hatly-orange px-4 text-base font-semibold text-white hover:bg-hatly-orangeDark disabled:opacity-50">
                  {cashOn ? (collection ? t('Close and record the cash received', 'تقفيل وتسجيل الاستلام') : t('Close and record the cash paid', 'تقفيل وتسجيل الدفع')) : t('Close the shift', 'تقفيل الوردية')}
                </button>
              ) : (
                <div className="rounded-lg border border-hatly-orange bg-orange-50 p-3" data-testid="dt-confirm-box">
                  <p className="text-sm text-gray-900">
                    {t(`${p.totals.orders} order(s) · `, `${p.totals.orders} طلب · `)}<CourierNet minor={net} />
                    {cashOn && parsed.ok && <> · {collection ? t(`receive ${money(parsed.minor)} cash`, `استلام ${money(parsed.minor)} نقدًا`) : t(`pay ${money(parsed.minor)} cash`, `دفع ${money(parsed.minor)} نقدًا`)}</>}
                  </p>
                  <p className="mt-1 text-xs text-gray-600">{t('A closing cannot be edited; corrections are new entries.', 'لا يُعدَّل التقفيل؛ التصحيح يكون بقيد جديد.')}</p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" disabled={busy} onClick={() => void go()} data-testid="dt-confirm" className="min-h-[44px] flex-1 rounded-lg bg-hatly-orange px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? '…' : t('Confirm', 'تأكيد')}</button>
                    <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="min-h-[44px] rounded-lg border border-gray-300 px-4 text-sm">{t('Back', 'رجوع')}</button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <p className="text-sm text-gray-600">{t('Nothing new to close.', 'لا شيء جديد للتقفيل.')}</p>
      )}

      {courier.unpaidClosings.length > 0 && (
        <div className="rounded-lg bg-gray-50 p-3" data-testid="dt-unpaid-list">
          <p className="mb-1 text-sm font-semibold text-gray-900">{t('Still unpaid on earlier closings', 'غير مدفوع من تقفيلات سابقة')}</p>
          <ul className="space-y-1 text-sm">
            {courier.unpaidClosings.map((u: any) => (
              <li key={u.periodId} className="flex items-center justify-between gap-2">
                <bdi className="font-mono">{u.reference ?? '—'}</bdi>
                <span><CourierNet minor={u.direction === 'COLLECTION' ? -u.remainingMinor : u.remainingMinor} /> <Link href={`/settlements/driver/${u.periodId}`} className="ms-2 text-hatly-orangeDark hover:underline">{t('Record', 'تسجيل')}</Link></span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

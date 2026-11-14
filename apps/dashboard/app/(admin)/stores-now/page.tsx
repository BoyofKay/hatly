'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { PageHeader, useToast } from '../../../components/ui';
import { RejectPart } from '../../../components/operations/RejectReason';
import { useApi } from '../../../lib/ui/api';
import { useLang } from '../../../lib/ui/lang';
import { usePermissions } from '../../../lib/ui/permissions';
import { apiErrorMessage } from '../../../lib/api/errors';
import { updateSegmentOnBehalf } from '../../../lib/api/admin-operations';

type Part = {
  segmentId: string; status: 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY_FOR_PICKUP'; createdAt: string; expectedReadyAt: string | null;
  orderId: string; orderNumber: string; fulfillmentType: string; unverifiedTransfer: boolean; lateAccept: boolean; latePreparation: boolean;
};
type Store = {
  branchId: string; branchName: string; vendorName: string; vendorNameAr: string | null; isOpen: boolean; acceptanceMode: string;
  contacts: Array<{ name: string; phone: string; role: string }>;
  counts: { notAccepted: number; lateAccept: number; preparing: number; latePreparation: number; ready: number };
  oldestWaitingAt: string | null; parts: Part[];
};

const STATUS: Record<Part['status'], [string, string]> = {
  PENDING: ['waiting to accept', 'بانتظار القبول'], CONFIRMED: ['accepted', 'مقبول'], PREPARING: ['preparing', 'قيد التحضير'], READY_FOR_PICKUP: ['ready — waiting for pickup', 'جاهز — بانتظار الاستلام'],
};

function minutesSince(iso: string | null, now: number) {
  return iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000)) : 0;
}

/**
 * Stage 4 of the Admin simplification (2026-11-14): "Stores now" — every store with an order part to act on, the late ones first (not
 * accepted within the alert window, preparation past its expected time), who to call, and the store's next step on each order: accept (or
 * accept and start preparing), start preparing, ready, or reject with a ready-made reason. Read: `GET /admin/operations/stores-now`. Every
 * button is the existing on-behalf segment transition with its own permission (MANAGE_ORDER_FULFILMENT); the page re-reads every 10 s.
 */
export default function StoresNowPage() {
  const { t, locale } = useLang();
  const ar = locale === 'ar';
  const { can } = usePermissions();
  const canStore = can('MANAGE_ORDER_FULFILMENT');
  const toast = useToast();
  const res = useApi<{ stores: Store[]; acceptAlertMinutes: number; truncated: boolean; totalParts: number }>('/admin/operations/stores-now', undefined, { refreshInterval: 10_000 });
  const [filter, setFilter] = useState<'action' | 'all'>('action');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const now = Date.now();

  const stores = res.data?.stores ?? [];
  const needsAction = (s: Store) => s.counts.notAccepted > 0 || s.counts.latePreparation > 0;
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return stores.filter((s) => (filter === 'all' || needsAction(s))
      && (!term || `${s.vendorName} ${s.vendorNameAr ?? ''} ${s.branchName}`.toLowerCase().includes(term) || s.parts.some((p) => p.orderNumber.toLowerCase().includes(term))));
  }, [stores, filter, q]);
  const sum = stores.reduce((a, s) => ({ late: a.late + s.counts.lateAccept, waiting: a.waiting + s.counts.notAccepted, latePrep: a.latePrep + s.counts.latePreparation }), { late: 0, waiting: 0, latePrep: 0 });

  async function act(key: string, fn: () => Promise<void>, ok: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(key);
    try {
      await fn();
      toast.push('success', ok);
    } catch (e) {
      toast.push('error', apiErrorMessage(e, t('The action could not be completed. The list was refreshed.', 'تعذّر تنفيذ الإجراء. تم تحديث القائمة.')));
    } finally {
      res.reload();
      busyRef.current = false;
      setBusy(null);
    }
  }

  const name = (s: Store) => (ar ? s.vendorNameAr ?? s.vendorName : s.vendorName);
  const btn = 'min-h-[40px] rounded-lg px-3 text-sm font-semibold disabled:opacity-50';

  return (
    <div className="space-y-4">
      <PageHeader title={t('Stores now', 'المتاجر الآن')} subtitle={t('Stores with orders to handle, the late ones first. Call the store or act for it from here.', 'المتاجر التي لديها طلبات الآن، المتأخر أولًا. اتصل بالمتجر أو نفّذ الخطوة نيابة عنه من هنا.')} />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className={`rounded-xl border p-3 ${sum.late ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'}`} data-testid="sn-sum-late">
          <p className="text-xs text-gray-600">{t(`Not accepted after ${res.data?.acceptAlertMinutes ?? 5} min`, `لم تُقبل بعد ${res.data?.acceptAlertMinutes ?? 5} دقائق`)}</p>
          <p className={`text-2xl font-bold ${sum.late ? 'text-red-700' : 'text-gray-900'}`}>{sum.late}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3" data-testid="sn-sum-waiting">
          <p className="text-xs text-gray-600">{t('Waiting for the store to accept', 'بانتظار قبول المتجر')}</p>
          <p className="text-2xl font-bold text-gray-900">{sum.waiting}</p>
        </div>
        <div className={`rounded-xl border p-3 ${sum.latePrep ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'}`} data-testid="sn-sum-late-prep">
          <p className="text-xs text-gray-600">{t('Preparation past the expected time', 'تحضير تجاوز الوقت المتوقع')}</p>
          <p className={`text-2xl font-bold ${sum.latePrep ? 'text-amber-800' : 'text-gray-900'}`}>{sum.latePrep}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(['action', 'all'] as const).map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} data-testid={`sn-filter-${f}`}
            className={`inline-flex min-h-[40px] items-center gap-2 rounded-full border px-3.5 text-sm font-medium ${filter === f ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}>
            {f === 'action' ? t('Needs action', 'يحتاج إجراء') : t('All stores with orders', 'كل المتاجر التي لديها طلبات')}
            <span className={`rounded-full px-2 text-xs ${filter === f ? 'bg-white/20' : 'bg-gray-100'}`}>{f === 'action' ? stores.filter(needsAction).length : stores.length}</span>
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Store or order number', 'المتجر أو رقم الطلب')} aria-label={t('Search', 'بحث')} data-testid="sn-search"
          className="ms-auto min-h-[40px] w-full rounded-lg border border-gray-300 px-3 text-sm sm:w-64" />
      </div>

      {res.data?.truncated && <p className="rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-700" data-testid="sn-truncated">{t(`Showing the newest 500 of ${res.data.totalParts} open store orders. Older ones are in Orders.`, `يُعرض أحدث 500 من ${res.data.totalParts} طلبًا مفتوحًا لدى المتاجر. الأقدم في صفحة الطلبات.`)}</p>}
      {res.error && <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('Could not refresh. Retrying…', 'تعذّر التحديث. جارٍ إعادة المحاولة…')}</p>}
      {!res.data && res.loading && <p className="py-10 text-center text-sm text-gray-500">{t('Loading…', 'جارٍ التحميل…')}</p>}
      {res.data && shown.length === 0 && (
        <p className="rounded-xl bg-green-50 px-4 py-8 text-center text-sm font-medium text-green-800" data-testid="sn-empty">
          ✓ {filter === 'action' ? t('No store needs action right now.', 'لا يوجد متجر يحتاج إجراء الآن.') : t('No store has an open order.', 'لا يوجد متجر لديه طلب مفتوح.')}
        </p>
      )}

      <ul className="space-y-3">
        {shown.map((s) => {
          const late = s.counts.lateAccept > 0;
          return (
            <li key={s.branchId} className={`overflow-hidden rounded-xl border bg-white shadow-sm ${late ? 'border-red-300' : 'border-gray-200'}`} data-testid={`sn-store-${s.branchId}`}>
              <div className="flex flex-wrap items-start gap-3 border-b border-gray-100 p-3">
                <div className="min-w-[12rem] flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <bdi className="text-base font-bold text-gray-900">{name(s)}</bdi>
                    <span className="text-sm text-gray-500"><bdi>{s.branchName}</bdi></span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.isOpen ? 'bg-green-50 text-green-800' : 'bg-gray-100 text-gray-700'}`}>{s.isOpen ? t('Open', 'مفتوح') : t('Closed', 'مغلق')}</span>
                    {s.acceptanceMode === 'HATLY' && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-800">{t('Hatly accepts for it', 'هاتلي تقبل نيابة عنه')}</span>}
                    {s.acceptanceMode === 'AUTO' && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-800">{t('Accepts automatically', 'قبول تلقائي')}</span>}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-1.5 text-xs" data-testid="sn-counts">
                    {s.counts.notAccepted > 0 && <span className={`rounded-full px-2 py-0.5 font-semibold ${late ? 'bg-red-600 text-white' : 'bg-orange-50 text-orange-800'}`}>
                      {t(`${s.counts.notAccepted} not accepted`, `${s.counts.notAccepted} لم يُقبل`)}{s.oldestWaitingAt ? t(` · oldest ${minutesSince(s.oldestWaitingAt, now)} min`, ` · الأقدم ${minutesSince(s.oldestWaitingAt, now)} د`) : ''}</span>}
                    {s.counts.preparing > 0 && <span className={`rounded-full px-2 py-0.5 ${s.counts.latePreparation ? 'bg-amber-100 font-semibold text-amber-900' : 'bg-gray-100 text-gray-700'}`}>
                      {t(`${s.counts.preparing} preparing`, `${s.counts.preparing} قيد التحضير`)}{s.counts.latePreparation ? t(` · ${s.counts.latePreparation} late`, ` · ${s.counts.latePreparation} متأخر`) : ''}</span>}
                    {s.counts.ready > 0 && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-800">{t(`${s.counts.ready} ready`, `${s.counts.ready} جاهز`)}</span>}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {s.contacts.length === 0 && <span className="text-xs text-gray-500" data-testid="sn-no-contact">{t('No store account to call', 'لا يوجد حساب للمتجر للاتصال به')}</span>}
                  {s.contacts.map((c) => (
                    <a key={c.phone} href={`tel:${c.phone}`} data-testid="sn-call"
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-800 hover:bg-gray-50">
                      {t('Call', 'اتصل')} <bdi>{c.name}</bdi> <bdi dir="ltr" className="text-xs text-gray-500">{c.phone}</bdi>
                    </a>
                  ))}
                </div>
              </div>
              <ul className="divide-y divide-gray-100">
                {s.parts.map((p) => {
                  const mins = minutesSince(p.status === 'PENDING' ? p.createdAt : p.expectedReadyAt, now);
                  return (
                    <li key={p.segmentId} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid={`sn-part-${p.segmentId}`} data-status={p.status}>
                      <span className="min-w-[10rem] flex-1 text-sm">
                        <Link href={`/order-management?order=${p.orderId}`} className="font-mono font-bold text-gray-900 hover:underline"><bdi>{p.orderNumber}</bdi></Link>
                        <span className="ms-2 text-xs text-gray-600">{t(...STATUS[p.status])}</span>
                        {p.lateAccept && <span className="ms-2 text-xs font-semibold text-red-700" data-testid="sn-late">{t(`waiting ${mins} min`, `منتظر ${mins} د`)}</span>}
                        {p.latePreparation && <span className="ms-2 text-xs font-semibold text-amber-800" data-testid="sn-late">{t(`${mins} min past the expected time`, `متأخر ${mins} د عن الوقت المتوقع`)}</span>}
                        {p.fulfillmentType === 'PICKUP' && <span className="ms-2 text-xs text-gray-500">{t('customer pickup', 'استلام العميل')}</span>}
                      </span>
                      {p.unverifiedTransfer && p.status !== 'READY_FOR_PICKUP' ? (
                        <Link href="/manual-transfer" className={`${btn} inline-flex items-center bg-hatly-orange text-white`} data-testid="sn-verify-transfer">{t('Verify the transfer first', 'تحقق من التحويل أولًا')}</Link>
                      ) : canStore && (
                        <>
                          {p.status === 'PENDING' && (
                            <>
                              <button type="button" disabled={busy !== null} data-testid="sn-accept-prepare" className={`${btn} bg-hatly-orange text-white hover:bg-hatly-orangeDark`}
                                onClick={() => act(`ap-${p.segmentId}`, async () => { await updateSegmentOnBehalf(p.segmentId, { status: 'CONFIRMED' }); await updateSegmentOnBehalf(p.segmentId, { status: 'PREPARING' }); }, t(`${p.orderNumber}: accepted and preparing for ${name(s)}.`, `${p.orderNumber}: قُبل وبدأ التحضير نيابة عن ${name(s)}.`))}>
                                {busy === `ap-${p.segmentId}` ? '…' : t('Accept & start preparing', 'قبول وبدء التحضير')}
                              </button>
                              <button type="button" disabled={busy !== null} data-testid="sn-accept" className={`${btn} border border-gray-300 bg-white font-medium text-gray-800 hover:bg-gray-50`}
                                onClick={() => act(`a-${p.segmentId}`, () => updateSegmentOnBehalf(p.segmentId, { status: 'CONFIRMED' }), t(`${p.orderNumber}: accepted for ${name(s)}.`, `${p.orderNumber}: قُبل نيابة عن ${name(s)}.`))}>
                                {t('Accept only', 'قبول فقط')}
                              </button>
                              <RejectPart segmentId={p.segmentId} orderNumber={p.orderNumber} storeName={name(s)} disabled={busy !== null} run={act} />
                            </>
                          )}
                          {p.status === 'CONFIRMED' && (
                            <button type="button" disabled={busy !== null} data-testid="sn-prepare" className={`${btn} bg-hatly-orange text-white hover:bg-hatly-orangeDark`}
                              onClick={() => act(`p-${p.segmentId}`, () => updateSegmentOnBehalf(p.segmentId, { status: 'PREPARING' }), t(`${p.orderNumber}: preparing.`, `${p.orderNumber}: بدأ التحضير.`))}>{t('Start preparing', 'بدء التحضير')}</button>
                          )}
                          {p.status === 'PREPARING' && (
                            <button type="button" disabled={busy !== null} data-testid="sn-ready" className={`${btn} bg-hatly-orange text-white hover:bg-hatly-orangeDark`}
                              onClick={() => act(`r-${p.segmentId}`, () => updateSegmentOnBehalf(p.segmentId, { status: 'READY_FOR_PICKUP' }), t(`${p.orderNumber}: ready.`, `${p.orderNumber}: جاهز.`))}>{t('Ready', 'جاهز')}</button>
                          )}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

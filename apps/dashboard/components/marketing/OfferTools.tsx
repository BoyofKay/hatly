'use client';
import { minorToEgpInput, parseEgpToMinor } from '../../lib/money';

import { useState } from 'react';
import Link from 'next/link';
import { Async, Button, ConfirmDialog, DataTable, LabeledInput, Modal, Pagination, usePaging, useToast } from '../ui';
import { send, useApi } from '../../lib/ui/api';
import { apiErrorMessage } from '../../lib/api/errors';
import { useLang } from '../../lib/ui/lang';
import { usePermissions } from '../../lib/ui/permissions';

/** Performance, clone and safe-edit actions added to each offer. Discount rules never change on an offer already used — clone instead. */
export function OfferTools({ offer, onChanged }: { offer: { id: string; name: string; endAt: string; budgetCapMinor: number | null; totalAllocationLimit: number | null }; onChanged: () => void }) {
  const { t } = useLang();
  const { can } = usePermissions();
  const toast = useToast();
  const [view, setView] = useState<null | 'perf' | 'edit' | 'clone'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(offer.name);
  const [endAt, setEndAt] = useState(offer.endAt.slice(0, 16));
  const [budget, setBudget] = useState(minorToEgpInput(offer.budgetCapMinor));
  const [alloc, setAlloc] = useState(offer.totalAllocationLimit === null ? '' : String(offer.totalAllocationLimit));
  const [cloneName, setCloneName] = useState(`${offer.name} (copy)`);
  const [cloneCode, setCloneCode] = useState('');
  const manage = can('MANAGE_OFFERS');

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (name !== offer.name) body.name = name;
      if (endAt && endAt !== offer.endAt.slice(0, 16)) body.endAt = new Date(endAt).toISOString();
      if (budget !== minorToEgpInput(offer.budgetCapMinor) && budget !== '') {
        const b = parseEgpToMinor(budget);
        if (!b.ok) { setError(t('Enter the budget in EGP, e.g. 500 or 750.50.', 'أدخل الميزانية بالجنيه، مثل 500 أو 750.50.')); return; }
        body.budgetCapMinor = b.minor;
      }
      if (alloc !== (offer.totalAllocationLimit === null ? '' : String(offer.totalAllocationLimit)) && alloc !== '') body.totalAllocationLimit = Number(alloc);
      if (Object.keys(body).length === 0) { setError(t('Nothing to change.', 'لا شيء لتغييره.')); return; }
      await send('patch', `/admin/offers/${offer.id}`, body);
      toast.push('success', t('Offer updated.', 'تم تحديث العرض.')); setView(null); onChanged();
    } catch (e) { setError(apiErrorMessage(e, t('Could not update the offer.', 'تعذّر تحديث العرض.'))); } finally { setBusy(false); }
  };
  const clone = async () => {
    setBusy(true); setError(null);
    try {
      await send('post', `/admin/offers/${offer.id}/clone`, { name: cloneName, couponCode: cloneCode || null });
      toast.push('success', t('Cloned as an inactive copy. Review it, then activate.', 'تم النسخ كنسخة غير مفعّلة. راجعها ثم فعّلها.')); setView(null); onChanged();
    } catch (e) { setError(apiErrorMessage(e, t('Could not clone the offer.', 'تعذّر نسخ العرض.'))); } finally { setBusy(false); }
  };

  return (
    <span className="inline-flex flex-wrap gap-2">
      <button className="text-xs text-hatly-orangeDark underline" onClick={() => { setError(null); setView('perf'); }}>{t('Performance', 'الأداء')}</button>
      {manage && <button className="text-xs text-hatly-orangeDark underline" onClick={() => { setError(null); setView('edit'); }}>{t('Edit', 'تعديل')}</button>}
      {manage && <button className="text-xs text-hatly-orangeDark underline" onClick={() => { setError(null); setView('clone'); }}>{t('Clone', 'نسخ')}</button>}

      <Modal open={view === 'perf'} wide title={t(`Performance — ${offer.name}`, `الأداء — ${offer.name}`)} onClose={() => setView(null)}>{view === 'perf' && <Perf id={offer.id} />}</Modal>

      <Modal open={view === 'edit'} title={t('Edit offer', 'تعديل العرض')} onClose={() => !busy && setView(null)} footer={<><Button onClick={() => setView(null)} disabled={busy}>{t('Cancel', 'إلغاء')}</Button><Button variant="primary" loading={busy} onClick={save}>{t('Save', 'حفظ')}</Button></>}>
        <div className="space-y-3">
          <LabeledInput label={t('Name', 'الاسم')} value={name} onChange={(e) => setName(e.target.value)} />
          <LabeledInput label={t('Ends at', 'ينتهي في')} type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
          <LabeledInput label={t('Budget cap (EGP, can only be raised after use)', 'سقف الميزانية (بالجنيه، يمكن رفعه فقط بعد الاستخدام)')} inputMode="decimal" dir="ltr" value={budget} onChange={(e) => setBudget(e.target.value)} />
          <LabeledInput label={t('Total uses (can only be raised after use)', 'إجمالي الاستخدامات (يمكن رفعه فقط بعد الاستخدام)')} inputMode="numeric" value={alloc} onChange={(e) => setAlloc(e.target.value.replace(/\D/g, ''))} />
          <p className="text-xs text-gray-500">{t('Discount type, value, coupon code and branch cannot change. To change those, clone the offer and edit the copy.', 'لا يمكن تغيير نوع الخصم وقيمته ورمز القسيمة والفرع. لتغييرها انسخ العرض وعدّل النسخة.')}</p>
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>
      </Modal>

      <Modal open={view === 'clone'} title={t('Clone offer', 'نسخ العرض')} onClose={() => !busy && setView(null)} footer={<><Button onClick={() => setView(null)} disabled={busy}>{t('Cancel', 'إلغاء')}</Button><Button variant="primary" loading={busy} onClick={clone}>{t('Clone', 'نسخ')}</Button></>}>
        <div className="space-y-3">
          <LabeledInput label={t('New name', 'الاسم الجديد')} value={cloneName} onChange={(e) => setCloneName(e.target.value)} />
          <LabeledInput label={t('Coupon code (optional, 4–20 letters/digits)', 'رمز القسيمة (اختياري، 4–20 حرفًا/رقمًا)')} value={cloneCode} onChange={(e) => setCloneCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())} />
          <p className="text-xs text-gray-500">{t('The copy has the same rules and targeting, zero usage, and starts inactive.', 'للنسخة القواعد والاستهداف نفسهما، وبلا استخدام، وتبدأ غير مفعّلة.')}</p>
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>
      </Modal>
    </span>
  );
}

function Perf({ id }: { id: string }) {
  const { t, money, num, dateTime } = useLang();
  const perf = useApi<any>(`/admin/offers/${id}/performance`);
  const { page, setPage, limit } = usePaging(id, 10);
  const uses = useApi<any[]>(`/admin/offers/${id}/consumptions`, { page, limit });
  const d = perf.data;
  return (
    <div className="space-y-3">
      <Async state={perf} rows={3}>
        {d && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-gray-500">{t('Uses (net of reversed)', 'الاستخدامات (بعد استبعاد المعكوسة)')}</dt><dd className="text-end tabular-nums">{num(d.netConsumptions)} <span className="text-xs text-gray-500">/ {num(d.consumptions)} {t('recorded', 'مسجلة')}</span></dd>
            <dt className="text-gray-500">{t('Reversed', 'المعكوسة')}</dt><dd className="text-end tabular-nums">{num(d.reversed)}</dd>
            <dt className="text-gray-500">{t('Customers', 'العملاء')}</dt><dd className="text-end tabular-nums">{num(d.customers)}</dd>
            <dt className="text-gray-500">{t('Net discount given', 'صافي الخصم الممنوح')}</dt><dd className="text-end tabular-nums">{money(d.netDiscountMinor)}</dd>
            <dt className="text-gray-500">{t('Orders using it', 'الطلبات المستخدمة')}</dt><dd className="text-end tabular-nums">{num(d.ordersUsing)} · {money(d.ordersTotalMinor)}</dd>
            {d.budgetRemainingMinor !== null && <><dt className="text-gray-500">{t('Budget remaining', 'الميزانية المتبقية')}</dt><dd className="text-end tabular-nums">{money(d.budgetRemainingMinor)}</dd></>}
          </dl>
        )}
      </Async>
      <p className="text-xs text-gray-500">{t('Figures come straight from the recorded consumption rows. No return-on-investment is estimated.', 'الأرقام من سجلات الاستخدام مباشرة. لا تُقدَّر عوائد الاستثمار.')}</p>
      <DataTable rows={uses.data} rowKey={(r: any) => r.id} loading={uses.loading} error={uses.error} status={uses.status} onRetry={uses.reload} emptyTitle={t('Not used yet', 'لم يُستخدم بعد')} columns={[
        { key: 'at', header: t('When', 'متى'), cell: (r: any) => dateTime(r.createdAt) },
        { key: 'o', header: t('Order', 'الطلب'), cell: (r: any) => (r.orderNumber ? <Link className="text-hatly-orangeDark hover:underline" href={`/order-management?q=${encodeURIComponent(r.orderNumber)}`}>{r.orderNumber}</Link> : '—') },
        { key: 'd', header: t('Discount', 'الخصم'), align: 'end', cell: (r: any) => money(r.discountMinor) },
        { key: 'r', header: t('State', 'الحالة'), cell: (r: any) => (r.reversed ? t('Reversed', 'معكوس') : t('Applied', 'مطبّق')) },
      ]} />
      {uses.meta && <Pagination page={page} limit={limit} total={uses.meta.total} onPage={setPage} />}
    </div>
  );
}

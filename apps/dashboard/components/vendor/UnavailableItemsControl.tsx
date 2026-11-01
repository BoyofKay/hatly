'use client';

import { useState } from 'react';
import { VendorOrderSegment, markItemsUnavailable } from '../../lib/api/vendor-orders';
import { apiErrorMessage } from '../../lib/api/errors';
import { useLang } from '../../lib/ui/lang';

/**
 * "An item is not available" (PD-016). The vendor ticks the items and sends; the customer is asked to continue without them or cancel the
 * order. The vendor does not choose a replacement and does not decide anything else — there is no substitution. Only the vendor's own part.
 */
export function UnavailableItemsControl({ segment, onDone }: { segment: VendorOrderSegment; onDone: () => void }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const editable = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP'].includes(segment.status);
  const removed = segment.removedItems ?? [];

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await markItemsUnavailable(segment.id, selected, note);
      setSent(true);
      setOpen(false);
      setSelected([]);
      setNote('');
      onDone();
    } catch (e) {
      setError(apiErrorMessage(e, t('Could not send this. Please try again.', 'تعذّر الإرسال. حاول مرة أخرى.')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 border-t pt-3" data-testid="vendor-unavailable-items">
      {removed.length > 0 && (
        <div className="mb-2 rounded border border-gray-200 bg-gray-50 p-2 text-sm text-gray-700" data-testid="vendor-removed-items">
          <p className="font-medium">{t('Taken off this order (the customer chose to continue without them):', 'حُذفت من هذا الطلب (اختار العميل المتابعة بدونها):')}</p>
          <ul className="list-disc ps-5">{removed.map((r) => <li key={r.id}>{r.productNameSnapshot ?? t('Item', 'صنف')} × {r.quantity}</li>)}</ul>
        </div>
      )}
      {sent && <p role="status" className="mb-2 rounded border border-green-200 bg-green-50 p-2 text-sm text-green-900">{t('Sent. The customer was asked whether to continue without these items or cancel the order; Hatly will follow up if they do not answer.', 'تم الإرسال. سُئل العميل هل يتابع بدون هذه الأصناف أم يلغي الطلب؛ وستتابع هاتلي إن لم يرد.')}</p>}
      {editable && segment.items.length > 0 && !open && (
        <button type="button" onClick={() => { setSent(false); setOpen(true); }} className="text-sm underline" data-testid="vendor-open-unavailable">{t('An item is not available', 'منتج غير متاح')}</button>
      )}
      {open && (
        <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium text-amber-900">{t('Which items can you not provide for this order?', 'ما الأصناف التي لا تستطيع توفيرها لهذا الطلب؟')}</p>
          <ul>
            {segment.items.map((i) => (
              <li key={i.id}>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={selected.includes(i.id)} onChange={() => setSelected((s) => (s.includes(i.id) ? s.filter((x) => x !== i.id) : [...s, i.id]))} />
                  {i.productNameSnapshot ?? t('Item', 'صنف')} × {i.quantity}
                </label>
              </li>
            ))}
          </ul>
          <label className="block">
            <span className="text-xs text-amber-900">{t('Note for Hatly (optional)', 'ملاحظة لهاتلي (اختيارية)')}</span>
            <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-1 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm" />
          </label>
          <p className="text-xs text-amber-900">{t('The customer will choose to continue without these items or cancel the whole order. You cannot suggest a replacement.', 'سيختار العميل المتابعة بدون هذه الأصناف أو إلغاء الطلب كاملًا. لا يمكنك اقتراح بديل.')}</p>
          {error && <p role="alert" className="text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={busy || selected.length === 0} onClick={submit} className="rounded bg-amber-700 px-3 py-1.5 text-white disabled:opacity-50" data-testid="vendor-send-unavailable">{busy ? t('Sending…', 'جارٍ الإرسال…') : t('Send to the customer', 'إرسال إلى العميل')}</button>
            <button type="button" disabled={busy} onClick={() => setOpen(false)} className="underline">{t('Cancel', 'إلغاء')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

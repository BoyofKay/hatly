'use client';

import { useRef, useState } from 'react';
import { useLang } from '../../lib/ui/lang';
import { updateSegmentOnBehalf } from '../../lib/api/admin-operations';

/**
 * Stage 4 (2026-11-14): ready-made reasons for rejecting a store part. The reason is the existing REQUIRED free-text reason of the
 * on-behalf transition — nothing new is stored: tapping a reason only fills the text, which stays editable. The text is written in Arabic
 * because the customer app shows it to the customer as written (the Egyptian customer base is Arabic-first); the English label is only
 * for the operator. "Other" leaves the box empty to type.
 */
export const REJECT_REASONS: Array<{ id: string; en: string; text: string }> = [
  { id: 'OUT_OF_STOCK', en: 'Items out of stock', text: 'بعض المنتجات غير متوفرة حاليًا' },
  { id: 'STORE_CLOSED', en: 'Store closed now', text: 'المتجر مغلق حاليًا' },
  { id: 'TOO_BUSY', en: 'Too busy to prepare', text: 'المتجر لديه ضغط طلبات ولا يستطيع تحضير الطلب الآن' },
  { id: 'CUSTOMER_ASKED', en: 'Customer asked to cancel', text: 'تم الإلغاء بناءً على طلب العميل' },
];

/** The chips + the editable reason box. Used in the order drawer (SegmentOperations) and inline on the board / "Stores now". */
export function RejectReasonPicker({ value, onChange, testIdPrefix = 'reject' }: { value: string; onChange: (v: string) => void; testIdPrefix?: string }) {
  const { t, locale } = useLang();
  const box = useRef<HTMLTextAreaElement>(null);
  return (
    <div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('Ready-made reasons', 'أسباب جاهزة')}>
        {REJECT_REASONS.map((r) => {
          const on = value.trim() === r.text;
          return (
            <button key={r.id} type="button" aria-pressed={on} onClick={() => onChange(r.text)} data-testid={`${testIdPrefix}-preset-${r.id}`}
              className={`min-h-[36px] rounded-full border px-3 text-xs font-medium ${on ? 'border-red-600 bg-red-600 text-white' : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50'}`}>
              {locale === 'ar' ? r.text : r.en}
            </button>
          );
        })}
        <button type="button" onClick={() => { onChange(''); box.current?.focus(); }} data-testid={`${testIdPrefix}-preset-OTHER`}
          className="min-h-[36px] rounded-full border border-dashed border-gray-400 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50">
          {t('Other…', 'سبب آخر…')}
        </button>
      </div>
      <label className="mt-2 block text-xs text-gray-600">
        {t('Reason (the customer sees it as written)', 'السبب (يظهر للعميل كما هو مكتوب)')}
        <textarea ref={box} value={value} onChange={(e) => onChange(e.target.value)} maxLength={500} rows={2} dir="auto"
          data-testid={`${testIdPrefix}-reason`}
          className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30" />
      </label>
    </div>
  );
}

/**
 * Inline "Reject…" for one pending store part: open → pick a reason (or type one) → "Reject" — the confirm is the second tap inside the
 * row (principle 2: irreversible actions confirm in place). Calls the existing on-behalf transition (CANCELLED + reason) only.
 */
export function RejectPart({ segmentId, orderNumber, storeName, disabled, run }: {
  segmentId: string;
  orderNumber: string;
  storeName: string;
  disabled: boolean;
  /** The caller's busy/toast/reload wrapper. */
  run: (key: string, fn: () => Promise<void>, ok: string) => Promise<void>;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open) {
    return (
      <button type="button" disabled={disabled} onClick={() => setOpen(true)} data-testid="part-reject"
        className="min-h-[40px] rounded-lg border border-red-300 bg-white px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
        {t('Reject…', 'رفض…')}
      </button>
    );
  }
  return (
    <div className="w-full rounded-xl border border-red-200 bg-red-50/40 p-2" data-testid="part-reject-form">
      <p className="mb-1.5 text-xs font-semibold text-red-800">{t(`Reject ${orderNumber} for ${storeName}`, `رفض ${orderNumber} نيابة عن ${storeName}`)}</p>
      <RejectReasonPicker value={reason} onChange={setReason} testIdPrefix="part-reject" />
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={disabled || !reason.trim()} data-testid="part-reject-confirm"
          onClick={() => run(`rj-${segmentId}`, async () => { await updateSegmentOnBehalf(segmentId, { status: 'CANCELLED', reason: reason.trim() }); setOpen(false); setReason(''); },
            t(`${orderNumber}: rejected for ${storeName}.`, `${orderNumber}: رُفض نيابة عن ${storeName}.`))}
          className="min-h-[40px] rounded-lg bg-red-600 px-3 text-sm font-semibold text-white disabled:opacity-50">
          {t('Reject — cannot be undone', 'رفض — لا يمكن التراجع')}
        </button>
        <button type="button" onClick={() => { setOpen(false); setReason(''); }} data-testid="part-reject-cancel"
          className="min-h-[40px] rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50">{t('Keep the order', 'تراجع')}</button>
      </div>
    </div>
  );
}

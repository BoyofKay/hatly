'use client';

import { useState } from 'react';
import { Offer } from '../../lib/api/admin-offers';
import { apiClient } from '../../lib/api/client';
import { apiErrorMessage } from '../../lib/api/errors';
import { useLang } from '../../lib/ui/lang';
import { Button, LabeledInput, Modal, useToast } from '../ui';

const toLocal = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const egp = (minor: number | null) => (minor === null ? '' : (minor / 100).toFixed(2));

/**
 * Edit an offer (backend `PATCH /admin/offers/:id`). Name, amounts, limits and an EARLIER end date can change; a running offer cannot be
 * extended, and the store / kind / targets / start / coupon stay as created (create a new offer to change those).
 */
export function OfferEditModal({ offer, onClose, onSaved }: { offer: Offer; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const { t } = useLang();
  const toast = useToast();
  const isFlash = offer.mechanism === 'FLASH_SALE';
  const isPercent = offer.discountType === 'PERCENTAGE';
  const [name, setName] = useState(offer.name);
  const [value, setValue] = useState(isFlash ? egp(offer.specialPriceMinor) : isPercent ? String((offer.discountValue ?? 0) / 100) : egp(offer.discountValue));
  const [minimum, setMinimum] = useState(egp(offer.minimumEligibleSubtotalMinor));
  const [maximum, setMaximum] = useState(egp(offer.maximumDiscountMinor));
  const [endAt, setEndAt] = useState(toLocal(offer.endAt));
  const [perOrder, setPerOrder] = useState(offer.perOrderLimit === null ? '' : String(offer.perOrderLimit));
  const [perCustomer, setPerCustomer] = useState(offer.perCustomerLifetimeLimit === null ? '' : String(offer.perCustomerLifetimeLimit));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const body: Record<string, unknown> = {};
    if (name.trim() !== offer.name) body.name = name.trim();
    const num = Number(value);
    if (isFlash) { const m = Math.round(num * 100); if (m !== offer.specialPriceMinor) body.specialPriceMinor = m; }
    else { const v = isPercent ? Math.round(num * 100) : Math.round(num * 100); if (v !== offer.discountValue) body.discountValue = v; }
    if (!isFlash && minimum && Math.round(Number(minimum) * 100) !== offer.minimumEligibleSubtotalMinor) body.minimumEligibleSubtotalMinor = Math.round(Number(minimum) * 100);
    if (!isFlash && maximum && Math.round(Number(maximum) * 100) !== offer.maximumDiscountMinor) body.maximumDiscountMinor = Math.round(Number(maximum) * 100);
    if (endAt !== toLocal(offer.endAt)) body.endAt = new Date(endAt).toISOString();
    if (perOrder && Number(perOrder) !== offer.perOrderLimit) body.perOrderLimit = Number(perOrder);
    if (perCustomer && Number(perCustomer) !== offer.perCustomerLifetimeLimit) body.perCustomerLifetimeLimit = Number(perCustomer);
    if (Object.keys(body).length === 0) { onClose(); return; }
    setBusy(true);
    setError(null);
    try {
      await apiClient.patch(`/admin/offers/${offer.id}`, body);
      toast.push('success', t('Offer saved.', 'تم حفظ العرض.'));
      await onSaved();
    } catch (err) {
      setError(apiErrorMessage(err, t('Could not save the offer.', 'تعذّر حفظ العرض.')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={t('Edit offer', 'تعديل العرض')} onClose={() => !busy && onClose()} footer={<>
      <Button onClick={onClose} disabled={busy}>{t('Cancel', 'إلغاء')}</Button>
      <Button variant="primary" loading={busy} disabled={!name.trim() || !(Number(value) > 0)} onClick={() => void save()}>{t('Save', 'حفظ')}</Button>
    </>}>
      <LabeledInput label={t('Name', 'الاسم')} value={name} onChange={(e) => setName(e.target.value)} />
      <LabeledInput
        label={isFlash ? t('Special price (EGP)', 'السعر الخاص (جنيه)') : isPercent ? t('Discount (%)', 'الخصم (%)') : t('Discount (EGP)', 'الخصم (جنيه)')}
        inputMode="decimal" dir="ltr" value={value} onChange={(e) => setValue(e.target.value)}
      />
      {!isFlash && (
        <div className="grid grid-cols-2 gap-3">
          <LabeledInput label={t('Minimum order (EGP)', 'الحد الأدنى للطلب (جنيه)')} inputMode="decimal" dir="ltr" value={minimum} onChange={(e) => setMinimum(e.target.value)} />
          <LabeledInput label={t('Maximum discount (EGP)', 'أقصى خصم (جنيه)')} inputMode="decimal" dir="ltr" value={maximum} onChange={(e) => setMaximum(e.target.value)} />
        </div>
      )}
      <LabeledInput label={t('Ends at', 'ينتهي في')} type="datetime-local" dir="ltr" value={endAt} onChange={(e) => setEndAt(e.target.value)} hint={t('A running offer can end earlier, not later.', 'يمكن إنهاء العرض الجاري مبكرًا وليس تمديده.')} />
      <div className="grid grid-cols-2 gap-3">
        <LabeledInput label={t('Limit per order', 'الحد لكل طلب')} inputMode="numeric" dir="ltr" value={perOrder} onChange={(e) => setPerOrder(e.target.value)} />
        <LabeledInput label={t('Limit per customer', 'الحد لكل عميل')} inputMode="numeric" dir="ltr" value={perCustomer} onChange={(e) => setPerCustomer(e.target.value)} />
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </Modal>
  );
}

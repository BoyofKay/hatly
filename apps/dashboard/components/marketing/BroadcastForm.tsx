'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, LabeledInput, LabeledSelect, LabeledTextarea, Modal, useToast } from '../ui';
import { send, useApi } from '../../lib/ui/api';
import { apiErrorMessage } from '../../lib/api/errors';
import { useLang } from '../../lib/ui/lang';

/** Shared create / edit form. `initial` present → edit of a draft. */
export function BroadcastForm({ open, onClose, onSaved, initial }: { open: boolean; onClose: () => void; onSaved: (b?: any) => void; initial?: any }) {
  const { t } = useLang();
  const router = useRouter();
  const toast = useToast();
  const audiences = useApi<any[]>(open ? '/admin/audiences' : null);
  const [f, setF] = useState(() => ({ titleEn: initial?.titleEn ?? '', titleAr: initial?.titleAr ?? '', bodyEn: initial?.bodyEn ?? '', bodyAr: initial?.bodyAr ?? '', deepLink: initial?.deepLink ?? '', audienceId: initial?.audienceId ?? '', push: Boolean(initial?.channels?.includes('PUSH')), scheduledAt: initial?.scheduledAt ? new Date(initial.scheduledAt).toISOString().slice(0, 16) : '' }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: any) => setF((s) => ({ ...s, [k]: v }));
  const submit = async () => {
    setBusy(true); setError(null);
    const body = { titleEn: f.titleEn, titleAr: f.titleAr, bodyEn: f.bodyEn, bodyAr: f.bodyAr, deepLink: f.deepLink || null, audienceId: f.audienceId, channels: f.push ? ['INBOX', 'PUSH'] : ['INBOX'], scheduledAt: f.scheduledAt ? new Date(f.scheduledAt).toISOString() : null };
    try {
      if (initial) { const r = await send('patch', `/admin/broadcasts/${initial.id}`, body); toast.push('success', t('Draft saved.', 'تم حفظ المسودة.')); onSaved(r); onClose(); }
      else { const r = await send<any>('post', '/admin/broadcasts', body); toast.push('success', t('Draft created.', 'تم إنشاء المسودة.')); onSaved(r); onClose(); router.push(`/broadcasts/${r.id}`); }
    } catch (e) { setError(apiErrorMessage(e, t('Could not save the broadcast.', 'تعذّر حفظ الرسالة.'))); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} wide title={initial ? t('Edit draft', 'تعديل المسودة') : t('New broadcast', 'رسالة جديدة')} onClose={() => !busy && onClose()} footer={<><Button onClick={onClose} disabled={busy}>{t('Cancel', 'إلغاء')}</Button><Button variant="primary" loading={busy} onClick={submit}>{t('Save draft', 'حفظ المسودة')}</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <LabeledInput label={t('Title (English, max 60)', 'العنوان (إنجليزي، حتى 60)')} maxLength={60} value={f.titleEn} onChange={(e) => set('titleEn', e.target.value)} />
        <LabeledInput label={t('Title (Arabic, max 60)', 'العنوان (عربي، حتى 60)')} dir="rtl" maxLength={60} value={f.titleAr} onChange={(e) => set('titleAr', e.target.value)} />
        <LabeledTextarea label={t('Message (English, max 240)', 'الرسالة (إنجليزي، حتى 240)')} rows={3} maxLength={240} value={f.bodyEn} onChange={(e) => set('bodyEn', e.target.value)} />
        <LabeledTextarea label={t('Message (Arabic, max 240)', 'الرسالة (عربي، حتى 240)')} dir="rtl" rows={3} maxLength={240} value={f.bodyAr} onChange={(e) => set('bodyAr', e.target.value)} />
        <LabeledSelect label={t('Audience', 'الجمهور')} value={f.audienceId} onChange={(e) => set('audienceId', e.target.value)}><option value="">{t('Choose…', 'اختر…')}</option>{(audiences.data ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</LabeledSelect>
        <LabeledInput label={t('Opens (optional)', 'يفتح (اختياري)')} placeholder="home | inbox | offer/<id> | order/<id>" hint={t('home, inbox, or offer/vendor/sector/product/order followed by an id.', 'home أو inbox أو offer/vendor/sector/product/order ثم المعرّف.')} value={f.deepLink} onChange={(e) => set('deepLink', e.target.value)} />
        <LabeledInput label={t('Schedule (optional, your local time)', 'جدولة (اختياري، بتوقيتك المحلي)')} type="datetime-local" value={f.scheduledAt} onChange={(e) => set('scheduledAt', e.target.value)} />
        <label className="flex items-center gap-2 pt-5 text-sm"><input type="checkbox" checked={f.push} onChange={(e) => set('push', e.target.checked)} /> {t('Also send as push notification (best effort)', 'أرسل أيضًا كإشعار (بأفضل جهد)')}</label>
      </div>
      <p className="mt-2 text-xs text-gray-500">{t('Every message always goes to the in-app inbox. SMS is not available.', 'تصل كل رسالة دائمًا إلى صندوق الوارد داخل التطبيق. الرسائل النصية غير متاحة.')}</p>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </Modal>
  );
}

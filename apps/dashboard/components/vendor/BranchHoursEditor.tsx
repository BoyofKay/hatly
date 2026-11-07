'use client';

import { useState } from 'react';
import { Button, Card, LabeledInput } from '../ui';
import { useLang } from '../../lib/ui/lang';

export type Hours = Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', { open: string; close: string }>>;
const DAYS: Array<[keyof Hours, string, string]> = [['sat', 'Saturday', 'السبت'], ['sun', 'Sunday', 'الأحد'], ['mon', 'Monday', 'الإثنين'], ['tue', 'Tuesday', 'الثلاثاء'], ['wed', 'Wednesday', 'الأربعاء'], ['thu', 'Thursday', 'الخميس'], ['fri', 'Friday', 'الجمعة']];

/**
 * Weekly opening hours and the preparation time of one branch — the same editor for the Admin branch page and (as a pattern) the vendor's own page.
 * Hours are informational for customers; whether the branch is open right now is decided by the open/closed switch and any active closure. Saving
 * sends exactly what is shown; the server validates it (HH:mm, 1–600 minutes).
 */
export function BranchHoursEditor({ initialHours, initialPrep, canEdit, onSave }: { initialHours: Hours; initialPrep: number | null; canEdit: boolean; onSave: (hours: Hours, prep: number | null) => Promise<void> }) {
  const { t } = useLang();
  const [hours, setHours] = useState<Hours>(initialHours ?? {});
  const [prep, setPrep] = useState(initialPrep == null ? '' : String(initialPrep));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const setDay = (d: keyof Hours, patch: { open?: string; close?: string } | null) => {
    setSaved(false);
    setHours((h) => { const n = { ...h }; if (patch === null) delete n[d]; else n[d] = { open: patch.open ?? n[d]?.open ?? '09:00', close: patch.close ?? n[d]?.close ?? '23:00' }; return n; });
  };
  async function save() {
    setError(null);
    const p = prep.trim() === '' ? null : Number(prep);
    if (p !== null && (!Number.isInteger(p) || p < 1 || p > 600)) return setError(t('Preparation time must be a whole number of minutes from 1 to 600.', 'مدة التحضير عدد صحيح من الدقائق بين 1 و600.'));
    setSaving(true);
    try { await onSave(hours, p); setSaved(true); } catch (e: any) { setError(e?.response?.data?.error?.message ?? t('The settings were refused.', 'تم رفض الإعدادات.')); } finally { setSaving(false); }
  }
  return (
    <Card title={t('Weekly hours and preparation time', 'المواعيد الأسبوعية ومدة التحضير')}>
{Object.keys(hours).length === 0 && <p className="mb-2 rounded-lg bg-blue-50 p-2 text-xs text-blue-800" data-testid="no-hours-note">{t('No weekly hours are set, so the store takes orders at any time while it is open. Tick the days you open to set hours — days left unticked will then be closed.', 'لا توجد مواعيد أسبوعية، لذلك يستقبل المتجر الطلبات في أي وقت طالما هو مفتوح. حدّد الأيام التي تعمل فيها لضبط المواعيد — الأيام غير المحددة ستكون مغلقة حينها.')}</p>}
      <ul className="space-y-2" data-testid="admin-hours">
        {DAYS.map(([d, en, ar]) => {
          const h = hours[d];
          return (
            <li key={d} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="w-24 font-medium">{t(en, ar)}</span>
              <label className="flex min-h-[40px] items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" disabled={!canEdit} checked={Boolean(h)} onChange={(e) => setDay(d, e.target.checked ? {} : null)} />{t('Open', 'مفتوح')}</label>
              {h ? (
                <>
                  <input aria-label={t(`${en} opens`, `${ar} يفتح`)} type="time" disabled={!canEdit} value={h.open} onChange={(e) => setDay(d, { open: e.target.value })} className="min-h-[40px] rounded-lg border border-gray-300 px-2 text-sm disabled:bg-gray-100" />
                  <span className="text-gray-400">→</span>
                  <input aria-label={t(`${en} closes`, `${ar} يغلق`)} type="time" disabled={!canEdit} value={h.close} onChange={(e) => setDay(d, { close: e.target.value })} className="min-h-[40px] rounded-lg border border-gray-300 px-2 text-sm disabled:bg-gray-100" />
                </>
              ) : <span className="text-xs text-gray-400">{Object.keys(hours).length === 0 ? t('No set hours', 'بدون مواعيد محددة') : t('Closed all day', 'مغلق طوال اليوم')}</span>}
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="w-56"><LabeledInput label={t('Preparation time (minutes)', 'مدة التحضير (بالدقائق)')} type="number" min={1} max={600} disabled={!canEdit} value={prep} onChange={(e) => { setPrep(e.target.value); setSaved(false); }} hint={t('Shown to customers as an estimate.', 'تظهر للعملاء كتقدير.')} /></div>
        {canEdit && <Button variant="primary" loading={saving} onClick={save} data-testid="admin-hours-save">{t('Save', 'حفظ')}</Button>}
        {saved && <span role="status" className="text-sm text-green-700">{t('Saved.', 'تم الحفظ.')}</span>}
      </div>
      {error && <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </Card>
  );
}

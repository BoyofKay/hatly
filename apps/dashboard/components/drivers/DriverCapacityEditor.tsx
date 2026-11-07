'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, inputCls } from '../ui';
import { useLang } from '../../lib/ui/lang';
import { usePermissions } from '../../lib/ui/permissions';
import { apiErrorMessage } from '../../lib/api/errors';
import { getDriverCapacity, setDriverCapacity, type DriverCapacity } from '../../lib/api/admin-dispatch';

/**
 * R18 (decision register 2026-11-06): how many active orders a driver may carry at once — their vehicle type's capacity unless an Admin
 * overrides it for this driver. Shows the current load; an override (or clearing it) needs OVERRIDE_DISPATCH and a reason, and records who
 * approved it, when, and the before/after. Lowering it never takes an order away — the driver simply gets no new one until under it.
 */
export function DriverCapacityEditor({ driverId, reloadKey = 0 }: { driverId: string; reloadKey?: number }) {
  const { t, dateTime } = useLang();
  const { can } = usePermissions();
  const [data, setData] = useState<DriverCapacity | null>(null);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    try { setData(await getDriverCapacity(driverId)); } catch { setData(null); }
  }, [driverId]);
  useEffect(() => { void load(); }, [load, reloadKey]);
  if (!data) return null;
  const parsed = value.trim() === '' ? null : Number(value);
  const valid = (parsed === null || (Number.isInteger(parsed) && parsed >= 1 && parsed <= 20)) && reason.trim().length >= 3;

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      setData(await setDriverCapacity(driverId, parsed, reason.trim()));
      setMessage({ ok: true, text: t('Saved. It applies to the next assignment.', 'تم الحفظ. يُطبَّق على الإسناد التالي.') });
      setOpen(false);
      setReason('');
    } catch (err) {
      setMessage({ ok: false, text: apiErrorMessage(err, t('Could not change the capacity.', 'تعذّر تغيير السعة.')) });
    } finally { setBusy(false); }
  }

  const last = data.history[0];
  return (
    <div className="border-t border-gray-100 pt-3" data-testid="driver-capacity">
      <p className="text-xs font-medium text-gray-700">{t('Orders at once', 'الطلبات في وقت واحد')}</p>
      <p className="text-sm" data-testid="driver-capacity-value">
        {t(`${data.active} active of ${data.capacity}`, `${data.active} نشطة من ${data.capacity}`)}
        <span className="ms-1 text-xs text-gray-500">
          {data.override !== null ? t('(override for this driver)', '(استثناء لهذا السائق)') : data.vehicleCapacity !== null ? t('(vehicle type)', '(نوع المركبة)') : t('(no vehicle type: 1)', '(بلا نوع مركبة: 1)')}
        </span>
      </p>
      {last && <p className="text-xs text-gray-500" data-testid="driver-capacity-last">{t(`Last change: ${last.effectiveBefore} → ${last.effectiveAfter} by ${last.approvedBy}, ${dateTime(last.at)} — ${last.reason}`, `آخر تغيير: ${last.effectiveBefore} ← ${last.effectiveAfter} بواسطة ${last.approvedBy}، ${dateTime(last.at)} — ${last.reason}`)}</p>}
      {can('OVERRIDE_DISPATCH') && !open && (
        <button type="button" className="mt-1 text-xs text-hatly-orange underline" data-testid="driver-capacity-edit" onClick={() => { setOpen(true); setValue(data.override === null ? '' : String(data.override)); setMessage(null); }}>
          {t('Override capacity', 'تعديل السعة استثنائيًا')}
        </button>
      )}
      {open && (
        <div className="mt-2 space-y-2">
          <input aria-label={t('Capacity (empty = vehicle type)', 'السعة (فارغ = نوع المركبة)')} placeholder={t('Empty = use the vehicle type', 'فارغ = نوع المركبة')} inputMode="numeric" className={`${inputCls} w-full`} value={value} onChange={(e) => setValue(e.target.value)} data-testid="driver-capacity-input" />
          <input aria-label={t('Reason', 'السبب')} placeholder={t('Reason (required)', 'السبب (مطلوب)')} className={`${inputCls} w-full`} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="driver-capacity-reason" />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={!valid || busy} loading={busy} onClick={save} data-testid="driver-capacity-save">{t('Save', 'حفظ')}</Button>
            <Button size="sm" disabled={busy} onClick={() => setOpen(false)}>{t('Cancel', 'إلغاء')}</Button>
          </div>
          {!valid && <p className="text-xs text-gray-500">{t('A whole number from 1 to 20 (or empty), and a reason of at least 3 characters.', 'عدد صحيح من 1 إلى 20 (أو فارغ)، وسبب من 3 أحرف على الأقل.')}</p>}
        </div>
      )}
      {message && <p className={`mt-1 text-xs ${message.ok ? 'text-green-700' : 'text-red-700'}`} role="status">{message.text}</p>}
    </div>
  );
}

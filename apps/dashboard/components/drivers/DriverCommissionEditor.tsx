'use client';

import { useState } from 'react';
import { Button, inputCls } from '../ui';
import { useLang } from '../../lib/ui/lang';
import { usePermissions } from '../../lib/ui/permissions';
import { apiErrorMessage } from '../../lib/api/errors';
import { setDriverCommissionRate } from '../../lib/api/admin-dispatch';

/**
 * R28 (decision register 2026-11-06): Hatly's commission percentage on ONE driver's delivery compensation (e.g. 0, 5, 10, 15, 20 %).
 * Stored as basis points; a change applies to deliveries completed after it — recorded entries keep the rate they were booked with.
 * Shown to everyone who can see the drivers; editable only with MANAGE_DRIVER_COMMISSION (the backend enforces it too).
 */
export function DriverCommissionEditor({ driverId, basisPoints, onSaved }: { driverId: string; basisPoints: number | null | undefined; onSaved: () => void }) {
  const { t } = useLang();
  const { can } = usePermissions();
  const current = basisPoints === null || basisPoints === undefined ? '' : String(basisPoints / 100);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const value = draft ?? current;
  const parsed = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 && Math.round(parsed * 100) === parsed * 100;
  const editable = can('MANAGE_DRIVER_COMMISSION');

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await setDriverCommissionRate(driverId, Math.round(parsed * 100));
      setDraft(null);
      setMessage({ ok: true, text: t('Saved. New deliveries use this rate.', 'تم الحفظ. تُطبَّق النسبة على التوصيلات الجديدة.') });
      onSaved();
    } catch (err: any) {
      setMessage({ ok: false, text: apiErrorMessage(err, t('Could not save the commission.', 'تعذّر حفظ العمولة.')) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-gray-100 pt-3" data-testid="driver-commission">
      <label htmlFor={`commission-${driverId}`} className="mb-1 block text-xs font-medium text-gray-700">
        {t('Hatly commission on delivery fee (%)', 'عمولة هاتلي من رسوم التوصيل (%)')}
      </label>
      {basisPoints === null || basisPoints === undefined ? (
        <p className="mb-1 text-xs text-amber-800" data-testid="driver-commission-unset">
          {t('Not set — no commission or earnings are recorded for this driver until it is set.', 'غير محددة — لا تُسجَّل عمولة ولا أرباح لهذا السائق حتى تُحدَّد.')}
        </p>
      ) : null}
      {editable ? (
        <div className="flex gap-2">
          <input
            id={`commission-${driverId}`}
            data-testid="driver-commission-input"
            inputMode="decimal"
            className={`${inputCls} min-w-0 flex-1`}
            value={value}
            placeholder="0, 5, 10, 15, 20"
            disabled={busy}
            onChange={(e) => {
              setMessage(null);
              setDraft(e.target.value === current ? null : e.target.value);
            }}
          />
          <Button size="sm" variant="primary" className="min-h-[40px]" disabled={!valid || draft === null || busy} onClick={save} data-testid="driver-commission-save">
            {t('Save', 'حفظ')}
          </Button>
        </div>
      ) : (
        <p className="text-sm" data-testid="driver-commission-value">{current === '' ? '—' : `${current}%`}</p>
      )}
      {draft !== null && !valid && <p className="mt-1 text-xs text-red-700">{t('Enter a percentage from 0 to 100.', 'أدخل نسبة من 0 إلى 100.')}</p>}
      {message && <p className={`mt-1 text-xs ${message.ok ? 'text-green-700' : 'text-red-700'}`} role="status">{message.text}</p>}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../../lib/api/client';
import { apiErrorMessage } from '../../lib/api/errors';
import { useLang } from '../../lib/ui/lang';
import { ResetPasswordButton } from '../admin/ResetPasswordButton';
import { Button, useToast } from '../ui';

interface ResetRequest { id: string; driverId: string; fullName: string; phone: string; requestedAt: string }

/**
 * Driver app round 2: "Forgot password?" requests sent from the app. Call the driver to confirm it is really them, then "Reset password"
 * (temporary password; the app makes them choose a new one) — that closes the request. "Dismiss" closes it without a reset.
 * Shown only when there is at least one open request; hidden for staff without access (the server refuses them).
 */
export function ResetRequestsCard() {
  const { t, dateTime } = useLang();
  const toast = useToast();
  const [items, setItems] = useState<ResetRequest[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get('/admin/drivers/password-reset-requests');
      setItems(res.data.data as ResetRequest[]);
    } catch {
      setItems([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const dismiss = async (id: string) => {
    try {
      await apiClient.post(`/admin/drivers/password-reset-requests/${id}/dismiss`);
      void load();
    } catch (e) {
      toast.push('error', apiErrorMessage(e, t('Could not dismiss the request.', 'تعذّر إغلاق الطلب.')));
    }
  };

  if (items.length === 0) return null;
  return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3" data-testid="drv-reset-requests">
      <p className="text-sm font-semibold text-amber-900">{t(`Password reset requests from the app (${items.length})`, `طلبات إعادة تعيين كلمة المرور من التطبيق (${items.length})`)}</p>
      <p className="mb-2 text-xs text-amber-900">{t('Call the driver to confirm it is them, then set a temporary password — the app asks them to choose a new one.', 'اتصل بالمندوب للتأكد أنه هو، ثم عيّن كلمة مرور مؤقتة — التطبيق سيطلب منه اختيار كلمة جديدة.')}</p>
      <ul className="space-y-2">
        {items.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white p-2 text-sm">
            <span className="min-w-0 flex-1"><bdi className="font-medium">{r.fullName}</bdi> · <a href={`tel:${r.phone}`} dir="ltr" className="text-hatly-orangeDark">{r.phone}</a> · <span className="text-xs text-gray-500">{dateTime(r.requestedAt)}</span></span>
            <ResetPasswordButton path={`/admin/drivers/${r.driverId}/reset-password`} name={r.fullName} onDone={() => void load()} />
            <Button size="sm" onClick={() => void dismiss(r.id)}>{t('Dismiss', 'إغلاق')}</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Button, ErrorState, Modal, PageHeader, useToast } from '../../../components/ui';
import { send, useApi } from '../../../lib/ui/api';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useLang } from '../../../lib/ui/lang';

interface Req {
  id: string; kind: 'CUSTOMER' | 'DRIVER' | 'STORE_STAFF' | 'HATLY_STAFF'; staffLevel: string | null; fullName: string | null; phone: string;
  requestedAt: string; tempIssuedAt: string | null; tempExpiresAt: string | null; failedAttempts: number; canIssue: boolean;
}

/**
 * Owner decision 2026-11-23: "Forgot password?" requests from every app and the dashboard. Call the person to check it is really them,
 * then "Give a temporary password" and read it to them: they type it with a new password on the same screen of their app (valid 60
 * minutes, 5 tries). Their old password keeps working until they change it. Only people above them can answer (staff by level).
 */
export default function PasswordRequestsPage() {
  const { t, dateTime } = useLang();
  const toast = useToast();
  const list = useApi<Req[]>('/admin/password-reset-requests', undefined, { refreshInterval: 30_000 });
  const [issued, setIssued] = useState<{ name: string; tempPassword: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const kindLabel: Record<Req['kind'], [string, string]> = {
    CUSTOMER: ['Customer', 'عميل'], DRIVER: ['Driver', 'مندوب'], STORE_STAFF: ['Store staff', 'موظف متجر'], HATLY_STAFF: ['Hatly staff', 'موظف هتلي'],
  };

  const issue = async (r: Req) => {
    setBusy(r.id);
    try {
      const d = await send<{ tempPassword: string; expiresAt: string }>('post', `/admin/password-reset-requests/${r.id}/issue`);
      setIssued({ name: r.fullName ?? r.phone, tempPassword: d.tempPassword, expiresAt: d.expiresAt });
      list.reload();
    } catch (e) {
      toast.push('error', apiErrorMessage(e, t('Could not issue a temporary password.', 'تعذّر إصدار كلمة مرور مؤقتة.')));
    } finally { setBusy(null); }
  };
  const dismiss = async (r: Req) => {
    setBusy(r.id);
    try { await send('post', `/admin/password-reset-requests/${r.id}/dismiss`); list.reload(); }
    catch (e) { toast.push('error', apiErrorMessage(e, t('Could not close the request.', 'تعذّر إغلاق الطلب.'))); }
    finally { setBusy(null); }
  };

  return (
    <div className="max-w-4xl space-y-4" data-testid="password-requests">
      <PageHeader title={t('Password requests', 'طلبات كلمة المرور')}
        subtitle={t('Call the person to confirm it is them, then give a temporary password. They type it with a new password in their app (valid 60 minutes, 5 tries). Their old password keeps working until then.',
          'اتصل بالشخص للتأكد أنه هو، ثم أعطه كلمة مرور مؤقتة. يكتبها مع كلمة مرور جديدة في تطبيقه (صالحة 60 دقيقة، 5 محاولات). كلمة مروره القديمة تظل تعمل حتى ذلك الحين.')} />
      {list.error && <ErrorState message={list.error} status={list.status} onRetry={list.reload} />}
      {list.data && list.data.length === 0 && <p className="rounded-xl bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">{t('No requests waiting.', 'لا توجد طلبات.')}</p>}
      <ul className="space-y-2">
        {(list.data ?? []).map((r) => (
          <li key={r.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3" data-testid={`pr-${r.id}`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-700">{t(...kindLabel[r.kind])}{r.staffLevel ? ` · ${r.staffLevel}` : ''}</span>
              <bdi className="font-semibold text-gray-900">{r.fullName ?? '—'}</bdi>
              <a href={`tel:${r.phone}`} dir="ltr" className="text-sm text-hatly-orangeDark">{r.phone}</a>
              <span className="text-xs text-gray-500">{t('asked', 'طلب')} {dateTime(r.requestedAt)}</span>
            </div>
            {r.tempIssuedAt && (
              <p className="mt-1 text-xs text-amber-900">
                {t(`Temporary password given ${dateTime(r.tempIssuedAt)} — valid until ${dateTime(r.tempExpiresAt)}; wrong tries: ${r.failedAttempts}/5.`, `أُعطيت كلمة مؤقتة ${dateTime(r.tempIssuedAt)} — صالحة حتى ${dateTime(r.tempExpiresAt)}؛ محاولات خاطئة: ${r.failedAttempts}/5.`)}
              </p>
            )}
            <div className="mt-2 flex gap-2">
              {r.canIssue ? (
                <>
                  <Button size="sm" variant="primary" loading={busy === r.id} onClick={() => void issue(r)} data-testid="pr-issue">{r.tempIssuedAt ? t('Give a new temporary password', 'إعطاء كلمة مؤقتة جديدة') : t('Give a temporary password', 'إعطاء كلمة مرور مؤقتة')}</Button>
                  <Button size="sm" disabled={busy === r.id} onClick={() => void dismiss(r)}>{t('Dismiss', 'إغلاق')}</Button>
                </>
              ) : <span className="text-xs text-gray-500">{t('Someone above this person must answer it.', 'يجب أن يجيب عليه شخص أعلى من هذا الشخص.')}</span>}
            </div>
          </li>
        ))}
      </ul>

      <Modal open={Boolean(issued)} title={t('Temporary password', 'كلمة المرور المؤقتة')} onClose={() => setIssued(null)} footer={<Button variant="primary" onClick={() => setIssued(null)}>{t('Done', 'تم')}</Button>}>
        {issued && (
          <div className="space-y-2 text-sm">
            <p>{t('For', 'لـ')} <bdi className="font-semibold">{issued.name}</bdi>:</p>
            <p dir="ltr" className="select-all rounded-lg bg-gray-100 px-3 py-2 text-center font-mono text-lg tracking-wider" data-testid="pr-temp">{issued.tempPassword}</p>
            <Button size="sm" onClick={() => void navigator.clipboard?.writeText(issued.tempPassword).then(() => toast.push('success', t('Copied.', 'تم النسخ.')))}>{t('Copy', 'نسخ')}</Button>
            <p className="text-xs text-gray-500">{t(`Tell it to them privately. Valid until ${dateTime(issued.expiresAt)}. It is not shown again.`, `أبلغه بها بشكل خاص. صالحة حتى ${dateTime(issued.expiresAt)}. لن تظهر مرة أخرى.`)}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}

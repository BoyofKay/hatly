'use client';

import { useState } from 'react';
import { apiClient } from '../../lib/api/client';
import { apiErrorMessage } from '../../lib/api/errors';
import { useLang } from '../../lib/ui/lang';
import { Button, LabeledInput, Modal, useToast } from '../ui';

/** A readable temporary password: 4 letters + 4 digits (no look-alike characters). */
function suggestPassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const pick = (set: string, n: number) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => set[x % set.length]).join('');
  return `${pick(letters, 4)}-${pick(digits, 4)}`;
}

/**
 * "Reset password" for someone who forgot theirs (drivers, store staff): the admin sets a temporary password and tells the person
 * (phone / WhatsApp). Every open session of that person ends. `path` is the reset endpoint, e.g. /admin/drivers/:id/reset-password.
 */
export function ResetPasswordButton({ path, name, size = 'sm' }: { path: string; name: string; size?: 'sm' | 'md' }) {
  const { t } = useLang();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const ok = value.length >= 8 && value.length <= 128;

  const start = () => {
    setValue(suggestPassword());
    setError(null);
    setDone(null);
    setOpen(true);
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(path, { newPassword: value });
      setDone(value);
      toast.push('success', t('Password reset. They were signed out everywhere.', 'تمت إعادة تعيين كلمة المرور وتسجيل خروجه من كل الأجهزة.'));
    } catch (e) {
      setError(apiErrorMessage(e, t('Could not reset the password.', 'تعذّرت إعادة تعيين كلمة المرور.')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size={size} className="min-h-[40px]" onClick={start}>{t('Reset password', 'إعادة تعيين كلمة المرور')}</Button>
      <Modal
        open={open}
        title={t('Reset password', 'إعادة تعيين كلمة المرور')}
        onClose={() => !busy && setOpen(false)}
        footer={done ? <Button variant="primary" onClick={() => setOpen(false)}>{t('Done', 'تم')}</Button> : <>
          <Button onClick={() => setOpen(false)} disabled={busy}>{t('Cancel', 'إلغاء')}</Button>
          <Button variant="primary" loading={busy} disabled={!ok} onClick={() => void save()}>{t('Set this password', 'تعيين كلمة المرور')}</Button>
        </>}
      >
        {done ? (
          <div className="space-y-2 text-sm">
            <p>{t('New password for', 'كلمة المرور الجديدة لـ')} <bdi className="font-semibold">{name}</bdi>:</p>
            <p dir="ltr" className="select-all rounded-lg bg-gray-100 px-3 py-2 text-center font-mono text-lg tracking-wider">{done}</p>
            <Button size="sm" onClick={() => void navigator.clipboard?.writeText(done).then(() => toast.push('success', t('Copied.', 'تم النسخ.')))}>{t('Copy', 'نسخ')}</Button>
            <p className="text-xs text-gray-500">{t('Send it to them privately. It is not shown again.', 'أرسلها له بشكل خاص. لن تظهر مرة أخرى.')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-gray-600">{t('For', 'لـ')} <bdi className="font-medium">{name}</bdi>. {t('They are signed out everywhere and sign in with this password.', 'سيتم تسجيل خروجه من كل الأجهزة ويدخل بكلمة المرور هذه.')}</p>
            <LabeledInput label={t('Temporary password (8+ characters)', 'كلمة مرور مؤقتة (8 أحرف أو أكثر)')} dir="ltr" value={value} onChange={(e) => setValue(e.target.value)} />
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          </div>
        )}
      </Modal>
    </>
  );
}

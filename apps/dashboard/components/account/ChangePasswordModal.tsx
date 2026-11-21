'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { changeMyPassword, staffPasswordProblem } from '../../lib/api/admin-staff';
import { apiErrorMessage } from '../../lib/api/errors';
import { useLang } from '../../lib/ui/lang';
import { Button, LabeledInput, Modal, useToast } from '../ui';

/** "Change my password" for whoever is signed in (super admin, admin, operations staff, vendor staff). */
export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLang();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setCurrent(''); setNext(''); setConfirm(''); setError(null); }
  }, [open]);

  const problem = next ? staffPasswordProblem(next, t) : null;
  const mismatch = confirm && confirm !== next ? t('The two new passwords do not match.', 'كلمتا المرور الجديدتان غير متطابقتين.') : null;
  const ok = current.length > 0 && next.length > 0 && !problem && confirm === next;

  async function submit() {
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      await changeMyPassword(current, next);
      toast.push('success', t('Your password was changed.', 'تم تغيير كلمة المرور.'));
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, t('Could not change the password.', 'تعذّر تغيير كلمة المرور.')));
    } finally {
      setBusy(false);
    }
  }

  // Rendered on <body>: the shells open this from inside their sticky, blurred header, which would otherwise clip a fixed dialog.
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <Modal open title={t('Change my password', 'تغيير كلمة المرور')} onClose={() => !busy && onClose()} footer={<>
      <Button onClick={onClose} disabled={busy}>{t('Cancel', 'إلغاء')}</Button>
      <Button variant="primary" loading={busy} disabled={!ok} onClick={() => void submit()}>{t('Change password', 'تغيير كلمة المرور')}</Button>
    </>}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-3">
        <LabeledInput label={t('Current password', 'كلمة المرور الحالية')} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <LabeledInput label={t('New password', 'كلمة المرور الجديدة')} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} error={problem} hint={t('10+ characters with a letter and a digit.', '10 أحرف أو أكثر بها حرف ورقم.')} />
        <LabeledInput label={t('Repeat the new password', 'أعد كتابة كلمة المرور الجديدة')} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={mismatch} />
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>,
    document.body,
  );
}

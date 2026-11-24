'use client';

import { useState } from 'react';
import { PasswordVisibilityInput } from './PasswordVisibilityInput';
import { egyptPhoneForAuth } from '../../lib/auth/egypt-phone';
import { apiClient } from '../../lib/api/client';
import { apiErrorCode, apiErrorMessage } from '../../lib/api/errors';
import { useLang } from '../../lib/ui/lang';

/**
 * Owner decision 2026-11-23 — request-based "Forgot password?" (Hatly staff and store staff):
 *  1. Send a request (your phone). Someone above you calls you and gives you a temporary password (valid 60 minutes, 5 tries).
 *  2. On this same panel type it with your new password. Or Cancel and sign in with your old password — it keeps working until then.
 */
export function ForgotPasswordPanel({ phone: initialPhone, onClose }: { phone: string; onClose: () => void }) {
  const { t } = useLang();
  const [step, setStep] = useState<'ask' | 'enter' | 'done'>('ask');
  const [phone, setPhone] = useState(initialPhone);
  const [temp, setTemp] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const input = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-hatly-orange focus:outline-none';

  const ask = async () => {
    if (!egyptPhoneForAuth(phone)) { setError(t('Enter your phone number.', 'أدخل رقم هاتفك.')); return; }
    setBusy(true); setError(null);
    try {
      await apiClient.post('/auth/password-reset/request', { phone: egyptPhoneForAuth(phone) ?? phone.trim() });
      setInfo(t('Request sent. Your manager will call you with a temporary password (valid 60 minutes).', 'تم إرسال الطلب. سيتصل بك مديرك ويعطيك كلمة مرور مؤقتة (صالحة 60 دقيقة).'));
      setStep('enter');
    } catch (e) {
      setError(apiErrorMessage(e, t('Could not send the request.', 'تعذّر إرسال الطلب.')));
    } finally { setBusy(false); }
  };

  const complete = async () => {
    if (next !== confirm) { setError(t('The two new passwords do not match.', 'كلمتا المرور الجديدتان غير متطابقتين.')); return; }
    setBusy(true); setError(null);
    try {
      await apiClient.post('/auth/password-reset/complete', { phone: egyptPhoneForAuth(phone) ?? phone.trim(), tempPassword: temp.trim(), newPassword: next });
      setStep('done');
    } catch (e: any) {
      const code = apiErrorCode(e);
      const left = e?.response?.data?.error?.details?.attemptsLeft;
      setError(
        code === 'TEMP_PASSWORD_INVALID'
          ? t(`The temporary password is not correct (or not given yet).${left ? ` ${left} tries left.` : ''}`, `كلمة المرور المؤقتة غير صحيحة (أو لم تُعطَ بعد).${left ? ` متبقٍ ${left} محاولات.` : ''}`)
          : code === 'TEMP_PASSWORD_EXPIRED'
            ? t('The temporary password has expired. Send a new request.', 'انتهت صلاحية كلمة المرور المؤقتة. أرسل طلبًا جديدًا.')
            : code === 'TEMP_PASSWORD_LOCKED'
              ? t('Too many wrong tries. Send a new request.', 'محاولات خاطئة كثيرة. أرسل طلبًا جديدًا.')
              : apiErrorMessage(e, t('Could not change the password.', 'تعذّر تغيير كلمة المرور.')),
      );
      if (code === 'TEMP_PASSWORD_EXPIRED' || code === 'TEMP_PASSWORD_LOCKED') setStep('ask');
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3 rounded-xl border border-orange-200 bg-orange-50 px-3.5 py-3 text-sm text-gray-800" data-testid="forgot-panel">
      {step === 'done' ? (
        <>
          <p className="font-medium text-green-800" role="status">{t('Your password was changed. Sign in with it now.', 'تم تغيير كلمة المرور. ادخل بها الآن.')}</p>
          <button type="button" onClick={onClose} className="text-sm font-medium text-hatly-orange hover:underline">{t('Back to sign in', 'العودة لتسجيل الدخول')}</button>
        </>
      ) : (
        <>
          <p className="font-medium text-gray-900">{t('Forgot your password?', 'نسيت كلمة المرور؟')}</p>
          <div>
            <label htmlFor="fp-phone" className="block text-xs font-medium text-gray-700">{t('Phone number', 'رقم الهاتف')}</label>
            <input id="fp-phone" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={input} />
          </div>
          {step === 'ask' && (
            <>
              <p className="text-xs text-gray-600">{t('Send a request. Someone above you will call you and give you a temporary password.', 'أرسل طلبًا. سيتصل بك شخص أعلى منك ويعطيك كلمة مرور مؤقتة.')}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => void ask()} data-testid="fp-send" className="rounded-lg bg-hatly-orange px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{t('Send request', 'إرسال الطلب')}</button>
                <button type="button" onClick={() => { setError(null); setStep('enter'); }} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">{t('I already have a temporary password', 'لدي كلمة مرور مؤقتة')}</button>
              </div>
            </>
          )}
          {step === 'enter' && (
            <>
              {info && <p className="text-xs text-gray-700" role="status">{info}</p>}
              <div>
                <label htmlFor="fp-temp" className="block text-xs font-medium text-gray-700">{t('Temporary password', 'كلمة المرور المؤقتة')}</label>
                <PasswordVisibilityInput id="fp-temp" dir="ltr" value={temp} onChange={(e) => setTemp(e.target.value)} autoComplete="current-password" className={input} />
              </div>
              <div>
                <label htmlFor="fp-new" className="block text-xs font-medium text-gray-700">{t('New password (10+ characters, a letter and a digit)', 'كلمة المرور الجديدة (10 أحرف أو أكثر بها حرف ورقم)')}</label>
                <PasswordVisibilityInput id="fp-new" dir="ltr" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" className={input} />
              </div>
              <div>
                <label htmlFor="fp-confirm" className="block text-xs font-medium text-gray-700">{t('Repeat the new password', 'أعد كتابة كلمة المرور الجديدة')}</label>
                <PasswordVisibilityInput id="fp-confirm" dir="ltr" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" className={input} />
              </div>
              <button type="button" disabled={busy || !temp || !next} onClick={() => void complete()} data-testid="fp-complete" className="rounded-lg bg-hatly-orange px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{t('Change password', 'تغيير كلمة المرور')}</button>
            </>
          )}
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          <button type="button" onClick={onClose} className="block text-xs text-gray-600 hover:underline">{t('Cancel — I remember my password', 'إلغاء — أتذكر كلمة المرور')}</button>
        </>
      )}
    </div>
  );
}

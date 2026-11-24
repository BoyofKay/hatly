'use client';

import { useState } from 'react';
import { PasswordVisibilityInput } from '../../../components/auth/PasswordVisibilityInput';
import { useRouter } from 'next/navigation';
import { changeMyPassword, staffPasswordProblem } from '../../../lib/api/admin-staff';
import { apiErrorMessage } from '../../../lib/api/errors';
import { getCurrentUser, logout } from '../../../lib/auth/session';
import { LangProvider, useLang } from '../../../lib/ui/lang';

/**
 * Owner decision 2026-11-23: after signing in with a TEMPORARY password (set by a manager), the panel shows only this page until the
 * person chooses their own password — the server refuses everything else (PASSWORD_CHANGE_REQUIRED) meanwhile.
 */
export default function ChangePasswordPage() {
  return (
    <LangProvider defaultLocale="en">
      <ChangePasswordForm />
    </LangProvider>
  );
}

function ChangePasswordForm() {
  const router = useRouter();
  const { t, locale, setLocale, dir } = useLang();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problem = next ? staffPasswordProblem(next, t) : null;
  const mismatch = confirm && confirm !== next ? t('The two new passwords do not match.', 'كلمتا المرور الجديدتان غير متطابقتين.') : null;
  const ok = current.length > 0 && next.length > 0 && !problem && confirm === next;
  const input = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      await changeMyPassword(current, next);
      const role = getCurrentUser()?.role;
      router.replace(role === 'VENDOR' || role === 'VENDOR_MANAGER' ? '/orders' : '/home');
    } catch (err) {
      setError(apiErrorMessage(err, t('Could not change the password.', 'تعذّر تغيير كلمة المرور.')));
      setBusy(false);
    }
  }

  return (
    <main dir={dir} className="flex min-h-screen items-center justify-center bg-gradient-to-b from-orange-50 to-gray-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-3 flex justify-end">
          <button type="button" onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
            {locale === 'ar' ? 'English' : 'العربية'}
          </button>
        </div>
        <div className="rounded-2xl bg-white p-7 shadow-lg ring-1 ring-black/5">
          <div className="flex flex-col items-center text-center">
            <img src="/hatly-logo.jpg" alt="Hatly" width={64} height={64} className="h-16 w-16 rounded-2xl object-cover shadow-md" />
            <h1 className="mt-3 text-xl font-semibold text-gray-900">{t('Choose your own password', 'اختر كلمة مرور خاصة بك')}</h1>
            <p className="mt-1 text-sm text-gray-500">{t('You signed in with a temporary password. Set a new one to continue.', 'دخلت بكلمة مرور مؤقتة. عيّن كلمة مرور جديدة للمتابعة.')}</p>
          </div>
          <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-4">
            <div>
              <label htmlFor="cp-current" className="block text-sm font-medium text-gray-700">{t('Temporary password', 'كلمة المرور المؤقتة')}</label>
              <PasswordVisibilityInput id="cp-current" dir="ltr" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={input} />
            </div>
            <div>
              <label htmlFor="cp-new" className="block text-sm font-medium text-gray-700">{t('New password', 'كلمة المرور الجديدة')}</label>
              <PasswordVisibilityInput id="cp-new" dir="ltr" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={input} />
              <p className={`mt-1 text-xs ${problem ? 'text-red-600' : 'text-gray-500'}`}>{problem ?? t('10+ characters with a letter and a digit.', '10 أحرف أو أكثر بها حرف ورقم.')}</p>
            </div>
            <div>
              <label htmlFor="cp-confirm" className="block text-sm font-medium text-gray-700">{t('Repeat the new password', 'أعد كتابة كلمة المرور الجديدة')}</label>
              <PasswordVisibilityInput id="cp-confirm" dir="ltr" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={input} />
              {mismatch && <p className="mt-1 text-xs text-red-600">{mismatch}</p>}
            </div>
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button type="submit" disabled={!ok || busy} className="w-full rounded-lg bg-hatly-orange py-2.5 font-medium text-white shadow-sm hover:brightness-95 disabled:opacity-50">
              {busy ? t('Saving...', 'جارٍ الحفظ...') : t('Save and continue', 'حفظ ومتابعة')}
            </button>
          </form>
          <button type="button" onClick={() => void logout().then(() => router.replace('/login'))} className="mt-4 w-full text-center text-sm text-gray-500 hover:text-gray-700">
            {t('Sign out', 'تسجيل الخروج')}
          </button>
        </div>
      </div>
    </main>
  );
}

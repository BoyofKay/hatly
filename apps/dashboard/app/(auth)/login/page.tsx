'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loginWithPassword } from '../../../lib/auth/session';
import { ForgotPasswordPanel } from '../../../components/auth/ForgotPasswordPanel';
import { apiErrorMessage } from '../../../lib/api/errors';
import { LangProvider, useLang } from '../../../lib/ui/lang';
import { forgetAccount, maskPhone, readRecentAccounts, rememberAccount, RecentAccount } from '../../../lib/auth/recent-accounts';

/**
 * Dashboard sign-in — phone + password (+ authenticator code when the admin account has one). Serves VENDOR/VENDOR_MANAGER/ADMIN/
 * SUPER_ADMIN through the same `auth/dashboard/login` endpoint (role-checked server-side; never trusted from this form).
 * Arabic/English, show/hide password, "Forgot password?" (reset by a manager — there is no SMS provider yet, so no self-service
 * code), and "Switch account": people who ticked "Remember my phone number" on this browser are listed (name + phone only — never a password).
 */
export default function LoginPage() {
  return (
    <LangProvider defaultLocale="en">
      <LoginForm />
    </LangProvider>
  );
}

function roleLabel(role: string, t: (en: string, ar: string) => string) {
  if (role === 'SUPER_ADMIN') return t('Super admin', 'مدير النظام');
  if (role === 'ADMIN') return t('Hatly staff', 'فريق هتلي');
  if (role === 'VENDOR_MANAGER') return t('Store manager', 'مدير المتجر');
  if (role === 'VENDOR') return t('Store staff', 'موظف المتجر');
  return role;
}

function LoginForm() {
  const router = useRouter();
  const { t, locale, setLocale, dir } = useLang();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [recent, setRecent] = useState<RecentAccount[]>([]);
  const [picked, setPicked] = useState<RecentAccount | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  // Second step: shown once the API says this admin account has an authenticator (MFA_REQUIRED). Never shown for vendors.
  const [needsCode, setNeedsCode] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setRecent(readRecentAccounts()), []);

  function pick(a: RecentAccount | null) {
    setPicked(a);
    setPhone(a?.phone ?? '');
    setPassword('');
    setNeedsCode(false);
    setMfaCode('');
    setError(null);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const user = await loginWithPassword(phone.trim(), password, needsCode ? mfaCode.trim() : undefined);
      const allowed = ['ADMIN', 'SUPER_ADMIN', 'VENDOR', 'VENDOR_MANAGER'].includes(user.role);
      if (allowed) {
        if (remember) rememberAccount({ phone: phone.trim(), fullName: user.fullName ?? null, role: user.role });
        else forgetAccount(phone.trim());
      }
      if (allowed && user.mustChangePassword) {
        router.push('/change-password'); // a temporary password set by a manager: choose your own first
      } else if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
        // An admin the policy requires to have an authenticator is taken straight to enrolling it.
        router.push(user.mfa.enrollmentRequired ? '/security' : '/home');
      } else if (user.role === 'VENDOR' || user.role === 'VENDOR_MANAGER') {
        router.push('/orders');
      } else {
        setError(t('This account does not have dashboard access.', 'هذا الحساب ليس له صلاحية الدخول إلى لوحة التحكم.'));
        setIsSubmitting(false);
      }
    } catch (err: any) {
      const apiCode = err?.response?.data?.error?.details?.code;
      if (apiCode === 'MFA_REQUIRED') {
        setNeedsCode(true);
        setError(null);
        setIsSubmitting(false);
        return;
      }
      if (needsCode && err?.response?.status === 401) {
        setError(t('That verification code is not valid. Try the current code from your authenticator app, or a recovery code.', 'رمز التحقق غير صحيح. أدخل الرمز الحالي من تطبيق المصادقة أو أحد رموز الاسترداد.'));
        setIsSubmitting(false);
        return;
      }
      // 401 = wrong phone/password (deliberately vague). Anything else — rate limit / lock (429), validation, outage — shows its own reason.
      setError(err?.response?.status === 401 ? t('Invalid phone number or password.', 'رقم الهاتف أو كلمة المرور غير صحيحة.') : apiErrorMessage(err, t('Could not sign in. Please try again.', 'تعذر تسجيل الدخول. حاول مرة أخرى.')));
      setIsSubmitting(false);
    }
  }

  const input = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30';

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
            <img src="/hatly-logo.jpg" alt="Hatly" width={72} height={72} className="h-[72px] w-[72px] rounded-2xl object-cover shadow-md" />
            <h1 className="mt-3 text-xl font-semibold text-gray-900">{t('Hatly Dashboard', 'لوحة تحكم هتلي')}</h1>
            <p className="mt-0.5 text-sm text-gray-500">{picked ? t('Welcome back', 'أهلاً بعودتك') : t('Sign in to continue', 'سجّل الدخول للمتابعة')}</p>
          </div>

          {recent.length > 0 && !picked && (
            <div className="mt-6">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{t('Switch account', 'تبديل الحساب')}</p>
              <ul className="mt-2 space-y-1.5">
                {recent.map((a) => (
                  <li key={a.phone} className="flex items-center gap-2 rounded-xl border border-gray-200 hover:border-hatly-orange/60 hover:bg-orange-50/40">
                    <button type="button" onClick={() => pick(a)} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-start">
                      <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-hatly-orange/15 text-sm font-semibold text-hatly-orange">{(a.fullName ?? '?').trim().charAt(0).toUpperCase()}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-gray-800"><bdi>{a.fullName ?? <span dir="ltr">{maskPhone(a.phone)}</span>}</bdi></span>
                        <span className="block text-xs text-gray-500"><span dir="ltr" className="inline-block">{maskPhone(a.phone)}</span> · {roleLabel(a.role, t)}</span>
                      </span>
                    </button>
                    <button type="button" onClick={() => { forgetAccount(a.phone); setRecent(readRecentAccounts()); }} className="me-2 rounded p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-600" title={t('Remove from this device', 'إزالة من هذا الجهاز')} aria-label={t('Remove from this device', 'إزالة من هذا الجهاز')}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <div className="my-5 flex items-center gap-3 text-xs text-gray-400"><span className="h-px flex-1 bg-gray-200" />{t('or use another account', 'أو استخدم حساباً آخر')}<span className="h-px flex-1 bg-gray-200" /></div>
            </div>
          )}

          {picked && (
            <div className="mt-6 flex items-center gap-3 rounded-xl bg-gray-50 px-3 py-2.5">
              <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-hatly-orange/15 text-sm font-semibold text-hatly-orange">{(picked.fullName ?? '?').trim().charAt(0).toUpperCase()}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-gray-800"><bdi>{picked.fullName ?? <span dir="ltr">{maskPhone(picked.phone)}</span>}</bdi></span>
                <span className="block text-xs text-gray-500"><span dir="ltr" className="inline-block">{maskPhone(picked.phone)}</span></span>
              </span>
              <button type="button" onClick={() => pick(null)} className="text-xs font-medium text-hatly-orange hover:underline">{t('Not you?', 'لست أنت؟')}</button>
            </div>
          )}

          <form onSubmit={handleLogin} className={`${recent.length > 0 && !picked ? '' : 'mt-6'} space-y-4`}>
            {!picked && (
              <div>
                <label htmlFor="login-phone" className="block text-sm font-medium text-gray-700">{t('Phone number', 'رقم الهاتف')}</label>
                <input id="login-phone" type="tel" dir="ltr" required autoComplete="username" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+20..." className={input} />
              </div>
            )}
            <div>
              <div className="flex items-baseline justify-between">
                <label htmlFor="login-password" className="block text-sm font-medium text-gray-700">{t('Password', 'كلمة المرور')}</label>
                <button type="button" onClick={() => setForgotOpen((v) => !v)} className="text-xs font-medium text-hatly-orange hover:underline">{t('Forgot password?', 'نسيت كلمة المرور؟')}</button>
              </div>
              <div className="relative" dir="ltr">
                <input id="login-password" type={showPassword ? 'text' : 'password'} dir="ltr" required autoFocus={!!picked} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={`${input} pe-11`} />
                <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute inset-y-0 end-0 mt-1 flex w-11 items-center justify-center text-gray-400 hover:text-gray-700" title={showPassword ? t('Hide password', 'إخفاء كلمة المرور') : t('Show password', 'إظهار كلمة المرور')} aria-label={showPassword ? t('Hide', 'إخفاء') : t('Show', 'إظهار')} aria-controls="login-password" aria-pressed={showPassword}>
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A9.8 9.8 0 0112 5c5 0 9 4.5 10 7-.4 1-1.2 2.3-2.4 3.5M6.6 6.6C4.6 8 3.4 9.8 2 12c1 2.5 5 7 10 7 1.6 0 3-.4 4.3-1.1" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
                  )}
                </button>
              </div>
            </div>

            {forgotOpen && <ForgotPasswordPanel phone={phone} onClose={() => setForgotOpen(false)} />}

            {needsCode && (
              <div>
                <label htmlFor="login-mfa" className="block text-sm font-medium text-gray-700">{t('Verification code', 'رمز التحقق')}</label>
                <input id="login-mfa" dir="ltr" inputMode="numeric" autoComplete="one-time-code" autoFocus required value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} placeholder={t('6-digit code or recovery code', 'رمز من 6 أرقام أو رمز استرداد')} className={input} />
                <p className="mt-1 text-xs text-gray-500">{t('Open your authenticator app and enter the current code for Hatly Admin.', 'افتح تطبيق المصادقة وأدخل الرمز الحالي لحساب Hatly Admin.')}</p>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 rounded border-gray-300 accent-hatly-orange" />
              {t('Remember my phone number on this device', 'تذكّر رقم هاتفي على هذا الجهاز')}
            </label>

            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button type="submit" disabled={isSubmitting} className="w-full rounded-lg bg-hatly-orange py-2.5 font-medium text-white shadow-sm hover:brightness-95 disabled:opacity-50">
              {isSubmitting ? t('Signing in...', 'جارٍ تسجيل الدخول...') : t('Sign in', 'تسجيل الدخول')}
            </button>
          </form>
        </div>
        <p className="mt-4 text-center text-xs text-gray-400">{t('Passwords are never saved — everyone types their own password each time.', 'كلمات المرور لا تُحفظ أبداً — كل شخص يكتب كلمة مروره في كل مرة.')}</p>
      </div>
    </main>
  );
}

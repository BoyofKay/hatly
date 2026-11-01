'use client';

import { useEffect, useState } from 'react';
import { beginMfaSetup, disableMfa, enableMfa, getMfaStatus } from '../../../lib/api/admin-mfa';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useLang } from '../../../lib/ui/lang';
import { Badge, Button, Card, LabeledInput, PageHeader, Skeleton } from '../../../components/ui';

/**
 * Two-factor authentication for the signed-in admin. A standard authenticator app (Google/Microsoft Authenticator, Authy, 1Password…) holds the secret;
 * once enabled, signing in needs the current 6-digit code. The secret and the recovery codes are shown ONCE here and are never retrievable again (the
 * server stores the secret encrypted and the recovery codes only as hashes). Turning it off re-asks for the password and a current code.
 */
export default function SecurityPage() {
  const { t } = useLang();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMfaStatus()
      .then((s) => setEnabled(s.enabled))
      .catch((err) => setError(apiErrorMessage(err, t('Failed to load the security settings.', 'تعذّر تحميل إعدادات الأمان.'))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(apiErrorMessage(err, t('The request was refused.', 'تم رفض الطلب.')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title={t('Security', 'الأمان')} subtitle={t('Two-factor authentication protects this admin account even if its password is stolen.', 'التحقق بخطوتين يحمي حساب الإدارة هذا حتى لو سُرقت كلمة المرور.')} />
      {error && <p data-testid="security-error" role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {recoveryCodes && (
        <section data-testid="recovery-codes" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-semibold text-amber-900">{t('Save these recovery codes now — they are shown only once.', 'احفظ رموز الاسترداد هذه الآن — تظهر مرة واحدة فقط.')}</p>
          <p className="mt-1 text-xs text-amber-800">{t('Each works one time if you lose your authenticator. Keep them somewhere safe and offline.', 'يعمل كل رمز مرة واحدة إذا فقدت تطبيق المصادقة. احتفظ بها في مكان آمن وبعيدًا عن الإنترنت.')}</p>
          <ul className="mt-3 grid grid-cols-2 gap-1.5 font-mono text-sm" dir="ltr">
            {recoveryCodes.map((c) => <li key={c} className="rounded bg-white px-2 py-1">{c}</li>)}
          </ul>
          <Button data-testid="recovery-codes-done" variant="primary" className="mt-3 min-h-[44px]" onClick={() => setRecoveryCodes(null)}>{t('I have saved them', 'لقد حفظتها')}</Button>
        </section>
      )}

      {enabled === null && !error && <Skeleton className="h-32" />}

      {enabled !== null && (
        <Card title={t('Two-factor authentication', 'التحقق بخطوتين')} actions={<span data-testid="mfa-state"><Badge tone={enabled ? 'green' : 'amber'}>{enabled ? t('On', 'مفعّل') : t('Off', 'غير مفعّل')}</Badge></span>}>
          {enabled === false && !setup && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">{t('Add an authenticator app to this account. Signing in will then also need a 6-digit code from the app.', 'أضف تطبيق مصادقة لهذا الحساب. سيتطلب تسجيل الدخول بعدها رمزًا من 6 أرقام من التطبيق.')}</p>
              <Button data-testid="mfa-begin" variant="primary" className="min-h-[44px]" loading={busy} onClick={() => run(async () => setSetup(await beginMfaSetup()))}>{t('Set up an authenticator', 'إعداد تطبيق مصادقة')}</Button>
            </div>
          )}

          {enabled === false && setup && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  const result = await enableMfa(code.trim());
                  setRecoveryCodes(result.recoveryCodes);
                  setSetup(null);
                  setCode('');
                  setEnabled(true);
                });
              }}
            >
              <div>
                <p className="text-sm"><span className="font-semibold">1.</span> {t('In your authenticator app choose Add account → Enter a setup key and type this key (or open the link on your phone):', 'في تطبيق المصادقة اختر إضافة حساب ← إدخال مفتاح الإعداد واكتب هذا المفتاح (أو افتح الرابط على هاتفك):')}</p>
                <p data-testid="mfa-secret" dir="ltr" className="mt-2 break-all rounded-lg bg-gray-100 p-3 font-mono text-sm">{setup.secret}</p>
                <a href={setup.otpauthUrl} className="mt-1 inline-flex min-h-[36px] items-center text-sm font-medium text-hatly-orangeDark hover:underline">{t('Open in authenticator app', 'فتح في تطبيق المصادقة')}</a>
              </div>
              <div>
                <p className="text-sm"><span className="font-semibold">2.</span> {t('Enter the 6-digit code the app shows to confirm:', 'أدخل الرمز المكوّن من 6 أرقام الذي يعرضه التطبيق للتأكيد:')}</p>
                <input data-testid="mfa-code" inputMode="numeric" autoComplete="one-time-code" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} aria-label={t('6-digit code', 'الرمز المكوّن من 6 أرقام')} className="mt-2 min-h-[44px] w-44 rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-lg tracking-widest shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30" placeholder="123456" />
              </div>
              <Button data-testid="mfa-enable" type="submit" variant="primary" className="min-h-[44px]" loading={busy} disabled={code.trim().length < 6}>{t('Turn on two-factor authentication', 'تفعيل التحقق بخطوتين')}</Button>
            </form>
          )}

          {enabled === true && (
            <div>
              <p data-testid="mfa-status" className="text-sm font-medium text-green-700">{t('Two-factor authentication is ON.', 'التحقق بخطوتين مفعّل.')}</p>
              <p className="mt-1 text-sm text-gray-600">{t('Signing in needs your password and a current code from your authenticator app.', 'يتطلب تسجيل الدخول كلمة المرور ورمزًا حاليًا من تطبيق المصادقة.')}</p>
            </div>
          )}
        </Card>
      )}

      {enabled === true && (
        <section className="mt-4 rounded-xl border border-red-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-red-800">{t('Turn off two-factor authentication', 'إيقاف التحقق بخطوتين')}</h2>
          <p className="mt-1 text-xs text-gray-600">{t('Confirm with your password and a current code (or a recovery code). This makes the account easier to break into.', 'أكّد بكلمة المرور ورمز حالي (أو رمز استرداد). هذا يجعل اختراق الحساب أسهل.')}</p>
          <form
            className="mt-3 grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await disableMfa(password, code.trim());
                setEnabled(false);
                setPassword('');
                setCode('');
              });
            }}
          >
            <LabeledInput data-testid="mfa-disable-password" label={t('Password', 'كلمة المرور')} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <LabeledInput data-testid="mfa-disable-code" label={t('Code', 'الرمز')} dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} />
            <div className="sm:col-span-2"><Button data-testid="mfa-disable" type="submit" variant="danger" className="min-h-[44px]" loading={busy} disabled={!password || code.trim().length < 6}>{t('Turn off', 'إيقاف')}</Button></div>
          </form>
        </section>
      )}
    </div>
  );
}

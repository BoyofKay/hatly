'use client';

import { useState } from 'react';
import { deleteAccountWithPassword, normalizePhone, PublicResult, requestAccountDeletion } from '../../lib/api/account-deletion';

/**
 * PUBLIC page (no sign-in): Google Play requires that a user can request account deletion without the app. Two ways:
 *  1. phone number + password → the account is deleted at once (backend `POST /account-deletion/delete`, same proof as signing in);
 *  2. "I can't sign in" → a request only (`POST /account-deletion/requests`); Hatly staff verify the requester controls the number before
 *     anything is deleted. The page never shows whether a number has an account.
 * Everything stated here mirrors AccountDeletionService (apps/backend/src/modules/auth/account-deletion.service.ts).
 */
type Lang = 'ar' | 'en';

const T = {
  ar: {
    title: 'حذف حساب Hatly',
    intro: 'يمكنك حذف حسابك في Hatly وبياناته من هذه الصفحة بدون تطبيق. يمكنك أيضًا الحذف من داخل التطبيق: الملف الشخصي ← حذف حسابي.',
    erasedTitle: 'ما الذي يُحذف',
    erased: 'الاسم ورقم الهاتف وكلمة المرور، العناوين المحفوظة، الإشعارات، المفضلة، السلة، تعليقات التقييم، الصور التي رفعتها، نص الطلبات الخاصة، الملاحظات وسبب الإلغاء، وعنوان التوصيل وإحداثيات مشاوير «Hatly Service» في طلباتك المنتهية.',
    keptTitle: 'ما الذي نحتفظ به (بدون ما يدل عليك)',
    kept: 'سجلات الطلبات والمدفوعات والمحفظة والنقاط (المبالغ والأصناف والتواريخ وأرقام الطلبات) لأنها سجلات محاسبية، وعدد النجوم في التقييمات، واسم المكان في طلبات «Hatly Service»، وإثبات التسليم الخاص بالمندوب. تُحذف نقاط الولاء.',
    blockedTitle: 'متى لا يمكن الحذف بعد',
    blocked: 'إذا كان لديك طلب قيد التنفيذ، أو إذا كان رصيد محفظتك ليس صفرًا (تواصل مع دعم Hatly لتسويته أولًا).',
    aTitle: '1) أعرف كلمة المرور',
    phone: 'رقم الهاتف المسجّل',
    password: 'كلمة المرور',
    confirm: 'أفهم أن الحذف نهائي ولا يمكن التراجع عنه.',
    deleteNow: 'احذف حسابي الآن',
    bTitle: '2) لا أستطيع تسجيل الدخول',
    bText: 'أرسل رقمك وسيتواصل معك فريق Hatly على هذا الرقم نفسه (اتصال أو واتساب من رقم Hatly الرسمي) للتأكد أنه رقمك. لن نطلب منك كلمة المرور أبدًا. لا يُحذف أي شيء قبل هذا التأكيد.',
    sendRequest: 'أرسل طلب الحذف',
    sending: 'جارٍ الإرسال…',
    deleted: 'تم حذف حسابك.',
    invalid: 'رقم الهاتف أو كلمة المرور غير صحيح.',
    tooMany: 'محاولات كثيرة. حاول مرة أخرى لاحقًا.',
    activeOrder: 'لديك طلب قيد التنفيذ. يمكنك حذف الحساب بعد انتهائه.',
    wallet: 'رصيد محفظتك ليس صفرًا. تواصل مع دعم Hatly لتسويته قبل الحذف.',
    badPhone: 'اكتب رقم هاتف صحيح، مثل 01012345678.',
    failed: 'تعذّر الإرسال. تحقق من الاتصال وحاول مرة أخرى.',
    requested: 'إذا كان لهذا الرقم حساب في Hatly فسيتواصل معك فريقنا على هذا الرقم للتأكد قبل الحذف. لا يُحذف أي شيء قبل ذلك.',
  },
  en: {
    title: 'Delete your Hatly account',
    intro: 'You can delete your Hatly account and its data on this page, without the app. You can also delete it in the app: Profile → Delete my account.',
    erasedTitle: 'What is deleted',
    erased: 'Your name, phone number and password, saved addresses, notifications, favourites, cart, review comments, the photos you uploaded, custom-request text, notes and cancellation reasons, and the delivery address and Hatly Service coordinates on your finished orders.',
    keptTitle: 'What we keep (without anything that identifies you)',
    kept: 'Order, payment, wallet and loyalty records (amounts, items, dates and order numbers), because they are accounting records; the star ratings; the place name on Hatly Service orders; and the driver’s proof of delivery. Loyalty points are forfeited.',
    blockedTitle: 'When deletion has to wait',
    blocked: 'While you have an order in progress, or while your wallet balance is not zero (contact Hatly support to settle it first).',
    aTitle: '1) I know my password',
    phone: 'Registered phone number',
    password: 'Password',
    confirm: 'I understand this is permanent and cannot be undone.',
    deleteNow: 'Delete my account now',
    bTitle: '2) I can’t sign in',
    bText: 'Send your number and the Hatly team will contact you on that same number (a call or WhatsApp from Hatly’s official number) to confirm it is yours. We will never ask for your password. Nothing is deleted before that confirmation.',
    sendRequest: 'Send deletion request',
    sending: 'Sending…',
    deleted: 'Your account has been deleted.',
    invalid: 'Invalid phone number or password.',
    tooMany: 'Too many attempts. Please try again later.',
    activeOrder: 'You have an order in progress. You can delete your account after it is finished.',
    wallet: 'Your Hatly wallet is not empty. Contact Hatly support to settle it before deleting your account.',
    badPhone: 'Enter a valid phone number, for example 01012345678.',
    failed: 'Could not send. Check your connection and try again.',
    requested: 'If this number has a Hatly account, our team will contact this number to confirm it is yours before deleting the account. Nothing is deleted until then.',
  },
} as const;

function messageFor(t: (typeof T)[Lang], r: PublicResult): string {
  if (r.status === 0) return t.failed;
  if (r.status === 429) return t.tooMany;
  if (r.code === 'ACCOUNT_HAS_ACTIVE_ORDERS') return t.activeOrder;
  if (r.code === 'ACCOUNT_HAS_WALLET_BALANCE') return t.wallet;
  if (r.status === 400) return t.badPhone;
  if (r.status === 401) return t.invalid;
  return t.failed;
}

export default function AccountDeletionPage() {
  const [lang, setLang] = useState<Lang>('ar');
  const t = T[lang];
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [requestPhone, setRequestPhone] = useState('');
  const [busy, setBusy] = useState<'delete' | 'request' | null>(null);
  const [deleteResult, setDeleteResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [requestResult, setRequestResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function onDelete(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !confirmed) return;
    setBusy('delete');
    setDeleteResult(null);
    const r = await deleteAccountWithPassword(normalizePhone(phone), password);
    setPassword('');
    setDeleteResult(r.ok ? { ok: true, text: t.deleted } : { ok: false, text: messageFor(t, r) });
    setBusy(null);
  }

  async function onRequest(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy('request');
    setRequestResult(null);
    const r = await requestAccountDeletion(normalizePhone(requestPhone));
    setRequestResult(r.ok ? { ok: true, text: t.requested } : { ok: false, text: messageFor(t, r) });
    setBusy(null);
  }

  const box = 'rounded-lg border border-gray-200 bg-white p-5 shadow-sm';
  const input = 'mt-1 w-full rounded border border-gray-300 px-3 py-2';
  const button = 'mt-4 w-full rounded bg-hatly-orange px-4 py-2 font-semibold text-white disabled:opacity-50';

  return (
    <main dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang} className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-xl space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900" data-testid="deletion-title">{t.title}</h1>
          <button type="button" className="text-sm text-hatly-orange underline" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} data-testid="deletion-lang">
            {lang === 'ar' ? 'English' : 'العربية'}
          </button>
        </div>
        <p className="text-gray-700">{t.intro}</p>

        <section className={box}>
          <h2 className="font-semibold">{t.erasedTitle}</h2>
          <p className="mt-1 text-sm text-gray-700">{t.erased}</p>
          <h2 className="mt-3 font-semibold">{t.keptTitle}</h2>
          <p className="mt-1 text-sm text-gray-700">{t.kept}</p>
          <h2 className="mt-3 font-semibold">{t.blockedTitle}</h2>
          <p className="mt-1 text-sm text-gray-700">{t.blocked}</p>
        </section>

        <form className={box} onSubmit={onDelete} data-testid="deletion-self-service">
          <h2 className="font-semibold">{t.aTitle}</h2>
          <label className="mt-3 block text-sm">
            {t.phone}
            <input className={input} type="tel" inputMode="tel" autoComplete="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} required data-testid="deletion-phone" />
          </label>
          <label className="mt-3 block text-sm">
            {t.password}
            <input className={input} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required data-testid="deletion-password" />
          </label>
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid="deletion-confirm" />
            <span>{t.confirm}</span>
          </label>
          <button className={button} type="submit" disabled={!confirmed || busy !== null} data-testid="deletion-submit">
            {busy === 'delete' ? t.sending : t.deleteNow}
          </button>
          {deleteResult && (
            <p role="status" className={`mt-3 text-sm ${deleteResult.ok ? 'text-green-700' : 'text-red-700'}`} data-testid="deletion-result">{deleteResult.text}</p>
          )}
        </form>

        <form className={box} onSubmit={onRequest} data-testid="deletion-request">
          <h2 className="font-semibold">{t.bTitle}</h2>
          <p className="mt-1 text-sm text-gray-700">{t.bText}</p>
          <label className="mt-3 block text-sm">
            {t.phone}
            <input className={input} type="tel" inputMode="tel" autoComplete="tel" dir="ltr" value={requestPhone} onChange={(e) => setRequestPhone(e.target.value)} required data-testid="deletion-request-phone" />
          </label>
          <button className={button} type="submit" disabled={busy !== null} data-testid="deletion-request-submit">
            {busy === 'request' ? t.sending : t.sendRequest}
          </button>
          {requestResult && (
            <p role="status" className={`mt-3 text-sm ${requestResult.ok ? 'text-green-700' : 'text-red-700'}`} data-testid="deletion-request-result">{requestResult.text}</p>
          )}
        </form>

        <p className="text-center text-sm">
          <a href="/privacy" className="text-hatly-orange underline" data-testid="deletion-privacy-link">
            {lang === 'ar' ? 'سياسة الخصوصية' : 'Privacy policy'}
          </a>
        </p>
      </div>
    </main>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLang } from '../../lib/ui/lang';
import { useOpsAlarm } from './OpsAlarm';
import { deviceSupport, enablePush, permissionState } from '../../lib/alerts/push-client';

const LATER_KEY = 'hatly_push_prompt_later_until';

/**
 * Admin Home: until THIS browser is registered for the signed-in admin, say plainly that new orders will not reach this device when Hatly
 * is closed, and offer the one click that fixes it (browser permission → Web Push subscription → registered device). "Later" hides it for
 * 24 hours on this browser only. Nothing is claimed that was not measured: the card follows the server's own registration check.
 */
export function PushSetupPrompt() {
  const ctx = useOpsAlarm();
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [hidden, setHidden] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    let until = 0;
    try {
      until = Number(window.localStorage.getItem(LATER_KEY) ?? 0) || 0;
    } catch {
      /* storage unavailable */
    }
    setHidden(Date.now() < until);
    const s = deviceSupport();
    setSupported(s.secureContext && s.serviceWorker && s.push && s.notifications);
    setBlocked(permissionState() === 'denied');
  }, []);

  if (!ctx?.enabled || ctx.pushRegistered !== false || hidden) return null;

  const enable = async () => {
    setBusy(true);
    setMessage(null);
    const r = await enablePush();
    setBusy(false);
    if (r.ok) {
      await ctx.refreshDevice();
      return;
    }
    if (r.reason === 'denied') setBlocked(true);
    setMessage(
      r.reason === 'denied' ? t('Notifications are blocked for this site — see the steps on the setup page.', 'الإشعارات محظورة لهذا الموقع — راجع الخطوات في صفحة الإعداد.')
      : r.reason === 'dismissed' ? t('You closed the question. Press the button again and choose Allow.', 'أغلقت السؤال. اضغط الزر مرة أخرى واختر «السماح».')
      : r.reason === 'not-configured' ? t('Push is not set up on the server.', 'الإشعارات غير مُعدّة على الخادم.')
      : r.reason === 'unsupported' || r.reason === 'insecure' ? t('This browser cannot receive push notifications.', 'هذا المتصفح لا يستقبل الإشعارات.')
      : t('Could not register this device. Try again from the setup page.', 'تعذّر تسجيل هذا الجهاز. حاول من صفحة الإعداد.'),
    );
  };
  const later = () => {
    try {
      window.localStorage.setItem(LATER_KEY, String(Date.now() + 24 * 3600_000));
    } catch {
      /* not remembered */
    }
    setHidden(true);
  };

  return (
    <section className="rounded-2xl border border-orange-200 bg-orange-50 p-4" data-testid="push-setup-prompt" aria-labelledby="push-setup-title">
      <h2 id="push-setup-title" className="text-sm font-semibold text-gray-900">🔔 {t('This device will not alert you when Hatly is closed', 'هذا الجهاز لن ينبهك عندما تكون هاتلي مغلقة')}</h2>
      <p className="mt-1 text-xs text-gray-700">
        {t('Turn on notifications so new orders and urgent problems reach this phone or computer even when this tab is closed or the screen is locked.', 'فعّل الإشعارات لتصلك الطلبات الجديدة والمشكلات العاجلة على هذا الهاتف أو الكمبيوتر حتى والتبويب مغلق أو الشاشة مقفلة.')}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {supported && !blocked && (
          <button type="button" onClick={() => void enable()} disabled={busy} className="rounded-lg bg-hatly-orange px-3.5 py-2 text-sm font-semibold text-white hover:bg-hatly-orangeDark disabled:opacity-50" data-testid="push-setup-enable">
            {t('Turn on notifications', 'تفعيل الإشعارات')}
          </button>
        )}
        <Link href="/notification-setup" className="text-xs font-medium text-hatly-orangeDark underline" data-testid="push-setup-details">{t('Setup and test', 'الإعداد والتجربة')}</Link>
        <button type="button" onClick={later} className="text-xs text-gray-600 underline" data-testid="push-setup-later">{t('Later', 'لاحقًا')}</button>
      </div>
      {message && <p role="status" className="mt-2 text-xs text-gray-800" data-testid="push-setup-message">{message}</p>}
    </section>
  );
}

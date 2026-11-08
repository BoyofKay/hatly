'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, PageHeader } from '../../../components/ui';
import { useLang } from '../../../lib/ui/lang';
import { useOpsAlarm } from '../../../components/alerts/OpsAlarm';
import { listPushDevices, pushConfig, pushDelivery, PushConfig, PushDelivery, PushDevice, removePushDevice, sendTestPush } from '../../../lib/api/ops-alerts';
import { currentDevice, deviceSupport, DeviceSupport, enablePush, EnableResult, permissionState } from '../../../lib/alerts/push-client';
import { audioState, playAlarm } from '../../../lib/alerts/sound';

/**
 * Notification setup & diagnostics for THIS device and the signed-in admin. Every line is measured (browser APIs, the server's own records);
 * nothing is shown as working until it is. "Accepted" = the browser's push service took the message; "Shown" = this device's service worker
 * reported it displayed; neither is claimed from the server queue alone.
 */
type Tone = 'ok' | 'warn' | 'bad' | 'info';
const ICON: Record<Tone, string> = { ok: '✓', warn: '!', bad: '✕', info: '·' };
const TONE: Record<Tone, string> = { ok: 'bg-green-100 text-green-800', warn: 'bg-amber-100 text-amber-800', bad: 'bg-red-100 text-red-800', info: 'bg-gray-100 text-gray-700' };

export default function NotificationSetupPage() {
  const { t, locale } = useLang();
  const alarm = useOpsAlarm();
  const [support, setSupport] = useState<DeviceSupport | null>(null);
  const [permission, setPermission] = useState<string>('default');
  const [swActive, setSwActive] = useState<boolean | null>(null);
  const [cfg, setCfg] = useState<PushConfig | null>(null);
  const [mine, setMine] = useState<PushDevice | null>(null);
  const [devices, setDevices] = useState<PushDevice[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(null);
  const [test, setTest] = useState<PushDelivery | null>(null);
  const [soundTested, setSoundTested] = useState<boolean | null>(null);
  const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { timeZone: 'Africa/Cairo' }) : t('never', 'أبدًا'));

  const refresh = useCallback(async () => {
    setSupport(deviceSupport());
    setPermission(permissionState());
    setCfg(await pushConfig().catch(() => null));
    const { device } = await currentDevice().catch(() => ({ device: null }));
    setSwActive(Boolean(typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) || Boolean(await navigator.serviceWorker?.getRegistration?.('/').catch(() => undefined)));
    setMine(device);
    setDevices(await listPushDevices().catch(() => []));
    await alarm?.refreshDevice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => void refresh(), [refresh]);

  const explain = (r: EnableResult): { tone: Tone; text: string } => {
    if (r.ok) return { tone: 'ok', text: t('This device will now receive Hatly alerts.', 'سيستقبل هذا الجهاز تنبيهات هاتلي الآن.') };
    switch (r.reason) {
      case 'denied': return { tone: 'bad', text: t('Notifications are blocked for this site. Allow them in the browser settings (see below), then press the button again.', 'الإشعارات محظورة لهذا الموقع. اسمح بها من إعدادات المتصفح (انظر أدناه) ثم اضغط الزر مرة أخرى.') };
      case 'dismissed': return { tone: 'warn', text: t('You closed the permission question. Press the button again and choose Allow.', 'أغلقت سؤال الإذن. اضغط الزر مرة أخرى واختر «السماح».') };
      case 'not-configured': return { tone: 'bad', text: t('Push is not set up on the Hatly server yet. Alerts still sound while this page is open.', 'الإشعارات غير مُعدّة على خادم هاتلي بعد. التنبيه يعمل والصفحة مفتوحة.') };
      case 'insecure': return { tone: 'bad', text: t('Notifications need the secure (https) address of Hatly Admin.', 'الإشعارات تحتاج عنوان هاتلي الآمن (https).') };
      case 'unsupported': return { tone: 'bad', text: t('This browser does not support push notifications. Use Chrome on Android, or Chrome/Edge/Firefox on a computer. On iPhone, add Hatly to the Home Screen first.', 'هذا المتصفح لا يدعم الإشعارات. استخدم كروم على أندرويد أو كروم/إيدج/فايرفوكس على الكمبيوتر. على آيفون أضف هاتلي إلى الشاشة الرئيسية أولًا.') };
      default: return { tone: 'bad', text: `${t('Could not register this device.', 'تعذّر تسجيل هذا الجهاز.')} ${r.message ?? ''}` };
    }
  };

  const doEnable = async () => {
    setBusy('enable');
    setMessage(null);
    const r = await enablePush();
    setMessage(explain(r));
    await refresh();
    setBusy(null);
  };
  const doSound = async () => {
    setBusy('sound');
    const ok = (await alarm?.enableSound()) ?? false;
    setSoundTested(ok);
    setBusy(null);
  };
  const doTestSound = () => setSoundTested(playAlarm('critical'));
  const doTestPush = async () => {
    if (!mine) return;
    setBusy('test');
    setMessage(null);
    try {
      let d = await sendTestPush(mine.id);
      setTest(d);
      for (let i = 0; i < 20 && !d.displayedAt && !['DEAD', 'EXPIRED', 'SKIPPED'].includes(d.status); i++) {
        await new Promise((r) => setTimeout(r, 1500));
        d = await pushDelivery(d.id);
        setTest(d);
      }
      if (!d.displayedAt) setMessage({ tone: 'warn', text: t('No "shown" report came back from this device. Check that notifications are allowed for the browser in the phone or computer settings.', 'لم يصل تأكيد «ظهر» من هذا الجهاز. تأكد أن إشعارات المتصفح مسموحة في إعدادات الهاتف أو الكمبيوتر.') });
    } catch {
      setMessage({ tone: 'bad', text: t('Could not send the test.', 'تعذّر إرسال التجربة.') });
    }
    await refresh();
    setBusy(null);
  };
  const doRemove = async (id: string) => {
    setBusy(`rm-${id}`);
    await removePushDevice(id).catch(() => undefined);
    await refresh();
    setBusy(null);
  };

  const audio = alarm?.audio ?? audioState();
  const rows: Array<{ id: string; label: string; tone: Tone; value: string }> = support
    ? [
        { id: 'permission', label: t('Browser notification permission', 'إذن إشعارات المتصفح'), tone: permission === 'granted' ? 'ok' : permission === 'denied' ? 'bad' : permission === 'unsupported' ? 'bad' : 'warn', value: permission === 'granted' ? t('Allowed', 'مسموح') : permission === 'denied' ? t('Blocked', 'محظور') : permission === 'unsupported' ? t('Not supported', 'غير مدعوم') : t('Not asked yet', 'لم يُطلب بعد') },
        { id: 'server', label: t('Push set up on the server', 'الإشعارات مُعدّة على الخادم'), tone: cfg?.configured ? 'ok' : 'bad', value: cfg ? (cfg.configured ? t('Yes', 'نعم') : t('No — in-app alarm only', 'لا — التنبيه داخل الصفحة فقط')) : t('Unknown', 'غير معروف') },
        { id: 'sw', label: t('Background service (service worker)', 'خدمة الخلفية (Service Worker)'), tone: swActive ? 'ok' : support.serviceWorker ? 'warn' : 'bad', value: swActive ? t('Running', 'يعمل') : support.serviceWorker ? t('Not running', 'لا يعمل') : t('Not supported', 'غير مدعوم') },
        { id: 'device', label: t('This device registered for my alerts', 'هذا الجهاز مسجّل لتنبيهاتي'), tone: mine?.active ? 'ok' : 'bad', value: mine?.active ? `${t('Yes', 'نعم')} · ${t('updated', 'آخر تحديث')} ${when(mine.updatedAt)}` : t('No', 'لا') },
        { id: 'sound', label: t('Alarm sound', 'صوت التنبيه'), tone: audio === 'ready' ? 'ok' : audio === 'unsupported' ? 'bad' : 'warn', value: audio === 'ready' ? t('On for this page', 'يعمل لهذه الصفحة') : audio === 'unsupported' ? t('Not supported', 'غير مدعوم') : t('Off until you tap the page (browser rule)', 'متوقف حتى تضغط على الصفحة (قاعدة المتصفح)') },
        { id: 'vibrate', label: t('Vibration', 'الاهتزاز'), tone: support.vibrate ? 'ok' : 'info', value: support.vibrate ? t('Supported', 'مدعوم') : t('Not on this device', 'غير متاح على هذا الجهاز') },
        { id: 'pwa', label: t('Installed as an app', 'مثبّت كتطبيق'), tone: support.standalone ? 'ok' : 'info', value: support.standalone ? t('Yes', 'نعم') : t('No (optional on Android/desktop; required on iPhone)', 'لا (اختياري على أندرويد/الكمبيوتر؛ مطلوب على آيفون)') },
        { id: 'last-test', label: t('Last test notification', 'آخر إشعار تجريبي'), tone: mine?.lastTestDisplayedAt ? 'ok' : mine?.lastTestAcceptedAt ? 'warn' : 'info', value: mine ? `${t('accepted', 'قُبل')} ${when(mine.lastTestAcceptedAt)} · ${t('shown', 'ظهر')} ${when(mine.lastTestDisplayedAt)}` : '—' },
        { id: 'last-ok', label: t('Last message accepted for this device', 'آخر رسالة قُبلت لهذا الجهاز'), tone: mine?.lastSuccessAt ? 'ok' : 'info', value: mine ? `${when(mine.lastSuccessAt)} · ${t('last shown', 'آخر ظهور')} ${when(mine.lastDisplayedAt)}` : '—' },
        { id: 'last-fail', label: t('Last delivery failure', 'آخر فشل في الإرسال'), tone: mine?.lastFailureAt ? 'warn' : 'ok', value: mine?.lastFailureAt ? `${when(mine.lastFailureAt)} · ${mine.lastFailureReason ?? ''}` : t('none', 'لا يوجد') },
        { id: 'last-ack', label: t('My last acknowledgement', 'آخر تأكيد اطلاع لي'), tone: 'info', value: when(cfg?.lastAcknowledgedAt) },
      ]
    : [];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t('Notification setup', 'إعداد الإشعارات')} subtitle={t('Make sure this phone or computer alerts you about new orders and urgent problems — even when Hatly is not on the screen.', 'تأكد أن هذا الهاتف أو الكمبيوتر ينبهك بالطلبات الجديدة والمشكلات العاجلة — حتى وهاتلي ليس على الشاشة.')} />

      <Card title={t('1 · Turn alerts on for this device', '١ · فعّل التنبيهات على هذا الجهاز')} className="mb-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void doEnable()} disabled={busy !== null} data-testid="setup-enable-push">{mine?.active ? t('Re-register this device', 'أعد تسجيل هذا الجهاز') : t('Enable notifications', 'تفعيل الإشعارات')}</Button>
          <Button variant="secondary" onClick={() => void doSound()} disabled={busy !== null} data-testid="setup-enable-sound">{t('Enable sound', 'تفعيل الصوت')}</Button>
          <Button variant="secondary" onClick={doTestSound} disabled={audio !== 'ready'} data-testid="setup-test-sound">{t('Test sound', 'تجربة الصوت')}</Button>
          <Button variant="secondary" onClick={() => void doTestPush()} disabled={busy !== null || !mine?.active || !cfg?.configured} data-testid="setup-test-push">{t('Send test notification', 'إرسال إشعار تجريبي')}</Button>
        </div>
        {soundTested !== null && (
          <p className={`mt-3 rounded-lg px-3 py-2 text-sm ${soundTested ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`} data-testid="setup-sound-result">
            {soundTested ? t('A test alarm was played. If you heard nothing, raise the device volume and check it is not on silent.', 'شُغّل تنبيه تجريبي. إن لم تسمع شيئًا ارفع صوت الجهاز وتأكد أنه ليس على الصامت.') : t('The browser did not allow sound. Tap "Enable sound" first.', 'المتصفح لم يسمح بالصوت. اضغط «تفعيل الصوت» أولًا.')}
          </p>
        )}
        {message && <p role="status" className={`mt-3 rounded-lg px-3 py-2 text-sm ${TONE[message.tone]}`} data-testid="setup-message">{message.text}</p>}
        {test && (
          <ol className="mt-3 grid grid-cols-1 gap-1 text-sm sm:grid-cols-3" data-testid="setup-test-stages">
            <li className={`rounded-lg px-3 py-2 ${TONE.ok}`}>1. {t('Queued', 'في الانتظار')} · {when(test.queuedAt)}</li>
            <li className={`rounded-lg px-3 py-2 ${test.acceptedAt ? TONE.ok : test.status === 'DEAD' || test.status === 'EXPIRED' ? TONE.bad : TONE.info}`}>2. {t('Accepted by push service', 'قبلته خدمة الإشعارات')} · {test.acceptedAt ? when(test.acceptedAt) : test.status}</li>
            <li className={`rounded-lg px-3 py-2 ${test.displayedAt ? TONE.ok : TONE.info}`}>3. {t('Shown on this device', 'ظهر على هذا الجهاز')} · {test.displayedAt ? when(test.displayedAt) : t('waiting…', 'بالانتظار…')}</li>
          </ol>
        )}
      </Card>

      <Card title={t('2 · What this device can do now', '٢ · ما يستطيعه هذا الجهاز الآن')} className="mb-4">
        <ul className="divide-y divide-gray-100" data-testid="setup-status">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start gap-3 py-2 text-sm" data-testid={`setup-row-${r.id}`} data-tone={r.tone}>
              <span aria-hidden className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${TONE[r.tone]}`}>{ICON[r.tone]}</span>
              <span className="flex-1 text-gray-800">{r.label}</span>
              <span className="text-end text-gray-600">{r.value}</span>
            </li>
          ))}
        </ul>
      </Card>

      {devices.length > 0 && (
        <Card title={t('My registered devices', 'أجهزتي المسجّلة')} className="mb-4">
          <ul className="divide-y divide-gray-100">
            {devices.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-2 text-sm" data-testid="setup-device">
                <span className="flex-1">
                  <strong>{d.deviceLabel ?? t('Browser', 'متصفح')}</strong>{mine?.id === d.id && <span className="ms-2 rounded-full bg-gray-900 px-2 py-0.5 text-[10px] text-white">{t('this device', 'هذا الجهاز')}</span>}
                  <span className="block text-xs text-gray-500">{d.active ? `${t('registered', 'مسجّل')} ${when(d.createdAt)} · ${t('last accepted', 'آخر قبول')} ${when(d.lastSuccessAt)}` : `${t('stopped', 'متوقف')} · ${d.revokedReason ?? ''}`}</span>
                </span>
                {d.active && <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void doRemove(d.id)}>{t('Remove', 'إزالة')}</Button>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={t('If alerts do not arrive', 'إذا لم تصل التنبيهات')}>
        <div className="space-y-3 text-sm text-gray-700">
          <p><strong>{t('Android (Chrome)', 'أندرويد (كروم)')}:</strong> {t('Settings → Apps → Chrome → Notifications: allowed, with sound. Settings → Apps → Chrome → Battery: "Unrestricted" (otherwise the phone may hold notifications while the screen is off). In Chrome: ⋮ → Settings → Notifications → admin.hatly.dev: Allowed. Optional: ⋮ → "Add to Home screen" to install Hatly Admin. Do not "Force stop" Chrome — push stops until it is opened again.', 'الإعدادات ← التطبيقات ← كروم ← الإشعارات: مسموحة مع الصوت. الإعدادات ← التطبيقات ← كروم ← البطارية: «غير مقيد» (وإلا قد يؤخر الهاتف الإشعارات والشاشة مطفأة). في كروم: ⋮ ← الإعدادات ← الإشعارات ← admin.hatly.dev: مسموح. اختياري: ⋮ ← «إضافة إلى الشاشة الرئيسية». لا تستخدم «فرض الإيقاف» لكروم — تتوقف الإشعارات حتى يُفتح مجددًا.')}</p>
          <p><strong>{t('Computer (Chrome, Edge, Firefox)', 'الكمبيوتر (كروم، إيدج، فايرفوكس)')}:</strong> {t('Click the lock icon next to the address → Notifications → Allow. Windows: Settings → System → Notifications → your browser on; Focus/Do not disturb off. macOS: System Settings → Notifications → your browser → Allow, with sound. Notifications arrive while the browser is running (even minimised or with the Hatly tab closed); not when the browser is fully quit.', 'اضغط رمز القفل بجانب العنوان ← الإشعارات ← السماح. ويندوز: الإعدادات ← النظام ← الإشعارات ← المتصفح مفعّل، ووضع «عدم الإزعاج» متوقف. ماك: إعدادات النظام ← الإشعارات ← المتصفح ← السماح مع الصوت. تصل الإشعارات ما دام المتصفح يعمل (حتى مصغرًا أو مع إغلاق تبويب هاتلي)؛ لا تصل إذا أُغلق المتصفح تمامًا.')}</p>
          <p><strong>{t('iPhone / iPad', 'آيفون / آيباد')}:</strong> {t('Safari → Share → "Add to Home Screen", open Hatly from the Home Screen, then press "Enable notifications" there (iOS 16.4 or later).', 'سفاري ← مشاركة ← «إضافة إلى الشاشة الرئيسية»، افتح هاتلي من الشاشة الرئيسية ثم اضغط «تفعيل الإشعارات» هناك (iOS 16.4 أو أحدث).')}</p>
          <p><strong>{t('Sound', 'الصوت')}:</strong> {t('Browsers only allow a page to play sound after you tap it. After every reload, tap anywhere on Hatly once. A notification from a closed or background tab uses the phone/computer notification sound, not the Hatly alarm.', 'المتصفحات لا تسمح للصفحة بتشغيل الصوت إلا بعد الضغط عليها. بعد كل إعادة تحميل اضغط مرة على أي مكان في هاتلي. الإشعار من تبويب مغلق أو في الخلفية يستخدم صوت إشعارات الهاتف/الكمبيوتر وليس تنبيه هاتلي.')}</p>
        </div>
      </Card>
    </div>
  );
}

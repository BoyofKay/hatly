'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApi } from '../../lib/ui/api';
import { useLang } from '../../lib/ui/lang';
import { usePermissions } from '../../lib/ui/permissions';
import { acknowledgeOpsAlert, OpsAlert } from '../../lib/api/ops-alerts';
import { decideRing, newSince, ringing, needsAttention, SNOOZE_MS } from '../../lib/alerts/alarm-logic';
import { audioState, AudioState, onAudioStateChange, playAlarm, unlockAudio, unlockOnFirstGesture } from '../../lib/alerts/sound';
import { currentDevice, ensureServiceWorker, permissionState, showLocalNotification } from '../../lib/alerts/push-client';
import { OPS_ACTION, OPS_CATEGORY, age } from '../../lib/alerts/words';
import { updateSegmentOnBehalf } from '../../lib/api/admin-operations';
import { apiErrorMessage } from '../../lib/api/errors';
import { useToast } from '../ui';

/**
 * The Admin alarm: one per tab, mounted in the Admin shell.
 *  - Reads the open Operations alerts every 8 s (also when the tab is in the background, and at once when a push arrives or the network returns).
 *  - Exactly ONE open tab plays sound (Web Locks election among tabs whose audio is unlocked; a shared timestamp throttles as a fallback),
 *    so several tabs never multiply the alarm. Critical alerts repeat until acknowledged (alarm-logic.ts); a snooze silences sound only.
 *  - On a new alert in a hidden tab it vibrates (where allowed) and — only when this browser has no push registration — shows a local
 *    notification, so a push and a local notification never double up (they also share the alert's tag).
 *  - Never claims sound is on while the browser has it locked.
 */
const LAST_RING_KEY = 'hatly_ops_alarm_last_ring';
const SNOOZE_KEY = 'hatly_ops_alarm_snoozed_until';
const readNum = (k: string) => {
  try {
    return Number(window.localStorage.getItem(k) ?? 0) || 0;
  } catch {
    return 0;
  }
};
const writeNum = (k: string, v: number) => {
  try {
    window.localStorage.setItem(k, String(v));
  } catch {
    /* storage unavailable */
  }
};

interface AlarmCtx {
  enabled: boolean;
  alerts: OpsAlert[];
  loaded: boolean;
  error: string | null;
  reload: () => void;
  canAck: boolean;
  acknowledge: (id: string) => Promise<void>;
  audio: AudioState;
  enableSound: () => Promise<boolean>;
  snoozedUntil: number;
  snooze: () => void;
  resume: () => void;
  leader: boolean;
  pushRegistered: boolean | null;
  refreshDevice: () => Promise<void>;
}
const Ctx = createContext<AlarmCtx | null>(null);
export const useOpsAlarm = () => useContext(Ctx);

export function OpsAlarmProvider({ children }: { children: React.ReactNode }) {
  const { can, loaded: permsLoaded } = usePermissions();
  const router = useRouter();
  const enabled = can('VIEW_ORDERS');
  const canAck = can('MANAGE_ORDER_FULFILMENT');
  const list = useApi<OpsAlert[]>(enabled ? '/admin/ops-alerts' : null, undefined, { refreshInterval: 8_000, refreshWhenHidden: true, revalidateOnReconnect: true, revalidateOnFocus: true });
  const alerts = useMemo(() => list.data ?? [], [list.data]);
  const [audio, setAudio] = useState<AudioState>('locked');
  const [leader, setLeader] = useState(false);
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  const [pushRegistered, setPushRegistered] = useState<boolean | null>(null);
  const [, setTick] = useState(0);
  const known = useRef<Set<string> | null>(null);
  const alertsRef = useRef<OpsAlert[]>([]);
  alertsRef.current = alerts;

  // Audio: unlock on the first interaction; follow the browser's real state.
  useEffect(() => {
    setAudio(audioState());
    const off = onAudioStateChange(() => setAudio(audioState()));
    const offGesture = unlockOnFirstGesture();
    return () => {
      off();
      offGesture();
    };
  }, []);

  // One sounding tab: hold a Web Lock for as long as this tab lives (released automatically when it closes or crashes, or on unmount).
  // The request is made once, when this tab's audio first becomes playable; a waiting tab takes over when the holder goes away.
  const lockRequested = useRef(false);
  const releaseLock = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (audio !== 'ready' || lockRequested.current) return;
    lockRequested.current = true;
    const locks = (navigator as unknown as { locks?: { request: (name: string, cb: () => Promise<void>) => Promise<void> } }).locks;
    if (!locks) {
      setLeader(true); // no Web Locks: every tab may ring, the shared last-ring timestamp keeps them from ringing together
      return;
    }
    void locks.request('hatly-ops-alarm', () => new Promise<void>((resolve) => {
      releaseLock.current = resolve;
      setLeader(true);
    })).catch(() => undefined);
  }, [audio]);
  useEffect(() => () => releaseLock.current(), []);

  // Service worker (for notification clicks) + this device's registration; messages from the worker.
  const refreshDevice = useCallback(async () => {
    const { device } = await currentDevice().catch(() => ({ device: null }));
    setPushRegistered(Boolean(device?.active));
  }, []);
  useEffect(() => {
    if (!enabled) return;
    void ensureServiceWorker().then(() => refreshDevice());
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'hatly-push') list.reload();
      if (e.data?.type === 'hatly-open' && typeof e.data.url === 'string') {
        try {
          const u = new URL(e.data.url, window.location.origin);
          if (u.origin === window.location.origin) router.push(u.pathname + u.search);
        } catch {
          /* ignore */
        }
      }
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    const onOnline = () => list.reload();
    window.addEventListener('online', onOnline);
    return () => {
      navigator.serviceWorker?.removeEventListener('message', onMessage);
      window.removeEventListener('online', onOnline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, refreshDevice]);

  // Snooze is shared by all tabs.
  useEffect(() => {
    setSnoozedUntil(readNum(SNOOZE_KEY));
    const onStorage = (e: StorageEvent) => e.key === SNOOZE_KEY && setSnoozedUntil(readNum(SNOOZE_KEY));
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const ring = useCallback((fresh: OpsAlert[]) => {
    const now = Date.now();
    const kind = decideRing({ alerts: alertsRef.current, fresh, now, lastRingAt: readNum(LAST_RING_KEY), snoozedUntil: readNum(SNOOZE_KEY) });
    if (!kind || !leader) return;
    if (playAlarm(kind)) writeNum(LAST_RING_KEY, now);
  }, [leader]);

  // New alerts → ring at once, vibrate, and (hidden tab, no push on this device) a local notification. The first load only records history.
  useEffect(() => {
    if (!list.data) return;
    const { fresh, known: next } = newSince(known.current, list.data);
    known.current = next;
    if (fresh.length === 0) return;
    ring(fresh);
    if (!leader) return;
    const critical = fresh.some((a) => a.priority === 'CRITICAL');
    if (critical && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate([400, 200, 400]);
      } catch {
        /* not allowed */
      }
    }
    if (document.visibilityState === 'hidden' && pushRegistered === false && permissionState() === 'granted') {
      for (const a of fresh.slice(0, 3)) {
        void showLocalNotification(`${OPS_CATEGORY[a.category]?.[0] ?? 'Alert'} ${a.orderNumber ?? ''} · ${OPS_CATEGORY[a.category]?.[1] ?? ''}`, {
          body: 'Open Hatly Admin. · افتح لوحة هاتلي.', tag: `ops-${a.id}`, requireInteraction: a.priority === 'CRITICAL', data: { url: new URL(a.href, window.location.origin).href },
        });
      }
    }
  }, [list.data, ring, leader, pushRegistered]);

  // Repeats while anything critical is unacknowledged; also re-renders ages.
  useEffect(() => {
    const id = window.setInterval(() => {
      ring([]);
      setTick((n) => n + 1);
    }, 5_000);
    return () => window.clearInterval(id);
  }, [ring]);

  // Tab title shows the count, so a background tab still says it.
  const open = ringing(alerts).length;
  useEffect(() => {
    if (!enabled) return;
    const base = document.title.replace(/^\(\d+\)\s⚠\s/, '');
    document.title = open > 0 ? `(${open}) ⚠ ${base}` : base;
  }, [open, enabled]);

  // Test hook (Playwright): what this tab believes, never used by the UI.
  useEffect(() => {
    (window as unknown as { __hatlyAlarm?: unknown }).__hatlyAlarm = { leader, audio, ringing: open, snoozedUntil };
  }, [leader, audio, open, snoozedUntil]);

  const acknowledge = useCallback(async (id: string) => {
    await acknowledgeOpsAlert(id);
    list.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.reload]);

  const value: AlarmCtx = {
    enabled,
    alerts, loaded: Boolean(list.data) || !permsLoaded, error: list.error, reload: list.reload, canAck, acknowledge, audio,
    enableSound: async () => {
      const ok = await unlockAudio();
      setAudio(audioState());
      if (ok) playAlarm('test');
      return ok;
    },
    snoozedUntil,
    snooze: () => {
      const until = Date.now() + SNOOZE_MS;
      writeNum(SNOOZE_KEY, until);
      setSnoozedUntil(until);
    },
    resume: () => {
      writeNum(SNOOZE_KEY, 0);
      setSnoozedUntil(0);
    },
    leader, pushRegistered, refreshDevice,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The red/amber bar under the header: what needs a person now, one click to the order, one click to acknowledge. */
export function OpsAlarmBar() {
  const ctx = useOpsAlarm();
  const { t, locale } = useLang();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  if (!ctx || !ctx.enabled) return null;
  const now = Date.now();
  // Urgent first, then the newest — a just-arrived order is always on top; the full list (oldest included) is in the Notification Center.
  const pending = ctx.alerts.filter(needsAttention).sort((a, b) => (a.priority === b.priority ? Date.parse(b.openedAt) - Date.parse(a.openedAt) : a.priority === 'CRITICAL' ? -1 : 1));
  const critical = pending.filter((a) => a.priority === 'CRITICAL').length;
  const showSetupHint = ctx.audio !== 'ready' || ctx.pushRegistered === false;
  if (pending.length === 0 && !showSetupHint) return null;
  const snoozed = ctx.snoozedUntil > now;

  const ack = async (id: string) => {
    setBusy(id);
    setFailed(null);
    try {
      await ctx.acknowledge(id);
    } catch {
      setFailed(id);
    } finally {
      setBusy(null);
    }
  };

  const soundChip =
    ctx.audio === 'unsupported' ? (
      <span className="text-xs text-gray-700">{t('This browser cannot play the alarm sound.', 'هذا المتصفح لا يستطيع تشغيل صوت التنبيه.')}</span>
    ) : ctx.audio === 'locked' ? (
      <button type="button" onClick={() => void ctx.enableSound()} data-testid="ops-alarm-enable-sound" className="rounded-lg bg-gray-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-gray-800">
        🔇 {t('Sound is off — tap to turn on the alarm', 'الصوت متوقف — اضغط لتشغيل التنبيه')}
      </button>
    ) : snoozed ? (
      <button type="button" onClick={ctx.resume} data-testid="ops-alarm-resume" className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-800">
        🔕 {t('Sound snoozed — turn back on', 'الصوت مؤجل — أعد تشغيله')}
      </button>
    ) : (
      <span className="flex items-center gap-2 text-xs text-gray-700" data-testid="ops-alarm-sound-on">
        🔊 {t('Alarm sound on', 'صوت التنبيه يعمل')}
        {critical > 0 && <button type="button" onClick={ctx.snooze} className="underline" data-testid="ops-alarm-snooze">{t('Snooze sound 10 min', 'أجّل الصوت 10 دقائق')}</button>}
      </span>
    );

  return (
    <section
      role={critical > 0 ? 'alert' : 'status'}
      data-testid="ops-alarm-bar"
      className={`border-b px-3 py-2 sm:px-6 ${critical > 0 ? 'border-red-200 bg-red-50' : pending.length > 0 ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`text-sm font-semibold ${critical > 0 ? 'text-red-800' : 'text-gray-800'}`}>
          {pending.length > 0
            ? critical > 0
              ? t(`${critical} urgent alert${critical === 1 ? '' : 's'} need you`, `${critical} تنبيه عاجل بانتظارك`)
              : t(`${pending.length} alert${pending.length === 1 ? '' : 's'} to check`, `${pending.length} تنبيه للمتابعة`)
            : t('Alerts are not fully set up on this device', 'التنبيهات غير مكتملة الإعداد على هذا الجهاز')}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {soundChip}
          {ctx.pushRegistered === false && (
            <Link href="/notification-setup" className="text-xs font-medium text-hatly-orangeDark underline" data-testid="ops-alarm-setup-link">
              {t('Get alerts when this tab is closed', 'استلم التنبيهات والتبويب مغلق')}
            </Link>
          )}
        </div>
      </div>
      {pending.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {/* Phones show the newest urgent alert only (the rest are one tap away); larger screens show three. */}
          {pending.slice(0, 3).map((a, i) => (
            <li key={a.id} data-testid={`ops-alarm-item-${a.id}`} className={`${i > 0 ? 'hidden sm:flex' : 'flex'} flex-col gap-2 rounded-lg px-3 py-2 sm:flex-row sm:items-center sm:gap-3 ${a.priority === 'CRITICAL' ? 'bg-white ring-1 ring-red-200' : 'bg-white ring-1 ring-amber-200'}`}>
              <span className="flex min-w-0 flex-1 items-start gap-2 text-sm">
                <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${a.priority === 'CRITICAL' ? 'animate-pulse bg-red-600' : 'bg-amber-500'}`} />
                <span className="min-w-0">
                  <strong className="text-gray-900">{t(...OPS_CATEGORY[a.category])}</strong>
                  {a.orderNumber && <> · <bdi dir="ltr" className="whitespace-nowrap font-mono">{a.orderNumber}</bdi></>}
                  <span className="text-gray-500"> · <span className="whitespace-nowrap">{age(a.openedAt, now, locale)}</span> · {t(...OPS_ACTION[a.category])}</span>
                </span>
              </span>
              <span className="flex shrink-0 flex-wrap items-center gap-2">
                <Link href={a.href} className="rounded-lg bg-hatly-orange px-3 py-1.5 text-xs font-semibold text-white hover:bg-hatly-orangeDark" data-testid="ops-alarm-open">
                  {t('Open order', 'افتح الطلب')}
                </Link>
                {ctx.canAck && (a.pendingParts ?? []).length > 0 && (a.pendingParts ?? []).length <= 2 &&
                  (a.pendingParts ?? []).map((part) => <AcceptForStore key={part.segmentId} alert={a} part={part} />)}
                {ctx.canAck && (
                  <button type="button" disabled={busy === a.id} onClick={() => void ack(a.id)} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50" data-testid="ops-alarm-ack">
                    {t('Seen — stop alarm', 'تم الاطلاع — أوقف التنبيه')}
                  </button>
                )}
                {failed === a.id && <span role="alert" className="text-xs text-red-700">{t('Not saved — try again.', 'لم يُحفظ — حاول مجددًا.')}</span>}
              </span>
            </li>
          ))}
          {pending.length > 1 && (
            <li className={pending.length > 3 ? '' : 'sm:hidden'}>
              <Link href="/inbox" className="text-xs font-medium text-red-800 underline" data-testid="ops-alarm-see-all">
                <span className="sm:hidden">{t(`+${pending.length - 1} more — see all`, `+${pending.length - 1} أخرى — عرض الكل`)}</span>
                <span className="hidden sm:inline">{t(`+${pending.length - 3} more — see all`, `+${pending.length - 3} أخرى — عرض الكل`)}</span>
              </Link>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

/**
 * "Accept for <store>" straight from an alert: the SAME on-behalf transition the order page offers (PATCH admin/orders/segments/:id/status,
 * MANAGE_ORDER_FULFILMENT, recorded "on behalf of the store"). Two taps (button, then Confirm) so it is never accidental. On success the alert
 * is also marked seen, so the alarm stops at once; the backend closes the alert itself on its next check (the store part is no longer waiting).
 */
export function AcceptForStore({ alert, part }: { alert: OpsAlert; part: NonNullable<OpsAlert['pendingParts']>[number] }) {
  const ctx = useOpsAlarm();
  const { t, locale } = useLang();
  const toast = useToast();
  const [stage, setStage] = useState<'idle' | 'confirm' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const store = (locale === 'ar' ? part.vendorNameAr || part.vendorName : part.vendorName) || part.branchName || t('the store', 'المتجر');
  if (!ctx) return null;
  const run = async () => {
    setStage('busy');
    setError(null);
    try {
      await updateSegmentOnBehalf(part.segmentId, { status: 'CONFIRMED' });
      setStage('done');
      // The alert row disappears once it is seen, so the confirmation must outlive it.
      toast.push('success', t(`${alert.orderNumber ?? 'Order'} accepted for ${store}. It moves to preparation.`, `تم قبول ${alert.orderNumber ?? 'الطلب'} نيابة عن ${store}. ينتقل الآن إلى التحضير.`));
      await ctx.acknowledge(alert.id).catch(() => undefined);
    } catch (e) {
      setError(apiErrorMessage(e, t('Could not accept. Open the order to check its state.', 'تعذّر القبول. افتح الطلب لمعرفة حالته.')));
      setStage('idle');
    }
  };
  if (stage === 'done') {
    return <span role="status" className="rounded-lg bg-green-50 px-2.5 py-1.5 text-xs font-semibold text-green-800" data-testid="ops-alarm-accepted">✓ {t(`Accepted for ${store}`, `تم القبول نيابة عن ${store}`)}</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {stage === 'idle' ? (
        <button type="button" onClick={() => setStage('confirm')} className="rounded-lg border border-green-600 bg-white px-3 py-1.5 text-xs font-semibold text-green-800 hover:bg-green-50" data-testid="ops-alarm-accept">
          {t(`Accept for ${store}`, `اقبل نيابة عن ${store}`)}
        </button>
      ) : (
        <>
          <button type="button" disabled={stage === 'busy'} onClick={() => void run()} className="rounded-lg bg-green-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-800 disabled:opacity-50" data-testid="ops-alarm-accept-confirm">
            {t(`Confirm — accept ${alert.orderNumber ?? ''}`, `تأكيد — قبول ${alert.orderNumber ?? ''}`)}
          </button>
          <button type="button" disabled={stage === 'busy'} onClick={() => setStage('idle')} className="text-xs text-gray-600 underline">{t('Cancel', 'إلغاء')}</button>
        </>
      )}
      {error && <span role="alert" className="text-xs text-red-700" data-testid="ops-alarm-accept-error">{error}</span>}
    </span>
  );
}

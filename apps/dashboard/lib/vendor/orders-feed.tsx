'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { VendorOrder, listVendorOrders } from '../api/vendor-orders';
import { apiErrorMessage } from '../api/errors';
import { countAwaitingAcceptance, findNewOrderIds, titleWithCount } from './new-orders';
import { fetchVendorChanges } from '../api/changes';
import { useChangeFeed } from '../changes/use-change-feed';

/**
 * The older fixed interval at which the vendor's order list re-reads itself (the approved 15–30 s window). It is now only the FALLBACK: the
 * list normally reloads when the change feed (D-72, `GET vendor/orders/changes`) reports a change, and this interval takes over whenever
 * the feed is unavailable. See lib/changes/change-feed.ts.
 */
export const VENDOR_POLL_MS = 20_000;
const SOUND_KEY = 'hatly_vendor_new_order_sound';
const BASE_TITLE = 'Hatly Vendor';

interface Feed {
  orders: VendorOrder[] | null;
  error: string | null;
  refresh: () => Promise<void>;
  /** Orders that arrived after this page was opened and have not been acknowledged. */
  newIds: ReadonlySet<string>;
  acknowledgeNew: () => void;
  awaitingAcceptance: number;
  lastUpdatedAt: Date | null;
  soundEnabled: boolean;
  setSoundEnabled: (on: boolean) => void;
}

const FeedContext = createContext<Feed | null>(null);

export function useVendorOrdersFeed(): Feed {
  const feed = useContext(FeedContext);
  if (!feed) throw new Error('useVendorOrdersFeed must be used inside VendorOrdersFeedProvider');
  return feed;
}

/** A short two-tone beep (no audio file needed). Browsers only allow it after the vendor interacted with the page — enabling the sound is that interaction. */
function beep(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [880, 1175].forEach((frequency, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = frequency;
      gain.gain.value = 0.15;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.15);
    });
    window.setTimeout(() => ctx.close().catch(() => undefined), 800);
  } catch {
    /* no sound — the visual indicator is the primary signal */
  }
}

/**
 * One feed for the whole vendor area: the order list (reloaded when the change feed reports a change — an idle list costs a few bytes every few
 * seconds instead of a full download every 20 s — with the 20 s reload as fallback, and again when the tab comes back), the
 * "new order" indicator (orders that arrived after the page opened), the awaiting-acceptance count (nav badge + tab title) and the optional
 * sound. A failed refresh keeps the last list and reports the error — a flapping network never blanks the screen.
 */
export function VendorOrdersFeedProvider({ children }: { children: React.ReactNode }) {
  const [orders, setOrders] = useState<VendorOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(new Set());
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [soundEnabled, setSoundState] = useState(false);
  const known = useRef<Set<string> | null>(null);
  const inFlight = useRef(false);
  const soundRef = useRef(false);

  useEffect(() => {
    try {
      const on = window.localStorage.getItem(SOUND_KEY) === '1';
      soundRef.current = on;
      setSoundState(on);
    } catch {
      /* storage unavailable — sound stays off */
    }
  }, []);

  const setSoundEnabled = useCallback((on: boolean) => {
    soundRef.current = on;
    setSoundState(on);
    try {
      window.localStorage.setItem(SOUND_KEY, on ? '1' : '0');
    } catch {
      /* not remembered */
    }
    if (on) beep(); // doubles as the user gesture that lets later beeps play, and as a test of the volume
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const list = await listVendorOrders();
      setOrders(list);
      setError(null);
      setLastUpdatedAt(new Date());
      if (known.current === null) {
        known.current = new Set(list.map((o) => o.id)); // the first load defines "already seen"
      } else {
        const fresh = findNewOrderIds(known.current, list);
        if (fresh.length > 0) {
          fresh.forEach((id) => known.current!.add(id));
          setNewIds((prev) => new Set([...prev, ...fresh]));
          if (soundRef.current) beep();
        }
      }
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to load orders.'));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useChangeFeed(fetchVendorChanges, refresh);

  const awaitingAcceptance = useMemo(() => countAwaitingAcceptance(orders ?? []), [orders]);
  useEffect(() => {
    document.title = titleWithCount(BASE_TITLE, awaitingAcceptance);
    return () => {
      document.title = BASE_TITLE;
    };
  }, [awaitingAcceptance]);

  const value = useMemo<Feed>(
    () => ({ orders, error, refresh, newIds, acknowledgeNew: () => setNewIds(new Set()), awaitingAcceptance, lastUpdatedAt, soundEnabled, setSoundEnabled }),
    [orders, error, refresh, newIds, awaitingAcceptance, lastUpdatedAt, soundEnabled, setSoundEnabled],
  );
  return <FeedContext.Provider value={value}>{children}</FeedContext.Provider>;
}

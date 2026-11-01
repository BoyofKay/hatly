'use client';

import { useEffect, useRef, useState } from 'react';
import { ChangeFeed, ChangesPage } from './change-feed';

/**
 * Keeps a screen current from the change feed: `reload` runs once at start, then only when something changed (plus the safety net and the
 * legacy fallback described in change-feed.ts). The latest `reload`/`fetchPage` are always used, so callers need not memoize them.
 * Returns 'feed' (live), 'legacy' (refreshing on the older fixed interval) or 'connecting' (not known yet).
 */
export function useChangeFeed(fetchPage: (since?: string) => Promise<ChangesPage>, reload: () => Promise<void> | void, enabled = true): 'connecting' | 'feed' | 'legacy' {
  const fetchRef = useRef(fetchPage);
  const reloadRef = useRef(reload);
  fetchRef.current = fetchPage;
  reloadRef.current = reload;
  const [mode, setMode] = useState<'connecting' | 'feed' | 'legacy'>('connecting');

  useEffect(() => {
    if (!enabled) return;
    const feed = new ChangeFeed({ fetchPage: (since) => fetchRef.current(since), reload: async () => void (await reloadRef.current()), onMode: setMode });
    void feed.start();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void feed.kick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      feed.stop();
    };
  }, [enabled]);

  return mode;
}

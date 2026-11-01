'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { OperationsFacts, getControlTowerSummary } from './api/admin-control-tower';
import { useAdminPermission } from './auth/use-admin-permission';

/** How often the banner and the navigation counter re-read the operations facts (the approved 15–30 s window). */
export const OPERATIONS_POLL_MS = 20_000;

/**
 * The operations facts for the banner and the navigation counter. Polls only for an admin who may view orders, only while the tab is
 * visible, and re-reads immediately when the tab comes back to the front. A failed read keeps the last facts (a flapping network never
 * hides an alert that was already showing). Display only: the backend computes every number.
 */
export function useOperationsFacts(): OperationsFacts | null {
  const canView = useAdminPermission('VIEW_ORDERS');
  const [facts, setFacts] = useState<OperationsFacts | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const summary = await getControlTowerSummary();
      setFacts(summary.operations ?? null);
    } catch {
      /* keep the last facts */
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (canView !== true) return;
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, OPERATIONS_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [canView, load]);

  return canView === true ? facts : null;
}

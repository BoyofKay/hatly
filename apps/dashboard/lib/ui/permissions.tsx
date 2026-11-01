'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getMyAdminPermissions } from '../api/admin-me';

interface PermissionState {
  loaded: boolean;
  role: string | null;
  permissions: Set<string>;
  /** The permission lookup failed (after retries) and there was no previous answer to fall back on: the menu cannot be trusted. */
  failed: boolean;
  reload: () => void;
  /** True when the admin holds ANY of the permissions (SUPER_ADMIN holds all). An empty list means "any signed-in admin". */
  can: (...perms: string[]) => boolean;
}

const PermissionContext = createContext<PermissionState>({ loaded: false, failed: false, reload: () => undefined, role: null, permissions: new Set(), can: () => false });

/**
 * Navigation and control visibility only — a UX filter. The backend independently enforces every endpoint, so hiding a link is never
 * the security boundary (a direct URL or API call is refused with 403 by the server).
 */
const CACHE_KEY = 'hatly.admin.permissions';
const readCache = (): { role: string; perms: string[] } | null => {
  try { const v = JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? 'null'); return v && typeof v.role === 'string' && Array.isArray(v.perms) ? v : null; } catch { return null; }
};

export function PermissionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ loaded: boolean; failed: boolean; role: string | null; perms: string[] }>({ loaded: false, failed: false, role: null, perms: [] });
  const [attemptKey, setAttemptKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    // A transient failure (rate limit, restart) must not leave the navigation empty: retry, then fall back to the last answer for this
    // session, and only then show an explicit "could not load" state (never an empty menu that looks like "no access").
    const load = (attempt: number) =>
      getMyAdminPermissions()
        .then((me) => {
          if (cancelled) return;
          try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ role: me.role, perms: me.permissions })); } catch { /* storage unavailable */ }
          setState({ loaded: true, failed: false, role: me.role, perms: me.permissions });
        })
        .catch((e) => {
          if (cancelled) return;
          const status = e?.response?.status;
          if (status === 401 || status === 403) { setState({ loaded: true, failed: false, role: null, perms: [] }); return; }
          if (attempt < 3) { setTimeout(() => !cancelled && load(attempt + 1), 600 * (attempt + 1)); return; }
          const cached = readCache();
          setState(cached ? { loaded: true, failed: false, role: cached.role, perms: cached.perms } : { loaded: false, failed: true, role: null, perms: [] });
        });
    load(0);
    return () => { cancelled = true; };
  }, [attemptKey]);
  const value = useMemo<PermissionState>(() => {
    const set = new Set(state.perms);
    return {
      loaded: state.loaded,
      failed: state.failed,
      reload: () => { setState((s) => ({ ...s, failed: false })); setAttemptKey((k) => k + 1); },
      role: state.role,
      permissions: set,
      can: (...perms) => (perms.length === 0 ? state.loaded : state.role === 'SUPER_ADMIN' || perms.some((p) => set.has(p))),
    };
  }, [state]);
  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export function usePermissions(): PermissionState {
  return useContext(PermissionContext);
}

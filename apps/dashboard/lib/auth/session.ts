import { apiClient } from '../api/client';

/**
 * The dashboard's session. The credentials themselves (access + refresh tokens) live ONLY in HttpOnly cookies set by the API — this code
 * can neither read nor leak them, so a script injected into a page cannot steal a session. What the page keeps is non-secret:
 *   - the signed-in staff member's profile {id, role, phone, fullName} (localStorage — display and routing convenience ONLY; every
 *     endpoint authorizes on the cookie, never on this);
 *   - the CSRF token the API issues with each session (in memory + sessionStorage), echoed on unsafe requests (see lib/api/client.ts).
 * See apps/backend/src/modules/auth/dashboard-session.ts for the full cookie / CSRF design.
 */
export const USER_KEY = 'hatly_dashboard_user';
const CSRF_KEY = 'hatly_dashboard_csrf';

export interface DashboardUser {
  sub: string;
  role: 'VENDOR' | 'VENDOR_MANAGER' | 'ADMIN' | 'SUPER_ADMIN';
  phone: string;
  fullName?: string | null;
}

export interface DashboardMfaState {
  eligible: boolean;
  enabled: boolean;
  enrollmentRequired: boolean;
}

interface SessionResponse {
  user: { id: string; role: DashboardUser['role']; phone: string; fullName: string | null };
  csrfToken: string;
  mfa: DashboardMfaState;
}

let csrfToken: string | null = null;

export function getCsrfToken(): string | null {
  if (csrfToken) return csrfToken;
  if (typeof window === 'undefined') return null;
  try {
    csrfToken = window.sessionStorage.getItem(CSRF_KEY);
  } catch {
    csrfToken = null;
  }
  return csrfToken;
}

function remember(session: SessionResponse): DashboardUser {
  csrfToken = session.csrfToken;
  const user: DashboardUser = { sub: session.user.id, role: session.user.role, phone: session.user.phone, fullName: session.user.fullName };
  try {
    window.sessionStorage.setItem(CSRF_KEY, session.csrfToken);
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* storage unavailable (private mode): the in-memory token still works for this page */
  }
  return user;
}

export function clearLocalSession(): void {
  csrfToken = null;
  try {
    window.sessionStorage.removeItem(CSRF_KEY);
    window.localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}

/** Phone + password (+ the authenticator code when the account has one). Throws the API's error — `MFA_REQUIRED` means "ask for the code". */
export async function loginWithPassword(phone: string, password: string, mfaCode?: string): Promise<DashboardUser & { mfa: DashboardMfaState }> {
  const response = await apiClient.post('/auth/dashboard/login', { phone, password, ...(mfaCode ? { mfaCode } : {}) });
  const session = response.data.data as SessionResponse;
  return { ...remember(session), mfa: session.mfa };
}

/** Who is signed in according to the cookie session (also recovers the CSRF token after a reload / new tab). */
export async function fetchSession(): Promise<(DashboardUser & { mfa: DashboardMfaState }) | null> {
  try {
    const response = await apiClient.get('/auth/dashboard/me');
    const session = response.data.data as SessionResponse;
    return { ...remember(session), mfa: session.mfa };
  } catch {
    return null;
  }
}

let refreshing: Promise<boolean> | null = null;

/** Rotates the session cookies. One refresh at a time, whatever number of requests failed together. Resolves false when the session is over. */
export function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = apiClient
      .post('/auth/dashboard/refresh', undefined, { headers: { 'X-Requested-With': 'hatly-dashboard' }, _skipAuthRetry: true } as never)
      .then((res) => {
        remember(res.data.data as SessionResponse);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

/** The profile kept for display/routing (never a credential). */
export function getCurrentUser(): DashboardUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as DashboardUser) : null;
  } catch {
    return null;
  }
}

/** Ends the session on the server (revokes the refresh session, clears the cookies) and then forgets the profile. Always resolves. */
export async function logout(): Promise<void> {
  try {
    await apiClient.post('/auth/dashboard/logout', undefined, { headers: { 'X-Requested-With': 'hatly-dashboard' }, _skipAuthRetry: true } as never);
  } catch {
    /* the cookies expire on their own; the profile is cleared regardless */
  }
  clearLocalSession();
}

import axios from 'axios';

/**
 * Same backend, same auth model as the Flutter apps (JWT bearer +
 * role-based endpoints). Token storage here is a placeholder
 * (localStorage) — swap for httpOnly cookies + a server action before
 * production, since localStorage is XSS-exposed; flagged for the
 * Phase 6 security review rather than blocking Phase 1 foundation work.
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';

export const apiClient = axios.create({ baseURL: API_BASE_URL });

apiClient.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('hatly_dashboard_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

/**
 * Sales Release Candidate hardening milestone fix. This client previously had NO 401 handling at
 * all — an expired/invalid session (a routine occurrence during a real, possibly long-running
 * Sales demo) fell through to whatever generic error a page's own `.catch()` happened to show
 * (e.g. Order Detail's "Failed to load order."), leaving the vendor stuck on a broken page with no
 * indication they'd been signed out, and no path back to `/login` other than manually noticing and
 * clicking "Sign out" themselves. `VendorLayout`'s own auth guard only decodes the stored JWT
 * locally ONCE on mount — it never checks expiry against the server, so it cannot catch this case
 * either. This does NOT add a refresh-token flow (the stored `hatly_dashboard_refresh_token` is
 * unused today — a genuine, separately-flagged gap, not invented here): it closes the immediate,
 * confusing dead end by clearing the stale session and sending the vendor back to a working login
 * screen the moment the backend says the session is no longer valid.
 */
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      error.response?.status === 401 &&
      typeof window !== 'undefined' &&
      window.location.pathname !== '/login'
    ) {
      window.localStorage.removeItem('hatly_dashboard_token');
      window.localStorage.removeItem('hatly_dashboard_refresh_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

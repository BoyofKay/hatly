import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { clearLocalSession, fetchSession, getCsrfToken, refreshSession } from '../auth/session';

/**
 * Same backend and role model as the Flutter apps, but the browser authenticates with HttpOnly cookies (`withCredentials`), not a bearer
 * token kept in script-readable storage: a script injected into the dashboard can no longer steal the session. Consequences handled here:
 *  - unsafe requests (POST/PUT/PATCH/DELETE) carry the CSRF token the API issued with the session (`X-CSRF-Token`);
 *  - an expired access cookie (15 min) is renewed ONCE, transparently, through the refresh cookie, and the request is retried — a signed-in
 *    staff member is only sent to /login when the session is really over (inactive too long, revoked, or the account was deactivated);
 *  - a request refused for a stale CSRF token fetches a fresh one and is retried once.
 */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';

export const apiClient = axios.create({ baseURL: API_BASE_URL, withCredentials: true });

type RetryableConfig = InternalAxiosRequestConfig & { _retried?: boolean; _csrfRetried?: boolean; _skipAuthRetry?: boolean };
const UNSAFE = new Set(['post', 'put', 'patch', 'delete']);

apiClient.interceptors.request.use(async (config) => {
  if (typeof window === 'undefined') return config;
  if (UNSAFE.has((config.method ?? 'get').toLowerCase()) && !config.headers['X-CSRF-Token']) {
    let token = getCsrfToken();
    if (!token && !(config as RetryableConfig)._skipAuthRetry && !String(config.url).includes('/auth/dashboard/login')) {
      await fetchSession(); // recovers the token after a reload / new tab (cookie-authenticated, safe GET)
      token = getCsrfToken();
    }
    if (token) config.headers['X-CSRF-Token'] = token;
  }
  return config;
});

/**
 * 401s that are an ANSWER, not an expired session (a wrong authenticator code, a wrong password on the disable form): they must reach the
 * screen that asked, never trigger a refresh or a redirect to /login.
 */
const BUSINESS_401 = new Set(['MFA_CODE_INVALID', 'INVALID_PASSWORD']);

function sendToLogin(): void {
  clearLocalSession();
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') window.location.href = '/login';
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ error?: { details?: { code?: string } } }>) => {
    const config = error.config as RetryableConfig | undefined;
    const status = error.response?.status;
    if (!config || typeof window === 'undefined') return Promise.reject(error);
    if (status === 401 && BUSINESS_401.has(error.response?.data?.error?.details?.code ?? '')) return Promise.reject(error);

    if (status === 401 && !config._retried && !config._skipAuthRetry && !String(config.url).includes('/auth/dashboard/login')) {
      config._retried = true;
      if (await refreshSession()) {
        delete config.headers['X-CSRF-Token']; // re-read the (possibly new) token on the retry
        return apiClient.request(config);
      }
      sendToLogin();
      return Promise.reject(error);
    }
    // The admin second-factor enrolment policy is on and this account has no authenticator yet: the only useful place is the Security page.
    if (status === 403 && error.response?.data?.error?.details?.code === 'MFA_ENROLLMENT_REQUIRED') {
      if (window.location.pathname !== '/security') window.location.href = '/security';
      return Promise.reject(error);
    }
    // Signed in with a temporary password: the only place that works is choosing a new one.
    if (status === 403 && error.response?.data?.error?.details?.code === 'PASSWORD_CHANGE_REQUIRED') {
      if (window.location.pathname !== '/change-password') window.location.href = '/change-password';
      return Promise.reject(error);
    }
    if (status === 403 && error.response?.data?.error?.details?.code === 'CSRF_TOKEN_INVALID' && !config._csrfRetried) {
      config._csrfRetried = true;
      delete config.headers['X-CSRF-Token'];
      if (await fetchSession()) return apiClient.request(config);
    }
    if (status === 401 && window.location.pathname !== '/login' && !String(config.url).includes('/auth/dashboard/login')) sendToLogin();
    return Promise.reject(error);
  },
);

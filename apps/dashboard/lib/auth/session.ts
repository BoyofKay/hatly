import { apiClient } from '../api/client';
import { decodeJwtPayload, DashboardJwtPayload } from './jwt';

const TOKEN_KEY = 'hatly_dashboard_token';
const REFRESH_TOKEN_KEY = 'hatly_dashboard_refresh_token';

/**
 * PHASE I-B, CHUNK 9: replaces the previous OTP-based dashboard login
 * (`auth/login` + `auth/otp/verify`) with the real staff password
 * endpoint (`auth/password/login`) — reused exactly, no second
 * session/token system. Token storage convention (`hatly_dashboard_token`
 * in localStorage) unchanged from before this chunk. Customer OTP is
 * untouched — this dashboard never served Customer accounts.
 */
export async function loginWithPassword(phone: string, password: string): Promise<DashboardJwtPayload> {
  const response = await apiClient.post('/auth/password/login', { phone, password });
  const { accessToken, refreshToken } = response.data.data as { accessToken: string; refreshToken: string };

  window.localStorage.setItem(TOKEN_KEY, accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);

  const payload = decodeJwtPayload(accessToken);
  if (!payload) {
    throw new Error('Could not read the session — please try logging in again.');
  }
  return payload;
}

export function getCurrentUser(): DashboardJwtPayload | null {
  if (typeof window === 'undefined') return null;
  const token = window.localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  return decodeJwtPayload(token);
}

export function logout(): void {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
}

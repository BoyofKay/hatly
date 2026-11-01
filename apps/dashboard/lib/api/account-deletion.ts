import { API_BASE_URL, apiClient } from './client';

// ---- PUBLIC (the /account-deletion page) --------------------------------------------------------------------------------------------
// Plain `fetch` with credentials OMITTED: the page is for people who are not signed in, must never send a staff session cookie that
// happens to exist in the browser, and must not use the dashboard client (which redirects to /login on a 401).

/** Accepts what Egyptians type (01xxxxxxxxx, 201xxxxxxxxx, +20 1x xxxx xxxx) and sends the international form the account stores. */
export function normalizePhone(input: string): string {
  const digits = input.replace(/[^\d+]/g, '');
  if (/^01\d{9}$/.test(digits)) return `+2${digits}`;
  if (/^201\d{9}$/.test(digits)) return `+${digits}`;
  if (/^0020\d+$/.test(digits)) return `+${digits.slice(2)}`;
  return digits;
}

export interface PublicResult {
  ok: boolean;
  status: number;
  message: string;
  code?: string;
}

async function postPublic(path: string, body: Record<string, string>): Promise<PublicResult> {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { message?: string; error?: { message?: string | string[]; details?: { code?: string } } };
    const raw = json.error?.message ?? json.message ?? '';
    return { ok: res.ok, status: res.status, message: Array.isArray(raw) ? raw.join(' ') : raw, code: json.error?.details?.code };
  } catch {
    return { ok: false, status: 0, message: '' };
  }
}

/** Self-service: phone number (international, e.g. +201…) + the account password. Deletes at once when they match. */
export const deleteAccountWithPassword = (phone: string, password: string) => postPublic('/account-deletion/delete', { phone, password });

/** "I can't sign in": records a request for staff verification. Always the same answer, whatever the number. */
export const requestAccountDeletion = (phone: string) => postPublic('/account-deletion/requests', { phone });

// ---- SUPER_ADMIN review --------------------------------------------------------------------------------------------------------------

export interface AccountDeletionRequestItem {
  id: string;
  createdAt: string;
  phone: string;
  status: 'PENDING' | 'COMPLETED' | 'REJECTED';
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  verificationMethod: 'CALLBACK_TO_ACCOUNT_PHONE' | 'WHATSAPP_FROM_ACCOUNT_PHONE' | null;
  rejectionReason: 'COULD_NOT_VERIFY' | 'WITHDRAWN_BY_REQUESTER' | 'NO_ACCOUNT_FOR_NUMBER' | 'DUPLICATE' | null;
}

export async function listAccountDeletionRequests(status: AccountDeletionRequestItem['status'] = 'PENDING'): Promise<AccountDeletionRequestItem[]> {
  return (await apiClient.get('/admin/account-deletion-requests', { params: { status } })).data.data;
}

export async function completeAccountDeletionRequest(id: string, verificationMethod: NonNullable<AccountDeletionRequestItem['verificationMethod']>): Promise<AccountDeletionRequestItem> {
  return (await apiClient.post(`/admin/account-deletion-requests/${id}/complete`, { verificationMethod })).data.data;
}

export async function rejectAccountDeletionRequest(id: string, reason: NonNullable<AccountDeletionRequestItem['rejectionReason']>): Promise<AccountDeletionRequestItem> {
  return (await apiClient.post(`/admin/account-deletion-requests/${id}/reject`, { reason })).data.data;
}

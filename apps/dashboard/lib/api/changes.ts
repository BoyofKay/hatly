import { apiClient } from './client';
import type { ChangesPage } from '../changes/change-feed';

/** `since` undefined = ask for a starting cursor. The vendor feed only ever contains the caller's own branches (enforced by the server). */
export async function fetchVendorChanges(since?: string): Promise<ChangesPage> {
  const res = await apiClient.get('/vendor/orders/changes', { params: since ? { since } : {} });
  return res.data.data;
}

export async function fetchAdminChanges(topics: 'orders' | 'exceptions' | 'orders,exceptions', since?: string): Promise<ChangesPage> {
  const res = await apiClient.get('/admin/changes', { params: since ? { topics, since } : { topics } });
  return res.data.data;
}

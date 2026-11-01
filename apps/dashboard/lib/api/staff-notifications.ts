import { apiClient } from './client';

export interface StaffAlert {
  id: string;
  category: string;
  severity: 'INFO' | 'CRITICAL';
  requiredAction: string | null;
  orderId: string | null;
  orderNumber: string | null;
  exceptionId: string | null;
  segmentId: string | null;
  note: string | null;
  vendorBranchId?: string | null;
  title: string;
  isRead: boolean;
  readAt?: string | null;
  createdAt: string;
}
export interface AlertPreference {
  category: string;
  severity: 'INFO' | 'CRITICAL';
  inApp: { enabled: boolean; locked: boolean };
  push: { enabled: boolean; available: boolean };
}

export async function listStaffAlerts(limit = 15): Promise<{ items: StaffAlert[]; unreadCount: number }> {
  const res = await apiClient.get('/staff/notifications', { params: { limit } });
  return { items: res.data.data, unreadCount: res.data.meta?.unreadCount ?? 0 };
}
/** One page of the caller's own inbox (newest first), optionally only the unread ones, with the totals the Notification Center shows. */
export async function listStaffAlertsPage(q: { page: number; limit: number; unread: boolean }): Promise<{ items: StaffAlert[]; total: number; unreadCount: number }> {
  const res = await apiClient.get('/staff/notifications', { params: { page: q.page, limit: q.limit, ...(q.unread ? { unread: 'true' } : {}) } });
  return { items: res.data.data, total: res.data.meta?.total ?? 0, unreadCount: res.data.meta?.unreadCount ?? 0 };
}
export async function staffAlertUnreadCount(): Promise<number> {
  const res = await apiClient.get('/staff/notifications/unread-count');
  return res.data.data.unreadCount;
}
export async function markStaffAlertRead(id: string): Promise<void> {
  await apiClient.post(`/staff/notifications/${id}/read`);
}
export async function markAllStaffAlertsRead(): Promise<void> {
  await apiClient.post('/staff/notifications/read-all');
}
export async function staffAlertPreferences(): Promise<AlertPreference[]> {
  const res = await apiClient.get('/staff/notifications/preferences');
  return res.data.data;
}
export async function setStaffAlertPreference(input: { category: string; channel: 'IN_APP' | 'PUSH'; enabled: boolean }): Promise<AlertPreference[]> {
  const res = await apiClient.put('/staff/notifications/preferences', input);
  return res.data.data;
}

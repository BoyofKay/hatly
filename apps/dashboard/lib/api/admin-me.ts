import { apiClient } from './client';

export interface AdminSelf {
  role: string;
  permissions: string[];
}

/** The calling admin's effective permissions (`GET admin/me/permissions`) — a display aid; the backend still enforces every endpoint. */
export async function getMyAdminPermissions(): Promise<AdminSelf> {
  const res = await apiClient.get('/admin/me/permissions');
  return res.data.data;
}

import { apiClient } from './client';

/** Mirrors the real backend `AdminUsersController.list` response shape exactly (permissions/admin-permissions.controller.ts). */
export interface AdminUser {
  id: string;
  fullName: string;
  phone: string;
  role: 'ADMIN' | 'SUPER_ADMIN';
  isActive: boolean;
  createdAt: string;
  permissions: string[];
}

/** M3b (Launch-Readiness Gap Audit, G-08). Reuses the new, unchanged `GET admin/users` endpoint exactly — SUPER_ADMIN only, enforced server-side. */
export async function listAdminUsers(): Promise<AdminUser[]> {
  const res = await apiClient.get('/admin/users');
  return res.data.data;
}

/** Reuses the new, unchanged `GET admin/permissions` endpoint exactly — the REAL Permission enum, never a hardcoded second list. */
export async function listPermissionCatalog(): Promise<string[]> {
  const res = await apiClient.get('/admin/permissions');
  return res.data.data;
}

/** Reuses the EXISTING, unchanged `POST admin/users/:userId/permissions` endpoint (already built, never touched here). */
export async function grantPermission(userId: string, permission: string): Promise<void> {
  await apiClient.post(`/admin/users/${userId}/permissions`, { permission });
}

/** Reuses the EXISTING, unchanged `DELETE admin/users/:userId/permissions/:permission` endpoint. */
export async function revokePermission(userId: string, permission: string): Promise<void> {
  await apiClient.delete(`/admin/users/${userId}/permissions/${permission}`);
}

import { apiClient } from './client';

export type StaffLevel = 'ADMIN' | 'OPS_SUPERVISOR' | 'OPS_TEAM';

/** Mirrors `StaffAccountsService` (backend `admin/staff`). */
export interface StaffAccount {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  role: 'SUPER_ADMIN' | 'ADMIN';
  level: StaffLevel | 'SUPER_ADMIN';
  isActive: boolean;
  createdAt: string;
  permissions: string[];
  manageable: boolean;
}

export interface StaffPreset {
  key: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  permissions: string[];
}

export interface StaffListMeta {
  creatableLevels: StaffLevel[];
  grantable: string[];
  presets: StaffPreset[];
}

export async function listStaff(): Promise<{ data: StaffAccount[]; meta: StaffListMeta }> {
  const res = await apiClient.get('/admin/staff');
  return res.data;
}

export interface CreateStaffInput {
  fullName: string;
  phone: string;
  email?: string;
  password: string;
  level: StaffLevel;
  permissions?: string[];
  templateKey?: string;
}

export async function createStaff(input: CreateStaffInput): Promise<StaffAccount> {
  return (await apiClient.post('/admin/staff', input)).data.data;
}

export async function updateStaff(id: string, input: { fullName?: string; phone?: string; email?: string; level?: StaffLevel }): Promise<StaffAccount> {
  return (await apiClient.patch(`/admin/staff/${id}`, input)).data.data;
}

export async function setStaffActive(id: string, active: boolean): Promise<StaffAccount> {
  return (await apiClient.patch(`/admin/staff/${id}/${active ? 'activate' : 'deactivate'}`)).data.data;
}

export async function resetStaffPassword(id: string, newPassword: string): Promise<void> {
  await apiClient.post(`/admin/staff/${id}/reset-password`, { newPassword });
}

export async function setStaffPermissions(id: string, permissions: string[]): Promise<StaffAccount> {
  return (await apiClient.put(`/admin/staff/${id}/permissions`, { permissions })).data.data;
}

export async function deleteStaff(id: string): Promise<void> {
  await apiClient.delete(`/admin/staff/${id}`);
}

/** Any signed-in dashboard user (admin side or vendor side) changes their own password. */
export async function changeMyPassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiClient.post('/auth/dashboard/password', { currentPassword, newPassword });
}

/** Same rule as the backend (staff-password-policy.ts): 10+ characters, a letter and a digit. */
export function staffPasswordProblem(p: string, t: (en: string, ar: string) => string): string | null {
  if (p.length < 10) return t('At least 10 characters.', '10 أحرف على الأقل.');
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return t('Use at least one letter and one digit.', 'استخدم حرفًا واحدًا ورقمًا واحدًا على الأقل.');
  return null;
}

export const LEVEL_LABEL: Record<StaffLevel | 'SUPER_ADMIN', [string, string]> = {
  SUPER_ADMIN: ['Super admin', 'المدير العام'],
  ADMIN: ['Admin', 'مدير'],
  OPS_SUPERVISOR: ['Operations supervisor', 'مشرف التشغيل'],
  OPS_TEAM: ['Operations team', 'فريق التشغيل'],
};

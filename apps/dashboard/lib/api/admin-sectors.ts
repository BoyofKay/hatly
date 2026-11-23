import { apiClient } from './client';

/** A marketplace sector as the ADMIN API returns it (active and inactive ones alike). */
export interface AdminSector {
  id: string;
  name: string;
  nameAr: string | null;
  slug: string;
  sortOrder: number;
  isActive: boolean;
  /** The tile picture customers see on Home. */
  imageUrl?: string | null;
  /** May customers send a free-text / photo custom request ("لا تجد ما تبحث عنه؟") to vendors of this sector? Off by default. */
  customRequestsEnabled: boolean;
  bannerUrl?: string | null;
  accentColor?: string | null;
}

export async function setSectorBanner(id: string, bannerUrl: string | null): Promise<AdminSector> {
  return (await apiClient.patch(`/admin/sectors/${id}`, { bannerUrl })).data.data;
}

export async function setSectorAccentColor(id: string, accentColor: string): Promise<AdminSector> {
  return (await apiClient.patch(`/admin/sectors/${id}`, { accentColor })).data.data;
}

export const MANAGE_MARKETPLACE_SECTORS = 'MANAGE_MARKETPLACE_SECTORS';

export async function listAdminSectors(): Promise<AdminSector[]> {
  const res = await apiClient.get('/admin/sectors');
  return res.data.data;
}

export async function setSectorCustomRequests(id: string, customRequestsEnabled: boolean): Promise<AdminSector> {
  const res = await apiClient.patch(`/admin/sectors/${id}`, { customRequestsEnabled });
  return res.data.data;
}

export interface CreateSectorInput {
  name: string;
  nameAr?: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
}

export async function createSector(input: CreateSectorInput): Promise<AdminSector> {
  const res = await apiClient.post('/admin/sectors', input);
  return res.data.data;
}

/** Shown to customers on Home only while active. */
export async function setSectorActive(id: string, active: boolean): Promise<AdminSector> {
  const res = await apiClient.patch(`/admin/sectors/${id}/${active ? 'activate' : 'deactivate'}`);
  return res.data.data;
}

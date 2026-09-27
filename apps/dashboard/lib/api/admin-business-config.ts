import { apiClient } from './client';

/** Reuses the existing generic GET/PUT admin/business-config/:key endpoints — no new API surface. */
export async function getBusinessConfigValue<T>(key: string): Promise<T | null> {
  const res = await apiClient.get(`/admin/business-config/${key}`);
  return res.data.data.value as T | null;
}

export async function setBusinessConfigValue<T>(key: string, value: T, description?: string): Promise<void> {
  await apiClient.put(`/admin/business-config/${key}`, { value, description });
}

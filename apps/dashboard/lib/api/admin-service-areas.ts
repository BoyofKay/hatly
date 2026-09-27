import { apiClient } from './client';

export interface ServiceArea {
  id: string;
  name: string;
  nameAr: string | null;
  centerLatitude: number;
  centerLongitude: number;
  radiusMeters: number;
  isActive: boolean;
}

export interface CreateServiceAreaInput {
  name: string;
  nameAr?: string;
  centerLatitude: number;
  centerLongitude: number;
  radiusMeters: number;
}

export async function listServiceAreas(): Promise<ServiceArea[]> {
  const res = await apiClient.get('/admin/service-areas');
  return res.data.data;
}

export async function createServiceArea(input: CreateServiceAreaInput): Promise<ServiceArea> {
  const res = await apiClient.post('/admin/service-areas', input);
  return res.data.data;
}

export async function updateServiceArea(id: string, input: Partial<CreateServiceAreaInput>): Promise<ServiceArea> {
  const res = await apiClient.patch(`/admin/service-areas/${id}`, input);
  return res.data.data;
}

export async function activateServiceArea(id: string): Promise<ServiceArea> {
  const res = await apiClient.patch(`/admin/service-areas/${id}/activate`);
  return res.data.data;
}

export async function deactivateServiceArea(id: string): Promise<ServiceArea> {
  const res = await apiClient.patch(`/admin/service-areas/${id}/deactivate`);
  return res.data.data;
}

import { apiClient } from './client';

/** Mirrors the real backend `VehicleType` entity exactly (business-config/entities/vehicle-type.entity.ts). */
export interface VehicleType {
  id: string;
  name: string;
  nameAr: string | null;
  maxActiveDeliveries: number;
  isActive: boolean;
  isBicycle: boolean;
}

export interface CreateVehicleTypeInput {
  name: string;
  nameAr?: string;
  maxActiveDeliveries: number;
  isBicycle?: boolean;
}

export interface UpdateVehicleTypeInput {
  name?: string;
  nameAr?: string;
  maxActiveDeliveries?: number;
  isActive?: boolean;
  isBicycle?: boolean;
}

/** M3a (Launch-Readiness Gap Audit, G-29). Reuses the existing, unchanged `admin/vehicle-types` endpoints exactly. */
export async function listVehicleTypes(includeInactive = false): Promise<VehicleType[]> {
  const res = await apiClient.get('/admin/vehicle-types', { params: includeInactive ? { includeInactive: 'true' } : undefined });
  return res.data.data;
}

export async function createVehicleType(input: CreateVehicleTypeInput): Promise<VehicleType> {
  const res = await apiClient.post('/admin/vehicle-types', input);
  return res.data.data;
}

export async function updateVehicleType(id: string, input: UpdateVehicleTypeInput): Promise<VehicleType> {
  const res = await apiClient.patch(`/admin/vehicle-types/${id}`, input);
  return res.data.data;
}

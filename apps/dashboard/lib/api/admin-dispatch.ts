import { apiClient } from './client';

export interface DispatchOrder {
  orderId: string;
  status: string;
  createdAt: string;
  deliveryAddressSnapshot: { line1?: string; latitude?: number; longitude?: number } | null;
  currentDeliveryId: string | null;
  currentDriverId: string | null;
  reassignmentCount: number;
}

export interface AdminDriver {
  id: string;
  fullName: string;
  phone: string;
  isOnline: boolean;
  isAvailable: boolean;
  verificationStatus: string;
}

/** Reuses the real backend `admin/orders/dispatchable` endpoint (Chunk 6 backend addition). */
export async function listDispatchableOrders(): Promise<DispatchOrder[]> {
  const res = await apiClient.get('/admin/orders/dispatchable');
  return res.data.data;
}

/** Reuses the real backend `admin/drivers` list endpoint (Chunk 6 backend addition). */
export async function listDrivers(): Promise<AdminDriver[]> {
  const res = await apiClient.get('/admin/drivers');
  return res.data.data;
}

export interface CreateDriverInput {
  fullName: string;
  phone: string;
  password: string;
}

/**
 * PHASE I-A, CHUNK 7-A addition. Calls the existing, real
 * `POST admin/drivers` (Chunk 5 backend) — exact `CreateDriverDto`
 * field names (`phone`/`fullName`/`password`). No OTP field, no
 * acceptance-configuration field — neither exists on the backend DTO.
 */
export async function createDriver(input: CreateDriverInput): Promise<AdminDriver> {
  const res = await apiClient.post('/admin/drivers', input);
  return res.data.data;
}

/**
 * `driverId` omitted lets the backend run its own automatic ranking
 * ("assign now" without naming anyone) — this UI always names a
 * driver explicitly, since that's the actual dispatch decision an
 * Admin is making here, but the API itself supports both.
 */
export async function assignDriver(orderId: string, driverId: string): Promise<void> {
  await apiClient.post(`/admin/orders/${orderId}/assign-driver`, { driverId });
}

export async function reassignDriver(orderId: string, driverId: string): Promise<void> {
  await apiClient.post(`/admin/orders/${orderId}/reassign-driver`, { driverId });
}

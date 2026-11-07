import { DeliveryAddressView } from '../delivery-address';
import { apiClient } from './client';

export interface DispatchOrder {
  orderId: string;
  status: string;
  createdAt: string;
  deliveryAddressSnapshot: (Partial<DeliveryAddressView> & { line1?: string }) | null;
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
  vehicleTypeName: string | null;
  vehicleTypeId: string | null;
  lastLocationAt: string | null;
  /** The order this driver is currently on (assigned / picked up / on the way), if any. */
  activeDelivery: { orderId: string; orderNumber: string; status: string } | null;
  /** R28: Hatly's commission on the driver's delivery compensation, basis points (null = not set). */
  commissionRateBasisPoints?: number | null;
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

/**
 * `expectedCurrentDriverId` = the driver the admin saw on the order: if the assignment changed since (another admin, the
 * timeout sweep, the driver's own release) the backend refuses with `ASSIGNMENT_CHANGED` instead of overriding it blindly.
 */
export async function reassignDriver(orderId: string, driverId: string, expectedCurrentDriverId?: string): Promise<void> {
  await apiClient.post(`/admin/orders/${orderId}/reassign-driver`, { driverId, ...(expectedCurrentDriverId ? { expectedCurrentDriverId } : {}) });
}

/**
 * M3a (Launch-Readiness Gap Audit, G-20). Reuses the existing, unchanged
 * `PATCH admin/drivers/:id/verification` exactly — the only two states
 * the backend's own `UpdateDriverVerificationDto` accepts (`PENDING` is
 * the creation default only, never a target this sets it back to).
 */
export async function setDriverVerification(driverId: string, status: 'APPROVED' | 'REJECTED'): Promise<AdminDriver> {
  const res = await apiClient.patch(`/admin/drivers/${driverId}/verification`, { status });
  return res.data.data;
}

/** An ACTIVE vehicle type an admin can give a driver (`GET admin/drivers/vehicle-types`, MANAGE_DRIVERS). */
export interface DriverVehicleTypeOption {
  id: string;
  name: string;
  nameAr: string | null;
  isBicycle: boolean;
}

export async function listDriverVehicleTypes(): Promise<DriverVehicleTypeOption[]> {
  const res = await apiClient.get('/admin/drivers/vehicle-types');
  return res.data.data;
}

/** R28: `PATCH admin/drivers/:id/commission-rate` (MANAGE_DRIVER_COMMISSION). Only future deliveries use the new rate. */
export async function setDriverCommissionRate(driverId: string, commissionRateBasisPoints: number): Promise<void> {
  await apiClient.patch(`/admin/drivers/${driverId}/commission-rate`, { commissionRateBasisPoints });
}

/** `PATCH admin/drivers/:id/vehicle-type` — sets, changes or clears (`null`) the driver's vehicle type. */
export async function setDriverVehicleType(driverId: string, vehicleTypeId: string | null): Promise<AdminDriver> {
  const res = await apiClient.patch(`/admin/drivers/${driverId}/vehicle-type`, { vehicleTypeId });
  return res.data.data;
}

/** Mirrors the real backend `DispatchAlert` entity exactly (delivery/entities/dispatch-alert.entity.ts). */
export interface DispatchAlert {
  id: string;
  orderId: string;
  orderNumber: string | null;
  orderStatus: string | null;
  reason: 'NO_ELIGIBLE_DRIVER' | 'AUTO_ASSIGN_DISABLED' | 'ASSIGNMENT_ERROR' | 'DRIVER_NOT_RESPONDING' | 'ACKNOWLEDGEMENT_OVERDUE';
  detail?: string | null;
  /** Set by the assignment that resolved it. */
  resolvedAt: string | null;
  createdAt: string;
}

/** `GET admin/dispatch-alerts` — newest first, bounded; `openOnly` = not yet resolved by an assignment. */
export async function listDispatchAlerts(openOnly = false): Promise<DispatchAlert[]> {
  const res = await apiClient.get('/admin/dispatch-alerts', { params: openOnly ? { open: true } : {} });
  return res.data.data;
}

/** R18: a driver's capacity (active orders at once), current load and the override history. */
export interface DriverCapacity {
  capacity: number;
  active: number;
  override: number | null;
  vehicleCapacity: number | null;
  history: Array<{ beforeOverride: number | null; afterOverride: number | null; effectiveBefore: number; effectiveAfter: number; reason: string; approvedBy: string; at: string }>;
}
export async function getDriverCapacity(driverId: string): Promise<DriverCapacity> {
  return (await apiClient.get(`/admin/drivers/${driverId}/capacity`)).data.data;
}
/** R18: override (or clear with null) one driver's capacity — OVERRIDE_DISPATCH, reason required. */
export async function setDriverCapacity(driverId: string, capacity: number | null, reason: string): Promise<DriverCapacity> {
  return (await apiClient.patch(`/admin/drivers/${driverId}/capacity`, { capacity, reason })).data.data;
}

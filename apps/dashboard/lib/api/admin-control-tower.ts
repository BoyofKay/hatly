import { DeliveryAddressView } from '../delivery-address';
import { apiClient } from './client';

export type ControlTowerStage = 'ALL' | 'AWAITING_ASSIGNMENT' | 'ASSIGNED' | 'IN_TRANSIT';
export const CONTROL_TOWER_STAGES: ControlTowerStage[] = ['ALL', 'AWAITING_ASSIGNMENT', 'ASSIGNED', 'IN_TRANSIT'];

/** Mirrors `GET admin/control-tower/summary` (AdminControlTowerService.summary). */
export interface ControlTowerSummary {
  generatedAt: string;
  automaticDispatchEnabled: boolean;
  ordersByStatus: Record<string, number>;
  attention: {
    awaitingAssignment: number;
    awaitingWithOpenNoDriverAlert: number;
    awaitingWithoutAlert: number;
    /** Released (driver hand-back / timeout) with no open alert — nothing assigns them again automatically. */
    releasedAwaitingManualAssignment: number;
    assignedPastAcceptDeadline: number;
    failedDeliveriesUnresolved: number;
    readyForCustomerPickup: number;
  };
  /** Order operations facts (the navigation counter and the banner are built from these). */
  operations?: OperationsFacts;
  drivers: { approved: number; onlineAndAvailable: number; onlineBusy: number; offline: number; pendingVerification: number } | null;
}

export type DispatchAlertReason = 'NO_ELIGIBLE_DRIVER' | 'AUTO_ASSIGN_DISABLED' | 'ASSIGNMENT_ERROR' | 'DRIVER_NOT_RESPONDING';
export const DISPATCH_ALERT_REASONS: DispatchAlertReason[] = ['NO_ELIGIBLE_DRIVER', 'AUTO_ASSIGN_DISABLED', 'ASSIGNMENT_ERROR', 'DRIVER_NOT_RESPONDING'];

/** Mirrors `AdminControlTowerService` `operations` — counts only; every number is computed by the backend. */
export interface OperationsFacts {
  pendingAcceptanceAlertMinutes: number;
  pendingAcceptance: number;
  pendingAcceptanceOverdue: number;
  preparationOverdue: number;
  openDispatchAlerts: Record<DispatchAlertReason, number>;
  refundsToSend: number;
  partiallyRejectedActiveOrders: number;
  actionRequired: number;
}

export interface ControlTowerDeliveryRow {
  orderId: string;
  orderNumber: string;
  status: string;
  statusSince: string | null;
  createdAt: string;
  deliveryAddress: DeliveryAddressView | null;
  hasPendingHatlyServicePricing: boolean;
  driver: { id: string; fullName: string; phone: string } | null;
  assignedAt: string | null;
  acceptDeadlineAt: string | null;
  acceptDeadlinePassed: boolean;
  reassignmentCount: number;
  openDispatchAlert: { id: string; reason: string; createdAt: string } | null;
  /** Waiting again because its driver was released: `DRIVER` = handed back by the driver, `ADMIN` = the timeout sweep. */
  released: { at: string; byRole: string | null } | null;
}

export interface Paged<T> {
  data: T[];
  meta: { page: number; limit: number; total: number };
}

/** An APPROVED driver as the dispatcher picker needs it (`GET admin/control-tower/drivers`). */
export interface DispatchDriver {
  id: string;
  fullName: string;
  phone: string;
  isOnline: boolean;
  isAvailable: boolean;
  verificationStatus: string;
  vehicleTypeName: string | null;
  lastLocationAt: string | null;
  activeDelivery: { orderId: string; orderNumber: string; status: string } | null;
}

export async function getControlTowerSummary(): Promise<ControlTowerSummary> {
  const res = await apiClient.get('/admin/control-tower/summary');
  return res.data.data;
}

export async function listControlTowerDeliveries(params: {
  stage: ControlTowerStage;
  search?: string;
  releasedOnly?: boolean;
  page: number;
  limit: number;
}): Promise<Paged<ControlTowerDeliveryRow>> {
  const res = await apiClient.get('/admin/control-tower/deliveries', {
    params: {
      stage: params.stage,
      page: params.page,
      limit: params.limit,
      ...(params.search ? { search: params.search } : {}),
      ...(params.releasedOnly ? { releasedOnly: true } : {}),
    },
  });
  return { data: res.data.data, meta: res.data.meta };
}

export async function listDispatchDrivers(): Promise<DispatchDriver[]> {
  const res = await apiClient.get('/admin/control-tower/drivers');
  return res.data.data;
}

import { apiClient } from './client';

export type OpsAlertCategory = 'NEW_ORDER' | 'ACCEPTANCE_OVERDUE' | 'PREPARATION_LATE' | 'DRIVER_ACK_OVERDUE' | 'NO_DRIVER' | 'DRIVER_NOT_RESPONDING' | 'ASSIGNMENT_ERROR' | 'FAILED_DELIVERY' | 'DRIVER_OFFLINE';

export interface OpsAlert {
  id: string;
  category: OpsAlertCategory;
  priority: 'CRITICAL' | 'HIGH';
  orderId: string | null;
  orderNumber: string | null;
  detail: string | null;
  openedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: { id: string; name: string | null } | null;
  resolvedAt: string | null;
  resolution: string | null;
  pushRounds: number;
  href: string;
  segmentId?: string | null;
  /** Store parts of this order still waiting for acceptance (open new-order / store-not-accepted alerts only). */
  pendingParts?: Array<{ segmentId: string; vendorName: string | null; vendorNameAr: string | null; branchName: string | null }>;
}

export async function acknowledgeOpsAlert(id: string): Promise<OpsAlert> {
  const res = await apiClient.post(`/admin/ops-alerts/${id}/acknowledge`);
  return res.data.data;
}

export interface PushConfig { configured: boolean; publicKey: string | null; lastAcknowledgedAt: string | null }
export interface PushDevice {
  id: string;
  deviceLabel: string | null;
  userAgent: string | null;
  pushService: string;
  endpointTail: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  lastDisplayedAt: string | null;
  lastClickedAt: string | null;
  lastTestAcceptedAt: string | null;
  lastTestDisplayedAt: string | null;
}
export interface PushDelivery { id: string; kind: 'ALERT' | 'TEST'; status: string; attempts: number; queuedAt: string; acceptedAt: string | null; displayedAt: string | null; clickedAt: string | null; lastError: string | null; skipReason: string | null }

export const pushConfig = async (): Promise<PushConfig> => (await apiClient.get('/admin/push/config')).data.data;
export const listPushDevices = async (): Promise<PushDevice[]> => (await apiClient.get('/admin/push/subscriptions')).data.data;
export const lookupPushDevice = async (endpoint: string): Promise<PushDevice | null> => (await apiClient.post('/admin/push/subscriptions/lookup', { endpoint })).data.data;
export const registerPushDevice = async (sub: PushSubscriptionJSON, deviceLabel: string): Promise<PushDevice> =>
  (await apiClient.post('/admin/push/subscriptions', { endpoint: sub.endpoint, keys: sub.keys, deviceLabel })).data.data;
export const removePushDevice = async (id: string): Promise<void> => void (await apiClient.delete(`/admin/push/subscriptions/${id}`));
export const sendTestPush = async (id: string): Promise<PushDelivery> => (await apiClient.post(`/admin/push/subscriptions/${id}/test`)).data.data;
export const pushDelivery = async (id: string): Promise<PushDelivery> => (await apiClient.get(`/admin/push/deliveries/${id}`)).data.data;

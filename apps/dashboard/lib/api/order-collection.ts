import { apiClient } from './client';

/**
 * U2 — the customer collected a PICKUP order at the branch: READY_FOR_PICKUP → COLLECTED (terminal), through the generic
 * `PATCH orders/:id/status`. The backend decides everything: the caller must be that branch's vendor staff, or an admin
 * holding MANAGE_ORDER_ISSUES; only a ready PICKUP order can be collected; a repeat is refused (it is already COLLECTED).
 */
export async function markOrderCollected(orderId: string): Promise<{ id: string; status: string }> {
  const res = await apiClient.patch(`/orders/${orderId}/status`, { status: 'COLLECTED' });
  return res.data.data;
}

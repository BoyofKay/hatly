import { apiClient } from './client';

/** Mirrors the real backend `FailedDeliveryQueueItem` exactly (failed-delivery-resolution.service.ts). */
export interface FailedDeliveryQueueItem {
  orderId: string;
  failedAt: string | null;
  failureReason: string | null;
  customerId: string;
  customerName: string | null;
  driverId: string | null;
  driverName: string | null;
  totalMinor: number | null;
  paymentMethod: string;
  paymentStatus: string | null;
  createdAt: string;
}

/** Mirrors the real backend `AdminOrderDetailView` exactly (admin-orders.service.ts, Chunk 2a). Only the shape actually used by this chunk's UI is declared here. */
export interface AdminOrderDetail {
  id: string;
  status: string;
  customerId: string;
  fulfillmentType: string;
  paymentMethod: string;
  subtotalMinor: number;
  deliveryFeeMinor: number | null;
  discountMinor: number;
  totalMinor: number | null;
  hasPendingAdHocPricing: boolean;
  cancellationReason: string | null;
  cancelledByRole: string | null;
  failureReason: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
  customer: { id: string; fullName: string; phone: string } | null;
  driver: { id: string; fullName: string; phone: string } | null;
  segments: Array<{
    id: string;
    groupType: string;
    vendorBranchId: string | null;
    status: string;
    subtotalMinor: number | null;
    items: Array<{
      id: string;
      productId: string | null;
      productNameSnapshot: string | null;
      freeTextDescription: string | null;
      imageUrls: string[] | null;
      quantity: number;
      unitPriceMinor: number | null;
      actualAmountMinor: number | null;
      requestedWeightGrams: number | null;
      actualWeightGrams: number | null;
      offerDiscountAmountMinor: number | null;
      orderVendorSegmentId: string;
    }>;
  }>;
  payment: { id: string; method: string; status: string; amountMinor: number | null; createdAt: string; updatedAt: string } | null;
  financialEvents: Array<{ id: string; type: string; direction: string; amountMinor: number | null; paymentId?: string | null; createdAt?: string }>;
  driverCashRemainders: Array<{ id: string; status: string; remainderAmountMinor: number }>;
  adHocPurchaseRecords: Array<{ id: string; orderItemId: string; amountMinor: number; recordedByRole: string }>;
}

/** Mirrors the real backend `FailedDeliveryResolution` entity exactly (Chunk 2b). */
export interface FailedDeliveryResolutionRecord {
  id: string;
  orderId: string;
  outcome: 'RESOLVED_NO_REFUND' | 'REFUND_CUSTOMER';
  refundAmountMinor: number | null;
  driverReviewNeeded: boolean;
  driverReviewNotes: string | null;
  notes: string | null;
  resolvedByUserId: string;
  resolvedAt: string;
}

/** Mirrors the real backend `FailedDeliveryRefundResult` exactly (Chunk 2c). */
export interface FailedDeliveryRefundResult {
  orderId: string;
  resolutionId: string;
  refundAmountMinor: number;
  paymentId: string;
  status: 'REFUNDED' | 'ALREADY_REFUNDED';
}

/** Reuses the real backend `GET admin/orders/failed-deliveries` (Chunk 2b). */
export async function listFailedDeliveryQueue(): Promise<FailedDeliveryQueueItem[]> {
  const res = await apiClient.get('/admin/orders/failed-deliveries');
  return res.data.data;
}

/** Reuses the real backend `GET admin/orders/:id` (Chunk 2a) — the same general-purpose Admin Order Detail endpoint, not a Failed-Delivery-specific one. */
export async function getAdminOrderDetail(orderId: string): Promise<AdminOrderDetail> {
  const res = await apiClient.get(`/admin/orders/${orderId}`);
  return res.data.data;
}

export interface CreateFailedDeliveryResolutionInput {
  outcome: 'RESOLVED_NO_REFUND' | 'REFUND_CUSTOMER';
  refundAmountMinor?: number;
  driverReviewNeeded?: boolean;
  driverReviewNotes?: string;
  notes?: string;
}

/** Reuses the real backend `POST admin/orders/:id/failed-delivery-resolution` (Chunk 2b). Terminal — the backend has no update/delete endpoint for this, and neither does this client. */
export async function createFailedDeliveryResolution(
  orderId: string,
  input: CreateFailedDeliveryResolutionInput,
): Promise<FailedDeliveryResolutionRecord> {
  const res = await apiClient.post(`/admin/orders/${orderId}/failed-delivery-resolution`, input);
  return res.data.data;
}

/** Reuses the real backend `POST admin/orders/:id/failed-delivery-refund` (Chunk 2c). Deliberately a separate call from resolution creation — the backend keeps decision and execution as two distinct actions. */
export async function executeFailedDeliveryRefund(orderId: string): Promise<FailedDeliveryRefundResult> {
  const res = await apiClient.post(`/admin/orders/${orderId}/failed-delivery-refund`);
  return res.data.data;
}

import { DeliveryAddressView } from '../delivery-address';
import { apiClient } from './client';

/** Mirrors the real backend `FailedDeliveryQueueItem` exactly (failed-delivery-resolution.service.ts). */
export interface FailedDeliveryQueueItem {
  orderId: string;
  orderNumber: string;
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

/** BUY_FROM_PLACE: origin = the named place (pickup*), destination = the order's delivery address. DELIVER_TO_PLACE: origin = the delivery address, destination = the named place (destination*). */
export interface AdminHatlyService {
  serviceType: string | null;
  placeName: string | null;
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
  /** Orders placed from PD-012 on: the route as it was frozen at checkout (origin → destination). Absent for earlier orders. */
  route?: { origin: AdminRoutePoint; destination: AdminRoutePoint } | null;
}

export interface AdminRoutePoint {
  latitude: number;
  longitude: number;
  label: string | null;
  source: 'CUSTOMER' | 'DEFAULT';
}

export interface AdminSegmentHistoryEntry {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  at: string;
  onBehalfOfVendor: boolean;
  /** SYSTEM when the platform itself made the change. */
  actorRole: string;
  actorName?: string | null;
  reason: string | null;
}

export interface AdminRefundSummary {
  walletRefundedMinor: number;
  transferRefundRecordedMinor: number;
  transferRefundSentMinor: number;
  pendingRefundMinor: number;
  totalRefundMinor: number;
  status: string;
  transferRefunds: Array<{ id: string; amountMinor: number; recordedAt: string; sentAt: string | null }>;
}

/** Mirrors the real backend `AdminOrderDetailView` exactly (admin-orders.service.ts, Chunk 2a). Only the shape actually used by this chunk's UI is declared here. */
export interface AdminOrderDetail {
  id: string;
  /** M3b (G-04) addition to this existing type — the backend's `AdminOrderDetailView` already returned this field; it just wasn't declared here yet since Failed Deliveries never needed to show it. */
  orderNumber: string;
  status: string;
  /** Operations' note for the driver (owner decision 2026-11-27). */
  operationsNoteForDriver?: string | null;
  customerId: string;
  fulfillmentType: string;
  paymentMethod: string;
  subtotalMinor: number;
  deliveryFeeMinor: number | null;
  discountMinor: number;
  totalMinor: number | null;
  walletAmountMinor?: number;
  amountDueMinor?: number | null;
  hasPendingAdHocPricing: boolean;
  /** Hatly Service pricing Admin UI: at least one Hatly Service request is still PENDING. */
  hasPendingHatlyServicePricing?: boolean;
  deliveryAddress?: DeliveryAddressView | null;
  cancellationReason: string | null;
  cancelledByRole: string | null;
  failureReason: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
  customer: { id: string; fullName: string; phone: string } | null;
  /** Null for a released order (back to READY_FOR_PICKUP): only the driver actually on (or who finished) the order. */
  driver: { id: string; fullName: string; phone: string } | null;
  /** Control Tower milestone: status history, oldest first. */
  timeline?: Array<{ status: string; at: string; actorRole: string | null }>;
  /** Control Tower milestone: dispatch facts of the delivery (null before any assignment). */
  delivery?: {
    assignedAt: string | null;
    acceptDeadlineAt: string | null;
    /** R16: when the current driver acknowledged (null = not yet). */
    acknowledgedAt?: string | null;
    pickedUpAt: string | null;
    deliveredAt: string | null;
    reassignmentCount: number;
  } | null;
  /** Control Tower milestone: "no eligible driver" alerts for this order, newest first. */
  dispatchAlerts?: Array<{ id: string; reason: string; detail?: string | null; createdAt: string; resolvedAt: string | null }>;
  /** Order operations: every automatic assignment attempt and its outcome, newest first. */
  dispatchAttempts?: Array<{ outcome: string; driverId: string | null; detail: string | null; at: string }>;
  /** Order operations: what has been given back so far, from the real ledgers. */
  refundSummary?: AdminRefundSummary;
  /** PD-015: the Hatly-funded promotional cost, recorded minus restored (informational — not a refund). */
  hatlyFundedDiscount?: { recordedMinor: number; restoredMinor: number; netMinor: number };
  segments: Array<{
    id: string;
    groupType: string;
    vendorBranchId: string | null;
    status: string;
    subtotalMinor: number | null;
    vendorName?: string | null;
    branchName?: string | null;
    /** Every transition of the segment, oldest first (who, in which role, on whose behalf, and why). */
    history?: AdminSegmentHistoryEntry[];
    rejectionReason?: string | null;
    /** Hatly Service request details — present only for an AD_HOC_SERVICE segment. */
    hatlyService?: AdminHatlyService | null;
    items: Array<{
      id: string;
      productId: string | null;
      productNameSnapshot: string | null;
      freeTextDescription: string | null;
      imageUrls: string[] | null;
      /** The customer's voice note (Hatly upload), or null. */
      voiceNoteUrl?: string | null;
      quantity: number;
      unitPriceMinor: number | null;
      actualAmountMinor: number | null;
      /** `null` for a normal catalog item. */
      priceStatus?: 'PENDING' | 'CONFIRMED' | null;
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

/** Operations write (or clear with an empty text) the note the driver sees on this order. */
export async function setOrderDriverNote(orderId: string, note: string): Promise<string | null> {
  const res = await apiClient.patch(`/admin/orders/${orderId}/driver-note`, { note });
  return res.data.data.operationsNoteForDriver ?? null;
}

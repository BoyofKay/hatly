import { apiClient } from './client';

/** Mirrors the real backend `AdminOrderListItemView` exactly (orders/admin-orders.service.ts). */
export interface AdminOrderListItem {
  id: string;
  orderNumber: string;
  status: string;
  createdAt: string;
  totalMinor: number | null;
  paymentMethod: string;
  paymentStatus: string | null;
  /** DELIVERY or PICKUP. */
  fulfillmentType: string;
  customer: { id: string; fullName: string; phone: string } | null;
  segmentCount: number;
  /** At least one Hatly Service request has no confirmed price yet. */
  hasPendingHatlyServicePricing: boolean;
  /** Names of the vendor branches with a part in this order. */
  vendorNames?: string[];
  /** The driver on the order while one is on record; null while it waits for a driver. */
  driver?: { id: string; fullName: string } | null;
}

export interface AdminOrderSearchParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  /** `true`: only orders with a Hatly Service request whose price is still pending (filtered server-side). */
  hasPendingPricing?: boolean;
  /** DELIVERY or PICKUP. */
  fulfillmentType?: string;
  /** Any of these statuses, comma-separated (queue views). */
  statuses?: string;
  /** Orders with a part from this vendor branch. */
  vendorBranchId?: string;
  /** Africa/Cairo calendar dates, YYYY-MM-DD, inclusive. */
  from?: string;
  to?: string;
}

export interface AdminOrderSearchResult {
  data: AdminOrderListItem[];
  meta: { page: number; limit: number; total: number };
}

/** M3b (Launch-Readiness Gap Audit, G-04). Reuses the new, unchanged `GET admin/orders` endpoint exactly. */
export async function searchAdminOrders(params: AdminOrderSearchParams): Promise<AdminOrderSearchResult> {
  const res = await apiClient.get('/admin/orders', {
    params: Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')),
  });
  return { data: res.data.data, meta: res.data.meta };
}

export const ORDER_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'ASSIGNED_TO_DRIVER',
  'PICKED_UP',
  'ON_THE_WAY',
  'DELIVERED',
  'CANCELLED',
  'FAILED_DELIVERY',
  'COLLECTED',
] as const;

export const PAYMENT_STATUSES = ['PENDING', 'CUSTOMER_CLAIMED_TRANSFER', 'UNDER_REVIEW', 'PAID', 'REJECTED'] as const;

export const PAYMENT_METHODS = ['COD', 'ONLINE', 'MANUAL_TRANSFER', 'PAY_AT_DELIVERY', 'WALLET'] as const;

export const FULFILLMENT_TYPES = ['DELIVERY', 'PICKUP'] as const;

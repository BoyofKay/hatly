import { apiClient } from './client';
import { AdminOrderListItem } from './admin-order-search';

/** Mirrors the real backend `AdminCustomerListItemView` exactly (admin-customers/admin-customers.service.ts). */
export interface AdminCustomerListItem {
  id: string;
  fullName: string;
  phone: string;
  isActive: boolean;
  isPhoneVerified: boolean;
  createdAt: string;
}

export interface AdminCustomerAddressSummary {
  id: string;
  label: string | null;
  line1: string;
  governorate: string | null;
  city: string | null;
  isDefault: boolean;
}

/** Mirrors the real backend `AdminCustomerDetailView` exactly. */
export interface AdminCustomerDetail extends AdminCustomerListItem {
  walletBalanceMinor: number;
  address: AdminCustomerAddressSummary | null;
  orderCount: number;
  recentOrders: AdminOrderListItem[];
}

export interface AdminCustomerSearchParams {
  page?: number;
  limit?: number;
  search?: string;
  isActive?: boolean;
}

export interface AdminCustomerSearchResult {
  data: AdminCustomerListItem[];
  meta: { page: number; limit: number; total: number };
}

/** M3c (Launch-Readiness Gap Audit, G-10). Reuses the new, unchanged `GET admin/customers` endpoint exactly. */
export async function searchAdminCustomers(params: AdminCustomerSearchParams): Promise<AdminCustomerSearchResult> {
  const res = await apiClient.get('/admin/customers', {
    params: Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')),
  });
  return { data: res.data.data, meta: res.data.meta };
}

/** Reuses the new, unchanged `GET admin/customers/:id` endpoint exactly. */
export async function getAdminCustomerDetail(customerId: string): Promise<AdminCustomerDetail> {
  const res = await apiClient.get(`/admin/customers/${customerId}`);
  return res.data.data;
}

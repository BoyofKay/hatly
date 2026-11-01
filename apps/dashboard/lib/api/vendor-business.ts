import { apiClient } from './client';

export type SegmentStatus = 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY_FOR_PICKUP' | 'PICKED_UP' | 'CANCELLED';

export interface VendorBranchSummary {
  id: string;
  name: string;
  isOpen: boolean;
  isActive: boolean;
  preparationTimeMinutes: number | null;
  autoAcceptEnabled: boolean;
}
export interface VendorOverview {
  live: Partial<Record<SegmentStatus, number>>;
  awaitingAcceptance: number;
  today: { received: number; cancelled: number; goodsMinor: number };
  /** The same figures for yesterday (Cairo date) — what today's cards compare against. Optional only for an older backend. */
  yesterday?: { received: number; cancelled: number; goodsMinor: number };
  productCount?: number;
  vendorName?: string | null;
  /** Derived from the branches' rating counters; null until a customer rates. */
  rating?: { average: number; count: number } | null;
  branches: VendorBranchSummary[];
  openExceptions: number;
}
export interface VendorHistoryRow {
  orderId: string;
  segmentId: string;
  orderNumber: string;
  orderStatus: string;
  status: SegmentStatus;
  subtotalMinor: number | null;
  paymentMethod: string;
  fulfillmentType: string;
  createdAt: string;
  branch: { id: string; name: string };
  itemCount: number;
}
export interface VendorInsights {
  totals: { received: number; cancelled: number; goodsMinor: number; averageMinor: number | null };
  byStatus: Record<string, number>;
  daily: Array<{ day: string; orders: number; goodsMinor: number }>;
  byHour: Array<{ hour: number; orders: number }>;
  topProducts: Array<{ name: string; nameAr: string | null; quantity: number }>;
  medianAcceptMinutes: number | null;
  medianPrepMinutes: number | null;
}
export interface VendorEarnings {
  totals: { orders: number; goodsMinor: number; commissionMinor: number };
  items: Array<{ orderId: string; orderNumber: string; completedAt: string; goodsMinor: number | null; commissionMinor: number | null; branchName: string; paymentMethod: string }>;
  settlements: Array<{ id: string; branchName: string; frequency: string; periodStart: string; periodEnd: string; status: string; grossSalesMinor: number | null; commissionOwedMinor: number | null; closedAt: string | null }>;
}
export interface VendorTeam {
  members: Array<{ id: string; fullName: string; role: 'MANAGER' | 'OPERATOR'; isActive: boolean; phoneMasked: string; branches: string[]; isYou: boolean }>;
  canManage: boolean;
}
export type OpeningHours = Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', { open: string; close: string }>>;
export interface VendorBranchProfile {
  id: string;
  name: string;
  address: string;
  isOpen: boolean;
  isActive: boolean;
  openingHours: OpeningHours;
  preparationTimeMinutes: number | null;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  autoAcceptEnabled: boolean;
  canEditProfile: boolean;
  /** Open to customers right now: the manual switch AND no active closure. */
  effectiveOpen?: boolean;
  activeClosure?: { id: string; kind: string; startsAt: string; endsAt: string; reason: string } | null;
}

export async function getVendorOverview(): Promise<VendorOverview> {
  return (await apiClient.get('/vendor/overview')).data.data;
}
export async function getVendorHistory(params: Record<string, string | number | undefined>): Promise<{ items: VendorHistoryRow[]; total: number; page: number; limit: number }> {
  const res = await apiClient.get('/vendor/orders/history', { params });
  return { items: res.data.data, ...res.data.meta };
}
export async function getVendorInsights(params: Record<string, string | undefined>): Promise<VendorInsights> {
  return (await apiClient.get('/vendor/insights', { params })).data.data;
}
export async function getVendorEarnings(params: Record<string, string | number | undefined>): Promise<VendorEarnings & { total: number; page: number; limit: number }> {
  const res = await apiClient.get('/vendor/earnings', { params });
  return { ...res.data.data, ...res.data.meta };
}
export async function getVendorTeam(): Promise<VendorTeam> {
  return (await apiClient.get('/vendor/team')).data.data;
}
export async function getVendorBranch(id: string): Promise<VendorBranchProfile> {
  return (await apiClient.get(`/vendor/branches/${id}`)).data.data;
}
export async function updateVendorBranch(id: string, body: { isOpen?: boolean; openingHours?: OpeningHours; preparationTimeMinutes?: number | null }): Promise<VendorBranchProfile> {
  return (await apiClient.patch(`/vendor/branches/${id}`, body)).data.data;
}

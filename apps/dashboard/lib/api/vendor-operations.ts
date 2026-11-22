import { apiClient } from './client';

export interface TeamMember {
  id: string;
  fullName: string;
  role: 'MANAGER' | 'OPERATOR';
  isActive: boolean;
  phoneMasked: string;
  branches: string[];
  branchIds: string[];
  isYou: boolean;
  /** The caller may activate, deactivate or move this person (an operator who works only at the caller's own branches). */
  manageable: boolean;
}
export interface TeamView {
  members: TeamMember[];
  canManage: boolean;
  /** The caller's own branches — what a person can be assigned to. */
  branches: Array<{ id: string; name: string }>;
}
export const createOperator = async (body: { fullName: string; phone: string; password: string; branchId: string }) => (await apiClient.post('/vendor/team/members', body)).data.data as { id: string };
export const promoteOperator = async (userId: string) => (await apiClient.post(`/vendor/team/members/${userId}/promote`)).data.data;
export const setOperatorActive = async (userId: string, isActive: boolean) => (await apiClient.patch(`/vendor/team/members/${userId}/active`, { isActive })).data.data;
export const assignOperatorBranch = async (userId: string, branchId: string) => (await apiClient.post(`/vendor/team/members/${userId}/branches/${branchId}`)).data.data;
export const unassignOperatorBranch = async (userId: string, branchId: string) => (await apiClient.delete(`/vendor/team/members/${userId}/branches/${branchId}`)).data.data;

export type ClosureKind = 'TEMPORARY' | 'HOLIDAY';
export type ClosureStatus = 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'CANCELLED';
export interface Closure {
  id: string;
  kind: ClosureKind;
  startsAt: string;
  endsAt: string;
  reason: string;
  status: ClosureStatus;
  createdBy: string;
  createdAt: string;
  cancelledAt: string | null;
  cancelledBy: string | null;
}
export interface ClosuresView {
  closures: Closure[];
  current: { active: { id: string; kind: ClosureKind; startsAt: string; endsAt: string; reason: string } | null; next: { id: string; kind: ClosureKind; startsAt: string; endsAt: string; reason: string } | null };
  canManage: boolean;
}
export type ClosureScope = 'vendor' | 'admin';
const closuresBase = (scope: ClosureScope, branchId: string) => (scope === 'admin' ? `/admin/vendor-branches/${branchId}/closures` : `/vendor/branches/${branchId}/closures`);
export const getClosures = async (scope: ClosureScope, branchId: string): Promise<ClosuresView> => (await apiClient.get(closuresBase(scope, branchId))).data.data;
export const createClosure = async (scope: ClosureScope, branchId: string, body: { kind: ClosureKind; startsAt: string; endsAt: string; reason: string }) => (await apiClient.post(closuresBase(scope, branchId), body)).data.data;
export const cancelClosure = async (scope: ClosureScope, branchId: string, closureId: string) => (await apiClient.delete(`${closuresBase(scope, branchId)}/${closureId}`)).data.data;

export type MovementReason = 'INITIAL_STOCK' | 'ORDER_PLACED' | 'ORDER_CANCELLED' | 'MANUAL_ADJUSTMENT' | 'SET_TO_ZERO' | 'STOCKTAKE' | 'IMPORT' | 'UNATTRIBUTED';
export interface StockMovement {
  id: string;
  occurredAt: string;
  productId: string;
  productName: string;
  productNameAr: string | null;
  branchName: string;
  beforeQuantity: number | null;
  afterQuantity: number | null;
  delta: number;
  reason: MovementReason;
  reference: { type: 'ORDER' | 'STOCKTAKE' | 'CART'; id: string; orderNumber: string | null } | null;
  actorName: string | null;
  actorRole: string | null;
  note: string | null;
  sourceCaptured: boolean;
}
export const getMovements = async (params: Record<string, string | number | undefined>): Promise<{ items: StockMovement[]; startedAt: string | null; total: number; page: number; limit: number }> => {
  const res = await apiClient.get('/vendor/inventory/movements', { params });
  return { ...res.data.data, ...res.data.meta };
};

export interface StocktakeSummaryRow { id: string; status: 'OPEN' | 'APPLIED' | 'CANCELLED'; note: string | null; createdAt: string; appliedAt: string | null; branchId: string; branchName: string; createdBy: string; lines: number; counted: number }
export interface StocktakeLine { productId: string; name: string; nameAr: string | null; pricingUnit: string; expected: number; counted: number | null; variance: number | null; currentQuantity: number; movedSinceStart: boolean; countedBy: string | null; countedAt: string | null }
export interface StocktakeDetail {
  id: string; status: 'OPEN' | 'APPLIED' | 'CANCELLED'; note: string | null; branchId: string; branchName: string; createdAt: string; appliedAt: string | null;
  items: StocktakeLine[]; canApply: boolean;
  summary: { lines: number; counted: number; uncounted: number; withVariance: number; netVariance: number };
}
export const listStocktakes = async (): Promise<{ items: StocktakeSummaryRow[]; canApply: boolean }> => (await apiClient.get('/vendor/inventory/stocktakes')).data.data;
export const startStocktake = async (body: { branchId: string; note?: string }) => (await apiClient.post('/vendor/inventory/stocktakes', body)).data.data as { id: string };
export const getStocktake = async (id: string): Promise<StocktakeDetail> => (await apiClient.get(`/vendor/inventory/stocktakes/${id}`)).data.data;
export const setStocktakeCount = async (id: string, productId: string, counted: number | null) => (await apiClient.patch(`/vendor/inventory/stocktakes/${id}/lines/${productId}`, { counted })).data.data;
export const applyStocktake = async (id: string) => (await apiClient.post(`/vendor/inventory/stocktakes/${id}/apply`)).data.data as { adjusted: number; counted: number };
export const cancelStocktake = async (id: string) => (await apiClient.post(`/vendor/inventory/stocktakes/${id}/cancel`)).data.data;

export interface FinanceStatement {
  terms: { settlementFrequency: 'WEEKLY' | 'MONTHLY' | null; updatedAt: string | null; /** The platform-wide frequency applied to a vendor without a contractual one (null if Hatly never set it). */ platformDefaultFrequency: 'WEEKLY' | 'MONTHLY' | null };
  branches: Array<{ id: string; name: string; commissionRateBasisPoints: number | null }>;
  sales: { parts: number; goodsMinor: number | null };
  commissionReceivable: { minor: number | null; note: string };
  customerPayments: Array<{ method: string; parts: number; goodsMinor: number | null }>;
  cancelledParts: { parts: number; goodsMinor: number | null };
  driverPaymentsToVendor: { recorded: boolean };
  netPayableToVendor: { defined: boolean };
  settlements: Array<{ id: string; branchName: string; frequency: string; periodStart: string; periodEnd: string; grossSalesMinor: number | null; commissionOwedMinor: number | null; closedAt: string | null; payments: Array<{ id: string; direction: string; amountMinor: number | null; method: string; paidOn: string; status: string }> }>;
  history: Array<{ month: string; parts: number; goodsMinor: number | null; commissionMinor: number | null }>;
}
export const getFinance = async (params: Record<string, string | undefined>): Promise<FinanceStatement> => (await apiClient.get('/vendor/finance', { params })).data.data;

export interface SettlementTerms { vendorId: string; vendorName: string; frequency: 'WEEKLY' | 'MONTHLY' | null; updatedAt: string | null; updatedBy: string | null }
export const getSettlementTerms = async (vendorId: string): Promise<SettlementTerms> => (await apiClient.get(`/admin/vendors/${vendorId}/settlement-terms`)).data.data;
export const setSettlementTerms = async (vendorId: string, frequency: 'WEEKLY' | 'MONTHLY' | null): Promise<SettlementTerms> => (await apiClient.put(`/admin/vendors/${vendorId}/settlement-terms`, { frequency })).data.data;

/** Downloads the statement as a CSV file (the browser saves it); the server sends no customer data. */
export async function downloadFinanceCsv(params: Record<string, string | undefined>): Promise<void> {
  const res = await apiClient.get('/vendor/finance/export', { params, responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hatly-vendor-statement-${params.from ?? ''}_${params.to ?? ''}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

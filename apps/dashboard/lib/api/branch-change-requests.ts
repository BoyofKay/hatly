import { apiClient } from './client';

/** R8/R44: a store change that waits for Hatly (pause / reopen / weekly hours / closure / early end of a closure). */
export type BranchChangeKind = 'PAUSE' | 'REOPEN' | 'HOURS' | 'CLOSURE' | 'CLOSURE_CANCEL';
export interface BranchChangeRequest {
  id: string;
  branchId: string;
  branchName: string;
  vendorName: string;
  kind: BranchChangeKind;
  payload: Record<string, any>;
  reason: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
  requestedBy: string;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export async function listMyBranchRequests(branchId: string): Promise<BranchChangeRequest[]> {
  return (await apiClient.get(`/vendor/branches/${branchId}/change-requests`)).data.data;
}
export async function withdrawMyBranchRequest(branchId: string, requestId: string): Promise<void> {
  await apiClient.post(`/vendor/branches/${branchId}/change-requests/${requestId}/withdraw`);
}
export async function listBranchRequests(status = 'PENDING'): Promise<BranchChangeRequest[]> {
  return (await apiClient.get('/admin/branch-change-requests', { params: { status } })).data.data;
}
export async function decideBranchRequest(requestId: string, decision: 'approve' | 'reject', note?: string): Promise<BranchChangeRequest> {
  return (await apiClient.post(`/admin/branch-change-requests/${requestId}/${decision}`, { note })).data.data;
}

/** Plain-language summary of what a request asks for (bilingual pair). */
export function describeRequest(r: Pick<BranchChangeRequest, 'kind' | 'payload'>, t: (en: string, ar: string) => string, dateTime: (iso: string) => string): string {
  switch (r.kind) {
    case 'PAUSE': return t('Pause the store (stop new orders)', 'إيقاف المتجر مؤقتًا (إيقاف الطلبات الجديدة)');
    case 'REOPEN': return t('Reopen the store', 'إعادة فتح المتجر');
    case 'HOURS': {
      const h = r.payload?.openingHours ?? {};
      const days = Object.entries(h).map(([d, v]: [string, any]) => `${d} ${v.open}–${v.close}`).join(', ');
      // Empty hours mean no time limit (R9): the store takes orders whenever it is open.
      return days ? t(`New weekly hours: ${days}`, `مواعيد أسبوعية جديدة: ${days}`) : t('Remove the weekly hours (take orders at any time while open)', 'إلغاء المواعيد الأسبوعية (استقبال الطلبات في أي وقت أثناء الفتح)');
    }
    case 'CLOSURE': return t(`Temporary closure ${dateTime(r.payload.startsAt)} → ${dateTime(r.payload.endsAt)} (${r.payload.reason})`, `إغلاق مؤقت ${dateTime(r.payload.startsAt)} ← ${dateTime(r.payload.endsAt)} (${r.payload.reason})`);
    case 'CLOSURE_CANCEL': return t('End a closure early (reopen)', 'إنهاء إغلاق مبكرًا (إعادة الفتح)');
  }
}

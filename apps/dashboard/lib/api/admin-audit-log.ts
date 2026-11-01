import { apiClient } from './client';

/** Mirrors the real backend `AuditLogView` exactly (modules/audit/admin-audit.service.ts). */
export interface AuditLogItem {
  id: string;
  createdAt: string;
  actorUserId: string | null;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  targetType: string | null;
  targetRef: string | null;
  outcome: 'SUCCESS' | 'FAILURE' | string;
  metadata: Record<string, string | number | boolean | null>;
  ipAddress: string | null;
}

export interface AuditLogParams {
  page?: number;
  limit?: number;
  action?: string;
  outcome?: 'SUCCESS' | 'FAILURE';
  actorUserId?: string;
  targetType?: string;
  targetRef?: string;
  from?: string;
  to?: string;
}

export interface AuditLogResult {
  data: AuditLogItem[];
  meta: { page: number; limit: number; total: number };
}

/** Launch-readiness G-11. Read-only `GET admin/audit-logs` (needs the VIEW_AUDIT_LOG permission; SUPER_ADMIN always). */
export async function listAuditLogs(params: AuditLogParams): Promise<AuditLogResult> {
  const res = await apiClient.get('/admin/audit-logs', {
    params: Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')),
  });
  return { data: res.data.data, meta: res.data.meta };
}

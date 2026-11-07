'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, useToast } from '../ui';
import { useLang } from '../../lib/ui/lang';
import { apiErrorMessage } from '../../lib/api/errors';
import { describeRequest, listMyBranchRequests, withdrawMyBranchRequest, type BranchChangeRequest } from '../../lib/api/branch-change-requests';

const TONE: Record<BranchChangeRequest['status'], 'amber' | 'green' | 'red' | 'gray'> = { PENDING: 'amber', APPROVED: 'green', REJECTED: 'red', WITHDRAWN: 'gray' };

/**
 * R8/R44: what this store has asked Hatly to change (pause / reopen / hours / closures) and what Hatly decided. A pending request can be
 * withdrawn. Nothing here changes the store directly — Hatly approves first.
 */
export function BranchChangeRequests({ branchId, reloadKey = 0, onChanged }: { branchId: string; reloadKey?: number; onChanged?: () => void }) {
  const { t, dateTime } = useLang();
  const toast = useToast();
  const [rows, setRows] = useState<BranchChangeRequest[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setRows(await listMyBranchRequests(branchId)); } catch { setRows([]); }
  }, [branchId]);
  useEffect(() => { void load(); }, [load, reloadKey]);
  if (!rows || rows.length === 0) return null;
  const statusText = (s: BranchChangeRequest['status']) =>
    ({ PENDING: t('Waiting for Hatly', 'بانتظار هاتلي'), APPROVED: t('Approved', 'تمت الموافقة'), REJECTED: t('Rejected', 'مرفوض'), WITHDRAWN: t('Withdrawn', 'مسحوب') })[s];
  async function withdraw(id: string) {
    setBusy(id);
    try {
      await withdrawMyBranchRequest(branchId, id);
      toast.push('success', t('Request withdrawn.', 'تم سحب الطلب.'));
      await load();
      onChanged?.();
    } catch (e) { toast.push('error', apiErrorMessage(e, t('Could not withdraw the request.', 'تعذّر سحب الطلب.'))); } finally { setBusy(null); }
  }
  return (
    <Card title={t('Requests to Hatly', 'طلبات إلى هاتلي')}>
      <p className="mb-2 text-xs text-gray-500">{t('Pausing or reopening the store, weekly hours and closures take effect only after Hatly approves them. Orders already confirmed continue either way.', 'إيقاف المتجر أو إعادة فتحه ومواعيد العمل والإغلاقات لا تسري إلا بعد موافقة هاتلي. الطلبات المؤكدة تستمر في كل الأحوال.')}</p>
      <ul className="divide-y divide-gray-100" data-testid={`branch-requests-${branchId}`}>
        {rows.slice(0, 10).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" data-testid={`branch-request-${r.id}`}>
            <span className="min-w-0">
              <span className="block">{describeRequest(r, t, (iso) => dateTime(iso))}</span>
              <span className="block text-xs text-gray-500">{dateTime(r.createdAt)}{r.decisionNote ? ` · ${r.decisionNote}` : ''}</span>
            </span>
            <span className="flex items-center gap-2">
              <Badge tone={TONE[r.status]}>{statusText(r.status)}</Badge>
              {r.status === 'PENDING' && <Button size="sm" loading={busy === r.id} onClick={() => withdraw(r.id)}>{t('Withdraw', 'سحب')}</Button>}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

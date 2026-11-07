'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, useToast } from '../ui';
import { useLang } from '../../lib/ui/lang';
import { apiErrorMessage } from '../../lib/api/errors';
import { listMyProductChangeRequests, withdrawMyProductChangeRequest, type ProductChangeRequest } from '../../lib/api/vendor-products';
import { describeProductChange } from '../../lib/products/describe-change';

const TONE = { PENDING: 'amber', APPROVED: 'green', REJECTED: 'red', WITHDRAWN: 'gray' } as const;

/**
 * R7: this branch's product changes that wait for Hatly (new products, price increases, detail and option changes) and Hatly's decisions.
 * Price reductions and stock changes apply at once and never appear here. A pending change (not a new product) can be withdrawn.
 */
export function VendorProductRequests({ branchId, reloadKey = 0, onChanged }: { branchId: string; reloadKey?: number; onChanged?: () => void }) {
  const { t, dateTime } = useLang();
  const toast = useToast();
  const [rows, setRows] = useState<ProductChangeRequest[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setRows(await listMyProductChangeRequests(branchId)); } catch { setRows([]); }
  }, [branchId]);
  useEffect(() => { void load(); }, [load, reloadKey]);
  if (!rows || rows.length === 0) return null;
  const statusText = (s: ProductChangeRequest['status']) =>
    ({ PENDING: t('Waiting for Hatly', 'بانتظار هاتلي'), APPROVED: t('Approved', 'تمت الموافقة'), REJECTED: t('Rejected', 'مرفوض'), WITHDRAWN: t('Withdrawn', 'مسحوب') })[s];
  async function withdraw(id: string) {
    setBusy(id);
    try {
      await withdrawMyProductChangeRequest(id);
      toast.push('success', t('Change withdrawn.', 'تم سحب التغيير.'));
      await load();
      onChanged?.();
    } catch (e) { toast.push('error', apiErrorMessage(e, t('Could not withdraw.', 'تعذّر السحب.'))); } finally { setBusy(null); }
  }
  const pending = rows.filter((r) => r.status === 'PENDING').length;
  return (
    <Card title={t(`Product changes for Hatly${pending ? ` (${pending} waiting)` : ''}`, `تغييرات المنتجات لدى هاتلي${pending ? ` (${pending} بالانتظار)` : ''}`)}>
      <p className="mb-2 text-xs text-gray-500">{t('New products, price increases and changes to names, descriptions, categories, photos and options go live only after Hatly approves them; until then customers see the approved version. Price reductions and stock apply at once.', 'المنتجات الجديدة وزيادات الأسعار وتغيير الأسماء والأوصاف والأقسام والصور والخيارات لا تُعرض إلا بعد موافقة هاتلي؛ وحتى ذلك يرى العملاء النسخة المعتمدة. خفض الأسعار والمخزون يُطبَّق فورًا.')}</p>
      <ul className="divide-y divide-gray-100" data-testid={`product-requests-${branchId}`}>
        {rows.slice(0, 15).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" data-testid={`product-request-${r.id}`}>
            <span className="min-w-0">
              <span className="block font-medium"><bdi>{r.productName}</bdi>{r.source === 'EXCEL' ? <span className="ms-1 text-xs text-gray-500">(Excel)</span> : null}</span>
              {describeProductChange(r, t).map((line, i) => <span key={i} className="block text-xs text-gray-700">{line}</span>)}
              <span className="block text-xs text-gray-500">{dateTime(r.createdAt)}{r.decisionNote ? ` · ${r.decisionNote}` : ''}</span>
            </span>
            <span className="flex items-center gap-2">
              <Badge tone={TONE[r.status]}>{statusText(r.status)}</Badge>
              {r.status === 'PENDING' && r.kind !== 'NEW_PRODUCT' && <Button size="sm" loading={busy === r.id} onClick={() => withdraw(r.id)}>{t('Withdraw', 'سحب')}</Button>}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

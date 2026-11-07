'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, PageHeader, Tabs, useToast } from '../../../components/ui';
import { useLang } from '../../../lib/ui/lang';
import { useAdminPermission } from '../../../lib/auth/use-admin-permission';
import { apiErrorMessage } from '../../../lib/api/errors';
import { decideProductChangeRequest, listProductChangeRequests, type ProductChangeRequest } from '../../../lib/api/vendor-products';
import { describeProductChange } from '../../../lib/products/describe-change';

const KIND: Record<ProductChangeRequest['kind'], [string, string]> = { NEW_PRODUCT: ['New product', 'منتج جديد'], UPDATE: ['Price / details', 'السعر / التفاصيل'], OPTIONS: ['Options', 'الخيارات'] };

/**
 * R7 (decision register 2026-11-07): vendors' new products, price increases and product-detail / option changes wait here for Hatly. Approving
 * applies the change (a new product goes live as the vendor asked); rejecting changes nothing (a new product stays off). Price reductions and
 * stock never come here. Admin's own product edits apply directly.
 */
export default function ProductRequestsPage() {
  const { t, dateTime } = useLang();
  const canDecide = useAdminPermission('MANAGE_CATALOG') === true;
  const toast = useToast();
  const [status, setStatus] = useState('PENDING');
  const [rows, setRows] = useState<ProductChangeRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    setError(null);
    try { setRows(await listProductChangeRequests(status)); } catch (e) { setError(apiErrorMessage(e, t('Could not load the requests.', 'تعذّر تحميل الطلبات.'))); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  useEffect(() => { void load(); }, [load]);

  async function decide(r: ProductChangeRequest, decision: 'approve' | 'reject') {
    setBusy(r.id);
    try {
      await decideProductChangeRequest(r.id, decision, notes[r.id]);
      toast.push('success', decision === 'approve' ? t('Approved and applied.', 'تمت الموافقة والتطبيق.') : t('Rejected — nothing changed.', 'تم الرفض — لم يتغير شيء.'));
      await load();
    } catch (e) { toast.push('error', apiErrorMessage(e, t('The decision could not be saved.', 'تعذّر حفظ القرار.'))); await load(); } finally { setBusy(null); }
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t('Product requests', 'طلبات المنتجات')} subtitle={t('New products, price increases and changes to product details or options wait for Hatly. The live version stays until you approve.', 'المنتجات الجديدة وزيادات الأسعار وتغييرات التفاصيل أو الخيارات تنتظر هاتلي. تبقى النسخة الحالية حتى توافق.')} />
      <Tabs tabs={[{ id: 'PENDING', label: t('Waiting', 'بالانتظار') }, { id: 'APPROVED', label: t('Approved', 'موافق عليها') }, { id: 'REJECTED', label: t('Rejected', 'مرفوضة') }, { id: 'WITHDRAWN', label: t('Withdrawn', 'مسحوبة') }]} value={status} onChange={setStatus} />
      <Card pad={false}>
        {error && <p role="alert" className="p-4 text-sm text-red-700">{error}</p>}
        {!error && rows && rows.length === 0 && <p className="p-4 text-sm text-gray-500" data-testid="product-requests-empty">{t('No requests here.', 'لا توجد طلبات هنا.')}</p>}
        <ul className="divide-y divide-gray-100" data-testid="product-requests-list">
          {(rows ?? []).map((r) => (
            <li key={r.id} className="flex flex-col gap-2 p-4 text-sm lg:flex-row lg:items-start lg:justify-between" data-testid={`product-request-${r.id}`}>
              <div className="flex min-w-0 gap-3">
                {(r.payload?.imageUrl || r.current.imageUrl) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.payload?.imageUrl ?? r.current.imageUrl ?? ''} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />
                ) : null}
                <div className="min-w-0">
                  <p className="font-medium"><bdi>{r.productName}</bdi> <Badge tone="gray">{t(...KIND[r.kind])}</Badge>{r.source === 'EXCEL' ? <span className="ms-1 text-xs text-gray-500">Excel</span> : null}</p>
                  <p className="text-xs text-gray-500"><bdi>{r.vendorName}</bdi> · <bdi>{r.branchName}</bdi></p>
                  {describeProductChange(r, t).map((line, i) => <p key={i}>{line}</p>)}
                  {r.kind === 'NEW_PRODUCT' && r.current.description ? <p className="text-xs text-gray-600">{r.current.description}</p> : null}
                  <p className="text-xs text-gray-500">{t('Asked by', 'بواسطة')} {r.requestedBy} · {dateTime(r.createdAt)}</p>
                  {r.status !== 'PENDING' && <p className="text-xs text-gray-500">{r.decidedBy ? `${r.decidedBy} · ` : ''}{r.decidedAt ? dateTime(r.decidedAt) : ''}{r.decisionNote ? ` · ${r.decisionNote}` : ''}</p>}
                </div>
              </div>
              {r.status === 'PENDING' && canDecide ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input aria-label={t('Note (optional)', 'ملاحظة (اختيارية)')} placeholder={t('Note (optional)', 'ملاحظة (اختيارية)')} value={notes[r.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} className="min-h-[40px] w-48 rounded-lg border border-gray-300 px-2 text-sm" />
                  <Button variant="primary" size="sm" loading={busy === r.id} onClick={() => decide(r, 'approve')} data-testid={`approve-${r.id}`}>{t('Approve', 'موافقة')}</Button>
                  <Button size="sm" disabled={busy === r.id} onClick={() => decide(r, 'reject')} data-testid={`reject-${r.id}`}>{t('Reject', 'رفض')}</Button>
                </div>
              ) : <Badge tone={r.status === 'APPROVED' ? 'green' : r.status === 'REJECTED' ? 'red' : r.status === 'PENDING' ? 'amber' : 'gray'}>{r.status}</Badge>}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

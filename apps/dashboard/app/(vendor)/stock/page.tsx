'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, DataTable, FilterBar, KpiCard, LabeledInput, LabeledSelect, PageHeader, StatusPill, Tabs, useToast } from '../../../components/ui';
import { useLang } from '../../../lib/ui/lang';
import { apiErrorMessage } from '../../../lib/api/errors';
import { activateVendorProduct, deactivateVendorProduct, listVendorProducts, setVendorProductInventoryToZero, updateVendorProduct, type VendorProduct } from '../../../lib/api/vendor-products';
import { getVendorOverview, type VendorBranchSummary } from '../../../lib/api/vendor-business';

const LOW = 5;

/** Stock at a glance for one branch: what is tracked, what is low or out, and quick fixes (set the quantity, switch availability, mark out of stock). */
export default function VendorStockPage() {
  const { t, num, locale } = useLang();
  const toast = useToast();
  const [branches, setBranches] = useState<VendorBranchSummary[]>([]);
  const [branchId, setBranchId] = useState('');
  const [products, setProducts] = useState<VendorProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState('LOW');
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    getVendorOverview().then((o) => { setBranches(o.branches); if (o.branches[0]) setBranchId(o.branches[0].id); }).catch((e) => setError(apiErrorMessage(e, t('Could not load your branches.', 'تعذّر تحميل فروعك.'))));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const load = useCallback(async () => {
    if (!branchId) return;
    setError(null);
    try { setProducts(await listVendorProducts(branchId)); } catch (e) { setError(apiErrorMessage(e, t('Could not load the products.', 'تعذّر تحميل المنتجات.'))); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);
  useEffect(() => { void load(); }, [load]);

  const tracked = useMemo(() => (products ?? []).filter((p) => p.inventoryMode === 'TRACKED'), [products]);
  const out = tracked.filter((p) => (p.quantity ?? 0) <= 0);
  const low = tracked.filter((p) => (p.quantity ?? 0) > 0 && (p.quantity ?? 0) <= LOW);
  const rows = useMemo(() => {
    let r = products ?? [];
    if (view === 'LOW') r = [...out, ...low];
    else if (view === 'TRACKED') r = tracked;
    else if (view === 'HIDDEN') r = r.filter((p) => !p.isAvailable);
    if (q.trim()) r = r.filter((p) => `${p.name} ${p.nameAr ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
    return r;
  }, [products, view, q, out, low, tracked]);

  async function run(id: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(id);
    try { await fn(); toast.push('success', ok); setDraft((d) => { const n = { ...d }; delete n[id]; return n; }); await load(); } catch (e) { toast.push('error', apiErrorMessage(e, t('The change was refused.', 'تم رفض التغيير.'))); } finally { setBusy(null); }
  }

  return (
    <div>
      <PageHeader title={t('Stock', 'المخزون')} subtitle={t('Quantities are only counted for products you chose to track; other products are always orderable while available.', 'تُحسب الكميات للمنتجات التي اخترت تتبّعها فقط؛ أما الباقي فيمكن طلبه دائمًا ما دام متاحًا.')} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={t('Tracked products', 'منتجات متتبَّعة')} value={num(tracked.length)} />
        <KpiCard label={t('Out of stock', 'نفدت')} value={num(out.length)} tone={out.length ? 'bad' : 'neutral'} />
        <KpiCard label={t(`Low (≤ ${LOW})`, `منخفضة (≤ ${LOW})`)} value={num(low.length)} tone={low.length ? 'bad' : 'neutral'} />
        <KpiCard label={t('Hidden from customers', 'مخفية عن العملاء')} value={num((products ?? []).filter((p) => !p.isAvailable).length)} />
      </div>
      <Tabs value={view} onChange={setView} tabs={[{ id: 'LOW', label: t('Needs attention', 'تحتاج انتباهًا') }, { id: 'TRACKED', label: t('All tracked', 'كل المتتبَّعة') }, { id: 'HIDDEN', label: t('Hidden', 'المخفية') }, { id: 'ALL', label: t('All products', 'كل المنتجات') }]} />
      <FilterBar>
        {branches.length > 1 && <div className="w-56"><LabeledSelect label={t('Branch', 'الفرع')} value={branchId} onChange={(e) => setBranchId(e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</LabeledSelect></div>}
        <div className="w-64"><LabeledInput label={t('Product name', 'اسم المنتج')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </FilterBar>
      <Card pad={false}>
        <DataTable rows={products ? rows : undefined} rowKey={(p) => p.id} loading={products === null && !error} error={error} onRetry={load} emptyTitle={view === 'LOW' ? t('Nothing is low or out of stock.', 'لا يوجد ما هو منخفض أو نافد.') : t('No products here.', 'لا توجد منتجات.')} columns={[
          { key: 'n', header: t('Product', 'المنتج'), cell: (p) => <bdi className="font-medium">{p.nameAr && locale === 'ar' ? p.nameAr : p.name}</bdi> },
          { key: 'm', header: t('Counting', 'الاحتساب'), cell: (p) => (p.inventoryMode === 'TRACKED' ? t('Tracked', 'متتبَّع') : t('Not counted', 'بدون عدّ')) },
          { key: 'q', header: t('Quantity', 'الكمية'), cell: (p) => p.inventoryMode === 'TRACKED' ? (
            <span className="flex items-center gap-1">
              <input aria-label={t(`Quantity of ${p.name}`, `كمية ${p.name}`)} type="number" min={0} className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm" value={draft[p.id] ?? String(p.quantity ?? 0)} onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.value }))} />
              <Button size="sm" disabled={busy === p.id || draft[p.id] === undefined || !/^\d+$/.test(draft[p.id])} onClick={() => run(p.id, () => updateVendorProduct(p.id, { quantity: Number(draft[p.id]) }), t('Quantity saved.', 'تم حفظ الكمية.'))}>{t('Save', 'حفظ')}</Button>
            </span>
          ) : '—' },
          { key: 's', header: t('Status', 'الحالة'), cell: (p) => (p.inventoryMode === 'TRACKED' && (p.quantity ?? 0) <= 0 ? <StatusPill status="OUT_OF_STOCK" /> : p.isAvailable ? <StatusPill status="ACTIVE" /> : <StatusPill status="HIDDEN" />) },
          { key: 'a', header: '', align: 'end', cell: (p) => (
            <span className="flex flex-wrap justify-end gap-1">
              {p.isAvailable
                ? <Button size="sm" disabled={busy === p.id} onClick={() => run(p.id, () => deactivateVendorProduct(p.id), t('Hidden from customers.', 'تم إخفاؤه عن العملاء.'))}>{t('Hide', 'إخفاء')}</Button>
                : <Button size="sm" disabled={busy === p.id} onClick={() => run(p.id, () => activateVendorProduct(p.id), t('Visible to customers.', 'أصبح ظاهرًا للعملاء.'))}>{t('Show', 'إظهار')}</Button>}
              {p.inventoryMode === 'TRACKED' && (p.quantity ?? 0) > 0 && <Button size="sm" disabled={busy === p.id} onClick={() => run(p.id, () => setVendorProductInventoryToZero(p.id), t('Marked out of stock.', 'تم تعليمه كنافد.'))}>{t('Out of stock', 'نفد')}</Button>}
            </span>
          ) },
        ]} />
      </Card>
    </div>
  );
}

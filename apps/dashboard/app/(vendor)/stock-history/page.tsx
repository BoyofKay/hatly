'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Column, ConfirmDialog, DataTable, DateRange, EmptyState, ErrorState, FilterBar, KpiCard, LabeledInput, LabeledSelect, Modal, PageHeader, Pagination, Skeleton, Tabs, useDebounced, usePaging, useToast } from '../../../components/ui';
import { useLang } from '../../../lib/ui/lang';
import { apiErrorMessage } from '../../../lib/api/errors';
import { getVendorOverview, type VendorBranchSummary } from '../../../lib/api/vendor-business';
import {
  applyStocktake, cancelStocktake, getMovements, getStocktake, listStocktakes, setStocktakeCount, startStocktake,
  type MovementReason, type StockMovement, type StocktakeDetail, type StocktakeSummaryRow,
} from '../../../lib/api/vendor-operations';

const REASONS: Array<[MovementReason, string, string]> = [
  ['ORDER_PLACED', 'Order placed', 'طلب جديد'], ['ORDER_CANCELLED', 'Order cancelled (stock returned)', 'إلغاء طلب (رجوع المخزون)'], ['MANUAL_ADJUSTMENT', 'Manual adjustment', 'تعديل يدوي'],
  ['SET_TO_ZERO', 'Set to zero', 'تصفير'], ['STOCKTAKE', 'Stocktake', 'جرد'], ['IMPORT', 'Excel import', 'استيراد إكسل'], ['INITIAL_STOCK', 'Initial stock', 'رصيد افتتاحي'], ['UNATTRIBUTED', 'Source not recorded', 'المصدر غير مسجَّل'],
];

/**
 * Stock history: the movement ledger (every change of a tracked product's quantity, with before/after, the reason, the order or stocktake it came from
 * and who did it) and stocktakes (count the shelves, see the variance, apply). History from before the ledger existed is not shown and not invented —
 * the page says from when it is complete. Nothing here deducts or restores stock by itself.
 */
export default function StockHistoryPage() {
  const { t } = useLang();
  const [tab, setTab] = useState('movements');
  const [branches, setBranches] = useState<VendorBranchSummary[]>([]);
  useEffect(() => { getVendorOverview().then((o) => setBranches(o.branches)).catch(() => undefined); }, []);
  return (
    <div className="space-y-4">
      <PageHeader title={t('Stock history', 'سجل المخزون')} subtitle={t('Every change to tracked stock, who made it and why — and a stocktake to check the shelves against the system.', 'كل تغيير في المخزون المتتبَّع، ومن أجراه ولماذا — وجرد لمقارنة الرفوف بالنظام.')} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'movements', label: t('Movements', 'الحركات') }, { id: 'stocktake', label: t('Stocktake', 'الجرد') }]} />
      {tab === 'movements' ? <Movements branches={branches} /> : <Stocktakes branches={branches} />}
    </div>
  );
}

function Movements({ branches }: { branches: VendorBranchSummary[] }) {
  const { t, num, dateTime, locale } = useLang();
  const [branchId, setBranchId] = useState('');
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const q = useDebounced(search);
  const { page, setPage, limit } = usePaging(`${branchId}|${reason}|${q}|${from}|${to}`);
  const [data, setData] = useState<{ items: StockMovement[]; startedAt: string | null; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await getMovements({ branchId: branchId || undefined, reason: reason || undefined, search: q || undefined, from: from || undefined, to: to || undefined, page, limit })); }
    catch (e) { setError(apiErrorMessage(e, t('Could not load the stock history.', 'تعذّر تحميل سجل المخزون.'))); }
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, reason, q, from, to, page, limit]);
  useEffect(() => { void load(); }, [load]);

  const reasonLabel = (r: MovementReason) => { const x = REASONS.find((v) => v[0] === r); return x ? t(x[1], x[2]) : r; };
  const columns: Column<StockMovement>[] = [
    { key: 'when', header: t('When', 'الوقت'), cell: (m) => <span className="whitespace-nowrap text-gray-600">{dateTime(m.occurredAt)}</span> },
    { key: 'product', header: t('Product', 'المنتج'), cell: (m) => <bdi className="font-medium">{locale === 'ar' && m.productNameAr ? m.productNameAr : m.productName}</bdi> },
    { key: 'reason', header: t('Why', 'السبب'), cell: (m) => <span><Badge tone={m.reason === 'UNATTRIBUTED' ? 'amber' : m.delta < 0 ? 'orange' : 'blue'}>{reasonLabel(m.reason)}</Badge>{m.reference?.orderNumber && <span className="ms-2 font-mono text-xs text-gray-600" dir="ltr">{m.reference.orderNumber}</span>}</span> },
    { key: 'qty', header: t('Before → after', 'قبل ← بعد'), align: 'end', cell: (m) => <span dir="ltr" className="tabular-nums text-gray-600">{m.beforeQuantity === null ? '—' : num(m.beforeQuantity)} → {m.afterQuantity === null ? '—' : num(m.afterQuantity)}</span> },
    { key: 'delta', header: t('Change', 'التغيير'), align: 'end', cell: (m) => <span dir="ltr" className={`font-semibold tabular-nums ${m.delta < 0 ? 'text-red-700' : 'text-green-700'}`}>{m.delta > 0 ? '+' : ''}{num(m.delta)}</span> },
    { key: 'by', header: t('By', 'بواسطة'), cell: (m) => (m.actorName ? <bdi>{m.actorName}</bdi> : m.sourceCaptured ? <span className="text-gray-500">{m.reason === 'ORDER_PLACED' ? t('Customer order', 'طلب عميل') : t('System', 'النظام')}</span> : <span className="text-amber-700">{t('Not recorded', 'غير مسجَّل')}</span>) },
  ];
  return (
    <div className="space-y-3">
      {data?.startedAt && <p className="rounded-lg bg-blue-50 p-3 text-xs text-blue-900" data-testid="ledger-started">{t('This history is complete from', 'هذا السجل مكتمل ابتداءً من')} {dateTime(data.startedAt)}. {t('Earlier stock changes were not recorded and are not shown.', 'لم تُسجَّل تغييرات المخزون السابقة ولا تُعرض.')}</p>}
      <FilterBar onClear={search || reason || branchId || from || to ? () => { setSearch(''); setReason(''); setBranchId(''); setFrom(''); setTo(''); } : undefined}>
        <div className="min-w-[14rem] flex-1"><LabeledInput label={t('Search', 'بحث')} placeholder={t('Product name or order number', 'اسم المنتج أو رقم الطلب')} value={search} onChange={(e) => setSearch(e.target.value)} data-testid="movements-search" /></div>
        {branches.length > 1 && <div className="w-48"><LabeledSelect label={t('Branch', 'الفرع')} value={branchId} onChange={(e) => setBranchId(e.target.value)}><option value="">{t('All branches', 'كل الفروع')}</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</LabeledSelect></div>}
        <div className="w-56"><LabeledSelect label={t('Why', 'السبب')} value={reason} onChange={(e) => setReason(e.target.value)}><option value="">{t('Any reason', 'أي سبب')}</option>{REASONS.map(([v, en, ar]) => <option key={v} value={v}>{t(en, ar)}</option>)}</LabeledSelect></div>
        <DateRange from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); }} />
      </FilterBar>
      <Card pad={false}>
        <DataTable columns={columns} rows={data?.items} rowKey={(m) => m.id} loading={loading} error={error} onRetry={load} emptyTitle={t('No stock movements match.', 'لا توجد حركات مخزون مطابقة.')} emptyHint={t('Only products with tracked stock appear here.', 'تظهر هنا المنتجات ذات المخزون المتتبَّع فقط.')}
          renderCard={(m) => (
            <div className="space-y-1">
              <div className="flex items-start justify-between gap-2"><bdi className="font-medium">{locale === 'ar' && m.productNameAr ? m.productNameAr : m.productName}</bdi><span dir="ltr" className={`shrink-0 font-semibold tabular-nums ${m.delta < 0 ? 'text-red-700' : 'text-green-700'}`}>{m.delta > 0 ? '+' : ''}{num(m.delta)}</span></div>
              <p className="flex flex-wrap items-center gap-1.5 text-xs"><Badge tone={m.reason === 'UNATTRIBUTED' ? 'amber' : m.delta < 0 ? 'orange' : 'blue'}>{reasonLabel(m.reason)}</Badge>{m.reference?.orderNumber && <span className="font-mono text-gray-600" dir="ltr">{m.reference.orderNumber}</span>}</p>
              <p className="text-xs text-gray-500"><span dir="ltr">{m.beforeQuantity === null ? '—' : num(m.beforeQuantity)} → {m.afterQuantity === null ? '—' : num(m.afterQuantity)}</span> · {dateTime(m.occurredAt)} · {m.actorName ?? (m.sourceCaptured ? t('System', 'النظام') : t('Not recorded', 'غير مسجَّل'))}</p>
            </div>
          )} />
        {data && data.items.length > 0 && <Pagination page={page} limit={limit} total={data.total} onPage={setPage} />}
      </Card>
    </div>
  );
}

function Stocktakes({ branches }: { branches: VendorBranchSummary[] }) {
  const { t, num, dateTime, locale } = useLang();
  const toast = useToast();
  const [list, setList] = useState<{ items: StocktakeSummaryRow[]; canApply: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [branchId, setBranchId] = useState('');
  const [note, setNote] = useState('');
  const [startError, setStartError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { try { setList(await listStocktakes()); setError(null); } catch (e) { setError(apiErrorMessage(e, t('Could not load the stocktakes.', 'تعذّر تحميل عمليات الجرد.'))); } }, [t]);
  useEffect(() => { void load(); }, [load]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setStartError(null);
    try { const r = await startStocktake({ branchId: branchId || branches[0]?.id, note: note.trim() || undefined }); setStartOpen(false); setNote(''); await load(); setOpenId(r.id); }
    catch (err) { setStartError(apiErrorMessage(err, t('The stocktake could not be started.', 'تعذّر بدء الجرد.'))); } finally { setBusy(false); }
  }
  const statusLabel = { OPEN: t('In progress', 'قيد التنفيذ'), APPLIED: t('Applied', 'مُطبَّق'), CANCELLED: t('Cancelled', 'ملغى') } as const;

  if (openId) return <StocktakeDetailView id={openId} onBack={() => { setOpenId(null); void load(); }} />;
  return (
    <div className="space-y-3">
      <Card title={t('Stocktakes', 'عمليات الجرد')} actions={<Button variant="primary" size="sm" className="min-h-[36px]" onClick={() => { setBranchId(branches[0]?.id ?? ''); setStartError(null); setStartOpen(true); }} data-testid="stocktake-start">{t('Start a stocktake', 'بدء جرد')}</Button>} pad={false}>
        {error ? <ErrorState message={error} onRetry={load} /> : !list ? <div className="p-4"><Skeleton className="h-16" /></div> : list.items.length === 0 ? <EmptyState title={t('No stocktakes yet', 'لا توجد عمليات جرد بعد')} hint={t('A stocktake lists the tracked products of a branch so you can enter what is really on the shelves.', 'يعرض الجرد منتجات الفرع المتتبَّعة لتُدخل ما هو موجود فعلًا على الرفوف.')} /> : (
          <ul className="divide-y divide-gray-100">
            {list.items.map((s) => (
              <li key={s.id}><button onClick={() => setOpenId(s.id)} className="flex min-h-[56px] w-full flex-wrap items-center justify-between gap-2 px-4 py-2 text-start hover:bg-gray-50">
                <span><Badge tone={s.status === 'OPEN' ? 'amber' : s.status === 'APPLIED' ? 'green' : 'gray'}>{statusLabel[s.status]}</Badge> <bdi className="ms-1 font-medium">{s.branchName}</bdi><span className="block text-xs text-gray-500">{dateTime(s.createdAt)} · <bdi>{s.createdBy}</bdi>{s.note ? ` · ${s.note}` : ''}</span></span>
                <span className="text-xs tabular-nums text-gray-600">{t(`${num(s.counted)} of ${num(s.lines)} counted`, `تم عدّ ${num(s.counted)} من ${num(s.lines)}`)}</span>
              </button></li>
            ))}
          </ul>
        )}
      </Card>
      <Modal open={startOpen} title={t('Start a stocktake', 'بدء جرد')} onClose={() => !busy && setStartOpen(false)} footer={<><Button onClick={() => setStartOpen(false)} disabled={busy}>{t('Cancel', 'إلغاء')}</Button><Button variant="primary" type="submit" form="st-start" loading={busy}>{t('Start', 'بدء')}</Button></>}>
        <form id="st-start" onSubmit={start} className="space-y-3">
          {branches.length > 1 && <LabeledSelect label={t('Branch', 'الفرع')} value={branchId} onChange={(e) => setBranchId(e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</LabeledSelect>}
          <LabeledInput label={t('Note (optional)', 'ملاحظة (اختياري)')} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          <p className="text-xs text-gray-500">{t('The system records today’s expected quantity for every tracked product. Sales made while you count are kept when the count is applied.', 'يسجّل النظام الكمية المتوقعة اليوم لكل منتج متتبَّع. تُحفظ المبيعات التي تتم أثناء العدّ عند تطبيق الجرد.')}</p>
          {startError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{startError}</p>}
        </form>
      </Modal>
    </div>
  );

  // (the detail view is its own component so its inputs keep their state while the list reloads)
  void toast; void locale;
}

function StocktakeDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const { t, num, dateTime, locale } = useLang();
  const toast = useToast();
  const [d, setD] = useState<StocktakeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<'apply' | 'cancel' | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => { try { const x = await getStocktake(id); setD(x); setDraft(Object.fromEntries(x.items.map((i) => [i.productId, i.counted === null ? '' : String(i.counted)]))); setError(null); } catch (e) { setError(apiErrorMessage(e, t('Could not load the stocktake.', 'تعذّر تحميل الجرد.'))); } }, [id, t]);
  useEffect(() => { void load(); }, [load]);

  async function save(productId: string) {
    const raw = (draft[productId] ?? '').trim();
    const current = d?.items.find((i) => i.productId === productId)?.counted;
    if ((raw === '' ? null : Number(raw)) === current) return;
    if (raw !== '' && !/^\d+$/.test(raw)) { toast.push('error', t('Enter a whole number, 0 or more.', 'أدخل عددًا صحيحًا، 0 أو أكثر.')); return; }
    try { await setStocktakeCount(id, productId, raw === '' ? null : Number(raw)); await load(); } catch (e) { toast.push('error', apiErrorMessage(e, t('The count was not saved.', 'لم يُحفظ العدّ.'))); }
  }
  async function run() {
    if (!confirm || busy) return;
    setBusy(true); setActionError(null);
    try {
      if (confirm === 'apply') { const r = await applyStocktake(id); toast.push('success', t(`Stocktake applied — ${num(r.adjusted)} product(s) adjusted.`, `تم تطبيق الجرد — تم تعديل ${num(r.adjusted)} منتج.`)); }
      else { await cancelStocktake(id); toast.push('success', t('Stocktake cancelled. Stock was not changed.', 'تم إلغاء الجرد. لم يتغير المخزون.')); }
      setConfirm(null); await load();
    } catch (e) { setActionError(apiErrorMessage(e, t('The action was refused.', 'تم رفض الإجراء.'))); } finally { setBusy(false); }
  }

  if (error) return <div className="space-y-3"><Button onClick={onBack}>{t('Back', 'رجوع')}</Button><ErrorState message={error} onRetry={load} /></div>;
  if (!d) return <Skeleton className="h-40" />;
  const open = d.status === 'OPEN';
  const rows = d.items.filter((i) => !filter.trim() || (i.name + ' ' + (i.nameAr ?? '')).toLowerCase().includes(filter.trim().toLowerCase()));
  const unit = (p: string) => (p === 'WEIGHT' ? t('g', 'جم') : '');
  return (
    <div className="space-y-3" data-testid="stocktake-detail">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button onClick={onBack}>← {t('All stocktakes', 'كل عمليات الجرد')}</Button>
        <span className="text-sm text-gray-600"><bdi className="font-medium">{d.branchName}</bdi> · {dateTime(d.createdAt)} · <Badge tone={open ? 'amber' : d.status === 'APPLIED' ? 'green' : 'gray'}>{open ? t('In progress', 'قيد التنفيذ') : d.status === 'APPLIED' ? t('Applied', 'مُطبَّق') : t('Cancelled', 'ملغى')}</Badge></span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label={t('Counted', 'تم عدّه')} value={`${num(d.summary.counted)} / ${num(d.summary.lines)}`} />
        <KpiCard label={t('Not counted yet', 'لم يُعد بعد')} value={num(d.summary.uncounted)} tone={open && d.summary.uncounted > 0 ? 'neutral' : 'good'} />
        <KpiCard label={t('With a difference', 'بها فرق')} value={num(d.summary.withVariance)} tone={d.summary.withVariance > 0 ? 'bad' : 'good'} />
        <KpiCard label={t('Net difference', 'صافي الفرق')} value={<span dir="ltr">{d.summary.netVariance > 0 ? '+' : ''}{num(d.summary.netVariance)}</span>} />
      </div>
      <Card pad={false} title={t('Variance report', 'تقرير الفروقات')} actions={<input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('Filter products', 'تصفية المنتجات')} aria-label={t('Filter products', 'تصفية المنتجات')} className="rounded-lg border border-gray-300 px-2 py-1 text-sm" />}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead><tr className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500"><th className="px-3 py-2 text-start font-medium">{t('Product', 'المنتج')}</th><th className="px-3 py-2 text-end font-medium">{t('Expected', 'المتوقع')}</th><th className="px-3 py-2 text-end font-medium">{t('Counted', 'المعدود')}</th><th className="px-3 py-2 text-end font-medium">{t('Difference', 'الفرق')}</th></tr></thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.productId} className="border-b border-gray-100" data-testid={`st-line-${i.productId}`}>
                  <td className="px-3 py-2"><bdi className="font-medium">{locale === 'ar' && i.nameAr ? i.nameAr : i.name}</bdi>{i.movedSinceStart && <span className="ms-2 text-xs text-amber-700" title={t('The quantity changed after the count started (a sale or an edit).', 'تغيرت الكمية بعد بدء العدّ (بيع أو تعديل).')}>{t(`now ${num(i.currentQuantity)}`, `الآن ${num(i.currentQuantity)}`)}</span>}</td>
                  <td className="px-3 py-2 text-end tabular-nums" dir="ltr">{num(i.expected)} {unit(i.pricingUnit)}</td>
                  <td className="px-3 py-2 text-end">{open ? <input data-testid={`st-count-${i.productId}`} inputMode="numeric" dir="ltr" value={draft[i.productId] ?? ''} onChange={(e) => setDraft((x) => ({ ...x, [i.productId]: e.target.value }))} onBlur={() => void save(i.productId)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label={t(`Counted quantity of ${i.name}`, `الكمية المعدودة من ${i.nameAr ?? i.name}`)} className="min-h-[40px] w-24 rounded-lg border border-gray-300 px-2 py-1 text-end tabular-nums" /> : <span className="tabular-nums" dir="ltr">{i.counted === null ? '—' : num(i.counted)}</span>}</td>
                  <td className="px-3 py-2 text-end tabular-nums" dir="ltr">{i.variance === null ? <span className="text-gray-400">—</span> : <span className={`font-semibold ${i.variance === 0 ? 'text-gray-500' : i.variance < 0 ? 'text-red-700' : 'text-green-700'}`}>{i.variance > 0 ? '+' : ''}{num(i.variance)}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {open && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-xl text-xs text-gray-500">{t('Applying moves each counted product by (counted − expected). Sales and returns since the count started are kept. Products you did not count are not changed. Only a branch manager applies a stocktake.', 'يحرّك التطبيق كل منتج معدود بمقدار (المعدود − المتوقع). تُحفظ المبيعات والمرتجعات منذ بدء العدّ. المنتجات التي لم تُعدّ لا تتغير. يطبّق الجرد مدير الفرع وحده.')}</p>
          <span className="flex gap-2"><Button onClick={() => { setActionError(null); setConfirm('cancel'); }}>{t('Cancel stocktake', 'إلغاء الجرد')}</Button>{d.canApply && <Button variant="primary" onClick={() => { setActionError(null); setConfirm('apply'); }} data-testid="stocktake-apply" disabled={d.summary.counted === 0}>{t('Apply stocktake', 'تطبيق الجرد')}</Button>}</span>
        </div>
      )}
      <ConfirmDialog open={!!confirm} title={confirm === 'apply' ? t('Apply this stocktake?', 'تطبيق هذا الجرد؟') : t('Cancel this stocktake?', 'إلغاء هذا الجرد؟')}
        message={confirm === 'apply' ? t(`${num(d.summary.withVariance)} product(s) will change by their difference and each change is written to the stock history. This cannot be undone (a later stocktake can correct it).`, `سيتغير ${num(d.summary.withVariance)} منتج بمقدار فرقه، ويُكتب كل تغيير في سجل المخزون. لا يمكن التراجع (يمكن لجرد لاحق تصحيحه).`) : t('The counts are discarded and stock is not changed.', 'تُهمل الأعداد ولا يتغير المخزون.')}
        confirmLabel={confirm === 'apply' ? t('Apply', 'تطبيق') : t('Cancel stocktake', 'إلغاء الجرد')} danger={confirm === 'cancel'} busy={busy} error={actionError} onConfirm={() => void run()} onClose={() => setConfirm(null)} />
    </div>
  );
}

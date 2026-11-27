'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, ConfirmDialog, DataTable, FilterBar, KpiCard, LabeledInput, LabeledSelect, Modal, PageHeader, Pagination, StatusPill, useDebounced, usePaging, useToast } from '../../../components/ui';
import { ICONS } from '../../../components/ui/icons';
import { send, useApi } from '../../../lib/ui/api';
import { apiErrorMessage } from '../../../lib/api/errors';
import { resolveMediaUrl } from '../../../lib/media-url';
import { useLang } from '../../../lib/ui/lang';
import { usePermissions } from '../../../lib/ui/permissions';
import Link from 'next/link';
import { DeleteRecordButton } from '../../../components/admin/DeleteRecordButton';
import { ProductImages } from '../../../components/admin/ProductImages';
import { BulkItemPhotos } from '../../../components/admin/BulkItemPhotos';
import { MenuImportPanel } from '../../../components/admin/MenuImportPanel';
import { MediaPicker } from '../../../components/media/MediaPicker';
import { ExportButton } from '../../../components/reports/ExportButton';

export default function ProductsPage() {
  const { t, money, num } = useLang();
  const { can } = usePermissions();
  const toast = useToast();
  const [q, setQ] = useState('');
  // Quick find (Ctrl+K) opens this page with the search term already in the box.
  useEffect(() => { const v = new URLSearchParams(window.location.search).get('q'); if (v) setQ(v); }, []);
  const [branch, setBranch] = useState('');
  const [excelOpen, setExcelOpen] = useState(false);
  const [excelBranch, setExcelBranch] = useState('');
  const [state, setState] = useState('');
  useEffect(() => { const v = new URLSearchParams(window.location.search).get('state'); if (v) setState(v); }, []);
  useEffect(() => { const v = new URLSearchParams(window.location.search).get('branch'); if (v) setBranch(v); }, []);
  const [active, setActive] = useState('');
  const [hasImage, setHasImage] = useState('');
  const [sort, setSort] = useState('name:asc');
  const search = useDebounced(q);
  const { page, setPage, limit } = usePaging(JSON.stringify([search, branch, state, active, hasImage, sort]));
  const branches = useApi<any[]>('/admin/branch-directory', { limit: 100 });
  // Header figures: the inventory board's stock-state counts and the directory's own total of products without an image — both whole-catalogue, unfiltered.
  const board = useApi<any>('/admin/inventory-board');
  const noImage = useApi<any[]>('/admin/product-directory', { hasImage: 'false', limit: 1 });
  const counts = board.data?.counts;
  const totalProducts = counts ? counts.ok + counts.low + counts.out + counts.unlimited : null;
  const list = useApi<any[]>('/admin/product-directory', { q: search || undefined, vendorBranchId: branch || undefined, state: state || undefined, active: active || undefined, hasImage: hasImage || undefined, sort, page, limit });
  const [sel, setSel] = useState<string[]>([]);
  const [bulk, setBulk] = useState<{ action: string } | null>(null);
  const [pct, setPct] = useState('10');
  const [qty, setQty] = useState('0');
  const [preview, setPreview] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgProduct, setImgProduct] = useState<any>(null);
  const [photosOpen, setPhotosOpen] = useState(false);
  const [photosBranch, setPhotosBranch] = useState('');
  const canEdit = can('MANAGE_CATALOG');
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < 50 ? [...s, id] : s));
  const bodyFor = (dry: boolean) => ({ ids: sel, action: bulk!.action, params: bulk!.action === 'PRICE_PERCENT' ? { percent: Number(pct) } : bulk!.action === 'SET_STOCK' ? { quantity: Number(qty) } : undefined, confirmCount: sel.length, dryRun: dry });
  const runPreview = async () => { setBusy(true); setError(null); try { setPreview((await send<any>('post', '/admin/products/bulk', bodyFor(true))).results); } catch (e) { setError(apiErrorMessage(e, t('Preview failed.', 'فشلت المعاينة.'))); } finally { setBusy(false); } };
  const apply = async () => { setBusy(true); setError(null); try { const r = await send<any>('post', '/admin/products/bulk', bodyFor(false)); const failed = r.results.filter((x: any) => !x.ok).length; toast.push(failed ? 'info' : 'success', t(`${r.results.length - failed} updated, ${failed} not changed.`, `تم تحديث ${r.results.length - failed}، ولم يتغير ${failed}.`)); setBulk(null); setPreview(null); setSel([]); list.reload(); } catch (e) { setError(apiErrorMessage(e, t('The bulk action failed.', 'فشل الإجراء الجماعي.'))); } finally { setBusy(false); } };

  return (
    <div>
      <PageHeader title={t('Products', 'المنتجات')} subtitle={t('All products across vendors. Select up to 50 for a bulk action with a before/after preview. Images are managed through the media library.', 'كل المنتجات عبر الموردين. حدد حتى 50 لإجراء جماعي مع معاينة قبل/بعد. تُدار الصور عبر مكتبة الوسائط.')} actions={<span className="flex flex-wrap gap-2">{can('MANAGE_CATALOG') && <Button onClick={() => { setPhotosBranch(branch); setPhotosOpen(true); }} data-testid="open-bulk-photos">{t('Add many photos', 'إضافة صور كثيرة')}</Button>}{can('MANAGE_CATALOG') && <Button variant="primary" onClick={() => { setExcelBranch(branch); setExcelOpen(true); }}>{t('Excel: update / add products', 'إكسل: تعديل / إضافة منتجات')}</Button>}{can('CATALOG_EXPORT') && <ExportButton report="S07" params={{ vendorBranchId: branch || undefined, state: state || undefined }} />}</span>} />
      <Modal open={excelOpen} title={t('Products by Excel', 'المنتجات عبر الإكسل')} onClose={() => setExcelOpen(false)}>
        <div className="space-y-3">
          <p className="text-sm text-gray-600">{t('Choose the branch, download its sheet (it already lists every product with its current price, names, stock and availability), change what you need, then upload it. Rows with a productId update that product; rows without one add a new product.', 'اختر الفرع ونزّل ملفه (فيه كل المنتجات بأسعارها وأسمائها ومخزونها وحالتها الحالية)، عدّل ما تريد ثم ارفعه. الصف الذي به productId يعدّل المنتج، والصف بدونه يضيف منتجًا جديدًا.')}</p>
          <LabeledSelect label={t('Branch', 'الفرع')} value={excelBranch} onChange={(e) => setExcelBranch(e.target.value)}><option value="">{t('Choose a branch…', 'اختر فرعًا…')}</option>{(branches.data ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.vendorName} — {b.name}</option>)}</LabeledSelect>
          {excelBranch && <MenuImportPanel key={excelBranch} branchId={excelBranch} branchName={(() => { const b = (branches.data ?? []).find((x: any) => x.id === excelBranch); return b ? `${b.vendorName} — ${b.name}` : ''; })()} onImported={() => list.reload()} />}
        </div>
      </Modal>
      {counts && (
        <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="catalog-kpis">
          {[
            { id: 'all', label: t('All products', 'كل المنتجات'), value: num(totalProducts), icon: ICONS.box, on: () => { setState(''); setHasImage(''); } },
            { id: 'low', label: t('Low stock', 'مخزون منخفض'), value: num(counts.low), icon: ICONS.alert, tone: counts.low > 0 ? 'bad' as const : undefined, on: () => { setHasImage(''); setState('LOW'); } },
            { id: 'out', label: t('Out of stock', 'نفد المخزون'), value: num(counts.out), icon: ICONS.empty, tone: counts.out > 0 ? 'bad' as const : undefined, on: () => { setHasImage(''); setState('OUT'); } },
            { id: 'noimg', label: t('Without a photo', 'بلا صورة'), value: noImage.meta ? num(noImage.meta.total) : '—', icon: ICONS.image, on: () => { setState(''); setHasImage('false'); } },
          ].map((k) => (
            <button key={k.id} type="button" onClick={k.on} className="rounded-2xl text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange" aria-label={`${k.label}: ${k.value}`}>
              <KpiCard label={k.label} value={k.value} icon={k.icon} tone={k.tone} testId={`catalog-kpi-${k.id}`} />
            </button>
          ))}
        </div>
      )}
      <FilterBar onClear={() => { setQ(''); setBranch(''); setState(''); setActive(''); setHasImage(''); }}>
        <div className="w-52"><LabeledInput label={t('Search', 'بحث')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="w-56"><LabeledSelect label={t('Vendor branch', 'فرع المورد')} value={branch} onChange={(e) => setBranch(e.target.value)}><option value="">{t('All', 'الكل')}</option>{(branches.data ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.vendorName} — {b.name}</option>)}</LabeledSelect></div>
        <div className="w-40"><LabeledSelect label={t('Stock', 'المخزون')} value={state} onChange={(e) => setState(e.target.value)}><option value="">{t('All', 'الكل')}</option><option value="OK">OK</option><option value="LOW">{t('Low', 'منخفض')}</option><option value="OUT">{t('Out', 'نفد')}</option><option value="UNLIMITED">{t('Unlimited', 'غير محدود')}</option></LabeledSelect></div>
        <div className="w-36"><LabeledSelect label={t('Available', 'متاح')} value={active} onChange={(e) => setActive(e.target.value)}><option value="">{t('All', 'الكل')}</option><option value="true">{t('Yes', 'نعم')}</option><option value="false">{t('No', 'لا')}</option></LabeledSelect></div>
        <div className="w-36"><LabeledSelect label={t('Image', 'الصورة')} value={hasImage} onChange={(e) => setHasImage(e.target.value)}><option value="">{t('All', 'الكل')}</option><option value="true">{t('Has image', 'لها صورة')}</option><option value="false">{t('No image', 'بلا صورة')}</option></LabeledSelect></div>
        <div className="w-40"><LabeledSelect label={t('Sort', 'الترتيب')} value={sort} onChange={(e) => setSort(e.target.value)}><option value="name:asc">{t('Name A→Z', 'الاسم أ→ي')}</option><option value="price:desc">{t('Price high→low', 'السعر الأعلى')}</option><option value="price:asc">{t('Price low→high', 'السعر الأقل')}</option><option value="stock:asc">{t('Stock low→high', 'المخزون الأقل')}</option><option value="updated:desc">{t('Recently updated', 'الأحدث تعديلًا')}</option></LabeledSelect></div>
      </FilterBar>
      {canEdit && sel.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-sm">
          <strong>{num(sel.length)}</strong> {t('selected', 'محدد')} <span className="text-xs text-gray-500">(max 50)</span>
          {[['ACTIVATE', 'Make available', 'إتاحة'], ['DEACTIVATE', 'Make unavailable', 'إيقاف'], ['SET_STOCK', 'Set stock…', 'ضبط المخزون…'], ['PRICE_PERCENT', 'Change price %…', 'تغيير السعر %…']].map(([a, en, ar]) => <Button key={a} size="sm" onClick={() => { setError(null); setPreview(null); setBulk({ action: a }); }}>{t(en, ar)}</Button>)}
          <Button size="sm" variant="ghost" onClick={() => setSel([])}>{t('Clear', 'مسح')}</Button>
        </div>
      )}
      <Card pad={false}>
        <DataTable rows={list.data} rowKey={(r) => r.id} loading={list.loading} error={list.error} status={list.status} onRetry={list.reload} emptyTitle={t('No products match', 'لا توجد منتجات مطابقة')} columns={[
          ...(canEdit ? [{ key: 'sel', header: '', cell: (r: any) => <input type="checkbox" aria-label={t('Select', 'تحديد')} checked={sel.includes(r.id)} onChange={() => toggle(r.id)} /> }] : []),
          { key: 'img', header: '', cell: (r: any) => (r.imageUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={resolveMediaUrl(r.imageUrl)} alt="" loading="lazy" className="h-10 w-10 rounded bg-gray-100 object-cover" onError={(e) => { e.currentTarget.style.opacity = '0'; e.currentTarget.title = 'Image missing'; }} /> : <span className="flex h-10 w-10 items-center justify-center rounded bg-gray-100 text-xs text-gray-400">—</span>) },
          { key: 'n', header: t('Product', 'المنتج'), cell: (r: any) => <span><bdi className="font-medium">{r.name}</bdi><span className="block text-xs text-gray-500"><bdi>{r.vendorName} — {r.branchName}</bdi></span></span> },
          { key: 'p', header: t('Price', 'السعر'), align: 'end', cell: (r: any) => money(r.priceMinor) },
          { key: 'st', header: t('Stock', 'المخزون'), cell: (r: any) => <span className="flex items-center gap-1"><StatusPill status={r.stockState} />{r.inventoryMode === 'TRACKED' && <span className="text-xs tabular-nums">{num(r.quantity)}</span>}</span> },
          { key: 'av', header: t('Available', 'متاح'), cell: (r: any) => (r.available ? <Badge tone="green">{t('Yes', 'نعم')}</Badge> : <Badge tone="red">{t('No', 'لا')}</Badge>) },
          { key: 'im', header: t('Images', 'الصور'), cell: (r: any) => (canEdit ? <Button size="sm" onClick={() => setImgProduct(r)}>{num(r.imageCount)} · {t('Manage', 'إدارة')}</Button> : num(r.imageCount)) },
          ...(canEdit ? [{ key: 'act', header: '', align: 'end' as const, cell: (r: any) => <span className="flex justify-end gap-1.5"><Link href={`/branches/${r.branchId}#sec-products`} className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">{t('Edit', 'تعديل')}</Link><DeleteRecordButton path={`/admin/products/${r.id}`} name={r.name} what={['Product', 'المنتج']} consequence={['It disappears from the menu. Past orders keep it.', 'يختفي من المنيو. الطلبات السابقة تحتفظ به.']} onDeleted={list.reload} /></span> }] : []),
        ]} />
        {list.meta && <Pagination page={page} limit={limit} total={list.meta.total} onPage={setPage} />}
      </Card>

      <Modal open={Boolean(bulk)} wide title={t('Bulk action', 'إجراء جماعي')} onClose={() => !busy && setBulk(null)} footer={<><Button onClick={() => setBulk(null)} disabled={busy}>{t('Cancel', 'إلغاء')}</Button>{!preview ? <Button variant="primary" loading={busy} onClick={runPreview}>{t('Preview changes', 'معاينة التغييرات')}</Button> : <Button variant="danger" loading={busy} onClick={apply}>{t(`Apply to ${sel.length} product(s)`, `تطبيق على ${sel.length} منتج`)}</Button>}</>}>
        {bulk?.action === 'PRICE_PERCENT' && <LabeledInput label={t('Change price by % (−90 to 90)', 'تغيير السعر بنسبة % (من −90 إلى 90)')} inputMode="decimal" value={pct} onChange={(e) => { setPct(e.target.value); setPreview(null); }} />}
        {bulk?.action === 'SET_STOCK' && <LabeledInput label={t('Set stock to (tracked products only)', 'ضبط المخزون إلى (للمنتجات المتتبَّعة فقط)')} inputMode="numeric" value={qty} onChange={(e) => { setQty(e.target.value); setPreview(null); }} />}
        {preview && <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200"><table className="w-full text-xs"><thead className="bg-gray-50"><tr><th className="px-2 py-1 text-start">{t('Product', 'المنتج')}</th><th className="px-2 py-1 text-end">{t('Before', 'قبل')}</th><th className="px-2 py-1 text-end">{t('After', 'بعد')}</th></tr></thead><tbody>{preview.map((r) => { const p = (list.data ?? []).find((x: any) => x.id === r.id); const money_ = bulk?.action === 'PRICE_PERCENT'; return <tr key={r.id} className="border-t border-gray-100"><td className="px-2 py-1"><bdi>{p?.name ?? r.id}</bdi></td>{r.ok ? <><td className="px-2 py-1 text-end tabular-nums">{money_ ? money(r.before) : String(r.before)}</td><td className="px-2 py-1 text-end font-medium tabular-nums">{money_ ? money(r.after) : String(r.after)}</td></> : <td colSpan={2} className="px-2 py-1 text-end text-red-600">{r.code}</td>}</tr>; })}</tbody></table></div>}
        <p className="text-xs text-gray-500">{t('Each product is changed individually; ones that cannot change (for example stock on an untracked product) are reported and left alone. One audit entry records the action and counts.', 'يُغيَّر كل منتج على حدة؛ وما لا يمكن تغييره (مثل مخزون منتج غير متتبَّع) يُبلَّغ عنه ويُترك. يسجل إدخال تدقيق واحد الإجراء والأعداد.')}</p>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </Modal>

      <Modal open={photosOpen} wide title={t('Add many photos to a branch’s items', 'إضافة صور كثيرة لمنتجات فرع')} onClose={() => { setPhotosOpen(false); list.reload(); }}>
        <div className="space-y-3">
          <LabeledSelect label={t('Branch', 'الفرع')} value={photosBranch} onChange={(e) => setPhotosBranch(e.target.value)}><option value="">{t('Choose a branch…', 'اختر فرعًا…')}</option>{(branches.data ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.vendorName} — {b.name}</option>)}</LabeledSelect>
          {photosBranch && <BulkItemPhotos key={photosBranch} branchId={photosBranch} />}
        </div>
      </Modal>
      <Modal open={Boolean(imgProduct)} wide title={imgProduct ? t(`Images — ${imgProduct.name}`, `الصور — ${imgProduct.name}`) : ''} onClose={() => setImgProduct(null)}>
        <ProductImages productId={imgProduct?.id} onChanged={() => list.reload()} />
      </Modal>
    </div>
  );
}


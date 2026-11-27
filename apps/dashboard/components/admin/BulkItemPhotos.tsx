'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../lib/api/client';
import { apiErrorMessage } from '../../lib/api/errors';
import { useLang } from '../../lib/ui/lang';
import { Button, useToast } from '../ui';

import { guessProduct } from '../../lib/catalog/photo-match';

interface Product { id: string; name: string; nameAr: string | null; imageCount: number | null }
interface Row { key: string; file: File; preview: string; productId: string; primary: boolean; status: 'ready' | 'uploading' | 'done' | 'error'; error?: string }

/**
 * Owner request 2026-11-27: add item photos for a whole branch in one go — choose many photos at once, each is matched to an item by its
 * file name (you can change it), then "Upload and assign" stores them and adds each to its item (up to 8 per item; "main photo" puts it
 * first). Uses the same media library and product-photo rules as the single-item editor.
 */
export function BulkItemPhotos({ branchId }: { branchId: string }) {
  const { t, locale } = useLang();
  const toast = useToast();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all: Product[] = [];
      for (let page = 1; page <= 30; page++) {
        const res = await apiClient.get('/admin/product-directory', { params: { vendorBranchId: branchId, limit: 100, page, sort: 'name:asc' } });
        all.push(...(res.data.data as Product[]));
        if (all.length >= (res.data.meta?.total ?? 0) || res.data.data.length === 0) break;
      }
      if (!cancelled) setProducts(all);
    })().catch(() => !cancelled && setProducts([]));
    return () => { cancelled = true; };
  }, [branchId]);

  useEffect(() => () => rows.forEach((r) => URL.revokeObjectURL(r.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const add = (files: FileList | null) => {
    if (!files || !products) return;
    const next = Array.from(files)
      .filter((f) => f.type.startsWith('image/'))
      .map((file, i) => ({ key: `${Date.now()}-${i}-${file.name}`, file, preview: URL.createObjectURL(file), productId: guessProduct(file.name, products), primary: false, status: 'ready' as const }));
    setRows((r) => [...r, ...next]);
  };
  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const label = (p: Product) => (locale === 'ar' && p.nameAr ? p.nameAr : p.name);
  const sorted = useMemo(() => [...(products ?? [])].sort((a, b) => label(a).localeCompare(label(b))), [products, locale]); // eslint-disable-line react-hooks/exhaustive-deps
  const ready = rows.filter((r) => r.status !== 'done' && r.productId);

  const run = async () => {
    setBusy(true);
    let ok = 0, failed = 0;
    const byProduct = new Map<string, Row[]>();
    for (const r of ready) byProduct.set(r.productId, [...(byProduct.get(r.productId) ?? []), r]);
    for (const [productId, items] of byProduct) {
      const uploaded: { id: string; primary: boolean; key: string }[] = [];
      for (const r of items) {
        patch(r.key, { status: 'uploading', error: undefined });
        try {
          const form = new FormData();
          form.append('purpose', 'PRODUCT_ADDITIONAL');
          form.append('file', r.file, r.file.name);
          const res = await apiClient.post('/admin/media/uploads', form);
          uploaded.push({ id: res.data.data.id, primary: r.primary, key: r.key });
        } catch (e) {
          failed++;
          patch(r.key, { status: 'error', error: apiErrorMessage(e, t('Upload failed.', 'فشل الرفع.')) });
        }
      }
      if (uploaded.length === 0) continue;
      try {
        const current = ((await apiClient.get(`/admin/products/${productId}/media`)).data.data as { id: string }[]).map((a) => a.id);
        const mains = uploaded.filter((u) => u.primary).map((u) => u.id);
        const others = uploaded.filter((u) => !u.primary).map((u) => u.id);
        const ids = [...new Set([...mains, ...current, ...others])];
        if (ids.length > 8) throw new Error(t(`This item would have ${ids.length} photos — the maximum is 8. Remove some first.`, `سيصبح لهذا المنتج ${ids.length} صور — الحد الأقصى 8. احذف بعضها أولًا.`));
        await apiClient.put(`/admin/products/${productId}/media`, { assetIds: ids });
        uploaded.forEach((u) => patch(u.key, { status: 'done' }));
        ok += uploaded.length;
      } catch (e) {
        failed += uploaded.length;
        uploaded.forEach((u) => patch(u.key, { status: 'error', error: e instanceof Error && !(e as any).response ? e.message : apiErrorMessage(e, t('Could not add the photos to the item.', 'تعذّر إضافة الصور للمنتج.')) }));
      }
    }
    setBusy(false);
    if (ok) toast.push('success', t(`${ok} photo(s) added to items.`, `تمت إضافة ${ok} صورة للمنتجات.`));
    if (failed) toast.push('error', t(`${failed} photo(s) were not added — see the rows in red.`, `لم تُضف ${failed} صورة — انظر الصفوف باللون الأحمر.`));
  };

  return (
    <div className="space-y-3" data-testid="bulk-photos">
      <p className="text-sm text-gray-600">{t('Choose many photos at once (or drag them here). Name each file like the item (e.g. "Chicken Shawarma.jpg" or "شاورما فراخ.jpg") and it is matched automatically — check or change the item next to each photo, then upload.', 'اختر صورًا كثيرة مرة واحدة (أو اسحبها هنا). سمِّ كل ملف باسم المنتج (مثل «شاورما فراخ.jpg») ليُطابق تلقائيًا — راجع أو غيّر المنتج بجوار كل صورة ثم ارفع.')}</p>
      <label onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files); }}
        className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-600 hover:border-hatly-orange">
        <input type="file" accept="image/*" multiple className="hidden" disabled={!products || busy} onChange={(e) => { add(e.target.files); e.target.value = ''; }} data-testid="bulk-photos-input" />
        {products ? t(`Choose photos (${products.length} items in this branch)`, `اختر الصور (${products.length} منتج في هذا الفرع)`) : t('Loading the items…', 'جارٍ تحميل المنتجات…')}
      </label>
      {rows.length > 0 && (
        <>
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.key} className={`flex flex-wrap items-center gap-3 rounded-lg border p-2 text-sm ${r.status === 'error' ? 'border-red-300 bg-red-50' : r.status === 'done' ? 'border-green-300 bg-green-50' : 'border-gray-200'}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.preview} alt="" className="h-14 w-14 rounded object-cover" />
                <span className="min-w-[8rem] flex-1 truncate text-xs text-gray-600" dir="auto">{r.file.name}</span>
                <select value={r.productId} disabled={busy || r.status === 'done'} onChange={(e) => patch(r.key, { productId: e.target.value })} aria-label={t('Item', 'المنتج')}
                  className={`min-h-[36px] max-w-[16rem] rounded-lg border px-2 text-sm ${r.productId ? 'border-gray-300' : 'border-amber-400 bg-amber-50'}`}>
                  <option value="">{t('— choose the item —', '— اختر المنتج —')}</option>
                  {sorted.map((p) => <option key={p.id} value={p.id}>{label(p)}{p.imageCount ? ` (${p.imageCount} 📷)` : ''}</option>)}
                </select>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={r.primary} disabled={busy || r.status === 'done'} onChange={(e) => patch(r.key, { primary: e.target.checked })} />{t('Main photo', 'الصورة الرئيسية')}</label>
                <span className="text-xs">{r.status === 'done' ? '✓' : r.status === 'uploading' ? '…' : ''}</span>
                {r.status !== 'done' && <button type="button" disabled={busy} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="text-xs text-red-600" aria-label={t('Remove', 'إزالة')}>✕</button>}
                {r.error && <p className="w-full text-xs text-red-700">{r.error}</p>}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" loading={busy} disabled={ready.length === 0} onClick={() => void run()} data-testid="bulk-photos-run">{t(`Upload and assign ${ready.length} photo(s)`, `رفع وتعيين ${ready.length} صورة`)}</Button>
            {rows.some((r) => !r.productId && r.status !== 'done') && <span className="text-xs text-amber-700">{t('Photos without an item are skipped.', 'الصور بدون منتج لن تُرفع.')}</span>}
          </div>
        </>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Badge, Button, useToast } from '../ui';
import { send, useApi } from '../../lib/ui/api';
import { apiErrorMessage } from '../../lib/api/errors';
import { resolveMediaUrl } from '../../lib/media-url';
import { useLang } from '../../lib/ui/lang';
import { MediaPicker } from '../media/MediaPicker';

/** A product's photos (up to 8; the first is the one customers see in lists). Used on Products › Images and inside Edit product. */
export function ProductImages({ productId, onChanged }: { productId?: string; onChanged: () => void }) {
  const { t, locale } = useLang();
  const toast = useToast();
  const current = useApi<any[]>(productId ? `/admin/products/${productId}/media` : null);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const list: any[] = current.data ?? [];
  const save = async (next: any[]) => {
    setBusy(true);
    try { await send('put', `/admin/products/${productId}/media`, { assetIds: next.map((a) => a.id) }); toast.push('success', t('Images saved.', 'تم حفظ الصور.')); current.reload(); onChanged(); }
    catch (e) { toast.push('error', apiErrorMessage(e, t('Could not save the images.', 'تعذّر حفظ الصور.'))); }
    finally { setBusy(false); }
  };
  const move = (i: number, d: number) => { const n = [...list]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; void save(n); };
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">{t('The first image is the primary one shown in lists. Up to 8 images. Use the arrows to reorder.', 'الصورة الأولى هي الرئيسية في القوائم. حتى 8 صور. استخدم الأسهم لإعادة الترتيب.')}</p>
      <p className="text-xs text-gray-500">{t('Recommended: 1000 × 1000 px (1:1). Center the item with padding; keep important details away from the edges for thumbnail and landscape crops.', 'المقاس المقترح 1000 × 1000 بكسل (1:1). ضع المنتج في المنتصف مع مساحة حوله بعيدًا عن الحواف للقص المربع والأفقي.')}</p>
      {current.loading && !current.data && <p className="text-sm text-gray-500">{t('Loading…', 'جارٍ التحميل…')}</p>}
      {current.error && <p role="alert" className="text-sm text-red-700">{t('Could not load the images.', 'تعذّر تحميل الصور.')}</p>}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {list.map((a, i) => (
          <li key={a.id} className="rounded-lg border border-gray-200 p-2 text-xs">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={resolveMediaUrl(a.thumb?.url)} alt="" className="aspect-square w-full rounded bg-gray-100 object-cover" />
            <div className="mt-1 flex items-center justify-between">
              {i === 0 ? <Badge tone="orange">{t('Primary', 'رئيسية')}</Badge> : <span />}
              <span className="flex gap-1">
                <button aria-label={t('Move earlier', 'تحريك للأمام')} disabled={busy || i === 0} onClick={() => move(i, -1)} className="rounded px-1 hover:bg-gray-100 disabled:opacity-30">{locale === 'ar' ? '→' : '←'}</button>
                <button aria-label={t('Move later', 'تحريك للخلف')} disabled={busy || i === list.length - 1} onClick={() => move(i, 1)} className="rounded px-1 hover:bg-gray-100 disabled:opacity-30">{locale === 'ar' ? '←' : '→'}</button>
                <button aria-label={t('Remove', 'إزالة')} disabled={busy} onClick={() => save(list.filter((x) => x.id !== a.id))} className="rounded px-1 text-red-600 hover:bg-red-50">✕</button>
              </span>
            </div>
          </li>
        ))}
      </ul>
      {current.data && list.length === 0 && <p className="text-sm text-gray-500">{t('No images yet.', 'لا توجد صور بعد.')}</p>}
      <Button variant="primary" disabled={busy || list.length >= 8} onClick={() => setPicker(true)}>{t('Add images…', 'إضافة صور…')}</Button>
      <MediaPicker open={picker} onClose={() => setPicker(false)} purpose="PRODUCT_PRIMARY" multiple onPick={(picked) => { const merged = [...list, ...picked.filter((p) => !list.some((x) => x.id === p.id))].slice(0, 8); void save(merged); }} />
    </div>
  );
}

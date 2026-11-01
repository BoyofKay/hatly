'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../../lib/api/client';
import { apiErrorCode, apiErrorMessage } from '../../lib/api/errors';
import { useLang } from '../../lib/ui/lang';
import { Button, LabeledInput, LabeledSelect } from '../ui';

export const PURPOSE_LABELS: Record<string, [string, string]> = {
  GENERAL: ['General', 'عام'], VENDOR_LOGO: ['Vendor logo (square)', 'شعار مورد (مربع)'], SECTOR_IMAGE: ['Sector image', 'صورة قطاع'], SUBCATEGORY_IMAGE: ['Subcategory image', 'صورة فئة فرعية'],
  HOME_BANNER: ['Home banner (about 2:1)', 'لافتة الرئيسية (تقريبًا 2:1)'], PRODUCT_PRIMARY: ['Product image', 'صورة منتج'], PRODUCT_ADDITIONAL: ['Product additional image', 'صورة إضافية للمنتج'], CATALOG_PRODUCT: ['Catalog product', 'منتج الكتالوج'], BRANCH_COVER: ['Branch cover', 'غلاف فرع'],
};
const ASPECT: Record<string, number | null> = { VENDOR_LOGO: 1, HOME_BANNER: 2 };
const MAX_BYTES = 5 * 1024 * 1024;

type Status = 'queued' | 'uploading' | 'done' | 'error' | 'cancelled';
interface Item { id: number; file: File; preview: string; status: Status; progress: number; error?: string; asset?: any; crop?: { x: number; y: number; width: number; height: number } | null; ctrl?: AbortController; w?: number; h?: number }

/** Magic-byte check (first bytes), instant feedback only — the server re-validates the real bytes and is the authority. */
async function sniff(file: File): Promise<boolean> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const jpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const webp = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  return jpeg || png || webp;
}

function CropEditor({ item, aspect, onApply, onClose }: { item: Item; aspect: number; onApply: (c: Item['crop']) => void; onClose: () => void }) {
  const { t } = useLang();
  const [zoom, setZoom] = useState(1);
  const [ox, setOx] = useState(0.5);
  const [oy, setOy] = useState(0.5);
  const canvas = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const W = item.w ?? 1, H = item.h ?? 1;
  const baseW = Math.min(W, H * aspect);
  const cw = baseW / zoom, ch = cw / aspect;
  const rect = { x: Math.round(ox * (W - cw)), y: Math.round(oy * (H - ch)), width: Math.floor(cw), height: Math.floor(ch) };
  useEffect(() => {
    const i = new Image();
    i.onload = () => { img.current = i; draw(); };
    i.src = item.preview;
  }, [item.preview]); // eslint-disable-line react-hooks/exhaustive-deps
  const draw = useCallback(() => {
    const c = canvas.current, i = img.current;
    if (!c || !i) return;
    c.width = 480; c.height = Math.round(480 / aspect);
    c.getContext('2d')?.drawImage(i, rect.x, rect.y, rect.width, rect.height, 0, 0, c.width, c.height);
  }, [aspect, rect.x, rect.y, rect.width, rect.height]);
  useEffect(draw, [draw]);
  return (
    <div className="space-y-3">
      <canvas ref={canvas} className="w-full rounded-lg border border-gray-200 bg-gray-50" aria-label={t('Crop preview', 'معاينة القص')} />
      <p className="text-xs text-gray-500">{t(`Result: ${rect.width}×${rect.height} px (ratio locked to ${aspect === 1 ? '1:1' : `${aspect}:1`}).`, `الناتج: ${rect.width}×${rect.height} بكسل (النسبة مقفلة على ${aspect === 1 ? '1:1' : `${aspect}:1`}).`)}</p>
      <label className="block text-xs text-gray-600">{t('Zoom', 'التكبير')}<input type="range" min={1} max={4} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-full" /></label>
      <label className="block text-xs text-gray-600">{t('Horizontal position', 'الموضع الأفقي')}<input type="range" min={0} max={1} step={0.01} value={ox} onChange={(e) => setOx(Number(e.target.value))} className="w-full" /></label>
      <label className="block text-xs text-gray-600">{t('Vertical position', 'الموضع الرأسي')}<input type="range" min={0} max={1} step={0.01} value={oy} onChange={(e) => setOy(Number(e.target.value))} className="w-full" /></label>
      <div className="flex justify-end gap-2"><Button onClick={onClose}>{t('Back', 'رجوع')}</Button><Button variant="primary" onClick={() => onApply(rect)}>{t('Use this crop', 'استخدام هذا القص')}</Button></div>
    </div>
  );
}

/**
 * Direct upload: drag-and-drop or choose several files, instant client checks, per-file progress, cancel, retry, optional fixed-aspect
 * crop for purposes that need one, alt text. Every file goes through the server's validation + sharp pipeline (WebP variants, EXIF stripped).
 */
export function MediaUploader({ purpose: initialPurpose, lockPurpose, multiple = true, onUploaded }: { purpose?: string; lockPurpose?: boolean; multiple?: boolean; onUploaded?: (assets: any[]) => void }) {
  const { t, locale } = useLang();
  const [purpose, setPurpose] = useState(initialPurpose ?? 'GENERAL');
  const [altEn, setAltEn] = useState('');
  const [altAr, setAltAr] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [cropping, setCropping] = useState<number | null>(null);
  const [drag, setDrag] = useState(false);
  const seq = useRef(0);
  const aspect = ASPECT[purpose] ?? null;
  useEffect(() => () => items.forEach((i) => URL.revokeObjectURL(i.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (id: number, p: Partial<Item>) => setItems((s) => s.map((i) => (i.id === id ? { ...i, ...p } : i)));

  const add = async (files: FileList | File[]) => {
    const next: Item[] = [];
    for (const file of Array.from(files).slice(0, multiple ? 20 : 1)) {
      const id = ++seq.current;
      const preview = URL.createObjectURL(file);
      let error: string | undefined;
      if (file.size > MAX_BYTES) error = t('Larger than 5 MB.', 'أكبر من 5 ميجابايت.');
      else if (!(await sniff(file))) error = t('Only JPEG, PNG or WebP images are accepted.', 'يُقبل فقط JPEG أو PNG أو WebP.');
      const dims = await new Promise<{ w: number; h: number }>((res) => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => res({ w: 0, h: 0 }); im.src = preview; });
      next.push({ id, file, preview, status: error ? 'error' : 'queued', progress: 0, error, w: dims.w, h: dims.h });
    }
    setItems((s) => (multiple ? [...s, ...next] : next));
  };

  const upload = async (item: Item) => {
    const ctrl = new AbortController();
    patch(item.id, { status: 'uploading', progress: 0, error: undefined, ctrl });
    const form = new FormData();
    form.append('purpose', purpose);
    if (item.crop) form.append('crop', JSON.stringify(item.crop));
    if (altEn) form.append('altEn', altEn);
    if (altAr) form.append('altAr', altAr);
    form.append('file', item.file, item.file.name);
    try {
      const res = await apiClient.post('/admin/media/uploads', form, { signal: ctrl.signal, onUploadProgress: (e) => patch(item.id, { progress: e.total ? Math.round((e.loaded / e.total) * 100) : 0 }) });
      patch(item.id, { status: 'done', progress: 100, asset: res.data.data });
      return res.data.data;
    } catch (e: any) {
      if (e?.code === 'ERR_CANCELED') { patch(item.id, { status: 'cancelled' }); return null; }
      const code = apiErrorCode(e);
      const aspectHint = code === 'MEDIA_BAD_ASPECT' ? ` ${t('Use “Crop”.', 'استخدم «قص».')}` : '';
      patch(item.id, { status: 'error', error: apiErrorMessage(e, t('Upload failed.', 'فشل الرفع.')) + aspectHint });
      return null;
    }
  };

  const uploadAll = async () => {
    const pending = items.filter((i) => i.status === 'queued' || i.status === 'error' || i.status === 'cancelled').filter((i) => !(i.status === 'error' && i.error && !i.ctrl && (i.file.size > MAX_BYTES)));
    const done: any[] = [];
    // three at a time
    const queue = [...pending];
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }).map(async () => {
      while (queue.length) { const it = queue.shift()!; const a = await upload(it); if (a) done.push(a); }
    }));
    if (done.length) onUploaded?.(done);
  };

  const cropItem = items.find((i) => i.id === cropping);
  return (
    <div className="space-y-4">
      {cropItem && aspect ? (
        <CropEditor item={cropItem} aspect={aspect} onClose={() => setCropping(null)} onApply={(c) => { patch(cropItem.id, { crop: c, status: 'queued', error: undefined }); setCropping(null); }} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {!lockPurpose && <LabeledSelect label={t('Used for', 'الغرض')} value={purpose} onChange={(e) => setPurpose(e.target.value)}>{Object.entries(PURPOSE_LABELS).map(([k, v]) => <option key={k} value={k}>{locale === 'ar' ? v[1] : v[0]}</option>)}</LabeledSelect>}
            <LabeledInput label={t('Alt text (English, optional)', 'نص بديل (إنجليزي، اختياري)')} value={altEn} onChange={(e) => setAltEn(e.target.value)} />
            <LabeledInput label={t('Alt text (Arabic, optional)', 'نص بديل (عربي، اختياري)')} value={altAr} onChange={(e) => setAltAr(e.target.value)} dir="rtl" />
          </div>
          <label
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); void add(e.dataTransfer.files); }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-8 text-center text-sm ${drag ? 'border-hatly-orange bg-orange-50' : 'border-gray-300 bg-gray-50 hover:bg-gray-100'}`}
          >
            <span className="font-medium text-gray-800">{t('Drop images here or click to choose', 'أسقط الصور هنا أو اضغط للاختيار')}</span>
            <span className="text-xs text-gray-500">{t('JPEG, PNG or WebP · up to 5 MB each · up to 20 files', 'JPEG أو PNG أو WebP · حتى 5 ميجابايت للملف · حتى 20 ملفًا')}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple={multiple} className="sr-only" onChange={(e) => { if (e.target.files) void add(e.target.files); e.target.value = ''; }} />
          </label>
          {items.length > 0 && (
            <ul className="space-y-2">
              {items.map((i) => (
                <li key={i.id} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={i.asset?.thumb?.url ? undefined : i.preview} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />
                  <div className="min-w-0 flex-1 text-xs">
                    <p className="truncate font-medium text-gray-900"><bdi>{i.file.name}</bdi> <span className="text-gray-400">{Math.round(i.file.size / 1024)} KB · {i.w}×{i.h}{i.crop ? ` → ${i.crop.width}×${i.crop.height}` : ''}</span></p>
                    {i.status === 'uploading' && <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-gray-200"><div className="h-full bg-hatly-orange" style={{ width: `${i.progress}%` }} /></div>}
                    {i.status === 'done' && <p className="text-green-700">{t('Uploaded', 'تم الرفع')} {i.asset?.deduplicated ? t('(identical image already in the library)', '(الصورة موجودة مسبقًا في المكتبة)') : ''}</p>}
                    {i.status === 'error' && <p role="alert" className="text-red-600">{i.error}</p>}
                    {i.status === 'cancelled' && <p className="text-gray-500">{t('Cancelled', 'أُلغي')}</p>}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {aspect && ['queued', 'error', 'cancelled'].includes(i.status) && (i.w ?? 0) > 0 && <Button size="sm" onClick={() => setCropping(i.id)}>{t('Crop', 'قص')}</Button>}
                    {i.status === 'uploading' && <Button size="sm" onClick={() => i.ctrl?.abort()}>{t('Cancel', 'إلغاء')}</Button>}
                    {['error', 'cancelled'].includes(i.status) && i.file.size <= MAX_BYTES && <Button size="sm" onClick={() => void upload(i).then((a) => a && onUploaded?.([a]))}>{t('Retry', 'إعادة')}</Button>}
                    {i.status !== 'uploading' && <Button size="sm" variant="ghost" onClick={() => setItems((s) => s.filter((x) => x.id !== i.id))} aria-label={t('Remove', 'إزالة')}>✕</Button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <Button variant="primary" disabled={!items.some((i) => ['queued', 'cancelled'].includes(i.status) || (i.status === 'error' && i.file.size <= MAX_BYTES))} onClick={uploadAll}>{t('Upload', 'رفع')}</Button>
          </div>
        </>
      )}
    </div>
  );
}

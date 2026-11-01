'use client';

import { useState } from 'react';
import { resolveMediaUrl } from '../../lib/media-url';
import { useApi } from '../../lib/ui/api';
import { useLang } from '../../lib/ui/lang';
import { Async, Button, LabeledInput, LabeledSelect, Modal, Pagination, Tabs, useDebounced, usePaging } from '../ui';
import { MediaUploader, PURPOSE_LABELS } from './MediaUploader';

/** Pick an existing asset from the library (reuse) or upload new ones. There is no external-URL input anywhere. */
export function MediaPicker({ open, onClose, onPick, purpose, multiple = false, title }: { open: boolean; onClose: () => void; onPick: (assets: any[]) => void; purpose?: string; multiple?: boolean; title?: string }) {
  const { t, locale } = useLang();
  const [tab, setTab] = useState('library');
  const [q, setQ] = useState('');
  const [p, setP] = useState(purpose ?? '');
  const [sel, setSel] = useState<any[]>([]);
  const search = useDebounced(q);
  const { page, setPage, limit } = usePaging(JSON.stringify([search, p]), 18);
  const list = useApi<any[]>(open ? '/admin/media' : null, { q: search || undefined, purpose: p || undefined, page, limit });
  const toggle = (a: any) => setSel((s) => (multiple ? (s.some((x) => x.id === a.id) ? s.filter((x) => x.id !== a.id) : [...s, a]) : [a]));
  return (
    <Modal open={open} wide title={title ?? t('Choose an image', 'اختر صورة')} onClose={onClose} footer={tab === 'library' ? <><Button onClick={onClose}>{t('Cancel', 'إلغاء')}</Button><Button variant="primary" disabled={sel.length === 0} onClick={() => { onPick(sel); setSel([]); onClose(); }}>{t('Use selected', 'استخدام المحدد')} {sel.length > 0 ? `(${sel.length})` : ''}</Button></> : undefined}>
      <Tabs tabs={[{ id: 'library', label: t('Library', 'المكتبة') }, { id: 'upload', label: t('Upload new', 'رفع جديد') }]} value={tab} onChange={setTab} />
      {tab === 'upload' ? (
        <MediaUploader purpose={purpose} lockPurpose={Boolean(purpose)} multiple={multiple} onUploaded={(assets) => { onPick(assets); onClose(); }} />
      ) : (
        <>
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <LabeledInput label={t('Search', 'بحث')} value={q} onChange={(e) => setQ(e.target.value)} />
            {!purpose && <LabeledSelect label={t('Purpose', 'الغرض')} value={p} onChange={(e) => setP(e.target.value)}><option value="">{t('All', 'الكل')}</option>{Object.entries(PURPOSE_LABELS).map(([k, v]) => <option key={k} value={k}>{locale === 'ar' ? v[1] : v[0]}</option>)}</LabeledSelect>}
          </div>
          <Async state={list} empty={list.data && list.data.length === 0} emptyTitle={t('No images yet — upload one', 'لا توجد صور بعد — ارفع صورة')}>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {(list.data ?? []).map((a) => (
                <li key={a.id}>
                  <button onClick={() => toggle(a)} aria-pressed={sel.some((x) => x.id === a.id)} className={`block w-full overflow-hidden rounded-lg border-2 ${sel.some((x) => x.id === a.id) ? 'border-hatly-orange' : 'border-transparent hover:border-gray-300'}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.thumb?.url ? resolveMediaUrl(a.thumb.url) : undefined} alt={(locale === 'ar' ? a.altAr : a.altEn) ?? a.originalName ?? ''} className="aspect-square w-full bg-gray-100 object-cover" loading="lazy" />
                  </button>
                </li>
              ))}
            </ul>
            {list.meta && <Pagination page={page} limit={limit} total={list.meta.total} onPage={setPage} />}
          </Async>
        </>
      )}
    </Modal>
  );
}

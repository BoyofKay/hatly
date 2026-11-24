'use client';

import { useState } from 'react';
import { send } from '../../lib/ui/api';
import { apiErrorMessage } from '../../lib/api/errors';
import { resolveMediaUrl } from '../../lib/media-url';
import { useLang } from '../../lib/ui/lang';
import { MediaPicker } from '../media/MediaPicker';
import { useToast } from '../ui';

/**
 * The photo of one record (a sector tile, a subcategory…): a thumbnail that opens the media library (pick or upload), plus remove.
 * Saves straight away through `POST admin/media/assign`, which checks the record's own permission on the server.
 */
export function RecordPhoto({ entity, entityId, imageUrl, purpose, canEdit, onChanged }: { entity: string; entityId: string; imageUrl?: string | null; purpose: string; canEdit: boolean; onChanged: () => void | Promise<void> }) {
  const { t } = useLang();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const assign = async (assetId: string | null) => {
    setBusy(true);
    try {
      await send('post', '/admin/media/assign', { entity, entityId, assetId });
      toast.push('success', assetId ? t('Photo saved.', 'تم حفظ الصورة.') : t('Photo removed.', 'تمت إزالة الصورة.'));
      await onChanged();
    } catch (e) {
      toast.push('error', apiErrorMessage(e, t('Could not save the photo.', 'تعذّر حفظ الصورة.')));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={!canEdit || busy}
        onClick={() => setOpen(true)}
        title={canEdit ? t('Change photo', 'تغيير الصورة') : undefined}
        className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-50 text-[10px] text-gray-400 enabled:hover:ring-2 enabled:hover:ring-hatly-orange/40"
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={resolveMediaUrl(imageUrl)} alt="" className="h-full w-full object-cover" />
        ) : canEdit ? (
          t('+ Photo', '+ صورة')
        ) : (
          '—'
        )}
      </button>
      {canEdit && imageUrl && (
        <button type="button" disabled={busy} onClick={() => void assign(null)} className="text-xs text-red-600 hover:underline disabled:opacity-40">
          {t('Remove', 'إزالة')}
        </button>
      )}
      {purpose === 'SECTOR_IMAGE' && <span className="text-[10px] text-gray-500">512 × 512 px (1:1)</span>}
      <MediaPicker open={open} onClose={() => setOpen(false)} purpose={purpose} onPick={(picked) => picked[0] && void assign(picked[0].id)} title={purpose === 'SECTOR_IMAGE' ? t('Choose a photo — 512 × 512 px (1:1)', 'اختر صورة — 512 × 512 بكسل (1:1)') : t('Choose a photo', 'اختر صورة')} />
    </span>
  );
}

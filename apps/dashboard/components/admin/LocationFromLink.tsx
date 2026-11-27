'use client';

import { useState } from 'react';
import { apiClient } from '../../lib/api/client';
import { apiErrorMessage } from '../../lib/api/errors';
import { parseLatLng } from '../../lib/admin/lat-lng';
import { useLang } from '../../lib/ui/lang';

/**
 * Owner request 2026-11-27: set a location by pasting a Google Maps (or Apple Maps) link — long links and coordinates are read here, short
 * share links (maps.app.goo.gl/…) are opened by the server. Shows the result with a "check on the map" link before it is saved.
 */
export function LocationFromLink({ lat, lng, onChange }: { lat: number | null; lng: number | null; onChange: (lat: number, lng: number) => void }) {
  const { t } = useLang();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = async (value: string) => {
    setText(value);
    setError(null);
    if (!value.trim()) return;
    const local = parseLatLng(value);
    if (local) { onChange(local.lat, local.lng); return; }
    if (!/^https:\/\//i.test(value.trim())) return;
    setBusy(true);
    try {
      const r = await apiClient.get('/admin/geo/maps-link', { params: { url: value.trim() } });
      onChange(r.data.data.latitude, r.data.data.longitude);
    } catch (e) {
      setError(apiErrorMessage(e, t('No location found in this link.', 'لا يوجد موقع في هذا الرابط.')));
    } finally { setBusy(false); }
  };

  return (
    <div data-testid="location-from-link">
      <label className="block text-sm font-medium">{t('Location: paste a Google Maps link (or "lat, lng")', 'الموقع: الصق رابط خرائط جوجل (أو "خط العرض، خط الطول")')}</label>
      <input dir="ltr" value={text} onChange={(e) => void read(e.target.value)} placeholder="https://maps.app.goo.gl/…"
        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30" />
      <p className="mt-1 text-xs text-gray-500">{t('In Google Maps: open the shop → Share → Copy link, then paste it here.', 'في خرائط جوجل: افتح المحل ← مشاركة ← نسخ الرابط، ثم الصقه هنا.')}</p>
      {busy && <p className="mt-1 text-xs text-gray-500">{t('Reading the link…', 'جارٍ قراءة الرابط…')}</p>}
      {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
      {lat != null && lng != null && (
        <p className="mt-1 text-xs text-gray-700" data-testid="location-value">
          <span dir="ltr" className="font-mono">{lat.toFixed(6)}, {lng.toFixed(6)}</span>{' · '}
          <a href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noreferrer" className="text-hatly-orangeDark hover:underline">{t('check on the map', 'تحقق على الخريطة')}</a>
        </p>
      )}
    </div>
  );
}

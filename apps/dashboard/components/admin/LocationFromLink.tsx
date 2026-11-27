'use client';

import { useState } from 'react';
import { apiClient } from '../../lib/api/client';
import { apiErrorMessage } from '../../lib/api/errors';
import { parseLatLng } from '../../lib/admin/lat-lng';
import { useLang } from '../../lib/ui/lang';
import { MapArea, MapPointPicker } from './MapPointPicker';

const distanceMeters = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

/**
 * Owner request 2026-11-27: set a location by pasting a Google Maps (or Apple Maps) link — long links and coordinates are read here, short
 * share links (maps.app.goo.gl/…) are opened by the server. Shows the result with a "check on the map" link before it is saved.
 */
export function LocationFromLink({ lat, lng, onChange, areas = [], areaId }: { lat: number | null; lng: number | null; onChange: (lat: number, lng: number) => void; areas?: MapArea[]; areaId?: string | null }) {
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

  // Owner UAT 2026-11-27 (ML-01): say at once when the point is outside the branch's service area (the server refuses it too).
  const relevant = areaId ? areas.filter((a) => a.id === areaId) : areas;
  const outside = lat != null && lng != null && relevant.length > 0 && !relevant.some((a) => distanceMeters(lat, lng, a.centerLatitude, a.centerLongitude) <= a.radiusMeters);

  return (
    <div data-testid="location-from-link">
      <label className="block text-sm font-medium">{t('Location: click the map (drag the pin to adjust)', 'الموقع: اضغط على الخريطة (اسحب الدبوس للتعديل)')}</label>
      <MapPointPicker lat={lat} lng={lng} areas={areas} highlightAreaId={areaId} onPick={onChange} />
      {outside && <p role="alert" className="mt-1 text-xs font-medium text-red-700" data-testid="location-outside">{t('This point is outside the service area — it cannot be saved.', 'هذه النقطة خارج منطقة الخدمة — لا يمكن حفظها.')}</p>}
      <label className="mt-3 block text-xs font-medium text-gray-600">{t('Or paste a Google Maps link (or "lat, lng")', 'أو الصق رابط خرائط جوجل (أو "خط العرض، خط الطول")')}</label>
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

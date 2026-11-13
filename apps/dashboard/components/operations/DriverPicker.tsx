'use client';

import { useMemo, useState } from 'react';
import { useApi } from '../../lib/ui/api';
import { useLang } from '../../lib/ui/lang';
import { DispatchDriver } from '../../lib/api/admin-control-tower';

type Ranked = { id: string; name: string; active: number; capacity: number };

/**
 * Stage 2 (smart assignment, 2026-11-13): pick a driver in ONE tap from an ordered list instead of a long drop-down.
 * - "Suggested": the drivers automatic dispatch would pick for the (first) order, in its order — read from the backend, never re-ranked here.
 * - Everyone else after them: online first, then the least loaded; offline drivers last and marked.
 * - Search by name or phone. Each row shows the load against the configured capacity (R18) and the free places.
 * Nothing is filtered out by a client-side rule: a driver the backend will refuse (offline, full) is still listed, marked, and the backend's
 * refusal is what the operator sees. The caller performs the assignment (`onPick`).
 */
export function DriverPicker({ orderId, count, drivers, busy, onPick, onClose }: {
  /** The order whose ranking orders the list (with several orders: the most urgent selected one). */
  orderId: string;
  /** How many orders will be assigned with one tap (1 = a single order). */
  count: number;
  drivers: DispatchDriver[];
  busy: boolean;
  onPick: (driver: { id: string; name: string }) => void;
  onClose: () => void;
}) {
  const { t, locale } = useLang();
  const ar = locale === 'ar';
  const [q, setQ] = useState('');
  const ranking = useApi<{ ranked: Ranked[] }>(`/admin/operations/orders/${orderId}/driver-ranking`, undefined, { keepPreviousData: false });
  const ranked = ranking.data?.ranked ?? [];

  const rows = useMemo(() => {
    const byId = new Map(drivers.map((d) => [d.id, d]));
    const rankOf = new Map(ranked.map((r, i) => [r.id, i]));
    const load = (d: DispatchDriver) => (d.activeCount ?? (d.activeDelivery ? 1 : 0)) / Math.max(1, d.capacity ?? 1);
    const rest = drivers
      .filter((d) => !rankOf.has(d.id))
      .sort((a, b) => Number(b.isOnline) - Number(a.isOnline) || load(a) - load(b) || a.fullName.localeCompare(b.fullName));
    const list = [
      ...ranked.map((r, i) => ({ id: r.id, name: r.name, phone: byId.get(r.id)?.phone ?? '', online: true, active: r.active, capacity: r.capacity, vehicle: byId.get(r.id)?.vehicleTypeName ?? null, rank: i })),
      ...rest.map((d) => ({ id: d.id, name: d.fullName, phone: d.phone, online: d.isOnline, active: d.activeCount ?? (d.activeDelivery ? 1 : 0), capacity: d.capacity ?? 1, vehicle: d.vehicleTypeName, rank: null as number | null })),
    ];
    const s = q.trim().toLowerCase();
    return s ? list.filter((d) => d.name.toLowerCase().includes(s) || d.phone.replace(/\s/g, '').includes(s.replace(/\s/g, ''))) : list;
  }, [drivers, ranked, q]);

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-2" data-testid="driver-picker">
      <div className="mb-2 flex items-center gap-2">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Driver name or phone', 'اسم المندوب أو رقمه')} aria-label={t('Search drivers', 'بحث عن مندوب')}
          data-testid="driver-picker-search" className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 text-sm" />
        <button type="button" onClick={onClose} className="min-h-[40px] rounded-lg px-3 text-sm text-gray-600 hover:bg-gray-100" data-testid="driver-picker-close">{t('Close', 'إغلاق')}</button>
      </div>
      {ranking.loading && !ranking.data && <p className="px-2 py-1 text-xs text-gray-500">{t('Ranking drivers…', 'جارٍ ترتيب المندوبين…')}</p>}
      {rows.length === 0 && <p className="px-2 py-3 text-center text-sm text-gray-500" data-testid="driver-picker-empty">{t('No driver matches.', 'لا يوجد مندوب مطابق.')}</p>}
      <ul className="max-h-80 space-y-1 overflow-y-auto">
        {rows.map((d) => {
          const room = Math.max(0, d.capacity - d.active);
          const full = room === 0;
          const partial = !full && count > room;
          return (
            <li key={d.id}>
              <button type="button" disabled={busy} onClick={() => onPick({ id: d.id, name: d.name })} data-testid={`driver-option-${d.id}`} data-rank={d.rank ?? ''}
                className={`flex min-h-[48px] w-full items-center gap-3 rounded-lg border px-3 py-1.5 text-start disabled:opacity-50 ${d.rank === 0 ? 'border-hatly-orange bg-orange-50' : 'border-gray-200 bg-white'} hover:border-hatly-orange`}>
                <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${d.online ? 'bg-green-500' : 'bg-gray-300'}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <bdi className="truncate font-medium text-gray-900">{d.name}</bdi>
                    {d.rank === 0 && <span className="rounded-full bg-hatly-orange px-2 text-xs font-semibold text-white">{t('Suggested', 'المقترح')}</span>}
                    {d.rank != null && d.rank > 0 && <span className="rounded-full bg-orange-100 px-2 text-xs text-orange-800">{ar ? `اقتراح ${d.rank + 1}` : `Option ${d.rank + 1}`}</span>}
                  </span>
                  <span className="block text-xs text-gray-500">
                    {!d.online ? <span className="text-red-700">{t('Offline', 'غير متصل')}</span> : full ? <span className="text-red-700">{t('Full', 'ممتلئ')}</span> : t(`${room} free`, `${room} متاح`)}
                    {d.vehicle ? <> · <bdi>{d.vehicle}</bdi></> : null}
                    {d.phone ? <> · <bdi dir="ltr">{d.phone}</bdi></> : null}
                  </span>
                </span>
                <span className="shrink-0 text-end">
                  <span className={`block font-mono text-sm font-semibold ${full ? 'text-red-700' : 'text-gray-800'}`} data-testid="driver-load">{d.active}/{d.capacity}</span>
                  {partial && d.online && <span className="block text-xs text-amber-800" data-testid="driver-partial">{t(`room for ${room} of ${count}`, `يسع ${room} من ${count}`)}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

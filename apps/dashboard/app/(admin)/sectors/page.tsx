'use client';

import { useEffect, useState } from 'react';
import { AdminSector, MANAGE_MARKETPLACE_SECTORS, createSector, listAdminSectors, setSectorActive, setSectorCustomRequests, setSectorBanner } from '../../../lib/api/admin-sectors';
import { MediaPicker } from '../../../components/media/MediaPicker';
import { resolveMediaUrl } from '../../../lib/media-url';
import { EMPTY_SECTOR_FORM, SectorFormState, buildCreateSectorBody, suggestSlug } from '../../../lib/sectors/sector-form';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useAdminPermission } from '../../../lib/auth/use-admin-permission';
import { useLang } from '../../../lib/ui/lang';
import { Badge, Button, Card, EmptyState, ErrorState, KpiCard, LabeledInput, PageHeader, Skeleton } from '../../../components/ui';

/**
 * Marketplace sectors and the one setting an admin controls per sector here: whether customers may send a custom request
 * ("لا تجد ما تبحث عنه؟" — a free-text / photo item the vendor prices later) to vendors of that sector. It is OFF by default and the
 * API enforces it — the customer app only mirrors it. A branch with no sector cannot take custom requests.
 *
 * An admin can also create a sector and turn it on or off for customers (a sector is the category tile on the customer Home). A new one
 * starts OFF so customers never see an empty category; turn it on once vendors are assigned to it.
 *
 * The permission is enforced by the backend; the UI only disables what the signed-in admin cannot do.
 */
export default function SectorsPage() {
  const { t } = useLang();
  const [sectors, setSectors] = useState<AdminSector[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const canManage = useAdminPermission(MANAGE_MARKETPLACE_SECTORS) === true;
  const [creating, setCreating] = useState(false);
  const [bannerSector, setBannerSector] = useState<AdminSector | null>(null);
  const [form, setForm] = useState<SectorFormState>(EMPTY_SECTOR_FORM);
  const [slugTouched, setSlugTouched] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setError(null);
    try {
      setSectors(await listAdminSectors());
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to load sectors.'));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function toggle(sector: AdminSector) {
    if (busyId) return;
    setBusyId(sector.id);
    setError(null);
    try {
      const updated = await setSectorCustomRequests(sector.id, !sector.customRequestsEnabled);
      setSectors((all) => (all ?? []).map((s) => (s.id === updated.id ? updated : s)));
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to update the sector.'));
    } finally {
      setBusyId(null);
    }
  }

  async function submitNew(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const v = buildCreateSectorBody(form);
    if (!v.ok) {
      setFormError(v.error);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await createSector(v.body);
      setForm(EMPTY_SECTOR_FORM);
      setSlugTouched(false);
      setCreating(false);
      await refresh();
    } catch (err) {
      setFormError(apiErrorMessage(err, 'Failed to create the sector.'));
    } finally {
      setSaving(false);
    }
  }

  async function updateBanner(sector: AdminSector, url: string | null) {
    if (!canManage || busyId) return;
    setBusyId(sector.id); setError(null);
    try {
      const updated = await setSectorBanner(sector.id, url);
      setSectors((all) => (all ?? []).map((s) => s.id === updated.id ? updated : s));
    } catch (err) { setError(apiErrorMessage(err, t('Failed to save sector banner.', 'تعذر حفظ بانر القطاع.'))); }
    finally { setBusyId(null); }
  }

  async function toggleActive(sector: AdminSector) {
    if (busyId) return;
    setBusyId(sector.id);
    setError(null);
    try {
      const updated = await setSectorActive(sector.id, !sector.isActive);
      setSectors((all) => (all ?? []).map((s) => (s.id === updated.id ? updated : s)));
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to update the sector.'));
    } finally {
      setBusyId(null);
    }
  }

  const noPermission = t('Requires the MANAGE_MARKETPLACE_SECTORS permission', 'يتطلب صلاحية MANAGE_MARKETPLACE_SECTORS');
  const customOn = (sectors ?? []).filter((s) => s.customRequestsEnabled).length;
  const activeCount = (sectors ?? []).filter((s) => s.isActive).length;
  const Switch = ({ s, testId }: { s: AdminSector; testId?: string }) => (
    <button
      role="switch"
      aria-checked={s.customRequestsEnabled}
      aria-label={`Custom requests for ${s.name}`}
      data-testid={testId}
      disabled={!canManage || busyId === s.id}
      title={canManage ? undefined : noPermission}
      onClick={() => toggle(s)}
      className={`min-h-[36px] rounded-lg px-3 py-1 text-xs font-medium disabled:opacity-50 ${s.customRequestsEnabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}
    >
      {s.customRequestsEnabled ? t('On', 'مفعّل') : t('Off', 'متوقف')}
    </button>
  );
  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('Sectors', 'القطاعات')}
        subtitle={t('The category tiles customers see on Home, and whether each may take custom requests.', 'تصنيفات الصفحة الرئيسية التي يراها العملاء، وهل يقبل كل قطاع الطلبات المخصصة.')}
        actions={<Button data-testid="sector-new" variant="primary" onClick={() => setCreating((v) => !v)} disabled={!canManage} title={canManage ? undefined : noPermission}>{creating ? t('Cancel', 'إلغاء') : t('New sector', 'قطاع جديد')}</Button>}
      />
      {sectors && sectors.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label={t('Sectors', 'القطاعات')} value={sectors.length} />
          <KpiCard label={t('Shown to customers', 'ظاهرة للعملاء')} value={activeCount} />
          <KpiCard label={t('Custom requests on', 'الطلبات المخصصة مفعّلة')} value={customOn} />
        </div>
      )}
      {creating && (
        <form onSubmit={submitNew} data-testid="sector-form" className="mb-4 space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabeledInput data-testid="sector-name" label="Name (EN)" value={form.name} placeholder="Restaurants" onChange={(e) => { const name = e.target.value; setForm((f) => ({ ...f, name, slug: slugTouched ? f.slug : suggestSlug(name) })); }} />
            <LabeledInput data-testid="sector-name-ar" label="Name (AR)" dir="rtl" value={form.nameAr} placeholder="مطاعم" onChange={(e) => setForm((f) => ({ ...f, nameAr: e.target.value }))} />
            <LabeledInput data-testid="sector-slug" label="Slug (lowercase, hyphens)" dir="ltr" value={form.slug} placeholder="restaurants" onChange={(e) => { setSlugTouched(true); setForm((f) => ({ ...f, slug: e.target.value })); }} />
            <LabeledInput data-testid="sector-order" label="Display order (lowest first)" inputMode="numeric" value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))} />
          </div>
          <label className="flex min-h-[44px] items-center gap-2 text-sm">
            <input data-testid="sector-active" type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
            <span>Show on customers&apos; Home now (leave off until vendors are assigned to it)</span>
          </label>
          {formError && <p data-testid="sector-form-error" role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" loading={saving}>{saving ? 'Saving…' : 'Create sector'}</Button>
            <Button type="button" onClick={() => setCreating(false)}>Cancel</Button>
          </div>
        </form>
      )}
      <p data-testid="sectors-rule" className="mb-4 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
        “Can’t find what you’re looking for?” lets a customer describe an item (text and/or photos) that the vendor prices later. Turn it on only for
        sectors where a vendor can source items that are not on the menu — it is off for every new sector, and a vendor without a sector cannot receive
        custom requests. Changes apply immediately.
      </p>
      {error && <p data-testid="sectors-error" role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {sectors === null && !error && <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>}
      {sectors && sectors.length === 0 && (
        <Card><div data-testid="sectors-empty"><EmptyState title={t('No sectors yet', 'لا توجد قطاعات بعد')} hint="No sectors yet — customers see no categories on Home until you create and activate at least one." /></div></Card>
      )}
      {sectors && sectors.length > 0 && (
        <>
          <div className="hidden overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm md:block">
            <table data-testid="sectors-table" className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2 text-start font-medium">{t('Sector', 'القطاع')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('Slug', 'المعرّف')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('Sector banner', 'بانر القطاع')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('Status', 'الحالة')}</th>
                  <th className="px-3 py-2 text-start font-medium" />
                  <th className="px-3 py-2 text-start font-medium">{t('Custom requests', 'الطلبات المخصصة')}</th>
                </tr>
              </thead>
              <tbody>
                {sectors.map((s) => (
                  <tr key={s.id} data-testid={`sector-row-${s.id}`} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2"><span className="font-medium text-gray-900">{s.name}</span>{s.nameAr ? <span dir="rtl" className="text-gray-500"> / {s.nameAr}</span> : null}</td>
                    <td className="px-3 py-2 text-gray-500" dir="ltr">{s.slug}</td>
                    <td className="px-3 py-2"><div className="flex items-center gap-2">
                      {s.bannerUrl ? <img alt="" src={resolveMediaUrl(s.bannerUrl)} className="h-12 w-20 rounded-lg object-cover" /> : <span className="text-xs text-gray-400">{t('No banner', 'لا يوجد بانر')}</span>}
                      <button type="button" className="rounded-lg border px-2 py-2 text-xs text-hatly-orangeDark disabled:opacity-40" disabled={!canManage || !!busyId} onClick={() => setBannerSector(s)}>{t('Choose image', 'اختيار صورة')}</button>
                      {s.bannerUrl && <button type="button" className="text-xs text-red-600 disabled:opacity-40" disabled={!canManage || !!busyId} onClick={() => void updateBanner(s, null)}>{t('Remove', 'إزالة')}</button>}
                    </div></td>
                    <td className="px-3 py-2"><Badge tone={s.isActive ? 'green' : 'gray'}>{s.isActive ? t('Active', 'نشط') : t('Inactive', 'غير نشط')}</Badge></td>
                    <td className="px-3 py-2"><button data-testid={`sector-active-toggle-${s.id}`} disabled={!canManage || busyId === s.id} onClick={() => toggleActive(s)} className="min-h-[36px] text-xs font-medium text-hatly-orangeDark hover:underline disabled:opacity-40">{s.isActive ? t('Deactivate', 'إيقاف') : t('Activate', 'تفعيل')}</button></td>
                    <td className="px-3 py-2"><Switch s={s} testId={`sector-custom-requests-${s.id}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 md:hidden">
            {sectors.map((s) => (
              <li key={s.id} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><p className="font-semibold text-gray-900">{s.name}</p>{s.nameAr && <p className="text-sm text-gray-500" dir="rtl">{s.nameAr}</p>}<p className="text-xs text-gray-400" dir="ltr">{s.slug}</p></div>
                  <Badge tone={s.isActive ? 'green' : 'gray'}>{s.isActive ? t('Active', 'نشط') : t('Inactive', 'غير نشط')}</Badge>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-gray-100 pt-2">
                  <button type="button" className="text-xs text-hatly-orangeDark disabled:opacity-40" disabled={!canManage || !!busyId} onClick={() => setBannerSector(s)}>{s.bannerUrl ? t('Change banner', 'تغيير البانر') : t('Add banner', 'إضافة بانر')}</button>
                  {s.bannerUrl && <button type="button" className="text-xs text-red-600 disabled:opacity-40" disabled={!canManage || !!busyId} onClick={() => void updateBanner(s, null)}>{t('Remove', 'إزالة')}</button>}
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-gray-100 pt-2">
                  <span className="text-xs text-gray-600">{t('Custom requests', 'الطلبات المخصصة')}</span>
                  <span className="flex items-center gap-2"><Switch s={s} /><button disabled={!canManage || busyId === s.id} onClick={() => toggleActive(s)} className="min-h-[36px] text-xs font-medium text-hatly-orangeDark disabled:opacity-40">{s.isActive ? t('Deactivate', 'إيقاف') : t('Activate', 'تفعيل')}</button></span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <MediaPicker open={bannerSector !== null} onClose={() => setBannerSector(null)} title={t('Choose sector banner', 'اختر بانر القطاع')} onPick={(items) => {
        const sector = bannerSector;
        const url = items[0]?.display?.url;
        setBannerSector(null);
        if (sector && typeof url === 'string') void updateBanner(sector, url);
        else setError(t('Selected image has no display URL.', 'الصورة المحددة لا تحتوي على رابط.'));
      }} />
    </div>
  );
}

'use client';
import { DeleteRecordButton } from '../../../components/admin/DeleteRecordButton';
import { SimpleEditModal } from '../../../components/admin/SimpleEditModal';
import { AssetHint } from '../../../components/admin/AssetHint';
import { send } from '../../../lib/ui/api';
import { MediaPicker } from '../../../components/media/MediaPicker';
import { resolveMediaUrl } from '../../../lib/media-url';

import { useEffect, useState } from 'react';
import { AdminSector, MANAGE_MARKETPLACE_SECTORS, createSector, listAdminSectors, setSectorActive, setSectorCustomRequests, setSectorBanner } from '../../../lib/api/admin-sectors';
import { EMPTY_SECTOR_FORM, SectorFormState, buildCreateSectorBody, suggestSlug } from '../../../lib/sectors/sector-form';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useAdminPermission } from '../../../lib/auth/use-admin-permission';
import { useLang } from '../../../lib/ui/lang';
import { Badge, Button, Card, EmptyState, ErrorState, KpiCard, LabeledInput, PageHeader, Skeleton, Modal } from '../../../components/ui';

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
  const [form, setForm] = useState<SectorFormState>(EMPTY_SECTOR_FORM);
  const [slugTouched, setSlugTouched] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<AdminSector | null>(null);
  const [assetsId, setAssetsId] = useState<string | null>(null);
  const [assetSlot, setAssetSlot] = useState<'photo' | 'en' | 'ar' | null>(null);
  const assetsSector = sectors?.find(s => s.id === assetsId) ?? null;

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

  async function saveAsset(sector: AdminSector, slot: 'photo' | 'en' | 'ar', asset: { id: string; display?: { url?: string } } | null) {
    if (!canManage || busyId) return;
    setBusyId(sector.id); setError(null);
    try {
      if (slot === 'photo') {
        await send('post', '/admin/media/assign', { entity: 'sector', entityId: sector.id, assetId: asset?.id ?? null });
        await refresh();
      } else {
        const url = asset ? asset.display?.url : null;
        if (asset && !url) throw new Error('Selected asset has no display URL');
        const updated = await setSectorBanner(sector.id, url ?? null, slot);
        setSectors((all) => (all ?? []).map((s) => (s.id === updated.id ? updated : s)));
      }
    } catch (err) {
      setError(apiErrorMessage(err, t('Could not update sector assets.', 'تعذر تحديث أصول القطاع.')));
    } finally { setBusyId(null); }
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
            <LabeledInput data-testid="sector-name-ar" label="Name (AR)" required dir="rtl" value={form.nameAr} placeholder="مطاعم" onChange={(e) => setForm((f) => ({ ...f, nameAr: e.target.value }))} />
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
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table data-testid="sectors-table" className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-3 text-start font-medium">{t('Sector', 'القطاع')}</th>
                  <th className="hidden px-3 py-3 text-start font-medium lg:table-cell">{t('Slug', 'المعرّف')}</th>
                  <th className="px-3 py-3 text-start font-medium">{t('Status', 'الحالة')}</th>
                  <th className="px-3 py-3 text-start font-medium">{t('Custom requests', 'الطلبات المخصصة')}</th>
                  <th className="px-3 py-3 text-start font-medium">{t('Actions', 'الإجراءات')}</th>
                </tr>
              </thead>
              <tbody>
                {sectors.map((s) => (
                  <tr key={s.id} data-testid={`sector-row-${s.id}`} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-3"><div className="flex items-center gap-3">
                      {s.imageUrl ? <img src={resolveMediaUrl(s.imageUrl)} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" /> : <div className="h-10 w-10 shrink-0 rounded-lg bg-gray-100" />}
                      <div className="min-w-0"><p className="font-medium text-gray-900">{s.name}</p>{s.nameAr && <p className="text-xs text-gray-500" dir="rtl">{s.nameAr}</p>}</div>
                    </div></td>
                    <td className="hidden px-3 py-3 text-gray-500 lg:table-cell" dir="ltr">{s.slug}</td>
                    <td className="px-3 py-3"><Badge tone={s.isActive ? 'green' : 'gray'}>{s.isActive ? t('Active', 'نشط') : t('Inactive', 'غير نشط')}</Badge></td>
                    <td className="px-3 py-3"><Switch s={s} testId={`sector-custom-requests-${s.id}`} /></td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" onClick={() => { setAssetsId(s.id); setAssetSlot(null); }}>{t('Assets', 'الأصول')}</Button>
                        {canManage && <Button size="sm" onClick={() => setEditing(s)}>{t('Edit', 'تعديل')}</Button>}
                        {canManage && <details className="relative">
                          <summary className="cursor-pointer list-none rounded-lg border border-gray-200 px-3 py-2 text-sm" aria-label={t('More actions', 'إجراءات إضافية')}>⋯</summary>
                          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border bg-white p-2">
                            <button type="button" data-testid={`sector-active-toggle-${s.id}`} disabled={busyId === s.id} onClick={() => void toggleActive(s)} className="px-2 py-1 text-xs font-medium text-hatly-orangeDark disabled:opacity-40">{s.isActive ? t('Deactivate', 'إيقاف') : t('Activate', 'تفعيل')}</button>
                            <DeleteRecordButton path={`/admin/sectors/${s.id}`} name={s.name} what={['Section', 'القسم']} consequence={['Only a section with no stores can be deleted: move its stores to another section first.', 'يمكن حذف القسم الذي لا يحتوي متاجر فقط: انقل متاجره أولًا.']} onDeleted={refresh} />
                          </div>
                        </details>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {editing && (
        <SimpleEditModal
          title={['Edit section', 'تعديل القسم']}
          path={`/admin/sectors/${editing.id}`}
          initial={editing as unknown as Record<string, unknown>}
          fields={[
            { key: 'name', label: ['Name (English)', 'الاسم (إنجليزي)'], required: true },
            { key: 'nameAr', label: ['Name (Arabic)', 'الاسم (عربي)'], dir: 'rtl' },
            { key: 'sortOrder', label: ['Display order (lowest first)', 'ترتيب العرض (الأقل أولًا)'], kind: 'int' },
          ]}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await refresh(); }}
        />
      )}
      {assetsSector && !assetSlot && (
        <Modal open title={`${t('Assets', 'الأصول')} — ${assetsSector.name}`} onClose={() => setAssetsId(null)} wide
          footer={<Button onClick={() => setAssetsId(null)}>{t('Done', 'تم')}</Button>}>
          {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
          <p className="text-xs text-gray-500">{t('Upload distinct English and Arabic artwork. If one banner is missing, the other is used. Changes save immediately.', 'ارفع تصميمًا مستقلًا لكل لغة. عند غياب أحد البانرين يُستخدم الآخر. تُحفظ التغييرات فورًا.')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              { slot: 'photo', title: t('Photo', 'الصورة'), url: assetsSector.imageUrl, hint: t('512 × 512 px (1:1). Center the subject.', '512 × 512 بكسل (1:1). ضع العنصر في المنتصف.') },
              { slot: 'en', title: t('Banner (EN)', 'البانر (إنجليزي)'), url: assetsSector.bannerUrl, hint: t('1280 × 720 px (16:9). English text, LTR layout.', '1280 × 720 بكسل (16:9). تصميم إنجليزي من اليسار إلى اليمين.') },
              { slot: 'ar', title: t('Banner (AR)', 'البانر (عربي)'), url: assetsSector.bannerUrlAr, hint: t('1280 × 720 px (16:9). Arabic text, RTL layout.', '1280 × 720 بكسل (16:9). تصميم عربي من اليمين إلى اليسار.') },
            ] as const).map(({slot, title, url, hint}) => (
              <section key={slot} className="space-y-2 rounded-xl border border-gray-200 p-3">
                <h3 className="font-medium">{title}</h3>
                <div className={`overflow-hidden rounded-lg bg-gray-50 ${slot === 'photo' ? 'aspect-square w-24' : 'aspect-video w-full'}`}>
                  {url ? <img src={resolveMediaUrl(url)} alt={title} className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center text-xs text-gray-400">{t('No image', 'لا توجد صورة')}</div>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" disabled={!canManage || !!busyId} onClick={() => { setError(null); setAssetSlot(slot); }}>{url ? t('Change image', 'تغيير الصورة') : t('Upload image', 'رفع صورة')}</Button>
                  <AssetHint text={hint} />
                  {url && <Button size="sm" variant="ghost" disabled={!canManage || !!busyId} onClick={() => void saveAsset(assetsSector, slot, null)}>{t('Remove', 'إزالة')}</Button>}
                </div>
              </section>
            ))}
          </div>
        </Modal>
      )}
      {assetsSector && assetSlot && <MediaPicker key={`${assetsSector.id}-${assetSlot}`} open
        onClose={() => setAssetSlot(null)}
        purpose={assetSlot === 'photo' ? 'SECTOR_IMAGE' : 'SECTOR_BANNER'}
        title={assetSlot === 'photo' ? t('Sector photo — 512 × 512 px', 'صورة القطاع — 512 × 512 بكسل') : assetSlot === 'en' ? t('English banner — 1280 × 720 px', 'البانر الإنجليزي — 1280 × 720 بكسل') : t('Arabic banner — 1280 × 720 px', 'البانر العربي — 1280 × 720 بكسل')}
        onPick={(picked) => { if (picked[0]) void saveAsset(assetsSector, assetSlot, picked[0]); setAssetSlot(null); }}
      />}
    </div>
  );
}

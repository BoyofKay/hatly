'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Vendor,
  VendorBranch,
  activateVendor,
  createVendorBranch,
  deactivateVendor,
  getVendor,
  listVendorBranches,
  updateVendor,
  uploadVendorCover,
  removeVendorCover,
  uploadVendorLogo,
} from '../../../../lib/api/admin-vendors';
import { apiErrorMessage } from '../../../../lib/api/errors';
import { checkImageFile } from '../../../../lib/banners/banner-form';
import { resolveMediaUrl } from '../../../../lib/media-url';
import { useLang } from '../../../../lib/ui/lang';
import { SettlementTermsCard } from '../../../../components/vendor/SettlementTermsCard';
import { DeleteRecordButton } from '../../../../components/admin/DeleteRecordButton';
import { ServiceArea, listServiceAreas } from '../../../../lib/api/admin-service-areas';
import { LabeledSelect } from '../../../../components/ui';
import { parseLatLng } from '../../../../lib/admin/lat-lng';
import { Badge, Button, Card, Column, ConfirmDialog, DataTable, ErrorState, KpiCard, LabeledInput, Modal, Skeleton, useToast } from '../../../../components/ui';

const LOGO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const LOGO_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Vendor profile — who the vendor is (name, Arabic name, logo, active state) and its branches. Consumes `admin/vendors` / `admin/vendor-branches`
 * exactly. A new branch is never auto-activated: the backend starts it inactive, and its sector, hours and delivery options are set on the branch page.
 */
export default function VendorDetailPage() {
  const { t } = useLang();
  const toast = useToast();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [branches, setBranches] = useState<VendorBranch[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [confirmToggle, setConfirmToggle] = useState(false);
  const [toggleBusy, setToggleBusy] = useState(false);

  const [branchOpen, setBranchOpen] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [branchAddress, setBranchAddress] = useState('');
  const [branchLat, setBranchLat] = useState('');
  const [branchLng, setBranchLng] = useState('');
  const [branchCommission, setBranchCommission] = useState('');
  const [branchAreaId, setBranchAreaId] = useState('');
  const [branchNameAr, setBranchNameAr] = useState('');
  const [mapsLink, setMapsLink] = useState('');
  const [areas, setAreas] = useState<ServiceArea[]>([]);
  useEffect(() => { listServiceAreas().then((a) => { setAreas(a.filter((x: any) => x.isActive !== false)); if (a.length === 1) setBranchAreaId(a[0].id); }).catch(() => undefined); }, []);
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [v, b] = await Promise.all([getVendor(id), listVendorBranches(id)]);
      setVendor(v);
      setName(v.name);
      setNameAr(v.nameAr ?? '');
      setLogoUrl(v.logoUrl ?? '');
      setBranches(b);
    } catch (err: any) {
      setError(apiErrorMessage(err, t('Failed to load vendor.', 'تعذّر تحميل المتجر.')));
    }
  }, [id, t]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    setActionError(null);
    try {
      // The logo is only sent when the field was actually edited: an uploaded logo is a server-relative reference (/uploads/files/...)
      // that the manual "Logo URL" field (absolute http(s) URLs only) must not resubmit.
      const logoChanged = logoUrl !== (vendor?.logoUrl ?? '');
      setVendor(await updateVendor(id, { name, nameAr: nameAr || undefined, ...(logoChanged ? { logoUrl: logoUrl || undefined } : {}) }));
      toast.push('success', t('Vendor saved.', 'تم حفظ المتجر.'));
    } catch (err: any) {
      setActionError(apiErrorMessage(err, t('Failed to save.', 'تعذّر الحفظ.')));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleLogoChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || isUploadingLogo) return;
    const problem = checkImageFile(file, LOGO_TYPES, LOGO_MAX_BYTES);
    if (problem) return setLogoError(problem);
    setIsUploadingLogo(true);
    setLogoError(null);
    try {
      const updated = await uploadVendorLogo(id, file);
      setVendor(updated);
      setLogoUrl(updated.logoUrl ?? '');
    } catch (err: any) {
      setLogoError(apiErrorMessage(err, t('Failed to upload the logo.', 'تعذّر رفع الشعار.')));
    } finally {
      setIsUploadingLogo(false);
    }
  }

  async function handleCoverChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || coverBusy) return;
    const problem = checkImageFile(file, LOGO_TYPES, LOGO_MAX_BYTES);
    if (problem) return setCoverError(problem);
    setCoverBusy(true);
    setCoverError(null);
    try {
      setVendor(await uploadVendorCover(id, file));
    } catch (err: any) {
      setCoverError(apiErrorMessage(err, t('Failed to upload the banner.', 'تعذّر رفع البانر.')));
    } finally {
      setCoverBusy(false);
    }
  }

  async function handleCoverRemove() {
    setCoverBusy(true);
    setCoverError(null);
    try {
      setVendor(await removeVendorCover(id));
    } catch (err: any) {
      setCoverError(apiErrorMessage(err, t('Failed to remove the banner.', 'تعذّر حذف البانر.')));
    } finally {
      setCoverBusy(false);
    }
  }

  async function handleToggleActive() {
    if (!vendor || toggleBusy) return;
    setToggleBusy(true);
    setActionError(null);
    try {
      setVendor(vendor.isActive ? await deactivateVendor(id) : await activateVendor(id));
      setConfirmToggle(false);
    } catch (err: any) {
      setConfirmToggle(false);
      setActionError(apiErrorMessage(err, t('Failed to update status.', 'تعذّر تحديث الحالة.')));
    } finally {
      setToggleBusy(false);
    }
  }

  async function handleCreateBranch(e: React.FormEvent) {
    e.preventDefault();
    if (isCreatingBranch) return;
    const latitude = Number(branchLat);
    const longitude = Number(branchLng);
    if (!branchLat.trim() || !branchLng.trim() || Number.isNaN(latitude) || Number.isNaN(longitude)) return setBranchError(t('Latitude and longitude must be valid numbers.', 'خط العرض وخط الطول يجب أن يكونا أرقامًا صحيحة.'));
    const percent = Number(branchCommission);
    if (!branchCommission.trim() || !(percent >= 0 && percent <= 100)) return setBranchError(t('Enter Hatly’s commission as a percentage (0–100). Without it, orders record no commission.', 'أدخل عمولة هاتلي كنسبة مئوية (0–100). بدونها لا تُسجَّل عمولة على الطلبات.'));
    if (!branchNameAr.trim()) return setBranchError(t('Enter the branch name in Arabic too.', 'أدخل اسم الفرع بالعربي أيضًا.'));
    if (!branchAreaId) return setBranchError(t('Choose the service area (customers only see stores in their area).', 'اختر منطقة الخدمة (العملاء يرون متاجر منطقتهم فقط).'));
    setIsCreatingBranch(true);
    setBranchError(null);
    try {
      const created = await createVendorBranch({ vendorId: id, name: branchName, nameAr: branchNameAr.trim(), address: branchAddress, latitude, longitude, serviceAreaId: branchAreaId, commissionRateBasisPoints: Math.round(percent * 100) });
      setBranchName(''); setBranchNameAr(''); setBranchAddress(''); setBranchLat(''); setBranchLng(''); setBranchCommission(''); setMapsLink('');
      setBranchOpen(false);
      toast.push('success', t('Branch created. Finish its go-live checklist.', 'تم إنشاء الفرع. أكمل قائمة الجاهزية.'));
      router.push(`/branches/${created.id}`);
    } catch (err: any) {
      setBranchError(apiErrorMessage(err, t('Failed to create branch.', 'تعذّر إنشاء الفرع.')));
    } finally {
      setIsCreatingBranch(false);
    }
  }

  const back = <Link href="/vendors" className="mb-3 inline-flex min-h-[36px] items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"><span aria-hidden className="rtl:rotate-180">←</span> {t('All vendors', 'كل المتاجر')}</Link>;
  if (error) return <div className="max-w-6xl">{back}<ErrorState message={error} onRetry={refresh} /></div>;
  if (!vendor) return <div className="max-w-6xl space-y-4" aria-busy="true">{back}<Skeleton className="h-20" /><Skeleton className="h-64" /></div>;

  const activeBranches = (branches ?? []).filter((b) => b.isActive).length;
  const columns: Column<VendorBranch>[] = [
    { key: 'name', header: t('Branch', 'الفرع'), cell: (b) => <Link href={`/branches/${b.id}`} className="font-medium text-gray-900 hover:underline">{b.name}</Link> },
    { key: 'address', header: t('Address', 'العنوان'), cell: (b) => <span className="text-gray-600">{b.address}</span> },
    { key: 'status', header: t('Status', 'الحالة'), cell: (b) => <span className="inline-flex flex-wrap gap-1"><Badge tone={b.isActive ? 'green' : 'gray'}>{b.isActive ? t('Active', 'نشط') : t('Inactive', 'غير نشط')}</Badge>{b.isActive && <Badge tone={b.isOpen ? 'blue' : 'amber'}>{b.isOpen ? t('Open', 'مفتوح') : t('Closed', 'مغلق')}</Badge>}</span> },
    { key: 'modes', header: t('Delivery / pickup', 'التوصيل / الاستلام'), cell: (b) => [b.deliveryEnabled && t('Delivery', 'توصيل'), b.pickupEnabled && t('Pickup', 'استلام')].filter(Boolean).join(' · ') || '—' },
    { key: 'commission', header: t('Commission', 'العمولة'), align: 'end', cell: (b) => (b.commissionRateBasisPoints != null ? `${b.commissionRateBasisPoints / 100}%` : '—') },
    { key: 'open', header: '', align: 'end', cell: (b) => <Link href={`/branches/${b.id}`} className="inline-flex min-h-[36px] items-center font-medium text-hatly-orangeDark hover:underline">{t('Open', 'فتح')}</Link> },
  ];

  return (
    <div className="max-w-6xl">
      {back}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {vendor.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img data-testid="vendor-logo" src={resolveMediaUrl(vendor.logoUrl)} alt={vendor.name} className="h-14 w-14 shrink-0 rounded-full border object-cover" />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border bg-gray-50 text-xs text-gray-400">{t('No logo', 'بلا شعار')}</div>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-gray-900 sm:text-2xl">{vendor.name}</h1>
            {vendor.nameAr && <p className="truncate text-sm text-gray-500" dir="rtl">{vendor.nameAr}</p>}
          </div>
          <Badge tone={vendor.isActive ? 'green' : 'gray'}>{vendor.isActive ? t('Active', 'نشط') : t('Inactive', 'غير نشط')}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant={vendor.isActive ? 'secondary' : 'primary'} className="min-h-[44px]" onClick={() => setConfirmToggle(true)}>{vendor.isActive ? t('Deactivate', 'إيقاف') : t('Activate', 'تفعيل')}</Button>
          <DeleteRecordButton
            size="md"
            path={`/admin/vendors/${vendor.id}`}
            name={vendor.name}
            what={['Store', 'المتجر']}
            consequence={['All its branches, menus, offers and store staff are switched off with it. Refused while any branch has orders in progress.', 'يتم إيقاف كل فروعه والمنيو والعروض وموظفي المتجر. يُرفض الحذف إذا كان لأي فرع طلبات جارية.']}
            strong
            onDeleted={() => router.replace('/vendors')}
          />
        </div>
      </div>
      {actionError && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label={t('Branches', 'الفروع')} value={branches?.length ?? '—'} />
        <KpiCard label={t('Active branches', 'الفروع النشطة')} value={activeBranches} tone={branches && activeBranches === 0 ? 'bad' : 'neutral'} hint={branches && branches.length > 0 && activeBranches === 0 ? t('No branch is active yet', 'لا يوجد فرع نشط بعد') : undefined} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title={t('Branches', 'الفروع')} pad={false} actions={<Button variant="primary" size="sm" className="min-h-[36px]" onClick={() => { setBranchError(null); setBranchOpen(true); }}>{t('New branch', 'فرع جديد')}</Button>}>
            <DataTable columns={columns} rows={branches ?? undefined} rowKey={(b) => b.id} emptyTitle={t('No branches yet.', 'لا توجد فروع بعد.')} emptyHint={t('Add a branch so this vendor can take orders.', 'أضف فرعًا ليتمكن المتجر من استقبال الطلبات.')} onRowClick={(b) => router.push(`/branches/${b.id}`)} />
          </Card>
        </div>

        <div className="space-y-4">
        <SettlementTermsCard vendorId={id} />
        <Card title={t('Profile', 'البيانات')}>
          <form onSubmit={handleSave} className="space-y-3">
            <LabeledInput label={t('Name', 'الاسم')} value={name} onChange={(e) => setName(e.target.value)} />
            <LabeledInput label={t('Name (Arabic)', 'الاسم (بالعربية)')} dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
            <div>
              <span className="mb-1 block text-xs font-medium text-gray-700">{t('Logo', 'الشعار')}</span>
              <input ref={logoInput} data-testid="vendor-logo-file" type="file" accept={LOGO_TYPES.join(',')} onChange={handleLogoChosen} className="hidden" />
              <Button type="button" onClick={() => logoInput.current?.click()} loading={isUploadingLogo}>{isUploadingLogo ? t('Uploading...', 'جارٍ الرفع...') : vendor.logoUrl ? t('Change logo', 'تغيير الشعار') : t('Upload logo', 'رفع شعار')}</Button>
              <p className="mt-1 text-xs text-gray-500">{t('Recommended: 512 × 512 px (1:1), centered with padding for circular crop. JPEG, PNG or WebP, up to 5 MB. It is saved immediately.', 'المقاس المقترح 512 × 512 بكسل (1:1)، الشعار في المنتصف مع مساحة حوله للقص الدائري. JPEG أو PNG أو WebP حتى 5 ميجابايت. يُحفظ فورًا.')}</p>
              {logoError && <p role="alert" className="mt-1 text-sm text-red-600">{logoError}</p>}
            </div>
            <div>
              <span className="mb-1 block text-xs font-medium text-gray-700">{t('Banner (top of the store page in the app)', 'البانر (أعلى صفحة المتجر في التطبيق)')}</span>
              {vendor.coverImageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img data-testid="vendor-cover" src={resolveMediaUrl(vendor.coverImageUrl)} alt="" className="mb-2 aspect-[16/9] w-full rounded-lg border object-cover" />
              )}
              <input ref={coverInput} data-testid="vendor-cover-file" type="file" accept={LOGO_TYPES.join(',')} onChange={handleCoverChosen} className="hidden" />
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => coverInput.current?.click()} loading={coverBusy}>{vendor.coverImageUrl ? t('Change banner', 'تغيير البانر') : t('Upload banner', 'رفع بانر')}</Button>
                {vendor.coverImageUrl && <Button type="button" variant="ghost" disabled={coverBusy} onClick={() => void handleCoverRemove()}>{t('Remove', 'إزالة')}</Button>}
              </div>
              <p className="mt-1 text-xs text-gray-500">{t('Recommended: 1280 × 720 px (16:9). Keep the lower leading corner clear for the store-name label and overlapping logo. JPEG, PNG or WebP, up to 5 MB. Saved immediately. Without a banner the app shows the logo.', 'المقاس المقترح 1280 × 720 بكسل (16:9). اترك الركن السفلي لاسم المتجر والشعار المتداخل. JPEG أو PNG أو WebP حتى 5 ميجا. تُحفظ فورًا. بدون بانر يعرض التطبيق الشعار.')}</p>
              {coverError && <p role="alert" className="mt-1 text-sm text-red-600">{coverError}</p>}
            </div>
            <LabeledInput label={t('Logo URL (optional — an external https address)', 'رابط الشعار (اختياري — عنوان https خارجي)')} dir="ltr" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
            <Button type="submit" variant="primary" loading={isSaving} className="min-h-[44px] w-full">{isSaving ? t('Saving...', 'جارٍ الحفظ...') : t('Save', 'حفظ')}</Button>
          </form>
        </Card>
        </div>
      </div>

      <Modal
        open={branchOpen}
        title={t('New branch', 'فرع جديد')}
        onClose={() => !isCreatingBranch && setBranchOpen(false)}
        footer={<><Button onClick={() => setBranchOpen(false)} disabled={isCreatingBranch}>{t('Cancel', 'إلغاء')}</Button><Button variant="primary" type="submit" form="vd-branch" loading={isCreatingBranch}>{isCreatingBranch ? t('Creating...', 'جارٍ الإنشاء...') : t('Create branch', 'إنشاء الفرع')}</Button></>}
      >
        <form id="vd-branch" onSubmit={handleCreateBranch} className="space-y-3">
          <LabeledInput label={t('Branch name (English)', 'اسم الفرع (إنجليزي)')} required value={branchName} onChange={(e) => setBranchName(e.target.value)} />
          <LabeledInput label={t('Branch name (Arabic)', 'اسم الفرع (عربي)')} required dir="rtl" value={branchNameAr} onChange={(e) => setBranchNameAr(e.target.value)} />
          <LabeledInput label={t('Address', 'العنوان')} required value={branchAddress} onChange={(e) => setBranchAddress(e.target.value)} />
          <LabeledInput
            label={t('Location: paste a Google Maps link or "lat, lng"', 'الموقع: الصق رابط خرائط جوجل أو "خط العرض، خط الطول"')}
            dir="ltr" value={mapsLink} placeholder="https://maps.google.com/?q=30.4170,31.5620"
            onChange={(e) => { setMapsLink(e.target.value); const p = parseLatLng(e.target.value); if (p) { setBranchLat(String(p.lat)); setBranchLng(String(p.lng)); } }}
            hint={t('In Google Maps: long-press the shop → copy the coordinates or Share → Copy link.', 'في خرائط جوجل: اضغط مطولًا على المحل ← انسخ الإحداثيات أو مشاركة ← نسخ الرابط.')}
          />
          <div className="grid grid-cols-2 gap-3">
            <LabeledInput label={t('Latitude', 'خط العرض')} required dir="ltr" inputMode="decimal" value={branchLat} onChange={(e) => setBranchLat(e.target.value)} />
            <LabeledInput label={t('Longitude', 'خط الطول')} required dir="ltr" inputMode="decimal" value={branchLng} onChange={(e) => setBranchLng(e.target.value)} />
          </div>
          <LabeledSelect label={t('Service area', 'منطقة الخدمة')} required value={branchAreaId} onChange={(e) => setBranchAreaId(e.target.value)}>
            <option value="">{t('Choose…', 'اختر…')}</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.nameAr ? `${a.name} — ${a.nameAr}` : a.name}</option>)}
          </LabeledSelect>
          <LabeledInput label={t('Hatly commission (%)', 'عمولة هاتلي (%)')} required dir="ltr" inputMode="decimal" placeholder="15" value={branchCommission} onChange={(e) => setBranchCommission(e.target.value)} />
          <p className="text-xs text-gray-500">{t('The new branch starts inactive and closed. Next, its page shows a go-live checklist: section, menu, staff, hours, then activate and open.', 'يبدأ الفرع غير مفعّل ومغلقًا. ستعرض صفحته قائمة الجاهزية: القسم والمنيو والموظفون والمواعيد ثم التفعيل والفتح.')}</p>
          {branchError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{branchError}</p>}
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmToggle}
        title={vendor.isActive ? t('Deactivate this vendor?', 'إيقاف هذا المتجر؟') : t('Activate this vendor?', 'تفعيل هذا المتجر؟')}
        message={vendor.isActive ? t(`${vendor.name} will no longer be listed or found in search in the customer app.`, `لن يظهر ${vendor.name} في قوائم تطبيق العملاء ولا في نتائج البحث.`) : t(`${vendor.name} is listed and searchable for customers again (through its active branches).`, `سيظهر ${vendor.name} للعملاء مجددًا في القوائم والبحث (عبر فروعه النشطة).`)}
        confirmLabel={vendor.isActive ? t('Deactivate', 'إيقاف') : t('Activate', 'تفعيل')}
        danger={vendor.isActive}
        busy={toggleBusy}
        onConfirm={() => void handleToggleActive()}
        onClose={() => setConfirmToggle(false)}
      />
    </div>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BANNER_IMAGE_MAX_BYTES,
  BANNER_IMAGE_TYPES,
  BannerActionType,
  HomeBanner,
  MANAGE_HOME_BANNERS,
  bannerErrorMessage,
  createHomeBanner,
  deleteHomeBanner,
  listHomeBanners,
  setHomeBannerActive,
  updateHomeBanner,
  uploadHomeBannerImage,
} from '../../../lib/api/admin-home-banners';
import { AdminSector, listAdminSectors } from '../../../lib/api/admin-sectors';
import { Product, listProducts } from '../../../lib/api/admin-catalog';
import { VendorBranch, listVendorBranches } from '../../../lib/api/admin-vendors';
import { useAdminPermission } from '../../../lib/auth/use-admin-permission';
import { resolveMediaUrl } from '../../../lib/media-url';
import {
  BannerFormState,
  EMPTY_BANNER_FORM,
  buildCreateBody,
  buildUpdateBody,
  checkBannerShape,
  checkImageFile,
  isoToLocalInput,
} from '../../../lib/banners/banner-form';
import { useLang } from '../../../lib/ui/lang';
import { useIsMobile } from '../../../lib/ui/use-media-query';

/**
 * Home banners — the promotional images at the top of the customer app's Home. A banner is a DRAFT until it has an image and an
 * admin publishes it; customers only ever receive banners that are published, inside their schedule, and whose destination still
 * exists. Images go through the same upload boundary as product images (JPEG/PNG/WebP, up to 5 MB). Permissions are enforced by the
 * backend; the UI only disables what the signed-in admin cannot do.
 */

const STATUS_STYLE: Record<HomeBanner['displayStatus'], string> = {
  DRAFT: 'bg-gray-200 text-gray-700',
  LIVE: 'bg-green-100 text-green-700',
  SCHEDULED: 'bg-blue-100 text-blue-700',
  EXPIRED: 'bg-amber-100 text-amber-800',
};
const STATUS_LABEL: Record<HomeBanner['displayStatus'], string> = { DRAFT: 'Draft', LIVE: 'Live', SCHEDULED: 'Scheduled', EXPIRED: 'Ended' };
const ACTION_LABEL: Record<BannerActionType, string> = { NONE: 'None (not tappable)', PRODUCT: 'A product', VENDOR: 'A vendor branch', SECTOR: 'A sector (category)' };

function toForm(b: HomeBanner): BannerFormState {
  return {
    title: b.title,
    titleAr: b.titleAr ?? '',
    actionType: b.actionType,
    productId: b.actionType === 'PRODUCT' ? (b.actionTargetId ?? '') : '',
    branchId: b.actionType === 'VENDOR' ? (b.actionTargetId ?? '') : '',
    sectorId: b.actionType === 'SECTOR' ? (b.actionTargetId ?? '') : '',
    sortOrder: String(b.sortOrder),
    startsAt: isoToLocalInput(b.startsAt),
    endsAt: isoToLocalInput(b.endsAt),
  };
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function Field({ label, value, onChange, testId, dir, placeholder, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; testId: string; dir?: 'rtl' | 'ltr'; placeholder?: string; type?: string }) {
  return (
    <label className="block text-sm">
      <span className="font-medium">{label}</span>
      <input data-testid={testId} type={type} dir={dir} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm" />
    </label>
  );
}

function BannerForm({
  initial,
  sectors,
  branches,
  submitLabel,
  onSubmit,
  onCancel,
  isEdit,
}: {
  initial: BannerFormState;
  sectors: AdminSector[];
  branches: VendorBranch[];
  submitLabel: string;
  isEdit: boolean;
  onSubmit: (body: ReturnType<typeof buildCreateBody>) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<BannerFormState>(initial);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof BannerFormState) => (v: string) => setForm((f) => ({ ...f, [key]: v }));

  // A product is found through its branch: choosing a branch loads that branch's products.
  const productBranch = form.actionType === 'PRODUCT' ? form.branchId : '';
  useEffect(() => {
    if (!productBranch) {
      setProducts(null);
      return;
    }
    let cancelled = false;
    setProductsError(null);
    listProducts(productBranch)
      .then((p) => !cancelled && setProducts(p))
      .catch((err) => !cancelled && setProductsError(bannerErrorMessage(err, 'Could not load the products of this branch.')));
    return () => {
      cancelled = true;
    };
  }, [productBranch]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const v = isEdit ? buildUpdateBody(form) : buildCreateBody(form);
    if (!v.ok) {
      setError(v.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(v as ReturnType<typeof buildCreateBody>);
    } catch (err) {
      setError(bannerErrorMessage(err, 'Failed to save the banner.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} data-testid="banner-form" className="mt-4 space-y-3 rounded-xl border bg-white p-4 border-gray-200 shadow-sm">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Title (EN) — also the description for screen readers" value={form.title} onChange={set('title')} testId="banner-title" placeholder="Weekend offers" />
        <Field label="Title (AR)" value={form.titleAr} onChange={set('titleAr')} testId="banner-title-ar" dir="rtl" placeholder="عروض نهاية الأسبوع" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="font-medium">When tapped, open…</span>
          <select data-testid="banner-action" value={form.actionType} onChange={(e) => set('actionType')(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm">
            {(Object.keys(ACTION_LABEL) as BannerActionType[]).map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a]}
              </option>
            ))}
          </select>
        </label>
        <Field label="Display order (lowest first)" value={form.sortOrder} onChange={set('sortOrder')} testId="banner-sort-order" />
      </div>

      {form.actionType === 'SECTOR' && (
        <label className="block text-sm">
          <span className="font-medium">Sector</span>
          <select data-testid="banner-sector" value={form.sectorId} onChange={(e) => set('sectorId')(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm">
            <option value="">Choose…</option>
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.nameAr ? ` / ${s.nameAr}` : ''}
                {s.isActive ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
        </label>
      )}
      {(form.actionType === 'VENDOR' || form.actionType === 'PRODUCT') && (
        <label className="block text-sm">
          <span className="font-medium">Vendor branch</span>
          <select
            data-testid="banner-branch"
            value={form.branchId}
            onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value, productId: '' }))}
            className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
          >
            <option value="">Choose…</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.isActive ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
        </label>
      )}
      {form.actionType === 'PRODUCT' && form.branchId && (
        <label className="block text-sm">
          <span className="font-medium">Product</span>
          {productsError ? (
            <p data-testid="banner-products-error" className="mt-1 text-sm text-red-600">
              {productsError}
            </p>
          ) : products === null ? (
            <p className="mt-1 text-sm text-gray-500">Loading products…</p>
          ) : products.length === 0 ? (
            <p data-testid="banner-products-empty" className="mt-1 text-sm text-gray-500">
              This branch has no products yet.
            </p>
          ) : (
            <select data-testid="banner-product" value={form.productId} onChange={(e) => set('productId')(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm">
              <option value="">Choose…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.isAvailable ? '' : ' (unavailable)'}
                </option>
              ))}
            </select>
          )}
        </label>
      )}

      <fieldset className="rounded border border-dashed p-3">
        <legend className="px-1 text-xs text-gray-500">Schedule (optional, your local time) — leave empty to show it as soon as it is published</legend>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Show from" value={form.startsAt} onChange={set('startsAt')} testId="banner-starts" type="datetime-local" />
          <Field label="Show until" value={form.endsAt} onChange={set('endsAt')} testId="banner-ends" type="datetime-local" />
        </div>
      </fieldset>
      <p className="text-xs text-gray-500">{isEdit ? 'The image is changed from the list.' : 'You add the image next, then publish.'}</p>
      {error && (
        <p data-testid="banner-form-error" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50 shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
          {busy ? 'Saving…' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm border-gray-300 bg-white font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function HomeBannersPage() {
  const { t: tl } = useLang();
  const isPhone = useIsMobile();
  const [statusFilter, setStatusFilter] = useState<'ALL' | HomeBanner['displayStatus']>('ALL');
  const [banners, setBanners] = useState<HomeBanner[] | null>(null);
  const [sectors, setSectors] = useState<AdminSector[]>([]);
  const [branches, setBranches] = useState<VendorBranch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const uploadTarget = useRef<string | null>(null);
  const canManage = useAdminPermission(MANAGE_HOME_BANNERS) === true;

  async function refresh() {
    setError(null);
    try {
      setBanners(await listHomeBanners());
    } catch (err) {
      setError(bannerErrorMessage(err, 'Failed to load the banners.'));
    }
  }

  useEffect(() => {
    refresh();
    // The pickers are conveniences: a failure here only means the destination lists stay empty (the page still works for "None").
    listAdminSectors().then(setSectors).catch(() => undefined);
    listVendorBranches().then(setBranches).catch(() => undefined);
  }, []);

  const label = useMemo(() => {
    const sectorName = new Map(sectors.map((s) => [s.id, s.name]));
    const branchName = new Map(branches.map((b) => [b.id, b.name]));
    return (b: HomeBanner) => {
      if (b.actionType === 'NONE') return 'Not tappable';
      if (b.actionType === 'SECTOR') return `Sector: ${sectorName.get(b.actionTargetId ?? '') ?? b.actionTargetId}`;
      if (b.actionType === 'VENDOR') return `Branch: ${branchName.get(b.actionTargetId ?? '') ?? b.actionTargetId}`;
      return `Product: ${b.actionTargetId}`;
    };
  }, [sectors, branches]);

  async function run(banner: HomeBanner, action: () => Promise<unknown>, fallback: string) {
    if (busyId) return;
    setBusyId(banner.id);
    setRowError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setRowError({ id: banner.id, message: bannerErrorMessage(err, fallback) });
    } finally {
      setBusyId(null);
    }
  }

  function chooseImage(banner: HomeBanner) {
    uploadTarget.current = banner.id;
    fileInput.current?.click();
  }

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const id = uploadTarget.current;
    e.target.value = ''; // the same file can be chosen again after a failure
    const banner = banners?.find((b) => b.id === id);
    if (!file || !banner) return;
    const problem = checkImageFile(file, BANNER_IMAGE_TYPES, BANNER_IMAGE_MAX_BYTES);
    if (problem) {
      setRowError({ id: banner.id, message: problem });
      return;
    }
    // The shape is checked here too (the server checks again): a wide image only, so the carousel never crops it badly.
    try {
      const bitmap = await createImageBitmap(file);
      const shapeProblem = checkBannerShape(bitmap.width, bitmap.height);
      bitmap.close();
      if (shapeProblem) {
        setRowError({ id: banner.id, message: shapeProblem });
        return;
      }
    } catch {
      setRowError({ id: banner.id, message: 'This file could not be read as an image.' });
      return;
    }
    await run(banner, () => uploadHomeBannerImage(banner.id, file), 'Failed to upload the image.');
  }

  const shown = (banners ?? []).filter((b) => statusFilter === 'ALL' || b.displayStatus === statusFilter);

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between">
        <div className="min-w-0"><h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">{tl('Home Banners', 'بانرات الرئيسية')}</h1><p className="mt-1 max-w-3xl text-sm text-gray-500">{tl('The banners customers see at the top of Home, and where each one leads.', 'البانرات التي يراها العملاء أعلى الصفحة الرئيسية، وإلى أين يقود كل منها.')}</p></div>
        <button
          data-testid="banner-new"
          onClick={() => {
            setEditingId(null);
            setCreating((v) => !v);
          }}
          disabled={!canManage}
          title={canManage ? undefined : 'Requires the MANAGE_HOME_BANNERS permission'}
          className="rounded-lg bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50 shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40"
        >
          {creating ? 'Cancel' : 'New banner'}
        </button>
      </div>
      <div className="mt-2 space-y-1 text-sm text-gray-600">
        <p data-testid="banners-rule">
          Banners appear in the carousel at the top of the customer app&apos;s Home, lowest display order first (at most 10). A new banner is a draft: add an
          image (JPEG, PNG or WebP, up to 5 MB, wide about 2:1 and at least 800×320 pixels — 1200×600 recommended), then publish it. Only published banners inside their schedule whose destination
          still exists are shown.
        </p>
      </div>
      <input ref={fileInput} data-testid="banner-file" type="file" accept={BANNER_IMAGE_TYPES.join(',')} onChange={onFileChosen} className="hidden" />

      {creating && (
        <BannerForm
          initial={EMPTY_BANNER_FORM}
          sectors={sectors}
          branches={branches}
          isEdit={false}
          submitLabel="Create draft"
          onCancel={() => setCreating(false)}
          onSubmit={async (v) => {
            if (!v.ok) return;
            await createHomeBanner(v.body);
            setCreating(false);
            await refresh();
          }}
        />
      )}

      <div className="mt-6">
        {error && (
          <div data-testid="banners-error" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}{' '}
            <button onClick={refresh} className="underline">
              Retry
            </button>
          </div>
        )}
        {!error && banners === null && <p className="text-gray-500">Loading...</p>}
        {!error && banners !== null && banners.length === 0 && (
          <p data-testid="banners-empty" className="text-gray-500">
            No banners yet. Create one, add an image, then publish it.
          </p>
        )}
        {banners !== null && banners.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="banners-filters">
            {(['ALL', 'LIVE', 'SCHEDULED', 'DRAFT', 'EXPIRED'] as const).map((f) => {
              const n = f === 'ALL' ? banners.length : banners.filter((b) => b.displayStatus === f).length;
              return (
                <button key={f} onClick={() => setStatusFilter(f)} aria-pressed={statusFilter === f} className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3 text-sm font-medium ${statusFilter === f ? 'border-hatly-orange bg-hatly-orange text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
                  {f === 'ALL' ? tl('All', 'الكل') : f === 'LIVE' ? tl('Live', 'منشور') : f === 'SCHEDULED' ? tl('Scheduled', 'مجدول') : f === 'DRAFT' ? tl('Draft', 'مسودة') : tl('Ended', 'منتهي')} <span className={`rounded-full px-1.5 text-xs ${statusFilter === f ? 'bg-white/25' : 'bg-gray-100 text-gray-600'}`}>{n}</span>
                </button>
              );
            })}
            <span className="text-xs text-gray-500">{tl(`${banners.filter((b) => b.displayStatus === 'LIVE').length} live in the carousel (at most 10)`, `${banners.filter((b) => b.displayStatus === 'LIVE').length} منشور في الشريط (الحد الأقصى 10)`)}</span>
          </div>
        )}
        {banners !== null && banners.length > 0 && !isPhone && (
          <div className="overflow-x-auto">
          <table data-testid="banners-table" className="mt-2 w-full divide-y rounded border bg-white text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 tracking-wide">
              <tr>
                <th className="px-3 py-2 text-start font-medium">Image</th>
                <th className="px-3 py-2 text-start font-medium">Title</th>
                <th className="px-3 py-2 text-start font-medium">Opens</th>
                <th className="px-3 py-2 text-start font-medium">Schedule</th>
                <th className="px-3 py-2 text-start font-medium">Order</th>
                <th className="px-3 py-2 text-start font-medium">Status</th>
                <th className="px-3 py-2 text-start font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map((b) =>
                editingId === b.id ? (
                  <tr key={b.id}>
                    <td colSpan={7} className="px-3 py-2">
                      <BannerForm
                        initial={toForm(b)}
                        sectors={sectors}
                        branches={branches}
                        isEdit
                        submitLabel="Save changes"
                        onCancel={() => setEditingId(null)}
                        onSubmit={async (v) => {
                          if (!v.ok) return;
                          await updateHomeBanner(b.id, v.body);
                          setEditingId(null);
                          await refresh();
                        }}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={b.id} data-testid={`banner-row-${b.id}`}>
                    <td className="px-3 py-2">
                      {b.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img data-testid="banner-thumb" src={resolveMediaUrl(b.imageUrl)} alt={b.title} className="h-16 w-28 rounded border object-cover" />
                      ) : (
                        <div data-testid="banner-no-image" className="flex h-16 w-28 items-center justify-center rounded border border-dashed text-xs text-gray-400">
                          No image
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{b.title}</div>
                      {b.titleAr && (
                        <div className="text-xs text-gray-500" dir="rtl">
                          {b.titleAr}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">{label(b)}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      <div>From: {formatWhen(b.startsAt)}</div>
                      <div>Until: {formatWhen(b.endsAt)}</div>
                    </td>
                    <td className="px-3 py-2">{b.sortOrder}</td>
                    <td className="px-3 py-2">
                      <span data-testid="banner-status" className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[b.displayStatus]}`}>
                        {b.isActive && !b.imageUrl ? 'Draft' : STATUS_LABEL[b.displayStatus]}
                      </span>
                    </td>
                    <td className="space-x-2 px-3 py-2 text-right whitespace-nowrap">
                      <button data-testid="banner-image" disabled={!canManage || busyId === b.id} onClick={() => chooseImage(b)} className="text-xs text-gray-600 underline disabled:opacity-40">
                        {b.imageUrl ? 'Change image' : 'Upload image'}
                      </button>
                      <button data-testid="banner-edit" disabled={!canManage || busyId === b.id} onClick={() => { setCreating(false); setEditingId(b.id); }} className="text-xs text-gray-600 underline disabled:opacity-40">
                        Edit
                      </button>
                      <button
                        data-testid="banner-toggle"
                        disabled={!canManage || busyId === b.id || (!b.isActive && !b.imageUrl)}
                        title={!b.isActive && !b.imageUrl ? 'Upload an image first' : undefined}
                        onClick={() => run(b, () => setHomeBannerActive(b.id, !b.isActive), 'Failed to update the banner.')}
                        className="text-xs text-gray-600 underline disabled:opacity-40"
                      >
                        {b.isActive ? 'Unpublish' : 'Publish'}
                      </button>
                      <button
                        data-testid="banner-delete"
                        disabled={!canManage || busyId === b.id}
                        onClick={() => {
                          if (window.confirm(`Delete the banner "${b.title}"? Customers stop seeing it immediately.`)) {
                            run(b, () => deleteHomeBanner(b.id), 'Failed to delete the banner.');
                          }
                        }}
                        className="text-xs text-red-600 underline disabled:opacity-40"
                      >
                        Delete
                      </button>
                      {rowError?.id === b.id && (
                        <p data-testid="banner-row-error" className="mt-1 whitespace-normal text-right text-xs text-red-600">
                          {rowError.message}
                        </p>
                      )}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
          </div>
        )}
        {banners !== null && banners.length > 0 && shown.length === 0 && <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">{tl('No banner has this status.', 'لا يوجد بانر بهذه الحالة.')}</p>}
        {banners !== null && shown.length > 0 && isPhone && (
          <ul className="space-y-3" data-testid="banners-cards">
            {shown.map((b) => (
              <li key={`card-${b.id}`} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                {editingId === b.id ? (
                  <div className="p-3"><BannerForm initial={toForm(b)} sectors={sectors} branches={branches} isEdit submitLabel="Save changes" onCancel={() => setEditingId(null)} onSubmit={async (v) => { if (!v.ok) return; await updateHomeBanner(b.id, v.body); setEditingId(null); await refresh(); }} /></div>
                ) : (
                  <>
                    {b.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={resolveMediaUrl(b.imageUrl)} alt={b.title} className="aspect-[2/1] w-full object-cover" />
                    ) : (
                      <div className="flex aspect-[2/1] w-full items-center justify-center border-b border-dashed bg-gray-50 text-sm text-gray-400">{tl('No image yet', 'لا توجد صورة بعد')}</div>
                    )}
                    <div className="space-y-2 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0"><p className="font-semibold">{b.title}</p>{b.titleAr && <p className="text-sm text-gray-500" dir="rtl">{b.titleAr}</p>}</div>
                        <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${STATUS_STYLE[b.displayStatus]}`}>{b.isActive && !b.imageUrl ? 'Draft' : STATUS_LABEL[b.displayStatus]}</span>
                      </div>
                      <p className="text-xs text-gray-600">{label(b)} · #{b.sortOrder}</p>
                      <p className="text-xs text-gray-500">{formatWhen(b.startsAt)} → {formatWhen(b.endsAt)}</p>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button disabled={!canManage || busyId === b.id} onClick={() => chooseImage(b)} className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm font-medium disabled:opacity-40">{b.imageUrl ? tl('Change image', 'تغيير الصورة') : tl('Upload image', 'رفع صورة')}</button>
                        <button disabled={!canManage || busyId === b.id} onClick={() => { setCreating(false); setEditingId(b.id); }} className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm font-medium disabled:opacity-40">{tl('Edit', 'تعديل')}</button>
                        <button disabled={!canManage || busyId === b.id || (!b.isActive && !b.imageUrl)} onClick={() => run(b, () => setHomeBannerActive(b.id, !b.isActive), 'Failed to update the banner.')} className="min-h-[44px] rounded-lg bg-hatly-orange px-3 text-sm font-medium text-white disabled:opacity-40">{b.isActive ? tl('Unpublish', 'إلغاء النشر') : tl('Publish', 'نشر')}</button>
                        <button disabled={!canManage || busyId === b.id} onClick={() => { if (window.confirm(`Delete the banner "${b.title}"? Customers stop seeing it immediately.`)) run(b, () => deleteHomeBanner(b.id), 'Failed to delete the banner.'); }} className="min-h-[44px] rounded-lg px-3 text-sm font-medium text-red-600 disabled:opacity-40">{tl('Delete', 'حذف')}</button>
                      </div>
                      {rowError?.id === b.id && <p className="text-xs text-red-600">{rowError.message}</p>}
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  VendorBranch,
  activateVendorBranch,
  assignVendorBranchSector,
  closeVendorBranch,
  deactivateVendorBranch,
  getVendorBranch,
  openVendorBranch,
  updateVendorBranch,
} from '../../../../lib/api/admin-vendors';
import {
  Product,
  ProductCategory,
  activateCategory,
  activateProduct,
  createCategory,
  createProduct,
  deactivateCategory,
  deactivateProduct,
  listCategories,
  listProducts,
  setProductInventoryToZero,
} from '../../../../lib/api/admin-catalog';
import { MarketplaceSector, listSectors } from '../../../../lib/api/sectors';
import { ProductOptionsEditor } from '../../../../components/products/ProductOptionsEditor';
import { ServiceArea, listServiceAreas } from '../../../../lib/api/admin-service-areas';
import { apiErrorMessage } from '../../../../lib/api/errors';
import { BranchAcceptanceMode } from '../../../../components/operations/BranchAcceptanceMode';
import { BranchClosures } from '../../../../components/vendor/BranchClosures';
import { BranchHoursEditor } from '../../../../components/vendor/BranchHoursEditor';
import { DeleteRecordButton } from '../../../../components/admin/DeleteRecordButton';
import { MenuImportPanel } from '../../../../components/admin/MenuImportPanel';
import { basisPointsToPercent, parseEgpToMinor, parsePercentToBasisPoints } from '../../../../lib/money';
import { BranchReadinessCard } from '../../../../components/admin/BranchReadinessCard';
import { CategoryEditModal, ProductEditModal } from '../../../../components/admin/CatalogEditModals';
import { useRouter } from 'next/navigation';
import { useLang } from '../../../../lib/ui/lang';

/**
 * Real Branch detail/edit/activate + Sector assignment (reuses the
 * EXISTING sector endpoint, no new Sectors backend) + Category/Product
 * management — consumes Chunk 1/2 endpoints exactly. New categories
 * and products are ACTIVE immediately on creation (the closed
 * decision — no publish step). `pricingUnit` is selectable only at
 * product creation and never appears in the edit form.
 */
export default function BranchDetailPage() {
  const { t } = useLang();
  const { id } = useParams<{ id: string }>();
  const [branch, setBranch] = useState<VendorBranch | null>(null);
  const [sectors, setSectors] = useState<MarketplaceSector[]>([]);
  const [serviceAreas, setServiceAreas] = useState<ServiceArea[]>([]);
  const [categories, setCategories] = useState<ProductCategory[] | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingCategory, setEditingCategory] = useState<ProductCategory | null>(null);
  const router = useRouter();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [categoryNameAr, setCategoryNameAr] = useState('');
  const [productNameAr, setProductNameAr] = useState('');
  const [address, setAddress] = useState('');
  const [commission, setCommission] = useState('');
  const [deliveryEnabled, setDeliveryEnabled] = useState(true);
  const [pickupEnabled, setPickupEnabled] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTogglingOpen, setIsTogglingOpen] = useState(false);
  const [selectedSectorId, setSelectedSectorId] = useState('');
  const [selectedServiceAreaId, setSelectedServiceAreaId] = useState('');
  const [serviceAreaError, setServiceAreaError] = useState<string | null>(null);

  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [categoryName, setCategoryName] = useState('');

  const [optionsOpenId, setOptionsOpenId] = useState<string | null>(null);
  const [showProductForm, setShowProductForm] = useState(false);
  const [productName, setProductName] = useState('');
  const [productCategoryId, setProductCategoryId] = useState('');
  const [productPrice, setProductPrice] = useState('');
  const [productPricingUnit, setProductPricingUnit] = useState<'PIECE' | 'WEIGHT'>('PIECE');
  const [productError, setProductError] = useState<string | null>(null);

  // Menu import (MenuImportPanel).
  const [showImport, setShowImport] = useState(false);

  async function refresh() {
    setError(null);
    try {
      const [b, s, sa, c, p] = await Promise.all([
        getVendorBranch(id),
        listSectors(),
        listServiceAreas(),
        listCategories(id),
        listProducts(id),
      ]);
      setBranch(b);
      setName(b.name);
      setNameAr(b.nameAr ?? '');
      setAddress(b.address);
      setCommission(basisPointsToPercent(b.commissionRateBasisPoints));
      setDeliveryEnabled(b.deliveryEnabled);
      setPickupEnabled(b.pickupEnabled);
      setSelectedSectorId(b.marketplaceSectorId ?? '');
      setSelectedServiceAreaId(b.serviceAreaId ?? '');
      setSectors(s);
      setServiceAreas(sa);
      setCategories(c);
      setProducts(p);
      if (!productCategoryId && c.length > 0) setProductCategoryId(c[0].id);
    } catch (err: any) {
      setError(apiErrorMessage(err, t("Failed to load branch.", "تعذّر تحميل الفرع.")));
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleSaveBranch(e: React.FormEvent) {
    e.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    setActionError(null);
    try {
      const commissionBp = commission.trim() ? parsePercentToBasisPoints(commission) : undefined;
      if (commissionBp === null) {
        setActionError(t("Commission must be a percentage between 0 and 100, e.g. 15 or 12.5.", "يجب أن تكون العمولة نسبة من 0 إلى 100، مثل 15 أو 12.5."));
        return;
      }
      if (!nameAr.trim()) {
        setActionError(t("Enter the Arabic name too — the app is Arabic and English.", "أدخل الاسم بالعربية أيضًا — التطبيق باللغتين العربية والإنجليزية."));
        return;
      }
      const updated = await updateVendorBranch(id, {
        name,
        nameAr: nameAr.trim(),
        address,
        deliveryEnabled,
        pickupEnabled,
        commissionRateBasisPoints: commissionBp,
      });
      setBranch(updated);
    } catch (err: any) {
      setActionError(apiErrorMessage(err, t("Failed to save branch.", "تعذّر حفظ الفرع.")));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleToggleActive() {
    if (!branch) return;
    setActionError(null);
    try {
      const updated = branch.isActive ? await deactivateVendorBranch(id) : await activateVendorBranch(id);
      setBranch(updated);
    } catch (err: any) {
      setActionError(apiErrorMessage(err, t("Failed to update status.", "تعذّر تحديث الحالة.")));
    }
  }

  /**
   * M1 (Launch-Readiness Gap Audit, G-01) — the first UI control for
   * `isOpen` anywhere in the dashboard. Explicit open/close calls
   * (never a blind toggle client-side, matching the new backend
   * endpoints), guarded by `isTogglingOpen` against a double-submit,
   * and re-set from the server's own response rather than assumed —
   * same shape as `handleToggleActive` above, plus the guard.
   */
  async function handleToggleOpen() {
    if (!branch || isTogglingOpen) return;
    setIsTogglingOpen(true);
    setActionError(null);
    try {
      const updated = branch.isOpen ? await closeVendorBranch(id) : await openVendorBranch(id);
      setBranch(updated);
    } catch (err: any) {
      setActionError(apiErrorMessage(err, t("Failed to update availability.", "تعذّر تحديث التوافر.")));
    } finally {
      setIsTogglingOpen(false);
    }
  }

  async function handleAssignSector(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSectorId) return;
    setActionError(null);
    try {
      const updated = await assignVendorBranchSector(id, selectedSectorId);
      setBranch(updated);
    } catch (err: any) {
      setActionError(apiErrorMessage(err, t("Failed to assign sector.", "تعذّر تعيين القطاع.")));
    }
  }

  async function handleAssignServiceArea(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedServiceAreaId) return;
    setServiceAreaError(null);
    try {
      const updated = await updateVendorBranch(id, { serviceAreaId: selectedServiceAreaId });
      setBranch(updated);
    } catch (err: any) {
      // Covers the backend's own validation — invalid or inactive
      // ServiceArea is rejected server-side, never assumed valid here.
      setServiceAreaError(apiErrorMessage(err, t("Failed to assign service area.", "تعذّر تعيين منطقة الخدمة.")));
    }
  }

  async function handleCreateCategory(e: React.FormEvent) {
    e.preventDefault();
    try {
      await createCategory({ vendorBranchId: id, name: categoryName.trim(), nameAr: categoryNameAr.trim() });
      setCategoryName('');
      setCategoryNameAr('');
      setShowCategoryForm(false);
      await refresh();
    } catch (err: any) {
      setActionError(apiErrorMessage(err, t("Failed to create category.", "تعذّر إنشاء القسم.")));
    }
  }

  async function handleToggleCategory(category: ProductCategory) {
    try {
      category.isActive ? await deactivateCategory(category.id) : await activateCategory(category.id);
      await refresh();
    } catch (err: any) {
      setActionError(apiErrorMessage(err, t("Failed to update category.", "تعذّر تحديث القسم.")));
    }
  }

  function handleRenameCategory(category: ProductCategory) {
    setEditingCategory(category);
  }

  async function handleCreateProduct(e: React.FormEvent) {
    e.preventDefault();
    setProductError(null);
    const parsedPrice = parseEgpToMinor(productPrice);
    if (!parsedPrice.ok) {
      setProductError(t("Enter the price in EGP, e.g. 95 or 12.50.", "أدخل السعر بالجنيه المصري، مثل 95 أو 12.50."));
      return;
    }
    const priceMinor = parsedPrice.minor;
    if (!productNameAr.trim()) {
      setProductError(t("Enter the Arabic name too — the app is Arabic and English.", "أدخل الاسم بالعربية أيضًا — التطبيق باللغتين العربية والإنجليزية."));
      return;
    }
    if (!productCategoryId) {
      setProductError(t("Create a category first.", "أنشئ قسمًا أولًا."));
      return;
    }
    try {
      await createProduct({
        vendorBranchId: id,
        categoryId: productCategoryId,
        name: productName.trim(),
        nameAr: productNameAr.trim(),
        priceMinor,
        pricingUnit: productPricingUnit,
      });
      setProductName('');
      setProductNameAr('');
      setProductPrice('');
      setProductPricingUnit('PIECE');
      setShowProductForm(false);
      await refresh();
    } catch (err: any) {
      setProductError(apiErrorMessage(err, t("Failed to create product.", "تعذّر إنشاء المنتج.")));
    }
  }

  async function handleToggleProduct(product: Product) {
    try {
      product.isAvailable ? await deactivateProduct(product.id) : await activateProduct(product.id);
      await refresh();
    } catch (err: any) {
      setActionError(apiErrorMessage(err, t("Failed to update product.", "تعذّر تحديث المنتج.")));
    }
  }

  /** Tracked Inventory Order-Time Enforcement. Only ever called for TRACKED products (button hidden for OPEN in the row rendering below). Never touches isAvailable. */
  async function handleSetProductInventoryToZero(product: Product) {
    const confirmed = window.confirm(t(`Set stock for "${product.name}" to 0? This does not change whether the product is active.`, `تصفير مخزون «${product.name}»؟ لن يغيّر ذلك حالة تفعيل المنتج.`));
    if (!confirmed) return;
    try {
      await setProductInventoryToZero(product.id);
      await refresh();
    } catch (err: any) {
      setActionError(apiErrorMessage(err, t("Failed to set inventory to zero.", "تعذّر تصفير المخزون.")));
    }
  }

  function handleRenameProduct(product: Product) {
    setEditingProduct(product);
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}{' '}
        <button onClick={refresh} className="underline">
          {t("Retry", "إعادة المحاولة")}
        </button>
      </div>
    );
  }
  if (!branch || categories === null || products === null) return <p className="text-gray-500">{t("Loading...", "جارٍ التحميل...")}</p>;

  const categoryName_ = (categoryId: string) => categories.find((c) => c.id === categoryId)?.name ?? '—';

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <Link href={`/vendors/${branch.vendorId}`} className="inline-flex min-h-[36px] items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"><span aria-hidden className="rtl:rotate-180">←</span> {t("Vendor", "المتجر")}</Link>
        <nav aria-label={t("Branch sections", "أقسام الفرع")} className="sticky top-0 z-10 -mx-1 mt-1 flex gap-2 overflow-x-auto bg-gray-50/95 px-1 py-2 backdrop-blur" data-testid="branch-nav">
          {[['sec-hours', t('Hours', 'ساعات العمل')], ['sec-closures', t('Closures', 'الإغلاقات')], ['sec-sector', t('Sector', 'القطاع')], ['sec-area', t('Service area', 'منطقة الخدمة')], ['sec-categories', t('Categories', 'الأقسام')], ['sec-products', t('Products', 'المنتجات')]].map(([id, label]) => (
            <a key={id} href={`#${id}`} className="inline-flex min-h-[40px] shrink-0 items-center rounded-full border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50">{label}</a>
          ))}
        </nav>
      </div>
      <BranchReadinessCard branchId={branch.id} vendorId={branch.vendorId} refreshKey={`${JSON.stringify(branch)}|${products?.length ?? 0}|${categories?.length ?? 0}`} />
      <div id="sec-details" className="scroll-mt-16 rounded-xl border bg-white p-4 border-gray-200 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">{branch.name}</h1>
          <div className="flex items-center gap-2">
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                branch.isOpen ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'
              }`}
            >
              {branch.isOpen ? t("Open", "مفتوح") : t("Closed", "مغلق")}
            </span>
            <button
              onClick={handleToggleOpen}
              disabled={isTogglingOpen}
              className={`min-h-[40px] rounded-lg px-4 py-1 text-sm font-medium disabled:opacity-50 ${
                branch.isOpen ? 'bg-gray-200 text-gray-700' : 'bg-green-600 text-white'
              }`}
            >
              {isTogglingOpen ? '...' : branch.isOpen ? t("Close", "إغلاق") : t("Open", "مفتوح")}
            </button>
            <button
              onClick={handleToggleActive}
              className={`min-h-[40px] rounded-lg px-4 py-1 text-sm font-medium ${
                branch.isActive ? 'bg-gray-200 text-gray-700' : 'bg-green-600 text-white'
              }`}
            >
              {branch.isActive ? t("Deactivate", "إيقاف") : t("Activate", "تفعيل")}
            </button>
            <DeleteRecordButton
              path={`/admin/vendor-branches/${branch.id}`}
              name={branch.name}
              what={['Branch', 'الفرع']}
              consequence={['Its menu, categories, offers and the staff who work only here are switched off with it. Refused while it has orders in progress.', 'يتم إيقاف المنيو والأقسام والعروض والموظفين الذين يعملون فيه فقط. يُرفض الحذف إذا كان لديه طلبات جارية.']}
              strong
              onDeleted={() => router.replace(branch.vendorId ? `/vendors/${branch.vendorId}` : '/branches')}
            />
          </div>
        </div>

        <form onSubmit={handleSaveBranch} className="mt-4 space-y-3">
          <div>
            <label className="block text-sm font-medium">{t("Name (English)", "الاسم بالإنجليزية")}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium">{t("Name (Arabic) — الاسم بالعربي", "الاسم بالعربية")}</label>
            <input dir="rtl" required value={nameAr} onChange={(e) => setNameAr(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium">{t("Address", "العنوان")}</label>
            <input value={address} onChange={(e) => setAddress(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium">{t("Hatly commission (%)", "عمولة هاتلي (%)")}</label>
            <input inputMode="decimal" dir="ltr" placeholder="15" value={commission} onChange={(e) => setCommission(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm" />
          </div>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={deliveryEnabled} onChange={(e) => setDeliveryEnabled(e.target.checked)} />
              {t("Delivery enabled", "التوصيل مفعّل")}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={pickupEnabled} onChange={(e) => setPickupEnabled(e.target.checked)} />
              {t("Pickup enabled", "الاستلام من الفرع مفعّل")}
            </label>
          </div>
          {actionError && <p className="text-sm text-red-600">{actionError}</p>}
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-lg bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50 shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40"
          >
            {isSaving ? t("Saving...", "جارٍ الحفظ...") : t("Save", "حفظ")}
          </button>
        </form>
      </div>

      <BranchAcceptanceMode branchId={branch.id} mode={branch.acceptanceMode ?? (branch.autoAcceptEnabled ? 'AUTO' : 'VENDOR')} onChanged={refresh} />
      <div id="sec-hours" className="scroll-mt-16"><BranchHoursEditor key={`${branch.id}-${JSON.stringify(branch.openingHours)}-${branch.preparationTimeMinutes ?? ''}`} initialHours={branch.openingHours as any} initialPrep={branch.preparationTimeMinutes ?? null} canEdit onSave={async (openingHours, preparationTimeMinutes) => { await updateVendorBranch(branch.id, { openingHours: openingHours as any, preparationTimeMinutes }); await refresh(); }} /></div>
      <div id="sec-closures" className="scroll-mt-16"><BranchClosures scope="admin" branchId={branch.id} onChanged={refresh} /></div>

      <div className="rounded-xl border bg-white p-4 border-gray-200 shadow-sm">
        <h2 id="sec-sector" className="scroll-mt-16 font-semibold">{t("Marketplace Sector", "قطاع المتجر")}</h2>
        <p className="text-sm text-gray-500">
          {t('Current:', 'الحالي:')} {sectors.find((s) => s.id === branch.marketplaceSectorId)?.name ?? t('Not assigned', 'غير معيّن')}
        </p>
        <form onSubmit={handleAssignSector} className="mt-2 flex gap-2">
          <select
            value={selectedSectorId}
            onChange={(e) => setSelectedSectorId(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100"
          >
            <option value="">{t("Select a sector...", "اختر قطاعًا...")}</option>
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-lg bg-hatly-orange px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
            Assign
          </button>
        </form>
      </div>

      <div className="rounded-xl border bg-white p-4 border-gray-200 shadow-sm">
        <h2 id="sec-area" className="scroll-mt-16 font-semibold">{t("Service Area", "منطقة الخدمة")}</h2>
        <p className="text-sm text-gray-500">
          {t('Current:', 'الحالي:')} {serviceAreas.find((sa) => sa.id === branch.serviceAreaId)?.name ?? t('Not assigned', 'غير معيّن')}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          A branch with no Service Area assigned will not appear to customers browsing by location.
        </p>
        <form onSubmit={handleAssignServiceArea} className="mt-2 flex gap-2">
          <select
            value={selectedServiceAreaId}
            onChange={(e) => setSelectedServiceAreaId(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100"
          >
            <option value="">{t("Select a service area...", "اختر منطقة خدمة...")}</option>
            {serviceAreas.map((sa) => (
              <option key={sa.id} value={sa.id}>
                {sa.name} {sa.isActive ? '' : '(inactive)'}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-lg bg-hatly-orange px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
            Assign
          </button>
        </form>
        {serviceAreaError && <p className="mt-1 text-sm text-red-600">{serviceAreaError}</p>}
      </div>

      <div className="rounded-xl border bg-white p-4 border-gray-200 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 id="sec-categories" className="scroll-mt-16 font-semibold">{t("Categories", "الأقسام")}</h2>
          <button onClick={() => setShowCategoryForm((v) => !v)} className="rounded-lg bg-hatly-orange px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
            {showCategoryForm ? t("Cancel", "إلغاء") : t("New Category", "قسم جديد")}
          </button>
        </div>
        {showCategoryForm && (
          <form onSubmit={handleCreateCategory} className="mt-3 flex gap-2">
            <input
              required
              value={categoryName}
              onChange={(e) => setCategoryName(e.target.value)}
              placeholder={t("Category name (English)", "اسم القسم بالإنجليزية")}
              className="flex-1 rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
            />
            <input
              required
              dir="rtl"
              value={categoryNameAr}
              onChange={(e) => setCategoryNameAr(e.target.value)}
              placeholder="اسم القسم بالعربي"
              className="flex-1 rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
            />
            <button type="submit" className="rounded-lg bg-hatly-orange px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
              Create
            </button>
          </form>
        )}
        <ul className="mt-4 divide-y rounded border">
          {categories.length === 0 && <li className="px-4 py-3 text-sm text-gray-500">{t("No categories yet.", "لا توجد أقسام بعد.")}</li>}
          {categories.map((c) => (
            <li key={c.id} className="flex items-center justify-between px-4 py-3">
              <button onClick={() => handleRenameCategory(c)} className="text-left hover:underline">
                {c.name}{c.nameAr ? <span className="ms-2 text-gray-500"><bdi dir="rtl">{c.nameAr}</bdi></span> : null}
              </button>
              <div className="flex items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs ${c.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                  {c.isActive ? t("Active", "نشط") : t("Inactive", "غير نشط")}
                </span>
                <button onClick={() => handleToggleCategory(c)} className="text-xs text-gray-500 underline">
                  {c.isActive ? t("Deactivate", "إيقاف") : t("Activate", "تفعيل")}
                </button>
                <button onClick={() => setEditingCategory(c)} className="text-xs text-gray-500 underline">{t("Edit", "تعديل")}</button>
                <DeleteRecordButton path={`/admin/product-categories/${c.id}`} name={c.name} what={['Category', 'القسم']} consequence={['Only an empty category can be deleted: move or delete its products first.', 'يمكن حذف القسم الفارغ فقط: انقل منتجاته أو احذفها أولًا.']} onDeleted={refresh} />
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border bg-white p-4 border-gray-200 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 id="sec-products" className="scroll-mt-16 font-semibold">{t("Products", "المنتجات")}</h2>
          <div className="flex gap-2">
            <button onClick={() => setShowImport((v) => !v)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium bg-white text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
              {showImport ? t("Close import", "إغلاق الاستيراد") : t("Import menu (Excel)", "استيراد القائمة (Excel)")}
            </button>
            <button onClick={() => setShowProductForm((v) => !v)} className="rounded-lg bg-hatly-orange px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
              {showProductForm ? t("Cancel", "إلغاء") : t("New Product", "منتج جديد")}
            </button>
          </div>
        </div>

        {showImport && <MenuImportPanel branchId={branch.id} branchName={branch.name} onImported={refresh} />}

        {showProductForm && (
          <form onSubmit={handleCreateProduct} className="mt-3 space-y-3 rounded border p-3">
            <div>
              <label className="block text-sm font-medium">{t("Name (English)", "الاسم بالإنجليزية")}</label>
              <input
                required
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">{t("Name (Arabic) — الاسم بالعربي", "الاسم بالعربية")}</label>
              <input
                required
                dir="rtl"
                value={productNameAr}
                onChange={(e) => setProductNameAr(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">{t("Category", "القسم")}</label>
              <select
                required
                value={productCategoryId}
                onChange={(e) => setProductCategoryId(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
              >
                <option value="">{t("Select a category...", "اختر قسمًا...")}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium">{productPricingUnit === 'WEIGHT' ? t("Price per kg (EGP)", "السعر لكل كجم (ج.م)") : t("Price (EGP)", "السعر (ج.م)")}</label>
                <input
                  required
                  inputMode="decimal"
                  dir="ltr"
                  value={productPrice}
                  onChange={(e) => setProductPrice(e.target.value)}
                  placeholder={t("e.g. 95 or 12.50", "مثل 95 أو 12.50")}
                  className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium">{t("Pricing unit", "وحدة التسعير")}</label>
                <select
                  value={productPricingUnit}
                  onChange={(e) => setProductPricingUnit(e.target.value as 'PIECE' | 'WEIGHT')}
                  className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
                >
                  <option value="PIECE">{t("Piece", "قطعة")}</option>
                  <option value="WEIGHT">{t("Weight (per kg)", "وزن (لكل كجم)")}</option>
                </select>
              </div>
            </div>
            <p className="text-xs text-gray-500">
              {t("Pricing unit cannot be changed after creation. For weighted products, price is per kilogram.", "لا يمكن تغيير وحدة التسعير بعد الإنشاء. سعر المنتجات بالوزن هو لكل كيلوجرام.")}
            </p>
            {productError && <p className="text-sm text-red-600">{productError}</p>}
            <button type="submit" className="rounded-lg bg-hatly-orange px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
              Create Product
            </button>
          </form>
        )}
        <ul className="mt-4 divide-y rounded border">
          {products.length === 0 && <li className="px-4 py-3 text-sm text-gray-500">{t("No products yet.", "لا توجد منتجات بعد.")}</li>}
          {products.map((p) => (
            <li key={p.id} className="px-4 py-3">
              <div className="flex items-center justify-between">
              <div>
                <button onClick={() => handleRenameProduct(p)} className="text-left font-medium hover:underline">
                  {p.name}
                </button>
                {p.nameAr ? <span className="ms-2 text-gray-600"><bdi dir="rtl">{p.nameAr}</bdi></span> : <span className="ms-2 rounded bg-amber-50 px-1.5 text-xs text-amber-700">{t("no Arabic name", "لا يوجد اسم بالعربية")}</span>}
                <p className="text-xs text-gray-500">
                  {categoryName_(p.categoryId)} &middot; {(p.priceMinor / 100).toFixed(2)} EGP {p.pricingUnit === 'WEIGHT' ? 'per kg' : 'per piece'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs ${p.isAvailable ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                  {p.isAvailable ? t("Available", "متاح") : t("Unavailable", "غير متاح")}
                </span>
                <button onClick={() => handleToggleProduct(p)} className="text-xs text-gray-500 underline">
                  {p.isAvailable ? t("Deactivate", "إيقاف") : t("Activate", "تفعيل")}
                </button>
                <button onClick={() => setEditingProduct(p)} className="text-xs text-gray-500 underline">{t("Edit", "تعديل")}</button>
                <DeleteRecordButton path={`/admin/products/${p.id}`} name={p.name} what={['Product', 'المنتج']} consequence={['It leaves the menu and every customer cart. Past orders keep it.', 'يُزال من المنيو ومن سلال العملاء. تحتفظ الطلبات السابقة به.']} onDeleted={refresh} />
                {p.inventoryMode === 'TRACKED' && (
                  <button onClick={() => handleSetProductInventoryToZero(p)} className="text-xs text-gray-500 underline">
                    Set Inventory to 0
                  </button>
                )}
                <button
                  data-testid={`product-options-toggle-${p.id}`}
                  onClick={() => setOptionsOpenId((cur) => (cur === p.id ? null : p.id))}
                  className="text-xs text-hatly-orange underline"
                >
                  {optionsOpenId === p.id ? t("Hide options", "إخفاء الخيارات") : t("Options", "الخيارات")}
                </button>
              </div>
              </div>
              {optionsOpenId === p.id && <ProductOptionsEditor scope="admin" productId={p.id} />}
            </li>
          ))}
        </ul>
      </div>
      {editingProduct && <ProductEditModal product={editingProduct} categories={categories ?? []} onClose={() => setEditingProduct(null)} onSaved={async () => { setEditingProduct(null); await refresh(); }} onPhotosChanged={() => void refresh()} />}
      {editingCategory && <CategoryEditModal category={editingCategory} onClose={() => setEditingCategory(null)} onSaved={async () => { setEditingCategory(null); await refresh(); }} />}
    </div>
  );
}

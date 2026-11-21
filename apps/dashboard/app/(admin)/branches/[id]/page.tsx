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
import { BranchReadinessCard } from '../../../../components/admin/BranchReadinessCard';
import { CategoryEditModal, ProductEditModal } from '../../../../components/admin/CatalogEditModals';
import { useRouter } from 'next/navigation';

/**
 * Real Branch detail/edit/activate + Sector assignment (reuses the
 * EXISTING sector endpoint, no new Sectors backend) + Category/Product
 * management — consumes Chunk 1/2 endpoints exactly. New categories
 * and products are ACTIVE immediately on creation (the closed
 * decision — no publish step). `pricingUnit` is selectable only at
 * product creation and never appears in the edit form.
 */
export default function BranchDetailPage() {
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
      setAddress(b.address);
      setCommission(b.commissionRateBasisPoints != null ? String(b.commissionRateBasisPoints) : '');
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
      setError(apiErrorMessage(err, 'Failed to load branch.'));
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
      const updated = await updateVendorBranch(id, {
        name,
        address,
        deliveryEnabled,
        pickupEnabled,
        commissionRateBasisPoints: commission ? Number(commission) : undefined,
      });
      setBranch(updated);
    } catch (err: any) {
      setActionError(apiErrorMessage(err, 'Failed to save branch.'));
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
      setActionError(apiErrorMessage(err, 'Failed to update status.'));
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
      setActionError(apiErrorMessage(err, 'Failed to update availability.'));
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
      setActionError(apiErrorMessage(err, 'Failed to assign sector.'));
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
      setServiceAreaError(apiErrorMessage(err, 'Failed to assign service area.'));
    }
  }

  async function handleCreateCategory(e: React.FormEvent) {
    e.preventDefault();
    try {
      await createCategory({ vendorBranchId: id, name: categoryName });
      setCategoryName('');
      setShowCategoryForm(false);
      await refresh();
    } catch (err: any) {
      setActionError(apiErrorMessage(err, 'Failed to create category.'));
    }
  }

  async function handleToggleCategory(category: ProductCategory) {
    try {
      category.isActive ? await deactivateCategory(category.id) : await activateCategory(category.id);
      await refresh();
    } catch (err: any) {
      setActionError(apiErrorMessage(err, 'Failed to update category.'));
    }
  }

  function handleRenameCategory(category: ProductCategory) {
    setEditingCategory(category);
  }

  async function handleCreateProduct(e: React.FormEvent) {
    e.preventDefault();
    setProductError(null);
    const priceMinor = Number(productPrice);
    if (Number.isNaN(priceMinor) || priceMinor <= 0) {
      setProductError('Price must be a positive number, in minor units (piasters).');
      return;
    }
    if (!productCategoryId) {
      setProductError('Create a category first.');
      return;
    }
    try {
      await createProduct({
        vendorBranchId: id,
        categoryId: productCategoryId,
        name: productName,
        priceMinor,
        pricingUnit: productPricingUnit,
      });
      setProductName('');
      setProductPrice('');
      setProductPricingUnit('PIECE');
      setShowProductForm(false);
      await refresh();
    } catch (err: any) {
      setProductError(apiErrorMessage(err, 'Failed to create product.'));
    }
  }

  async function handleToggleProduct(product: Product) {
    try {
      product.isAvailable ? await deactivateProduct(product.id) : await activateProduct(product.id);
      await refresh();
    } catch (err: any) {
      setActionError(apiErrorMessage(err, 'Failed to update product.'));
    }
  }

  /** Tracked Inventory Order-Time Enforcement. Only ever called for TRACKED products (button hidden for OPEN in the row rendering below). Never touches isAvailable. */
  async function handleSetProductInventoryToZero(product: Product) {
    const confirmed = window.confirm(`Set stock for "${product.name}" to 0? This does not change whether the product is active.`);
    if (!confirmed) return;
    try {
      await setProductInventoryToZero(product.id);
      await refresh();
    } catch (err: any) {
      setActionError(apiErrorMessage(err, 'Failed to set inventory to zero.'));
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
          Retry
        </button>
      </div>
    );
  }
  if (!branch || categories === null || products === null) return <p className="text-gray-500">Loading...</p>;

  const categoryName_ = (categoryId: string) => categories.find((c) => c.id === categoryId)?.name ?? '—';

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <Link href={`/vendors/${branch.vendorId}`} className="inline-flex min-h-[36px] items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"><span aria-hidden className="rtl:rotate-180">←</span> Vendor</Link>
        <nav aria-label="Branch sections" className="sticky top-0 z-10 -mx-1 mt-1 flex gap-2 overflow-x-auto bg-gray-50/95 px-1 py-2 backdrop-blur" data-testid="branch-nav">
          {[['sec-hours', 'Hours'], ['sec-closures', 'Closures'], ['sec-sector', 'Sector'], ['sec-area', 'Service area'], ['sec-categories', 'Categories'], ['sec-products', 'Products']].map(([id, label]) => (
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
              {branch.isOpen ? 'Open' : 'Closed'}
            </span>
            <button
              onClick={handleToggleOpen}
              disabled={isTogglingOpen}
              className={`min-h-[40px] rounded-lg px-4 py-1 text-sm font-medium disabled:opacity-50 ${
                branch.isOpen ? 'bg-gray-200 text-gray-700' : 'bg-green-600 text-white'
              }`}
            >
              {isTogglingOpen ? '...' : branch.isOpen ? 'Close' : 'Open'}
            </button>
            <button
              onClick={handleToggleActive}
              className={`min-h-[40px] rounded-lg px-4 py-1 text-sm font-medium ${
                branch.isActive ? 'bg-gray-200 text-gray-700' : 'bg-green-600 text-white'
              }`}
            >
              {branch.isActive ? 'Deactivate' : 'Activate'}
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
            <label className="block text-sm font-medium">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium">Address</label>
            <input value={address} onChange={(e) => setAddress(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium">Commission rate (basis points — 1000 = 10%)</label>
            <input value={commission} onChange={(e) => setCommission(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm" />
          </div>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={deliveryEnabled} onChange={(e) => setDeliveryEnabled(e.target.checked)} />
              Delivery enabled
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={pickupEnabled} onChange={(e) => setPickupEnabled(e.target.checked)} />
              Pickup enabled
            </label>
          </div>
          {actionError && <p className="text-sm text-red-600">{actionError}</p>}
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-lg bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50 shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </form>
      </div>

      <BranchAcceptanceMode branchId={branch.id} mode={branch.acceptanceMode ?? (branch.autoAcceptEnabled ? 'AUTO' : 'VENDOR')} onChanged={refresh} />
      <div id="sec-hours" className="scroll-mt-16"><BranchHoursEditor key={`${branch.id}-${JSON.stringify(branch.openingHours)}-${branch.preparationTimeMinutes ?? ''}`} initialHours={branch.openingHours as any} initialPrep={branch.preparationTimeMinutes ?? null} canEdit onSave={async (openingHours, preparationTimeMinutes) => { await updateVendorBranch(branch.id, { openingHours: openingHours as any, preparationTimeMinutes }); await refresh(); }} /></div>
      <div id="sec-closures" className="scroll-mt-16"><BranchClosures scope="admin" branchId={branch.id} onChanged={refresh} /></div>

      <div className="rounded-xl border bg-white p-4 border-gray-200 shadow-sm">
        <h2 id="sec-sector" className="scroll-mt-16 font-semibold">Marketplace Sector</h2>
        <p className="text-sm text-gray-500">
          Current: {sectors.find((s) => s.id === branch.marketplaceSectorId)?.name ?? 'Not assigned'}
        </p>
        <form onSubmit={handleAssignSector} className="mt-2 flex gap-2">
          <select
            value={selectedSectorId}
            onChange={(e) => setSelectedSectorId(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100"
          >
            <option value="">Select a sector...</option>
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
        <h2 id="sec-area" className="scroll-mt-16 font-semibold">Service Area</h2>
        <p className="text-sm text-gray-500">
          Current: {serviceAreas.find((sa) => sa.id === branch.serviceAreaId)?.name ?? 'Not assigned'}
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
            <option value="">Select a service area...</option>
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
          <h2 id="sec-categories" className="scroll-mt-16 font-semibold">Categories</h2>
          <button onClick={() => setShowCategoryForm((v) => !v)} className="rounded-lg bg-hatly-orange px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
            {showCategoryForm ? 'Cancel' : 'New Category'}
          </button>
        </div>
        {showCategoryForm && (
          <form onSubmit={handleCreateCategory} className="mt-3 flex gap-2">
            <input
              required
              value={categoryName}
              onChange={(e) => setCategoryName(e.target.value)}
              placeholder="Category name"
              className="flex-1 rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
            />
            <button type="submit" className="rounded-lg bg-hatly-orange px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
              Create
            </button>
          </form>
        )}
        <ul className="mt-4 divide-y rounded border">
          {categories.length === 0 && <li className="px-4 py-3 text-sm text-gray-500">No categories yet.</li>}
          {categories.map((c) => (
            <li key={c.id} className="flex items-center justify-between px-4 py-3">
              <button onClick={() => handleRenameCategory(c)} className="text-left hover:underline">
                {c.name}
              </button>
              <div className="flex items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs ${c.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                  {c.isActive ? 'Active' : 'Inactive'}
                </span>
                <button onClick={() => handleToggleCategory(c)} className="text-xs text-gray-500 underline">
                  {c.isActive ? 'Deactivate' : 'Activate'}
                </button>
                <button onClick={() => setEditingCategory(c)} className="text-xs text-gray-500 underline">Edit</button>
                <DeleteRecordButton path={`/admin/product-categories/${c.id}`} name={c.name} what={['Category', 'القسم']} consequence={['Only an empty category can be deleted: move or delete its products first.', 'يمكن حذف القسم الفارغ فقط: انقل منتجاته أو احذفها أولًا.']} onDeleted={refresh} />
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border bg-white p-4 border-gray-200 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 id="sec-products" className="scroll-mt-16 font-semibold">Products</h2>
          <div className="flex gap-2">
            <button onClick={() => setShowImport((v) => !v)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium bg-white text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
              {showImport ? 'Close import' : 'Import menu (Excel)'}
            </button>
            <button onClick={() => setShowProductForm((v) => !v)} className="rounded-lg bg-hatly-orange px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
              {showProductForm ? 'Cancel' : 'New Product'}
            </button>
          </div>
        </div>

        {showImport && <MenuImportPanel branchId={branch.id} branchName={branch.name} onImported={refresh} />}

        {showProductForm && (
          <form onSubmit={handleCreateProduct} className="mt-3 space-y-3 rounded border p-3">
            <div>
              <label className="block text-sm font-medium">Name</label>
              <input
                required
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Category</label>
              <select
                required
                value={productCategoryId}
                onChange={(e) => setProductCategoryId(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
              >
                <option value="">Select a category...</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium">Price (minor units)</label>
                <input
                  required
                  value={productPrice}
                  onChange={(e) => setProductPrice(e.target.value)}
                  placeholder="e.g. 10000 = 100.00"
                  className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Pricing unit</label>
                <select
                  value={productPricingUnit}
                  onChange={(e) => setProductPricingUnit(e.target.value as 'PIECE' | 'WEIGHT')}
                  className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
                >
                  <option value="PIECE">Piece</option>
                  <option value="WEIGHT">Weight (per kg)</option>
                </select>
              </div>
            </div>
            <p className="text-xs text-gray-500">
              Pricing unit cannot be changed after creation. For weighted products, price is per kilogram.
            </p>
            {productError && <p className="text-sm text-red-600">{productError}</p>}
            <button type="submit" className="rounded-lg bg-hatly-orange px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
              Create Product
            </button>
          </form>
        )}
        <ul className="mt-4 divide-y rounded border">
          {products.length === 0 && <li className="px-4 py-3 text-sm text-gray-500">No products yet.</li>}
          {products.map((p) => (
            <li key={p.id} className="px-4 py-3">
              <div className="flex items-center justify-between">
              <div>
                <button onClick={() => handleRenameProduct(p)} className="text-left font-medium hover:underline">
                  {p.name}
                </button>
                <p className="text-xs text-gray-500">
                  {categoryName_(p.categoryId)} &middot; {(p.priceMinor / 100).toFixed(2)}
                  {p.pricingUnit === 'WEIGHT' ? ' / kg' : ''} &middot; {p.pricingUnit}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs ${p.isAvailable ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                  {p.isAvailable ? 'Available' : 'Unavailable'}
                </span>
                <button onClick={() => handleToggleProduct(p)} className="text-xs text-gray-500 underline">
                  {p.isAvailable ? 'Deactivate' : 'Activate'}
                </button>
                <button onClick={() => setEditingProduct(p)} className="text-xs text-gray-500 underline">Edit</button>
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
                  {optionsOpenId === p.id ? 'Hide options' : 'Options'}
                </button>
              </div>
              </div>
              {optionsOpenId === p.id && <ProductOptionsEditor scope="admin" productId={p.id} />}
            </li>
          ))}
        </ul>
      </div>
      {editingProduct && <ProductEditModal product={editingProduct} categories={categories ?? []} onClose={() => setEditingProduct(null)} onSaved={async () => { setEditingProduct(null); await refresh(); }} />}
      {editingCategory && <CategoryEditModal category={editingCategory} onClose={() => setEditingCategory(null)} onSaved={async () => { setEditingCategory(null); await refresh(); }} />}
    </div>
  );
}

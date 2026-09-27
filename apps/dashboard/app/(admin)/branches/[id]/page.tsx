'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  VendorBranch,
  activateVendorBranch,
  assignVendorBranchSector,
  deactivateVendorBranch,
  getVendorBranch,
  updateVendorBranch,
} from '../../../../lib/api/admin-vendors';
import {
  Product,
  ProductCategory,
  activateCategory,
  activateProduct,
  applyAdminImport,
  createCategory,
  createProduct,
  deactivateCategory,
  deactivateProduct,
  downloadAdminImportTemplate,
  ExcelImportApplyResult,
  ExcelImportValidationSummary,
  listCategories,
  listProducts,
  setProductInventoryToZero,
  updateCategory,
  updateProduct,
  validateAdminImport,
} from '../../../../lib/api/admin-catalog';
import { MarketplaceSector, listSectors } from '../../../../lib/api/sectors';
import { ServiceArea, listServiceAreas } from '../../../../lib/api/admin-service-areas';

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
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [commission, setCommission] = useState('');
  const [deliveryEnabled, setDeliveryEnabled] = useState(true);
  const [pickupEnabled, setPickupEnabled] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedSectorId, setSelectedSectorId] = useState('');
  const [selectedServiceAreaId, setSelectedServiceAreaId] = useState('');
  const [serviceAreaError, setServiceAreaError] = useState<string | null>(null);

  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [categoryName, setCategoryName] = useState('');

  const [showProductForm, setShowProductForm] = useState(false);
  const [productName, setProductName] = useState('');
  const [productCategoryId, setProductCategoryId] = useState('');
  const [productPrice, setProductPrice] = useState('');
  const [productPricingUnit, setProductPricingUnit] = useState<'PIECE' | 'WEIGHT'>('PIECE');
  const [productError, setProductError] = useState<string | null>(null);

  // Excel Inventory & Price Management.
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importSummary, setImportSummary] = useState<ExcelImportValidationSummary | null>(null);
  const [importResult, setImportResult] = useState<ExcelImportApplyResult | null>(null);
  const [isValidatingImport, setIsValidatingImport] = useState(false);
  const [isApplyingImport, setIsApplyingImport] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

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
      setError(err?.response?.data?.message ?? 'Failed to load branch.');
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
      setActionError(err?.response?.data?.message ?? 'Failed to save branch.');
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
      setActionError(err?.response?.data?.message ?? 'Failed to update status.');
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
      setActionError(err?.response?.data?.message ?? 'Failed to assign sector.');
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
      setServiceAreaError(err?.response?.data?.message ?? 'Failed to assign service area.');
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
      setActionError(err?.response?.data?.message ?? 'Failed to create category.');
    }
  }

  async function handleToggleCategory(category: ProductCategory) {
    try {
      category.isActive ? await deactivateCategory(category.id) : await activateCategory(category.id);
      await refresh();
    } catch (err: any) {
      setActionError(err?.response?.data?.message ?? 'Failed to update category.');
    }
  }

  async function handleRenameCategory(category: ProductCategory) {
    const newName = window.prompt('Category name', category.name);
    if (!newName || newName === category.name) return;
    try {
      await updateCategory(category.id, { name: newName });
      await refresh();
    } catch (err: any) {
      setActionError(err?.response?.data?.message ?? 'Failed to rename category.');
    }
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
      setProductError(err?.response?.data?.message ?? 'Failed to create product.');
    }
  }

  async function handleToggleProduct(product: Product) {
    try {
      product.isAvailable ? await deactivateProduct(product.id) : await activateProduct(product.id);
      await refresh();
    } catch (err: any) {
      setActionError(err?.response?.data?.message ?? 'Failed to update product.');
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
      setActionError(err?.response?.data?.message ?? 'Failed to set inventory to zero.');
    }
  }

  // Excel Inventory & Price Management.
  async function handleDownloadTemplate(prefilled: boolean) {
    try {
      const blob = await downloadAdminImportTemplate(id, prefilled);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'hatly-products-template.xlsx';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setImportError(err?.response?.data?.message ?? 'Failed to download template.');
    }
  }

  function handleImportFileSelected(file: File | undefined) {
    setImportFile(file ?? null);
    setImportSummary(null);
    setImportResult(null);
    setImportError(null);
  }

  async function handleValidateImport() {
    if (!importFile) return;
    setIsValidatingImport(true);
    setImportError(null);
    setImportSummary(null);
    try {
      const summary = await validateAdminImport(importFile);
      setImportSummary(summary);
    } catch (err: any) {
      setImportError(err?.response?.data?.message ?? 'Failed to validate file.');
    } finally {
      setIsValidatingImport(false);
    }
  }

  async function handleApplyImport() {
    if (!importFile || importSummary?.status !== 'READY') return;
    setIsApplyingImport(true);
    setImportError(null);
    try {
      const result = await applyAdminImport(importFile);
      setImportResult(result);
      setImportSummary(null);
      setImportFile(null);
      await refresh();
    } catch (err: any) {
      setImportError(err?.response?.data?.message ?? 'Failed to apply import.');
    } finally {
      setIsApplyingImport(false);
    }
  }

  function handleCloseImport() {
    setShowImport(false);
    setImportFile(null);
    setImportSummary(null);
    setImportResult(null);
    setImportError(null);
  }

  async function handleRenameProduct(product: Product) {
    const newName = window.prompt('Product name', product.name);
    if (!newName || newName === product.name) return;
    try {
      await updateProduct(product.id, { name: newName });
      await refresh();
    } catch (err: any) {
      setActionError(err?.response?.data?.message ?? 'Failed to rename product.');
    }
  }

  if (error) {
    return (
      <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
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
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="rounded border bg-white p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">{branch.name}</h1>
          <button
            onClick={handleToggleActive}
            className={`rounded px-3 py-1 text-sm font-medium ${
              branch.isActive ? 'bg-gray-200 text-gray-700' : 'bg-green-600 text-white'
            }`}
          >
            {branch.isActive ? 'Deactivate' : 'Activate'}
          </button>
        </div>

        <form onSubmit={handleSaveBranch} className="mt-4 space-y-3">
          <div>
            <label className="block text-sm font-medium">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium">Address</label>
            <input value={address} onChange={(e) => setAddress(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium">Commission rate (basis points)</label>
            <input value={commission} onChange={(e) => setCommission(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
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
            className="rounded bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </form>
      </div>

      <div className="rounded border bg-white p-4">
        <h2 className="font-semibold">Marketplace Sector</h2>
        <p className="text-sm text-gray-500">
          Current: {sectors.find((s) => s.id === branch.marketplaceSectorId)?.name ?? 'Not assigned'}
        </p>
        <form onSubmit={handleAssignSector} className="mt-2 flex gap-2">
          <select
            value={selectedSectorId}
            onChange={(e) => setSelectedSectorId(e.target.value)}
            className="rounded border px-3 py-2 text-sm"
          >
            <option value="">Select a sector...</option>
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded bg-hatly-orange px-3 py-2 text-sm font-medium text-white">
            Assign
          </button>
        </form>
      </div>

      <div className="rounded border bg-white p-4">
        <h2 className="font-semibold">Service Area</h2>
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
            className="rounded border px-3 py-2 text-sm"
          >
            <option value="">Select a service area...</option>
            {serviceAreas.map((sa) => (
              <option key={sa.id} value={sa.id}>
                {sa.name} {sa.isActive ? '' : '(inactive)'}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded bg-hatly-orange px-3 py-2 text-sm font-medium text-white">
            Assign
          </button>
        </form>
        {serviceAreaError && <p className="mt-1 text-sm text-red-600">{serviceAreaError}</p>}
      </div>

      <div className="rounded border bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Categories</h2>
          <button onClick={() => setShowCategoryForm((v) => !v)} className="rounded bg-hatly-orange px-3 py-1.5 text-sm font-medium text-white">
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
              className="flex-1 rounded border px-3 py-2"
            />
            <button type="submit" className="rounded bg-hatly-orange px-4 py-2 text-sm font-medium text-white">
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
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded border bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Products</h2>
          <div className="flex gap-2">
            <button onClick={() => setShowImport((v) => !v)} className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium">
              {showImport ? 'Cancel' : 'Import Excel'}
            </button>
            <button onClick={() => setShowProductForm((v) => !v)} className="rounded bg-hatly-orange px-3 py-1.5 text-sm font-medium text-white">
              {showProductForm ? 'Cancel' : 'New Product'}
            </button>
          </div>
        </div>

        {showImport && (
          <div className="mt-3 space-y-3 rounded border p-3">
            <h3 className="text-sm font-semibold">Import Excel</h3>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => handleDownloadTemplate(true)} className="rounded border px-3 py-1.5 text-xs">
                Download Current Catalog Template
              </button>
              <button onClick={() => handleDownloadTemplate(false)} className="rounded border px-3 py-1.5 text-xs">
                Download Empty Template
              </button>
            </div>

            <input type="file" accept=".xlsx" onChange={(e) => handleImportFileSelected(e.target.files?.[0])} className="text-sm" />

            {importFile && (
              <button
                onClick={handleValidateImport}
                disabled={isValidatingImport}
                className="rounded bg-hatly-orange px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {isValidatingImport ? 'Validating…' : 'Validate'}
              </button>
            )}

            {importError && <p className="text-xs text-red-600">{importError}</p>}

            {importSummary && (
              <div className="space-y-2">
                <p className="text-xs">
                  Status: <span className="font-semibold">{importSummary.status}</span> — {importSummary.totalRows} rows,{' '}
                  {importSummary.changedRows} changed, {importSummary.unchangedRows} unchanged
                </p>
                <div className="max-h-64 overflow-y-auto rounded border">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="p-1.5 text-left">Row</th>
                        <th className="p-1.5 text-left">Product</th>
                        <th className="p-1.5 text-left">Changed Fields</th>
                        <th className="p-1.5 text-left">Errors</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importSummary.rows.map((r) => (
                        <tr key={r.rowNumber} className={r.errors.length > 0 ? 'bg-red-50' : ''}>
                          <td className="p-1.5">{r.rowNumber}</td>
                          <td className="p-1.5">{r.productName ?? r.productId ?? '—'}</td>
                          <td className="p-1.5">{r.changedFields.join(', ') || '—'}</td>
                          <td className="p-1.5 text-red-600">{r.errors.join('; ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  onClick={handleApplyImport}
                  disabled={importSummary.status !== 'READY' || isApplyingImport}
                  className="rounded bg-hatly-orange px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  {isApplyingImport ? 'Applying…' : 'Confirm Apply'}
                </button>
              </div>
            )}

            {importResult && (
              <p className="rounded bg-green-50 p-2 text-xs text-green-800">
                Applied: {importResult.totalRows} total rows, {importResult.updatedRows} updated, {importResult.unchangedRows}{' '}
                unchanged.
              </p>
            )}

            <button onClick={handleCloseImport} className="text-xs text-gray-500 underline">
              Close
            </button>
          </div>
        )}

        {showProductForm && (
          <form onSubmit={handleCreateProduct} className="mt-3 space-y-3 rounded border p-3">
            <div>
              <label className="block text-sm font-medium">Name</label>
              <input
                required
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                className="mt-1 w-full rounded border px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Category</label>
              <select
                required
                value={productCategoryId}
                onChange={(e) => setProductCategoryId(e.target.value)}
                className="mt-1 w-full rounded border px-3 py-2"
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
                  className="mt-1 w-full rounded border px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Pricing unit</label>
                <select
                  value={productPricingUnit}
                  onChange={(e) => setProductPricingUnit(e.target.value as 'PIECE' | 'WEIGHT')}
                  className="mt-1 w-full rounded border px-3 py-2"
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
            <button type="submit" className="rounded bg-hatly-orange px-4 py-2 text-sm font-medium text-white">
              Create Product
            </button>
          </form>
        )}
        <ul className="mt-4 divide-y rounded border">
          {products.length === 0 && <li className="px-4 py-3 text-sm text-gray-500">No products yet.</li>}
          {products.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-4 py-3">
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
                {p.inventoryMode === 'TRACKED' && (
                  <button onClick={() => handleSetProductInventoryToZero(p)} className="text-xs text-gray-500 underline">
                    Set Inventory to 0
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

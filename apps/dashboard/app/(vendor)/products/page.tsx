'use client';

import { useEffect, useState } from 'react';
import { VendorOwnedBranch, listOwnedBranches } from '../../../lib/api/vendor-branches';
import { VendorCategory, listCategoriesForBranch } from '../../../lib/api/vendor-categories';
import {
  CreateVendorProductInput,
  ExcelImportApplyResult,
  ExcelImportValidationSummary,
  InventoryMode,
  PricingUnit,
  UpdateVendorProductInput,
  VendorProduct,
  activateVendorProduct,
  applyVendorImport,
  createVendorProduct,
  deactivateVendorProduct,
  downloadVendorImportTemplate,
  listVendorProducts,
  setVendorProductInventoryToZero,
  updateVendorProduct,
  uploadVendorProductImage,
  validateVendorImport,
} from '../../../lib/api/vendor-products';
import { apiErrorMessage } from '../../../lib/api/errors';

/**
 * Real Vendor Product Management — Chunk 12B-4. Consumes only
 * already-existing Vendor endpoints (12B-1/12B-2/12B-3/12B-3-A).
 * Branch is never derived from products/categories — always the real
 * `GET vendor/branches`. `vendorBranchId` on create always comes from
 * the selected-branch state, never typed by the user. `pricingUnit`
 * never appears in the edit form — immutable after creation, matching
 * `VendorUpdateProductDto`'s own structural exclusion. `isAvailable`
 * is create-only; edit uses the separate activate/deactivate actions.
 */
export default function VendorProductsPage() {
  const [branches, setBranches] = useState<VendorOwnedBranch[] | null>(null);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');

  const [products, setProducts] = useState<VendorProduct[] | null>(null);
  const [productError, setProductError] = useState<string | null>(null);
  const [categories, setCategories] = useState<VendorCategory[] | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Excel Inventory & Price Management.
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importSummary, setImportSummary] = useState<ExcelImportValidationSummary | null>(null);
  const [importResult, setImportResult] = useState<ExcelImportApplyResult | null>(null);
  const [isValidatingImport, setIsValidatingImport] = useState(false);
  const [isApplyingImport, setIsApplyingImport] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const [createFields, setCreateFields] = useState({
    name: '',
    nameAr: '',
    description: '',
    descriptionAr: '',
    categoryId: '',
    price: '',
    pricingUnit: 'PIECE' as PricingUnit,
    inventoryMode: 'OPEN' as InventoryMode,
    quantity: '',
    isAvailable: true,
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editFields, setEditFields] = useState({
    name: '',
    nameAr: '',
    description: '',
    descriptionAr: '',
    categoryId: '',
    price: '',
    inventoryMode: 'OPEN' as InventoryMode,
    quantity: '',
  });
  const [editingPricingUnit, setEditingPricingUnit] = useState<PricingUnit>('PIECE');

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleErrorById, setToggleErrorById] = useState<Record<string, string>>({});
  const [settingZeroId, setSettingZeroId] = useState<string | null>(null);
  const [zeroErrorById, setZeroErrorById] = useState<Record<string, string>>({});
  const [uploadingImageId, setUploadingImageId] = useState<string | null>(null);
  const [imageErrorById, setImageErrorById] = useState<Record<string, string>>({});

  async function loadBranches() {
    setBranchError(null);
    try {
      const result = await listOwnedBranches();
      setBranches(result);
      if (result.length > 0) setSelectedBranchId((prev) => prev || result[0].id);
    } catch (err: any) {
      setBranchError(apiErrorMessage(err, 'Failed to load branches.'));
    }
  }

  async function refreshBranchData(branchId: string) {
    setProductError(null);
    setCategoryError(null);
    try {
      const [productList, categoryList] = await Promise.all([
        listVendorProducts(branchId),
        listCategoriesForBranch(branchId),
      ]);
      setProducts(productList);
      setCategories(categoryList);
    } catch (err: any) {
      setProductError(apiErrorMessage(err, 'Failed to load products.'));
    }
  }

  useEffect(() => {
    loadBranches();
  }, []);

  useEffect(() => {
    if (!selectedBranchId) return;
    // Branch changed — never carry a stale product/edit state from the
    // previous branch into the new context.
    setEditingId(null);
    setShowCreateForm(false);
    setProducts(null);
    setCategories(null);
    refreshBranchData(selectedBranchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranchId]);

  function categoryName(categoryId: string): string {
    return categories?.find((c) => c.id === categoryId)?.name ?? '—';
  }

  function toMinorUnits(decimal: string): number | null {
    const value = Number(decimal);
    if (Number.isNaN(value) || value <= 0) return null;
    return Math.round(value * 100);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (isCreating || !selectedBranchId) return;
    setCreateError(null);

    const priceMinor = toMinorUnits(createFields.price);
    if (priceMinor === null) {
      setCreateError('Enter a valid price.');
      return;
    }
    const input: CreateVendorProductInput = {
      vendorBranchId: selectedBranchId,
      categoryId: createFields.categoryId,
      name: createFields.name,
      nameAr: createFields.nameAr || undefined,
      description: createFields.description || undefined,
      descriptionAr: createFields.descriptionAr || undefined,
      priceMinor,
      pricingUnit: createFields.pricingUnit,
      inventoryMode: createFields.inventoryMode,
      isAvailable: createFields.isAvailable,
    };
    if (createFields.inventoryMode === 'TRACKED') {
      const qty = Number(createFields.quantity);
      if (!Number.isInteger(qty) || qty < 0) {
        setCreateError('Enter a valid, non-negative whole-number quantity.');
        return;
      }
      input.quantity = qty;
    }

    setIsCreating(true);
    try {
      await createVendorProduct(input);
      setCreateFields({
        name: '',
        nameAr: '',
        description: '',
        descriptionAr: '',
        categoryId: '',
        price: '',
        pricingUnit: 'PIECE',
        inventoryMode: 'OPEN',
        quantity: '',
        isAvailable: true,
      });
      setShowCreateForm(false);
      await refreshBranchData(selectedBranchId);
    } catch (err: any) {
      setCreateError(apiErrorMessage(err, 'Failed to create product.'));
    } finally {
      setIsCreating(false);
    }
  }

  function startEdit(product: VendorProduct) {
    setEditingId(product.id);
    setEditError(null);
    setEditingPricingUnit(product.pricingUnit);
    setEditFields({
      name: product.name,
      nameAr: product.nameAr ?? '',
      description: product.description ?? '',
      descriptionAr: product.descriptionAr ?? '',
      categoryId: product.categoryId,
      price: (product.priceMinor / 100).toFixed(2),
      inventoryMode: product.inventoryMode,
      quantity: product.quantity != null ? String(product.quantity) : '',
    });
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (isSaving || !editingId) return;
    setEditError(null);

    const priceMinor = toMinorUnits(editFields.price);
    if (priceMinor === null) {
      setEditError('Enter a valid price.');
      return;
    }
    const input: UpdateVendorProductInput = {
      name: editFields.name,
      nameAr: editFields.nameAr || undefined,
      description: editFields.description || undefined,
      descriptionAr: editFields.descriptionAr || undefined,
      categoryId: editFields.categoryId,
      priceMinor,
      inventoryMode: editFields.inventoryMode,
    };
    if (editFields.inventoryMode === 'TRACKED') {
      const qty = Number(editFields.quantity);
      if (!Number.isInteger(qty) || qty < 0) {
        setEditError('Enter a valid, non-negative whole-number quantity.');
        return;
      }
      input.quantity = qty;
    }

    setIsSaving(true);
    try {
      await updateVendorProduct(editingId, input);
      setEditingId(null);
      await refreshBranchData(selectedBranchId);
    } catch (err: any) {
      setEditError(apiErrorMessage(err, 'Failed to save changes.'));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleToggleActive(product: VendorProduct) {
    if (togglingId) return;
    setTogglingId(product.id);
    setToggleErrorById((prev) => ({ ...prev, [product.id]: '' }));
    try {
      product.isAvailable ? await deactivateVendorProduct(product.id) : await activateVendorProduct(product.id);
      await refreshBranchData(selectedBranchId);
    } catch (err: any) {
      setToggleErrorById((prev) => ({
        ...prev,
        [product.id]: apiErrorMessage(err, 'Failed to update status.'),
      }));
    } finally {
      setTogglingId(null);
    }
  }

  /** Tracked Inventory Order-Time Enforcement. Only ever called for TRACKED products (the button itself is hidden for OPEN — see the row rendering below). Never touches isAvailable. */
  async function handleSetInventoryToZero(product: VendorProduct) {
    if (settingZeroId) return;
    const confirmed = window.confirm(`Set stock for "${product.name}" to 0? This does not change whether the product is active.`);
    if (!confirmed) return;
    setSettingZeroId(product.id);
    setZeroErrorById((prev) => ({ ...prev, [product.id]: '' }));
    try {
      await setVendorProductInventoryToZero(product.id);
      await refreshBranchData(selectedBranchId);
    } catch (err: any) {
      setZeroErrorById((prev) => ({
        ...prev,
        [product.id]: apiErrorMessage(err, 'Failed to set inventory to zero.'),
      }));
    } finally {
      setSettingZeroId(null);
    }
  }

  async function handleImageUpload(productId: string, file: File | undefined) {
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      setImageErrorById((prev) => ({ ...prev, [productId]: 'Only JPEG, PNG, or WebP images are allowed.' }));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setImageErrorById((prev) => ({ ...prev, [productId]: 'Image exceeds the 5MB size limit.' }));
      return;
    }
    setUploadingImageId(productId);
    setImageErrorById((prev) => ({ ...prev, [productId]: '' }));
    try {
      await uploadVendorProductImage(productId, file);
      await refreshBranchData(selectedBranchId);
    } catch (err: any) {
      // Product data itself is untouched by a failed upload — only the
      // image action shows an error, nothing else on the page changes.
      setImageErrorById((prev) => ({
        ...prev,
        [productId]: apiErrorMessage(err, 'Image upload failed.'),
      }));
    } finally {
      setUploadingImageId(null);
    }
  }

  // Excel Inventory & Price Management.
  async function handleDownloadTemplate(prefilled: boolean) {
    if (!selectedBranchId) return;
    try {
      const blob = await downloadVendorImportTemplate(selectedBranchId, prefilled);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'hatly-products-template.xlsx';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setImportError(apiErrorMessage(err, 'Failed to download template.'));
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
      const summary = await validateVendorImport(importFile);
      setImportSummary(summary);
    } catch (err: any) {
      setImportError(apiErrorMessage(err, 'Failed to validate file.'));
    } finally {
      setIsValidatingImport(false);
    }
  }

  async function handleApplyImport() {
    if (!importFile || importSummary?.status !== 'READY') return;
    setIsApplyingImport(true);
    setImportError(null);
    try {
      const result = await applyVendorImport(importFile);
      setImportResult(result);
      setImportSummary(null);
      setImportFile(null);
      await refreshBranchData(selectedBranchId);
    } catch (err: any) {
      setImportError(apiErrorMessage(err, 'Failed to apply import.'));
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

  if (branchError) {
    return (
      <div className="mx-auto max-w-4xl rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {branchError}{' '}
        <button onClick={loadBranches} className="underline">
          Retry
        </button>
      </div>
    );
  }
  if (branches === null) return <p className="mx-auto max-w-4xl text-gray-500">Loading...</p>;
  if (branches.length === 0) {
    return (
      <div className="mx-auto max-w-4xl rounded border bg-white p-4 text-sm text-gray-600">
        No branches are available for your account yet. Contact your Admin.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Products</h1>
        {branches.length > 1 && (
          <select
            value={selectedBranchId}
            onChange={(e) => setSelectedBranchId(e.target.value)}
            className="rounded border px-3 py-2 text-sm"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={() => setShowImport((v) => !v)}
          className="rounded border border-gray-300 px-4 py-2 text-sm font-medium"
          disabled={!selectedBranchId}
        >
          {showImport ? 'Cancel' : 'Import Excel'}
        </button>
        <button
          onClick={() => setShowCreateForm((v) => !v)}
          className="rounded bg-hatly-orange px-4 py-2 text-sm font-medium text-white"
        >
          {showCreateForm ? 'Cancel' : 'New Product'}
        </button>
      </div>

      {showImport && (
        <div className="mt-3 space-y-3 rounded border bg-white p-4">
          <h3 className="text-sm font-semibold">Import Excel</h3>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => handleDownloadTemplate(true)} className="rounded border px-3 py-1.5 text-xs">
              Download Current Catalog Template
            </button>
            <button onClick={() => handleDownloadTemplate(false)} className="rounded border px-3 py-1.5 text-xs">
              Download Empty Template
            </button>
          </div>

          <input
            type="file"
            accept=".xlsx"
            onChange={(e) => handleImportFileSelected(e.target.files?.[0])}
            className="text-sm"
          />

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
              Applied: {importResult.totalRows} total rows, {importResult.updatedRows} updated,{' '}
              {importResult.unchangedRows} unchanged.
            </p>
          )}

          <button onClick={handleCloseImport} className="text-xs text-gray-500 underline">
            Close
          </button>
        </div>
      )}

      {showCreateForm && (
        <form onSubmit={handleCreate} className="mt-3 space-y-3 rounded border bg-white p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium">Name</label>
              <input
                required
                value={createFields.name}
                onChange={(e) => setCreateFields((f) => ({ ...f, name: e.target.value }))}
                className="mt-1 w-full rounded border px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Name (Arabic)</label>
              <input
                value={createFields.nameAr}
                onChange={(e) => setCreateFields((f) => ({ ...f, nameAr: e.target.value }))}
                className="mt-1 w-full rounded border px-3 py-2"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium">Description</label>
            <textarea
              value={createFields.description}
              onChange={(e) => setCreateFields((f) => ({ ...f, description: e.target.value }))}
              className="mt-1 w-full rounded border px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Category</label>
            {categories !== null && categories.length === 0 ? (
              <p className="mt-1 text-sm text-gray-500">No categories yet — contact your Admin.</p>
            ) : (
              <select
                required
                value={createFields.categoryId}
                onChange={(e) => setCreateFields((f) => ({ ...f, categoryId: e.target.value }))}
                className="mt-1 w-full rounded border px-3 py-2"
              >
                <option value="">Select a category...</option>
                {categories?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium">
                {createFields.pricingUnit === 'WEIGHT' ? 'Price per kg' : 'Price'}
              </label>
              <input
                required
                value={createFields.price}
                onChange={(e) => setCreateFields((f) => ({ ...f, price: e.target.value }))}
                placeholder="0.00"
                className="mt-1 w-full rounded border px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Pricing Unit</label>
              <select
                value={createFields.pricingUnit}
                onChange={(e) => setCreateFields((f) => ({ ...f, pricingUnit: e.target.value as PricingUnit }))}
                className="mt-1 w-full rounded border px-3 py-2"
              >
                <option value="PIECE">Piece</option>
                <option value="WEIGHT">Weight (per kg)</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium">Inventory</label>
              <select
                value={createFields.inventoryMode}
                onChange={(e) => setCreateFields((f) => ({ ...f, inventoryMode: e.target.value as InventoryMode }))}
                className="mt-1 w-full rounded border px-3 py-2"
              >
                <option value="OPEN">Open (no fixed stock)</option>
                <option value="TRACKED">Tracked</option>
              </select>
            </div>
            {createFields.inventoryMode === 'TRACKED' && (
              <div>
                <label className="block text-sm font-medium">
                  {createFields.pricingUnit === 'WEIGHT' ? 'Quantity (grams)' : 'Quantity (pieces)'}
                </label>
                <input
                  required
                  value={createFields.quantity}
                  onChange={(e) => setCreateFields((f) => ({ ...f, quantity: e.target.value }))}
                  className="mt-1 w-full rounded border px-3 py-2"
                />
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={createFields.isAvailable}
              onChange={(e) => setCreateFields((f) => ({ ...f, isAvailable: e.target.checked }))}
            />
            Available
          </label>
          {createError && <p className="text-sm text-red-600">{createError}</p>}
          <button
            type="submit"
            disabled={isCreating}
            className="rounded bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isCreating ? 'Creating...' : 'Create Product'}
          </button>
          <p className="text-xs text-gray-500">
            You can upload a photo for this product from the list below once it&apos;s created.
          </p>
        </form>
      )}

      <div className="mt-6">
        {productError && (
          <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {productError}{' '}
            <button onClick={() => refreshBranchData(selectedBranchId)} className="underline">
              Retry
            </button>
          </div>
        )}
        {categoryError && (
          <div className="mt-2 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {categoryError}
          </div>
        )}
        {!productError && products === null && <p className="text-gray-500">Loading...</p>}
        {!productError && products !== null && products.length === 0 && (
          <p className="text-gray-500">No products in this branch yet.</p>
        )}
        {!productError && products !== null && products.length > 0 && (
          <div className="space-y-3">
            {products.map((p) => (
              <div key={p.id} className="rounded border bg-white p-4">
                {editingId === p.id ? (
                  <form onSubmit={handleSaveEdit} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium">Name</label>
                        <input
                          required
                          value={editFields.name}
                          onChange={(e) => setEditFields((f) => ({ ...f, name: e.target.value }))}
                          className="mt-1 w-full rounded border px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium">Name (Arabic)</label>
                        <input
                          value={editFields.nameAr}
                          onChange={(e) => setEditFields((f) => ({ ...f, nameAr: e.target.value }))}
                          className="mt-1 w-full rounded border px-3 py-2"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium">Description</label>
                      <textarea
                        value={editFields.description}
                        onChange={(e) => setEditFields((f) => ({ ...f, description: e.target.value }))}
                        className="mt-1 w-full rounded border px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium">Category</label>
                      <select
                        required
                        value={editFields.categoryId}
                        onChange={(e) => setEditFields((f) => ({ ...f, categoryId: e.target.value }))}
                        className="mt-1 w-full rounded border px-3 py-2"
                      >
                        {categories?.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium">
                        {editingPricingUnit === 'WEIGHT' ? 'Price per kg' : 'Price'}
                      </label>
                      <input
                        required
                        value={editFields.price}
                        onChange={(e) => setEditFields((f) => ({ ...f, price: e.target.value }))}
                        className="mt-1 w-full rounded border px-3 py-2"
                      />
                      <p className="mt-1 text-xs text-gray-500">Pricing unit ({editingPricingUnit}) cannot be changed after creation.</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium">Inventory</label>
                        <select
                          value={editFields.inventoryMode}
                          onChange={(e) =>
                            setEditFields((f) => ({ ...f, inventoryMode: e.target.value as InventoryMode }))
                          }
                          className="mt-1 w-full rounded border px-3 py-2"
                        >
                          <option value="OPEN">Open (no fixed stock)</option>
                          <option value="TRACKED">Tracked</option>
                        </select>
                      </div>
                      {editFields.inventoryMode === 'TRACKED' && (
                        <div>
                          <label className="block text-sm font-medium">
                            {editingPricingUnit === 'WEIGHT' ? 'Quantity (grams)' : 'Quantity (pieces)'}
                          </label>
                          <input
                            required
                            value={editFields.quantity}
                            onChange={(e) => setEditFields((f) => ({ ...f, quantity: e.target.value }))}
                            className="mt-1 w-full rounded border px-3 py-2"
                          />
                        </div>
                      )}
                    </div>
                    {editError && <p className="text-sm text-red-600">{editError}</p>}
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={isSaving}
                        className="rounded bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        {isSaving ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex gap-3">
                      {p.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imageUrl} alt={p.name} className="h-16 w-16 rounded object-cover" />
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded bg-gray-100 text-xs text-gray-400">
                          No image
                        </div>
                      )}
                      <div>
                        <button onClick={() => startEdit(p)} className="text-left font-medium hover:underline">
                          {p.name}
                        </button>
                        {p.nameAr && <p className="text-xs text-gray-500">{p.nameAr}</p>}
                        <p className="text-xs text-gray-500">
                          {categoryName(p.categoryId)} &middot; {(p.priceMinor / 100).toFixed(2)}
                          {p.pricingUnit === 'WEIGHT' ? ' / kg' : ''} &middot; {p.pricingUnit}
                        </p>
                        <p className="text-xs text-gray-500">
                          {p.inventoryMode === 'OPEN'
                            ? 'Open stock'
                            : `Tracked: ${p.quantity ?? 0} ${p.pricingUnit === 'WEIGHT' ? 'g' : 'pcs'}`}
                        </p>
                        <label className="mt-1 inline-block text-xs text-hatly-orange">
                          {uploadingImageId === p.id ? 'Uploading...' : p.imageUrl ? 'Change Image' : 'Upload Image'}
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="hidden"
                            disabled={uploadingImageId === p.id}
                            onChange={(e) => handleImageUpload(p.id, e.target.files?.[0])}
                          />
                        </label>
                        {imageErrorById[p.id] && <p className="text-xs text-red-600">{imageErrorById[p.id]}</p>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${p.isAvailable ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}
                      >
                        {p.isAvailable ? 'Active' : 'Inactive'}
                      </span>
                      <button
                        onClick={() => handleToggleActive(p)}
                        disabled={togglingId === p.id}
                        className="text-xs text-gray-500 underline disabled:opacity-50"
                      >
                        {p.isAvailable ? 'Deactivate' : 'Activate'}
                      </button>
                      {toggleErrorById[p.id] && <p className="text-xs text-red-600">{toggleErrorById[p.id]}</p>}
                      {p.inventoryMode === 'TRACKED' && (
                        <button
                          onClick={() => handleSetInventoryToZero(p)}
                          disabled={settingZeroId === p.id}
                          className="text-xs text-gray-500 underline disabled:opacity-50"
                        >
                          Set Inventory to 0
                        </button>
                      )}
                      {zeroErrorById[p.id] && <p className="text-xs text-red-600">{zeroErrorById[p.id]}</p>}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

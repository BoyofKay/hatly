'use client';
import { gramsToKg, parseKgToGrams } from '../../../lib/money';

/** Stock typed by the store: kg with decimals for weighed products (stored as grams), whole pieces otherwise. null = invalid. */
function quantityFromInput(raw: string, unit: string): number | null {
  if (unit === 'WEIGHT') return parseKgToGrams(raw.trim());
  const n = Number(raw);
  return raw.trim() !== '' && Number.isInteger(n) && n >= 0 ? n : null;
}

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
import { ProductOptionsEditor } from '../../../components/products/ProductOptionsEditor';
import { useLang } from '../../../lib/ui/lang';
import { KpiCard, useToast } from '../../../components/ui';
import { VendorProductRequests } from '../../../components/products/VendorProductRequests';
import { ICONS } from '../../../components/ui/icons';

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
  const { t, num } = useLang();
  const toast = useToast();
  // R7: bumps the 'Product changes for Hatly' panel after any change that may have created a request.
  const [requestsVersion, setRequestsVersion] = useState(0);
  const [branches, setBranches] = useState<VendorOwnedBranch[] | null>(null);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');

  const [products, setProducts] = useState<VendorProduct[] | null>(null);
  const [productError, setProductError] = useState<string | null>(null);
  const [categories, setCategories] = useState<VendorCategory[] | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const [optionsOpenId, setOptionsOpenId] = useState<string | null>(null);
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
      setBranchError(apiErrorMessage(err, t('Failed to load branches.', 'تعذّر تحميل الفروع.')));
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
      setProductError(apiErrorMessage(err, t('Failed to load products.', 'تعذّر تحميل المنتجات.')));
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
      setCreateError(t('Enter a valid price.', 'أدخل سعرًا صحيحًا.'));
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
      const qty = quantityFromInput(createFields.quantity, createFields.pricingUnit);
      if (qty === null) {
        setCreateError(createFields.pricingUnit === 'WEIGHT' ? t('Enter the quantity in kg, e.g. 12.5.', 'أدخل الكمية بالكيلو، مثل 12.5.') : t('Enter a valid, non-negative whole-number quantity.', 'أدخل كمية صحيحة غير سالبة (عدد صحيح).'));
        return;
      }
      input.quantity = qty;
    }

    setIsCreating(true);
    try {
      await createVendorProduct(input);
      // R7: a new product waits for Hatly's approval and is not shown to customers until then.
      toast.push('success', t('Product saved and sent to Hatly for approval. It goes live once approved.', 'تم حفظ المنتج وإرساله إلى هاتلي للموافقة. يُعرض بعد الموافقة.'));
      setRequestsVersion((v) => v + 1);
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
      setCreateError(apiErrorMessage(err, t('Failed to create product.', 'تعذّر إنشاء المنتج.')));
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
      quantity: product.quantity != null ? (product.pricingUnit === 'WEIGHT' ? gramsToKg(product.quantity) : String(product.quantity)) : '',
    });
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (isSaving || !editingId) return;
    setEditError(null);

    const priceMinor = toMinorUnits(editFields.price);
    if (priceMinor === null) {
      setEditError(t('Enter a valid price.', 'أدخل سعرًا صحيحًا.'));
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
      const qty = quantityFromInput(editFields.quantity, editingPricingUnit);
      if (qty === null) {
        setEditError(editingPricingUnit === 'WEIGHT' ? t('Enter the quantity in kg, e.g. 12.5.', 'أدخل الكمية بالكيلو، مثل 12.5.') : t('Enter a valid, non-negative whole-number quantity.', 'أدخل كمية صحيحة غير سالبة (عدد صحيح).'));
        return;
      }
      input.quantity = qty;
    }

    setIsSaving(true);
    try {
      const saved = await updateVendorProduct(editingId, input);
      // R7: a price reduction and stock apply now; a price increase or detail change waits for Hatly (the approved version stays live).
      toast.push('success', saved.pendingChange
        ? t('Saved. The price increase / detail changes were sent to Hatly for approval — customers see the current version until then.', 'تم الحفظ. أُرسلت زيادة السعر / تغييرات التفاصيل إلى هاتلي للموافقة — يرى العملاء النسخة الحالية حتى ذلك.')
        : t('Saved.', 'تم الحفظ.'));
      setRequestsVersion((v) => v + 1);
      setEditingId(null);
      await refreshBranchData(selectedBranchId);
    } catch (err: any) {
      setEditError(apiErrorMessage(err, t('Failed to save changes.', 'تعذّر حفظ التغييرات.')));
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
      if (!product.isAvailable && product.approvalStatus === 'PENDING') {
        toast.push('success', t('Noted — it goes live as soon as Hatly approves it.', 'تم — سيُعرض فور موافقة هاتلي.'));
      }
      await refreshBranchData(selectedBranchId);
    } catch (err: any) {
      setToggleErrorById((prev) => ({
        ...prev,
        [product.id]: apiErrorMessage(err, t('Failed to update status.', 'تعذّر تحديث الحالة.')),
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
        [product.id]: apiErrorMessage(err, t('Failed to set inventory to zero.', 'تعذّر تصفير المخزون.')),
      }));
    } finally {
      setSettingZeroId(null);
    }
  }

  async function handleImageUpload(productId: string, file: File | undefined) {
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      setImageErrorById((prev) => ({ ...prev, [productId]: t('Only JPEG, PNG, or WebP images are allowed.', 'الصور المسموحة: JPEG وPNG وWebP فقط.') }));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setImageErrorById((prev) => ({ ...prev, [productId]: t('Image exceeds the 5MB size limit.', 'حجم الصورة يتجاوز 5 ميغابايت.') }));
      return;
    }
    setUploadingImageId(productId);
    setImageErrorById((prev) => ({ ...prev, [productId]: '' }));
    try {
      const saved = await uploadVendorProductImage(productId, file);
      if (saved.pendingChange) {
        toast.push('success', t('New photo sent to Hatly for approval. The current photo stays until then.', 'أُرسلت الصورة الجديدة إلى هاتلي للموافقة. تبقى الصورة الحالية حتى ذلك.'));
        setRequestsVersion((v) => v + 1);
      }
      await refreshBranchData(selectedBranchId);
    } catch (err: any) {
      // Product data itself is untouched by a failed upload — only the
      // image action shows an error, nothing else on the page changes.
      setImageErrorById((prev) => ({
        ...prev,
        [productId]: apiErrorMessage(err, t('Image upload failed.', 'فشل رفع الصورة.')),
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
      setImportError(apiErrorMessage(err, t('Failed to download template.', 'تعذّر تنزيل القالب.')));
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
      setImportError(apiErrorMessage(err, t('Failed to validate file.', 'تعذّر فحص الملف.')));
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
      setRequestsVersion((v) => v + 1);
      setImportSummary(null);
      setImportFile(null);
      await refreshBranchData(selectedBranchId);
    } catch (err: any) {
      setImportError(apiErrorMessage(err, t('Failed to apply import.', 'تعذّر تطبيق الاستيراد.')));
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
      <div className="max-w-6xl rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {branchError}{' '}
        <button onClick={loadBranches} className="underline">
          {t('Retry', 'إعادة المحاولة')}
        </button>
      </div>
    );
  }
  if (branches === null) return <p className="max-w-6xl text-gray-500">{t('Loading...', 'جارٍ التحميل...')}</p>;
  if (branches.length === 0) {
    return (
      <div className="max-w-6xl rounded-xl border bg-white p-4 text-sm text-gray-600 border-gray-200 shadow-sm">
        {t('No branches are available for your account yet. Contact your Admin.', 'لا توجد فروع متاحة لحسابك بعد. تواصل مع الإدارة.')}
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">{t('Products', 'المنتجات')}</h1>
        {branches.length > 1 && (
          <select
            value={selectedBranchId}
            onChange={(e) => setSelectedBranchId(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {products !== null && !productError && (
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="vendor-products-kpis">
          <KpiCard label={t('Products in this branch', 'منتجات هذا الفرع')} value={num(products.length)} icon={ICONS.box} />
          <KpiCard label={t('Available to customers', 'متاحة للعملاء')} value={num(products.filter((p) => p.isAvailable).length)} icon={ICONS.check} />
          <KpiCard label={t('Unavailable', 'غير متاحة')} value={num(products.filter((p) => !p.isAvailable).length)} icon={ICONS.empty} />
          <KpiCard label={t('Without a photo', 'بلا صورة')} value={num(products.filter((p) => !p.imageUrl).length)} icon={ICONS.image} />
        </div>
      )}

      {selectedBranchId && <div className="mt-4"><VendorProductRequests branchId={selectedBranchId} reloadKey={requestsVersion} onChanged={() => refreshBranchData(selectedBranchId)} /></div>}

      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={() => setShowImport((v) => !v)}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium bg-white text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40"
          disabled={!selectedBranchId}
        >
          {showImport ? t('Cancel', 'إلغاء') : t('Import Excel', 'استيراد Excel')}
        </button>
        <button
          onClick={() => setShowCreateForm((v) => !v)}
          className="rounded-lg bg-hatly-orange px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40"
        >
          {showCreateForm ? t('Cancel', 'إلغاء') : t('New Product', 'منتج جديد')}
        </button>
      </div>

      {showImport && (
        <div className="mt-3 space-y-3 rounded-xl border bg-white p-4 border-gray-200 shadow-sm">
          <h3 className="text-sm font-semibold">{t('Import Excel', 'استيراد Excel')}</h3>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => handleDownloadTemplate(true)} className="rounded-lg border px-3 py-1.5 text-xs border-gray-300 bg-white font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
              {t('Download Current Catalog Template', 'تنزيل قالب الكتالوج الحالي')}
            </button>
            <button onClick={() => handleDownloadTemplate(false)} className="rounded-lg border px-3 py-1.5 text-xs border-gray-300 bg-white font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
              {t('Download Empty Template', 'تنزيل قالب فارغ')}
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
              className="rounded-lg bg-hatly-orange px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40"
            >
              {isValidatingImport ? t('Validating…', 'جارٍ الفحص…') : t('Validate', 'فحص')}
            </button>
          )}

          {importError && <p className="text-xs text-red-600">{importError}</p>}

          {importSummary && (
            <div className="space-y-2">
              <p className="text-xs">
                {t('Status:', 'الحالة:')} <span className="font-semibold">{importSummary.status}</span> — {importSummary.totalRows} {t('rows,', 'صفًّا،')}{' '}
                {importSummary.changedRows} {t('changed,', 'متغيّر،')} {importSummary.unchangedRows} {t('unchanged', 'دون تغيير')}
              </p>
              <div className="max-h-64 overflow-y-auto rounded border">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 tracking-wide">
                    <tr>
                      <th className="p-1.5 text-left font-medium">{t('Row', 'الصف')}</th>
                      <th className="p-1.5 text-left font-medium">{t('Product', 'المنتج')}</th>
                      <th className="p-1.5 text-left font-medium">{t('Changed Fields', 'الحقول المتغيّرة')}</th>
                      <th className="p-1.5 text-left font-medium">{t('Errors', 'الأخطاء')}</th>
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
                className="rounded-lg bg-hatly-orange px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40"
              >
                {isApplyingImport ? t('Applying…', 'جارٍ التطبيق…') : t('Confirm Apply', 'تأكيد التطبيق')}
              </button>
            </div>
          )}

          {importResult && (
            <p className="rounded bg-green-50 p-2 text-xs text-green-800">
              {t('Applied:', 'تم التطبيق:')} {importResult.totalRows} {t('total rows,', 'إجمالي الصفوف،')} {importResult.updatedRows} {t('updated,', 'محدَّث،')}{' '}
              {importResult.unchangedRows} {t('unchanged.', 'دون تغيير.')}
              {importResult.sentForApproval ? (
                <span className="block" data-testid="import-sent-for-approval">
                  {t(`${importResult.sentForApproval} row(s) with a price increase or name change were sent to Hatly for approval.`, `أُرسل ${importResult.sentForApproval} صف بزيادة سعر أو تغيير اسم إلى هاتلي للموافقة.`)}
                </span>
              ) : null}
            </p>
          )}

          <button onClick={handleCloseImport} className="text-xs text-gray-500 underline">
            {t('Close', 'إغلاق')}
          </button>
        </div>
      )}

      {showCreateForm && (
        <form onSubmit={handleCreate} className="mt-3 space-y-3 rounded-xl border bg-white p-4 border-gray-200 shadow-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium">{t('Name', 'الاسم')}</label>
              <input
                required
                value={createFields.name}
                onChange={(e) => setCreateFields((f) => ({ ...f, name: e.target.value }))}
                className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">{t('Name (Arabic)', 'الاسم (بالعربية)')}</label>
              <input
                value={createFields.nameAr}
                onChange={(e) => setCreateFields((f) => ({ ...f, nameAr: e.target.value }))}
                className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium">{t('Description', 'الوصف')}</label>
            <textarea
              value={createFields.description}
              onChange={(e) => setCreateFields((f) => ({ ...f, description: e.target.value }))}
              className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">{t('Category', 'التصنيف')}</label>
            {categories !== null && categories.length === 0 ? (
              <p className="mt-1 text-sm text-gray-500">{t('No categories yet — contact your Admin.', 'لا توجد تصنيفات بعد — تواصل مع الإدارة.')}</p>
            ) : (
              <select
                required
                value={createFields.categoryId}
                onChange={(e) => setCreateFields((f) => ({ ...f, categoryId: e.target.value }))}
                className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
              >
                <option value="">{t('Select a category...', 'اختر تصنيفًا...')}</option>
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
                {createFields.pricingUnit === 'WEIGHT' ? t('Price per kg', 'السعر للكيلو') : t('Price', 'السعر')}
              </label>
              <input
                required
                value={createFields.price}
                onChange={(e) => setCreateFields((f) => ({ ...f, price: e.target.value }))}
                placeholder="0.00"
                className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">{t('Pricing Unit', 'وحدة التسعير')}</label>
              <select
                value={createFields.pricingUnit}
                onChange={(e) => setCreateFields((f) => ({ ...f, pricingUnit: e.target.value as PricingUnit }))}
                className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
              >
                <option value="PIECE">{t('Piece', 'قطعة')}</option>
                <option value="WEIGHT">{t('Weight (per kg)', 'بالوزن (للكيلو)')}</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium">{t('Inventory', 'المخزون')}</label>
              <select
                value={createFields.inventoryMode}
                onChange={(e) => setCreateFields((f) => ({ ...f, inventoryMode: e.target.value as InventoryMode }))}
                className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
              >
                <option value="OPEN">{t('Open (no fixed stock)', 'مفتوح (بدون مخزون محدد)')}</option>
                <option value="TRACKED">{t('Tracked', 'متتبَّع')}</option>
              </select>
            </div>
            {createFields.inventoryMode === 'TRACKED' && (
              <div>
                <label className="block text-sm font-medium">
                  {createFields.pricingUnit === 'WEIGHT' ? t('Quantity (kg)', 'الكمية (بالكيلو)') : t('Quantity (pieces)', 'الكمية (بالقطع)')}
                </label>
                <input
                  required
                  value={createFields.quantity}
                  onChange={(e) => setCreateFields((f) => ({ ...f, quantity: e.target.value }))}
                  className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
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
            {t('Available', 'متاح')}
          </label>
          {createError && <p className="text-sm text-red-600">{createError}</p>}
          <button
            type="submit"
            disabled={isCreating}
            className="rounded-lg bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50 shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40"
          >
            {isCreating ? t('Creating...', 'جارٍ الإنشاء...') : t('Create Product', 'إنشاء المنتج')}
          </button>
          <p className="text-xs text-gray-500">
            You can upload a photo for this product from the list below once it&apos;s created.
          </p>
        </form>
      )}

      <div className="mt-6">
        {productError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {productError}{' '}
            <button onClick={() => refreshBranchData(selectedBranchId)} className="underline">
              {t('Retry', 'إعادة المحاولة')}
            </button>
          </div>
        )}
        {categoryError && (
          <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {categoryError}
          </div>
        )}
        {!productError && products === null && <p className="text-gray-500">{t('Loading...', 'جارٍ التحميل...')}</p>}
        {!productError && products !== null && products.length === 0 && (
          <p className="text-gray-500">{t('No products in this branch yet.', 'لا توجد منتجات في هذا الفرع بعد.')}</p>
        )}
        {!productError && products !== null && products.length > 0 && (
          <div className="space-y-3">
            {products.map((p) => (
              <div key={p.id} className="rounded-xl border bg-white p-4 border-gray-200 shadow-sm">
                {editingId === p.id ? (
                  <form onSubmit={handleSaveEdit} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium">{t('Name', 'الاسم')}</label>
                        <input
                          required
                          value={editFields.name}
                          onChange={(e) => setEditFields((f) => ({ ...f, name: e.target.value }))}
                          className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium">{t('Name (Arabic)', 'الاسم (بالعربية)')}</label>
                        <input
                          value={editFields.nameAr}
                          onChange={(e) => setEditFields((f) => ({ ...f, nameAr: e.target.value }))}
                          className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium">{t('Description', 'الوصف')}</label>
                      <textarea
                        value={editFields.description}
                        onChange={(e) => setEditFields((f) => ({ ...f, description: e.target.value }))}
                        className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium">{t('Category', 'التصنيف')}</label>
                      <select
                        required
                        value={editFields.categoryId}
                        onChange={(e) => setEditFields((f) => ({ ...f, categoryId: e.target.value }))}
                        className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
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
                        {editingPricingUnit === 'WEIGHT' ? t('Price per kg', 'السعر للكيلو') : t('Price', 'السعر')}
                      </label>
                      <input
                        required
                        value={editFields.price}
                        onChange={(e) => setEditFields((f) => ({ ...f, price: e.target.value }))}
                        className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
                      />
                      <p className="mt-1 text-xs text-gray-500">{t('Pricing unit', 'وحدة التسعير')} ({editingPricingUnit}) {t('cannot be changed after creation.', 'لا يمكن تغييرها بعد الإنشاء.')}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium">{t('Inventory', 'المخزون')}</label>
                        <select
                          value={editFields.inventoryMode}
                          onChange={(e) =>
                            setEditFields((f) => ({ ...f, inventoryMode: e.target.value as InventoryMode }))
                          }
                          className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
                        >
                          <option value="OPEN">{t('Open (no fixed stock)', 'مفتوح (بدون مخزون محدد)')}</option>
                          <option value="TRACKED">{t('Tracked', 'متتبَّع')}</option>
                        </select>
                      </div>
                      {editFields.inventoryMode === 'TRACKED' && (
                        <div>
                          <label className="block text-sm font-medium">
                            {editingPricingUnit === 'WEIGHT' ? t('Quantity (kg)', 'الكمية (بالكيلو)') : t('Quantity (pieces)', 'الكمية (بالقطع)')}
                          </label>
                          <input
                            required
                            value={editFields.quantity}
                            onChange={(e) => setEditFields((f) => ({ ...f, quantity: e.target.value }))}
                            className="mt-1 w-full rounded-lg border px-3 py-2 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
                          />
                        </div>
                      )}
                    </div>
                    {editError && <p className="text-sm text-red-600">{editError}</p>}
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={isSaving}
                        className="rounded-lg bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50 shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40"
                      >
                        {isSaving ? t('Saving...', 'جارٍ الحفظ...') : t('Save', 'حفظ')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700"
                      >
                        {t('Cancel', 'إلغاء')}
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
                          {t('No image', 'لا توجد صورة')}
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
                            ? t('Open stock', 'مخزون مفتوح')
                            : `Tracked: ${p.pricingUnit === 'WEIGHT' ? `${gramsToKg(p.quantity ?? 0)} kg` : `${p.quantity ?? 0} pcs`}`}
                        </p>
                        <label className="mt-1 inline-block text-xs text-hatly-orange">
                          {uploadingImageId === p.id ? t('Uploading...', 'جارٍ الرفع...') : p.imageUrl ? t('Change Image', 'تغيير الصورة') : t('Upload Image', 'رفع صورة')}
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
                      {p.approvalStatus === 'PENDING' && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800" data-testid={`approval-${p.id}`}>{t('Waiting for Hatly', 'بانتظار هاتلي')}</span>}
                      {p.approvalStatus === 'REJECTED' && <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700" data-testid={`approval-${p.id}`}>{t('Rejected — edit to resend', 'مرفوض — عدّله لإعادة الإرسال')}</span>}
                      <button
                        onClick={() => handleToggleActive(p)}
                        disabled={togglingId === p.id}
                        className="text-xs text-gray-500 underline disabled:opacity-50"
                      >
                        {p.isAvailable ? t('Deactivate', 'إلغاء التفعيل') : t('Activate', 'تفعيل')}
                      </button>
                      {toggleErrorById[p.id] && <p className="text-xs text-red-600">{toggleErrorById[p.id]}</p>}
                      {p.inventoryMode === 'TRACKED' && (
                        <button
                          onClick={() => handleSetInventoryToZero(p)}
                          disabled={settingZeroId === p.id}
                          className="text-xs text-gray-500 underline disabled:opacity-50"
                        >
                          {t('Set Inventory to 0', 'تصفير المخزون')}
                        </button>
                      )}
                      {zeroErrorById[p.id] && <p className="text-xs text-red-600">{zeroErrorById[p.id]}</p>}
                      <button
                        data-testid={`product-options-toggle-${p.id}`}
                        onClick={() => setOptionsOpenId((cur) => (cur === p.id ? null : p.id))}
                        className="text-xs text-hatly-orange underline"
                      >
                        {optionsOpenId === p.id ? t('Hide options', 'إخفاء الخيارات') : t('Options', 'الخيارات')}
                      </button>
                    </div>
                  </div>
                )}
                {editingId !== p.id && optionsOpenId === p.id && <ProductOptionsEditor scope="vendor" productId={p.id} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

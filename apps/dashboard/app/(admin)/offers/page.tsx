'use client';

import { useEffect, useState } from 'react';
import { VendorBranch, listVendorBranches } from '../../../lib/api/admin-vendors';
import { Product, ProductCategory, listProducts, listCategories } from '../../../lib/api/admin-catalog';
import {
  CreateOfferInput,
  DiscountType,
  Offer,
  OfferMechanism,
  activateOffer,
  createOffer,
  deactivateOffer,
  listOffers,
} from '../../../lib/api/admin-offers';
import { apiErrorMessage } from '../../../lib/api/errors';

/**
 * Admin Offers Management UI. Reuses the existing Admin catalog/branch
 * APIs for all real data — no fixtures, no hardcoded ids. The backend
 * has no general field-level update endpoint for an existing Offer
 * (confirmed by inspection — deliberate, to avoid retroactively
 * changing the meaning of historical consumption snapshots), so this
 * page only supports Create + Activate/Deactivate, never editing an
 * existing offer's fields — that limitation is real, not an oversight.
 */
export default function AdminOffersPage() {
  const [branches, setBranches] = useState<VendorBranch[] | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [categories, setCategories] = useState<ProductCategory[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [mechanism, setMechanism] = useState<OfferMechanism>('SUBTOTAL_DISCOUNT');
  const [name, setName] = useState('');
  const [discountType, setDiscountType] = useState<DiscountType>('PERCENTAGE');
  const [discountValue, setDiscountValue] = useState('');
  const [minimumEligibleSubtotal, setMinimumEligibleSubtotal] = useState('');
  const [maximumDiscount, setMaximumDiscount] = useState('');
  const [specialPrice, setSpecialPrice] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [targetingMode, setTargetingMode] = useState<'BRANCH_WIDE' | 'PRODUCT' | 'CATEGORY'>('BRANCH_WIDE');
  const [targetProductId, setTargetProductId] = useState('');
  const [targetCategoryId, setTargetCategoryId] = useState('');
  const [perCustomerLifetimeLimit, setPerCustomerLifetimeLimit] = useState('');
  const [totalAllocationLimit, setTotalAllocationLimit] = useState('');
  const [budgetCapMinor, setBudgetCapMinor] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [actionErrorById, setActionErrorById] = useState<Record<string, string>>({});

  useEffect(() => {
    listVendorBranches()
      .then(setBranches)
      .catch((err) => setListError(apiErrorMessage(err, 'Failed to load branches.')));
  }, []);

  useEffect(() => {
    if (!selectedBranchId) return;
    refresh(selectedBranchId);
  }, [selectedBranchId]);

  async function refresh(branchId: string) {
    setListError(null);
    try {
      const [offersData, productsData, categoriesData] = await Promise.all([
        listOffers(branchId),
        listProducts(branchId),
        listCategories(branchId),
      ]);
      setOffers(offersData);
      setProducts(productsData);
      setCategories(categoriesData);
    } catch (err: any) {
      setListError(apiErrorMessage(err, 'Failed to load offers.'));
    }
  }

  function resetForm() {
    setName('');
    setDiscountType('PERCENTAGE');
    setDiscountValue('');
    setMinimumEligibleSubtotal('');
    setMaximumDiscount('');
    setSpecialPrice('');
    setStartAt('');
    setEndAt('');
    setTargetingMode('BRANCH_WIDE');
    setTargetProductId('');
    setTargetCategoryId('');
    setPerCustomerLifetimeLimit('');
    setTotalAllocationLimit('');
    setBudgetCapMinor('');
    setCreateError(null);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (isCreating || !selectedBranchId) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      const input: CreateOfferInput = {
        vendorBranchId: selectedBranchId,
        name,
        mechanism,
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
        productIds: targetingMode === 'PRODUCT' && targetProductId ? [targetProductId] : undefined,
        categoryIds: targetingMode === 'CATEGORY' && targetCategoryId ? [targetCategoryId] : undefined,
        perCustomerLifetimeLimit: perCustomerLifetimeLimit ? Number(perCustomerLifetimeLimit) : undefined,
        totalAllocationLimit: totalAllocationLimit ? Number(totalAllocationLimit) : undefined,
        budgetCapMinor: budgetCapMinor ? Math.round(Number(budgetCapMinor) * 100) : undefined,
      };
      if (mechanism === 'SUBTOTAL_DISCOUNT') {
        input.discountType = discountType;
        input.discountValue = discountType === 'PERCENTAGE' ? Math.round(Number(discountValue) * 100) : Math.round(Number(discountValue) * 100);
        input.minimumEligibleSubtotalMinor = minimumEligibleSubtotal ? Math.round(Number(minimumEligibleSubtotal) * 100) : undefined;
        input.maximumDiscountMinor = maximumDiscount ? Math.round(Number(maximumDiscount) * 100) : undefined;
      } else {
        input.specialPriceMinor = Math.round(Number(specialPrice) * 100);
      }

      await createOffer(input);
      setShowCreateForm(false);
      resetForm();
      await refresh(selectedBranchId);
    } catch (err: any) {
      // Mutual-exclusion and other structured backend errors surface
      // their real message directly — never a generic/raw stack trace.
      setCreateError(apiErrorMessage(err, 'Failed to create offer.'));
    } finally {
      setIsCreating(false);
    }
  }

  async function handleToggleActive(offer: Offer) {
    setActionErrorById((prev) => ({ ...prev, [offer.id]: '' }));
    try {
      offer.isActive ? await deactivateOffer(offer.id) : await activateOffer(offer.id);
      await refresh(selectedBranchId);
    } catch (err: any) {
      setActionErrorById((prev) => ({ ...prev, [offer.id]: apiErrorMessage(err, 'Failed to update offer.' )}));
    }
  }

  function formatMinor(minor: number | null): string {
    if (minor == null) return '—';
    return `${(minor / 100).toFixed(2)} EGP`;
  }

  function targetingSummary(offer: Offer): string {
    if (offer.productIds.length > 0) {
      const p = products?.find((pr) => pr.id === offer.productIds[0]);
      return `Product: ${p?.name ?? offer.productIds[0]}`;
    }
    if (offer.categoryIds.length > 0) {
      const c = categories?.find((cat) => cat.id === offer.categoryIds[0]);
      return `Category: ${c?.name ?? offer.categoryIds[0]}`;
    }
    return 'Branch-wide';
  }

  function mechanismSummary(offer: Offer): string {
    if (offer.mechanism === 'SUBTOTAL_DISCOUNT') {
      const value =
        offer.discountType === 'PERCENTAGE' ? `${((offer.discountValue ?? 0) / 100).toFixed(0)}%` : formatMinor(offer.discountValue);
      return `${value} off eligible products`;
    }
    return `Special Price ${formatMinor(offer.specialPriceMinor)}`;
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">Offers</h1>

      <div className="mt-4">
        <label className="text-sm font-medium">Vendor Branch</label>
        <select
          value={selectedBranchId}
          onChange={(e) => setSelectedBranchId(e.target.value)}
          className="ml-2 rounded border px-2 py-1 text-sm"
        >
          <option value="">Select a branch…</option>
          {branches?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {listError && <p className="mt-2 text-sm text-red-600">{listError}</p>}

      {selectedBranchId && (
        <>
          <div className="mt-4 flex justify-end">
            <button
              onClick={() => setShowCreateForm((v) => !v)}
              className="rounded bg-hatly-orange px-4 py-2 text-sm font-medium text-white"
            >
              {showCreateForm ? 'Cancel' : 'New Offer'}
            </button>
          </div>

          {showCreateForm && (
            <form onSubmit={handleCreate} className="mt-3 space-y-3 rounded border bg-white p-4">
              <div>
                <label className="block text-sm font-medium">Mechanism</label>
                <select
                  value={mechanism}
                  onChange={(e) => setMechanism(e.target.value as OfferMechanism)}
                  className="mt-1 w-full rounded border px-2 py-1 text-sm"
                >
                  <option value="SUBTOTAL_DISCOUNT">Subtotal Discount</option>
                  <option value="FLASH_SALE">Flash Sale</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium">Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} required className="mt-1 w-full rounded border px-2 py-1 text-sm" />
              </div>

              <div>
                <label className="block text-sm font-medium">Targeting</label>
                <select
                  value={targetingMode}
                  onChange={(e) => setTargetingMode(e.target.value as any)}
                  className="mt-1 w-full rounded border px-2 py-1 text-sm"
                >
                  <option value="BRANCH_WIDE">Branch-wide (applies to every product)</option>
                  <option value="PRODUCT">Specific Product</option>
                  <option value="CATEGORY">Specific Category</option>
                </select>
                {targetingMode === 'PRODUCT' && (
                  <select
                    value={targetProductId}
                    onChange={(e) => setTargetProductId(e.target.value)}
                    required
                    className="mt-1 w-full rounded border px-2 py-1 text-sm"
                  >
                    <option value="">Select a product…</option>
                    {products?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
                {targetingMode === 'CATEGORY' && (
                  <select
                    value={targetCategoryId}
                    onChange={(e) => setTargetCategoryId(e.target.value)}
                    required
                    className="mt-1 w-full rounded border px-2 py-1 text-sm"
                  >
                    <option value="">Select a category…</option>
                    {categories?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {mechanism === 'SUBTOTAL_DISCOUNT' ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium">Discount Type</label>
                      <select
                        value={discountType}
                        onChange={(e) => setDiscountType(e.target.value as DiscountType)}
                        className="mt-1 w-full rounded border px-2 py-1 text-sm"
                      >
                        <option value="PERCENTAGE">Percentage</option>
                        <option value="FIXED">Fixed Amount</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium">
                        {discountType === 'PERCENTAGE' ? 'Discount %' : 'Discount Amount (EGP)'}
                      </label>
                      <input
                        type="number"
                        value={discountValue}
                        onChange={(e) => setDiscountValue(e.target.value)}
                        required
                        min="0"
                        className="mt-1 w-full rounded border px-2 py-1 text-sm"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium">Minimum Eligible Subtotal (EGP)</label>
                      <input
                        type="number"
                        value={minimumEligibleSubtotal}
                        onChange={(e) => setMinimumEligibleSubtotal(e.target.value)}
                        min="0"
                        className="mt-1 w-full rounded border px-2 py-1 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium">Maximum Discount (EGP)</label>
                      <input
                        type="number"
                        value={maximumDiscount}
                        onChange={(e) => setMaximumDiscount(e.target.value)}
                        min="0"
                        className="mt-1 w-full rounded border px-2 py-1 text-sm"
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium">Special Price (EGP)</label>
                    <input
                      type="number"
                      value={specialPrice}
                      onChange={(e) => setSpecialPrice(e.target.value)}
                      required
                      min="0"
                      className="mt-1 w-full rounded border px-2 py-1 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium">Per-Customer Cumulative Limit (units/grams)</label>
                      <input
                        type="number"
                        value={perCustomerLifetimeLimit}
                        onChange={(e) => setPerCustomerLifetimeLimit(e.target.value)}
                        min="0"
                        className="mt-1 w-full rounded border px-2 py-1 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium">Global Total Allocation (units/grams)</label>
                      <input
                        type="number"
                        value={totalAllocationLimit}
                        onChange={(e) => setTotalAllocationLimit(e.target.value)}
                        min="0"
                        className="mt-1 w-full rounded border px-2 py-1 text-sm"
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium">Start</label>
                  <input
                    type="datetime-local"
                    value={startAt}
                    onChange={(e) => setStartAt(e.target.value)}
                    required
                    className="mt-1 w-full rounded border px-2 py-1 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium">End</label>
                  <input
                    type="datetime-local"
                    value={endAt}
                    onChange={(e) => setEndAt(e.target.value)}
                    required
                    className="mt-1 w-full rounded border px-2 py-1 text-sm"
                  />
                </div>
              </div>

              {mechanism === 'SUBTOTAL_DISCOUNT' && (
                <div>
                  <label className="block text-sm font-medium">Budget Cap (EGP, optional)</label>
                  <input
                    type="number"
                    value={budgetCapMinor}
                    onChange={(e) => setBudgetCapMinor(e.target.value)}
                    min="0"
                    className="mt-1 w-full rounded border px-2 py-1 text-sm"
                  />
                </div>
              )}

              {createError && <p className="text-sm text-red-600">{createError}</p>}

              <button
                type="submit"
                disabled={isCreating}
                className="rounded bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {isCreating ? 'Creating…' : 'Create Offer'}
              </button>
            </form>
          )}

          <div className="mt-4 space-y-2">
            {offers?.map((offer) => (
              <div key={offer.id} className="rounded border bg-white p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span
                      className={`mr-2 rounded px-2 py-0.5 text-xs font-semibold ${
                        offer.mechanism === 'FLASH_SALE' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {offer.mechanism === 'FLASH_SALE' ? 'FLASH SALE' : 'SUBTOTAL DISCOUNT'}
                    </span>
                    <span className="font-semibold">{offer.name}</span>
                    <span className="ml-2 text-xs text-gray-500">{offer.isActive ? 'Active' : 'Inactive'}</span>
                  </div>
                  <button onClick={() => handleToggleActive(offer)} className="text-xs text-gray-500 underline">
                    {offer.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
                <p className="mt-1 text-sm">{mechanismSummary(offer)}</p>
                <p className="text-xs text-gray-500">
                  {targetingSummary(offer)} · {new Date(offer.startAt).toLocaleDateString()} –{' '}
                  {new Date(offer.endAt).toLocaleDateString()}
                </p>
                {actionErrorById[offer.id] && <p className="text-xs text-red-600">{actionErrorById[offer.id]}</p>}
              </div>
            ))}
            {offers?.length === 0 && <p className="text-sm text-gray-500">No offers for this branch yet.</p>}
          </div>
        </>
      )}
    </div>
  );
}

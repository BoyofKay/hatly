import { apiClient } from './client';

/**
 * Admin Offers Management UI. Mirrors the real backend contract
 * exactly (Offer entity + CreateOfferDto) — no invented fields, no
 * invented endpoints.
 */
export type OfferMechanism = 'SUBTOTAL_DISCOUNT' | 'FLASH_SALE';
export type DiscountType = 'PERCENTAGE' | 'FIXED';

export interface Offer {
  id: string;
  vendorBranchId: string;
  name: string;
  mechanism: OfferMechanism;
  discountType: DiscountType | null;
  discountValue: number | null;
  minimumEligibleSubtotalMinor: number | null;
  maximumDiscountMinor: number | null;
  specialPriceMinor: number | null;
  startAt: string;
  endAt: string;
  isActive: boolean;
  perOrderLimit: number | null;
  perCustomerLifetimeLimit: number | null;
  totalAllocationLimit: number | null;
  budgetCapMinor: number | null;
  consumedUnitsCount: number;
  consumedDiscountMinor: number;
  createdAt: string;
  updatedAt: string;
  /** Backend-resolved targeting summary — empty arrays on both means branch-wide. */
  productIds: string[];
  categoryIds: string[];
}

export interface CreateOfferInput {
  vendorBranchId: string;
  name: string;
  mechanism: OfferMechanism;
  // SUBTOTAL_DISCOUNT only:
  discountType?: DiscountType;
  discountValue?: number;
  minimumEligibleSubtotalMinor?: number;
  maximumDiscountMinor?: number;
  // FLASH_SALE only:
  specialPriceMinor?: number;
  startAt: string;
  endAt: string;
  productIds?: string[];
  categoryIds?: string[];
  perOrderLimit?: number;
  perCustomerLifetimeLimit?: number;
  totalAllocationLimit?: number;
  budgetCapMinor?: number;
}

export async function listOffers(vendorBranchId?: string): Promise<Offer[]> {
  const res = await apiClient.get('/admin/offers', { params: vendorBranchId ? { vendorBranchId } : {} });
  return res.data.data;
}

export async function getOffer(id: string): Promise<Offer> {
  const res = await apiClient.get(`/admin/offers/${id}`);
  return res.data.data;
}

export async function createOffer(input: CreateOfferInput): Promise<Offer> {
  const res = await apiClient.post('/admin/offers', input);
  return res.data.data;
}

export async function activateOffer(id: string): Promise<Offer> {
  const res = await apiClient.patch(`/admin/offers/${id}/activate`);
  return res.data.data;
}

export async function deactivateOffer(id: string): Promise<Offer> {
  const res = await apiClient.patch(`/admin/offers/${id}/deactivate`);
  return res.data.data;
}

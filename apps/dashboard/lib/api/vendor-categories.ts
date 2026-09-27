import { apiClient } from './client';

export interface VendorCategory {
  id: string;
  vendorBranchId: string;
  name: string;
  nameAr: string | null;
  sortOrder: number;
  isActive: boolean;
}

/** Read-only — reuses the real backend `vendor/categories` endpoint (Chunk 12B-3). No create/update/delete exists here or anywhere Vendor-facing. */
export async function listCategoriesForBranch(vendorBranchId: string): Promise<VendorCategory[]> {
  const res = await apiClient.get('/vendor/categories', { params: { vendorBranchId } });
  return res.data.data;
}

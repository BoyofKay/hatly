import { apiClient } from './client';

export interface VendorOwnedBranch {
  id: string;
  name: string;
}

/** Reuses the real backend `vendor/branches` endpoint (Chunk 12B-3-A). Never derives branches from products/categories, never accepts a vendorId — the authenticated session determines the result server-side. */
export async function listOwnedBranches(): Promise<VendorOwnedBranch[]> {
  const res = await apiClient.get('/vendor/branches');
  return res.data.data;
}

import { apiClient } from './client';

export interface Vendor {
  id: string;
  name: string;
  nameAr: string | null;
  logoUrl: string | null;
  isActive: boolean;
}

export interface VendorBranch {
  id: string;
  vendorId: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  serviceAreaId: string | null;
  openingHours: Record<string, { open: string; close: string }>;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  commissionRateBasisPoints: number | null;
  isActive: boolean;
  isOpen: boolean;
  marketplaceSectorId: string | null;
}

/** Only `name`/`nameAr`/`logoUrl` — `category`/`commissionPercent` are excluded, per the closed decision. */
export interface CreateVendorInput {
  name: string;
  nameAr?: string;
  logoUrl?: string;
}

export interface CreateVendorBranchInput {
  vendorId: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  serviceAreaId?: string;
  openingHours?: Record<string, { open: string; close: string }>;
  deliveryEnabled?: boolean;
  pickupEnabled?: boolean;
  commissionRateBasisPoints?: number;
}

export async function listVendors(): Promise<Vendor[]> {
  const res = await apiClient.get('/admin/vendors');
  return res.data.data;
}

export async function getVendor(id: string): Promise<Vendor> {
  const res = await apiClient.get(`/admin/vendors/${id}`);
  return res.data.data;
}

export async function createVendor(input: CreateVendorInput): Promise<Vendor> {
  const res = await apiClient.post('/admin/vendors', input);
  return res.data.data;
}

export async function updateVendor(id: string, input: Partial<CreateVendorInput>): Promise<Vendor> {
  const res = await apiClient.patch(`/admin/vendors/${id}`, input);
  return res.data.data;
}

export async function activateVendor(id: string): Promise<Vendor> {
  const res = await apiClient.patch(`/admin/vendors/${id}/activate`);
  return res.data.data;
}

export async function deactivateVendor(id: string): Promise<Vendor> {
  const res = await apiClient.patch(`/admin/vendors/${id}/deactivate`);
  return res.data.data;
}

export async function listVendorBranches(vendorId?: string): Promise<VendorBranch[]> {
  const res = await apiClient.get('/admin/vendor-branches', { params: vendorId ? { vendorId } : undefined });
  return res.data.data;
}

export async function getVendorBranch(id: string): Promise<VendorBranch> {
  const res = await apiClient.get(`/admin/vendor-branches/${id}`);
  return res.data.data;
}

export async function createVendorBranch(input: CreateVendorBranchInput): Promise<VendorBranch> {
  const res = await apiClient.post('/admin/vendor-branches', input);
  return res.data.data;
}

export async function updateVendorBranch(
  id: string,
  input: Partial<Omit<CreateVendorBranchInput, 'vendorId'>>,
): Promise<VendorBranch> {
  const res = await apiClient.patch(`/admin/vendor-branches/${id}`, input);
  return res.data.data;
}

export async function activateVendorBranch(id: string): Promise<VendorBranch> {
  const res = await apiClient.patch(`/admin/vendor-branches/${id}/activate`);
  return res.data.data;
}

export async function deactivateVendorBranch(id: string): Promise<VendorBranch> {
  const res = await apiClient.patch(`/admin/vendor-branches/${id}/deactivate`);
  return res.data.data;
}

/**
 * M1 (Launch-Readiness Gap Audit, G-01). `isOpen` previously had no
 * write path at all — mirrors `activateVendorBranch`/
 * `deactivateVendorBranch` exactly. Gated backend-side by the
 * `OPEN_CLOSE_VENDOR_BRANCHES` permission, not `MANAGE_VENDORS`.
 */
export async function openVendorBranch(id: string): Promise<VendorBranch> {
  const res = await apiClient.patch(`/admin/vendor-branches/${id}/open`);
  return res.data.data;
}

export async function closeVendorBranch(id: string): Promise<VendorBranch> {
  const res = await apiClient.patch(`/admin/vendor-branches/${id}/close`);
  return res.data.data;
}

/** Reuses the EXISTING, untouched Sectors-module endpoint — not duplicated here. */
export async function assignVendorBranchSector(branchId: string, marketplaceSectorId: string): Promise<VendorBranch> {
  const res = await apiClient.patch(`/admin/vendor-branches/${branchId}/sector`, { marketplaceSectorId });
  return res.data.data;
}

import { apiClient } from './client';

export interface VendorStaffMember {
  id: string;
  fullName: string;
  phone: string;
  role: 'VENDOR' | 'VENDOR_MANAGER';
  isActive: boolean;
  vendorId: string;
  vendorName: string;
  vendorBranchId: string;
  vendorBranchName: string;
  createdAt: string;
}

export interface CreateVendorStaffInput {
  phone: string;
  fullName: string;
  password: string;
  vendorBranchId: string;
  role?: 'VENDOR' | 'VENDOR_MANAGER';
}

export async function listVendorStaff(): Promise<VendorStaffMember[]> {
  const res = await apiClient.get('/admin/vendor-staff');
  return res.data.data;
}

/** `password` is sent once, over the existing authenticated API call, and never stored client-side beyond the form submission. */
export async function createVendorStaff(input: CreateVendorStaffInput): Promise<VendorStaffMember> {
  const res = await apiClient.post('/admin/vendor-staff', input);
  return res.data.data;
}

/** CHUNK 11 additions. `id` is the VendorStaff row id (matches `VendorStaffMember.id`), never a raw User id. */
export async function activateVendorStaff(id: string): Promise<VendorStaffMember> {
  const res = await apiClient.patch(`/admin/vendor-staff/${id}/activate`);
  return res.data.data;
}

export async function deactivateVendorStaff(id: string): Promise<VendorStaffMember> {
  const res = await apiClient.patch(`/admin/vendor-staff/${id}/deactivate`);
  return res.data.data;
}

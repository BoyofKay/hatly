import { apiClient } from './client';

export type PricingUnit = 'PIECE' | 'WEIGHT';
export type InventoryMode = 'OPEN' | 'TRACKED';

export interface VendorProduct {
  id: string;
  vendorBranchId: string;
  categoryId: string;
  name: string;
  nameAr: string | null;
  description: string | null;
  descriptionAr: string | null;
  imageUrl: string | null;
  priceMinor: number;
  pricingUnit: PricingUnit;
  inventoryMode: InventoryMode;
  quantity: number | null;
  isAvailable: boolean;
  /** R7: APPROVED products can be live; a new product waits (PENDING) for Hatly, or was REJECTED. */
  approvalStatus?: 'APPROVED' | 'PENDING' | 'REJECTED';
  /** Present after an edit when part of it (a price increase / detail change) was sent to Hatly instead of applied. */
  pendingChange?: ProductChangeRequest | null;
}

/** R7: a vendor product change Hatly reviews. */
export interface ProductChangeRequest {
  id: string;
  productId: string;
  productName: string;
  approvalStatus: 'APPROVED' | 'PENDING' | 'REJECTED';
  isAvailable: boolean;
  branchId: string;
  branchName: string;
  vendorName: string;
  kind: 'NEW_PRODUCT' | 'UPDATE' | 'OPTIONS';
  source: 'DASHBOARD' | 'EXCEL';
  payload: Record<string, any>;
  current: { name: string; nameAr: string | null; description: string | null; descriptionAr: string | null; categoryId: string; categoryName: string | null; imageUrl: string | null; priceMinor: number };
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
  requestedBy: string;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export async function listMyProductChangeRequests(vendorBranchId: string): Promise<ProductChangeRequest[]> {
  return (await apiClient.get('/vendor/products/change-requests', { params: { vendorBranchId } })).data.data;
}
export async function withdrawMyProductChangeRequest(id: string): Promise<void> {
  await apiClient.post(`/vendor/products/change-requests/${id}/withdraw`);
}
export async function listProductChangeRequests(status = 'PENDING'): Promise<ProductChangeRequest[]> {
  return (await apiClient.get('/admin/product-change-requests', { params: { status } })).data.data;
}
export async function decideProductChangeRequest(id: string, decision: 'approve' | 'reject', note?: string): Promise<ProductChangeRequest> {
  return (await apiClient.post(`/admin/product-change-requests/${id}/${decision}`, { note })).data.data;
}

export interface CreateVendorProductInput {
  vendorBranchId: string;
  categoryId: string;
  name: string;
  nameAr?: string;
  description?: string;
  descriptionAr?: string;
  priceMinor: number;
  pricingUnit: PricingUnit;
  inventoryMode?: InventoryMode;
  quantity?: number;
  isAvailable?: boolean;
}

/** CONFIRMED: matches VendorUpdateProductDto exactly — no pricingUnit, no vendorBranchId, no imageUrl (image goes through the dedicated multipart endpoint below). */
export interface UpdateVendorProductInput {
  categoryId?: string;
  name?: string;
  nameAr?: string;
  description?: string;
  descriptionAr?: string;
  priceMinor?: number;
  inventoryMode?: InventoryMode;
  quantity?: number;
}

export async function listVendorProducts(vendorBranchId: string): Promise<VendorProduct[]> {
  const res = await apiClient.get('/vendor/products', { params: { vendorBranchId } });
  return res.data.data;
}

export async function createVendorProduct(input: CreateVendorProductInput): Promise<VendorProduct> {
  const res = await apiClient.post('/vendor/products', input);
  return res.data.data;
}

export async function updateVendorProduct(id: string, input: UpdateVendorProductInput): Promise<VendorProduct> {
  const res = await apiClient.patch(`/vendor/products/${id}`, input);
  return res.data.data;
}

export async function activateVendorProduct(id: string): Promise<VendorProduct> {
  const res = await apiClient.patch(`/vendor/products/${id}/activate`);
  return res.data.data;
}

export async function deactivateVendorProduct(id: string): Promise<VendorProduct> {
  const res = await apiClient.patch(`/vendor/products/${id}/deactivate`);
  return res.data.data;
}

/** Tracked Inventory Order-Time Enforcement. Only meaningful for TRACKED products — rejected by the backend for OPEN. */
export async function setVendorProductInventoryToZero(id: string): Promise<VendorProduct> {
  const res = await apiClient.patch(`/vendor/products/${id}/set-inventory-zero`);
  return res.data.data;
}

/** Multipart, field name "image" — matches the real backend FileInterceptor('image') exactly. Content-Type is deliberately NOT set manually here — axios/the browser must generate the multipart boundary automatically for a FormData body; setting it explicitly without a boundary would break parsing. */
export async function uploadVendorProductImage(id: string, file: File): Promise<VendorProduct> {
  const formData = new FormData();
  formData.append('image', file);
  const res = await apiClient.post(`/vendor/products/${id}/image`, formData);
  return res.data.data;
}

/** Excel Inventory & Price Management. */
export interface ExcelImportRowResult {
  rowNumber: number;
  productId: string | null;
  productName: string | null;
  changedFields: string[];
  errors: string[];
}

export interface ExcelImportValidationSummary {
  status: 'READY' | 'FAILED';
  totalRows: number;
  changedRows: number;
  unchangedRows: number;
  rows: ExcelImportRowResult[];
}

export interface ExcelImportApplyResult {
  totalRows: number;
  updatedRows: number;
  unchangedRows: number;
  /** R7: rows whose price increase / name change was sent to Hatly instead of applied. */
  sentForApproval?: number;
}

export async function downloadVendorImportTemplate(vendorBranchId: string, prefilled = true): Promise<Blob> {
  const res = await apiClient.get(`/vendor/products/import-template`, {
    params: { vendorBranchId, prefilled },
    responseType: 'blob',
  });
  return res.data;
}

export async function validateVendorImport(file: File): Promise<ExcelImportValidationSummary> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await apiClient.post('/vendor/products/import/validate', formData);
  return res.data.data;
}

export async function applyVendorImport(file: File): Promise<ExcelImportApplyResult> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await apiClient.post('/vendor/products/import/apply', formData);
  return res.data.data;
}

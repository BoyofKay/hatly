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

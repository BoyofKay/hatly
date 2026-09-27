import { apiClient } from './client';

export interface ProductCategory {
  id: string;
  vendorBranchId: string;
  name: string;
  nameAr: string | null;
  sortOrder: number;
  isActive: boolean;
}

export type PricingUnit = 'PIECE' | 'WEIGHT';

export interface Product {
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
  isAvailable: boolean;
  inventoryMode: 'OPEN' | 'TRACKED';
  quantity: number | null;
}

export interface CreateProductCategoryInput {
  vendorBranchId: string;
  name: string;
  nameAr?: string;
  sortOrder?: number;
}

/** `pricingUnit` selectable ONLY at creation — see UpdateProductInput's own comment. */
export interface CreateProductInput {
  vendorBranchId: string;
  categoryId: string;
  name: string;
  nameAr?: string;
  description?: string;
  descriptionAr?: string;
  imageUrl?: string;
  priceMinor: number;
  pricingUnit: PricingUnit;
}

/**
 * CONFIRMED (closed decision): `pricingUnit` is immutable after
 * creation — deliberately absent from this type, matching the
 * backend's own `UpdateProductDto`, which never accepts it either. No
 * UI anywhere in this app may attempt to send it in an update request.
 */
export interface UpdateProductInput {
  categoryId?: string;
  name?: string;
  nameAr?: string;
  description?: string;
  descriptionAr?: string;
  imageUrl?: string;
  priceMinor?: number;
}

export async function listCategories(vendorBranchId: string): Promise<ProductCategory[]> {
  const res = await apiClient.get('/admin/product-categories', { params: { vendorBranchId } });
  return res.data.data;
}

export async function createCategory(input: CreateProductCategoryInput): Promise<ProductCategory> {
  const res = await apiClient.post('/admin/product-categories', input);
  return res.data.data;
}

export async function updateCategory(
  id: string,
  input: Partial<Omit<CreateProductCategoryInput, 'vendorBranchId'>>,
): Promise<ProductCategory> {
  const res = await apiClient.patch(`/admin/product-categories/${id}`, input);
  return res.data.data;
}

export async function activateCategory(id: string): Promise<ProductCategory> {
  const res = await apiClient.patch(`/admin/product-categories/${id}/activate`);
  return res.data.data;
}

export async function deactivateCategory(id: string): Promise<ProductCategory> {
  const res = await apiClient.patch(`/admin/product-categories/${id}/deactivate`);
  return res.data.data;
}

export async function listProducts(vendorBranchId: string, categoryId?: string): Promise<Product[]> {
  const res = await apiClient.get('/admin/products', { params: { vendorBranchId, categoryId } });
  return res.data.data;
}

export async function createProduct(input: CreateProductInput): Promise<Product> {
  const res = await apiClient.post('/admin/products', input);
  return res.data.data;
}

export async function updateProduct(id: string, input: UpdateProductInput): Promise<Product> {
  const res = await apiClient.patch(`/admin/products/${id}`, input);
  return res.data.data;
}

export async function activateProduct(id: string): Promise<Product> {
  const res = await apiClient.patch(`/admin/products/${id}/activate`);
  return res.data.data;
}

export async function deactivateProduct(id: string): Promise<Product> {
  const res = await apiClient.patch(`/admin/products/${id}/deactivate`);
  return res.data.data;
}

/** Tracked Inventory Order-Time Enforcement. Only meaningful for TRACKED products — rejected by the backend for OPEN. */
export async function setProductInventoryToZero(id: string): Promise<Product> {
  const res = await apiClient.patch(`/admin/products/${id}/set-inventory-zero`);
  return res.data.data;
}

/** Excel Inventory & Price Management. Same shared backend service as the Vendor side — only the authorization path differs (MANAGE_CATALOG here, per-row branch ownership on the Vendor side). */
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

export async function downloadAdminImportTemplate(vendorBranchId: string, prefilled = true): Promise<Blob> {
  const res = await apiClient.get(`/admin/products/import-template`, {
    params: { vendorBranchId, prefilled },
    responseType: 'blob',
  });
  return res.data;
}

export async function validateAdminImport(file: File): Promise<ExcelImportValidationSummary> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await apiClient.post('/admin/products/import/validate', formData);
  return res.data.data;
}

export async function applyAdminImport(file: File): Promise<ExcelImportApplyResult> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await apiClient.post('/admin/products/import/apply', formData);
  return res.data.data;
}

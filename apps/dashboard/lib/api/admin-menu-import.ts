import { apiClient } from './client';

/** Mirrors backend `MenuImportService` (`admin/menu-import`). */
export interface MenuImportRow {
  sheet: 'Menu' | 'Options' | 'Photos';
  rowNumber: number | null;
  label: string | null;
  action: 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'OPTIONS' | 'SKIP';
  errors: string[];
}
export interface MenuImportSummary {
  status: 'READY' | 'FAILED' | 'APPLIED';
  counts: { newProducts: number; updatedProducts: number; unchangedProducts: number; newCategories: number; optionGroups: number; photos: number };
  rows: MenuImportRow[];
}

export async function downloadMenuTemplate(vendorBranchId: string): Promise<Blob> {
  return (await apiClient.get('/admin/menu-import/template', { params: { vendorBranchId }, responseType: 'blob' })).data;
}

async function send(step: 'validate' | 'apply', vendorBranchId: string, file: File): Promise<MenuImportSummary> {
  const form = new FormData();
  form.append('file', file);
  const res = await apiClient.post(`/admin/menu-import/${step}`, form, { params: { vendorBranchId }, timeout: 300_000 });
  return res.data.data;
}

export const checkMenuFile = (vendorBranchId: string, file: File) => send('validate', vendorBranchId, file);
export const importMenuFile = (vendorBranchId: string, file: File) => send('apply', vendorBranchId, file);

import { apiClient } from './client';

/** Admin (MANAGE_CATALOG) and vendor (owner of the product's branch) share one API shape; only the prefix differs. */
export type OptionsScope = 'admin' | 'vendor';

export interface ProductOptionValue {
  id: string;
  name: string;
  nameAr: string | null;
  /** Signed minor units added to the product's base price when chosen. */
  priceDeltaMinor: number;
}

export interface ProductOptionGroup {
  id: string;
  name: string;
  nameAr: string | null;
  isRequired: boolean;
  allowsMultiple: boolean;
  minSelections: number;
  maxSelections: number | null;
  values: ProductOptionValue[];
}

export interface OptionValueInput {
  name: string;
  nameAr?: string;
  priceDeltaMinor?: number;
}

export interface OptionGroupInput {
  name: string;
  nameAr?: string;
  isRequired?: boolean;
  allowsMultiple?: boolean;
  minSelections?: number;
  maxSelections?: number | null;
}

/**
 * R7: on a LIVE product a vendor's new option, rename or higher price is sent to Hatly instead of applied. The server answers `{ request }`;
 * this turns it into an error-shaped notice (so every caller shows it where it shows the server's messages) and never pretends it applied.
 */
export const REVIEW_NOTICE = 'Sent to Hatly for approval — it applies once approved. / أُرسل إلى هاتلي للموافقة — يُطبَّق بعد الموافقة.';
function unlessSentForReview<T>(data: any): T {
  if (data && typeof data === 'object' && 'request' in data && data.request) {
    throw Object.assign(new Error(REVIEW_NOTICE), { sentForReview: true, response: { status: 201, data: { error: { message: REVIEW_NOTICE } } } });
  }
  return data as T;
}

export async function listOptionGroups(scope: OptionsScope, productId: string): Promise<ProductOptionGroup[]> {
  const res = await apiClient.get(`/${scope}/products/${productId}/options`);
  return res.data.data;
}

export async function createOptionGroup(scope: OptionsScope, productId: string, input: OptionGroupInput & { values: OptionValueInput[] }): Promise<ProductOptionGroup> {
  const { maxSelections, ...rest } = input;
  const res = await apiClient.post(`/${scope}/products/${productId}/options`, maxSelections == null ? rest : { ...rest, maxSelections });
  return unlessSentForReview<ProductOptionGroup>(res.data.data);
}

export async function updateOptionGroup(scope: OptionsScope, optionId: string, input: OptionGroupInput): Promise<ProductOptionGroup> {
  const res = await apiClient.patch(`/${scope}/product-options/${optionId}`, input);
  return unlessSentForReview<ProductOptionGroup>(res.data.data);
}

export async function deleteOptionGroup(scope: OptionsScope, optionId: string): Promise<void> {
  await apiClient.delete(`/${scope}/product-options/${optionId}`);
}

export async function addOptionValue(scope: OptionsScope, optionId: string, input: OptionValueInput): Promise<ProductOptionGroup> {
  const res = await apiClient.post(`/${scope}/product-options/${optionId}/values`, input);
  return unlessSentForReview<ProductOptionGroup>(res.data.data);
}

export async function updateOptionValue(scope: OptionsScope, valueId: string, input: Partial<OptionValueInput>): Promise<ProductOptionGroup> {
  const res = await apiClient.patch(`/${scope}/product-option-values/${valueId}`, input);
  return unlessSentForReview<ProductOptionGroup>(res.data.data);
}

export async function deleteOptionValue(scope: OptionsScope, valueId: string): Promise<ProductOptionGroup> {
  const res = await apiClient.delete(`/${scope}/product-option-values/${valueId}`);
  return res.data.data;
}

/** "6", "6.5", "-2.50" (EGP) → minor units; null when it is not a plain amount. Never floating-point arithmetic on money. */
export function parseSignedEgpToMinor(input: string): number | null {
  const m = /^\s*(-)?(\d+)(?:\.(\d{1,2}))?\s*$/.exec(input);
  if (!m) return null;
  const minor = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0') || 0);
  return m[1] ? -minor : minor;
}

export function formatSignedMinor(minor: number): string {
  const abs = Math.abs(minor);
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return minor < 0 ? `-${text}` : minor > 0 ? `+${text}` : '0.00';
}

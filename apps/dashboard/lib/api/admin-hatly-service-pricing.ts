import { apiClient } from './client';
import type { MessageKey } from '../i18n/messages';

export const MANAGE_HATLY_SERVICE_PRICING = 'MANAGE_HATLY_SERVICE_PRICING';

export interface ConfirmedPrice {
  id: string;
  orderItemId: string;
  amountMinor: number;
  recordedByRole: string;
  /** `true` when the same confirmation had already been applied (idempotent replay, HTTP 200). */
  alreadyApplied: boolean;
}

/** `POST admin/orders/items/:itemId/confirm-price` — the backend validates, authorizes and recomputes the order totals. */
export async function confirmHatlyServicePrice(itemId: string, amountMinor: number): Promise<ConfirmedPrice> {
  const res = await apiClient.post(`/admin/orders/items/${itemId}/confirm-price`, { amountMinor });
  return res.data.data;
}

export type PricingFailure =
  | { kind: 'CONFLICT'; message: MessageKey } // a different price is already recorded — reconcile with the current order
  | { kind: 'FORBIDDEN'; message: MessageKey }
  | { kind: 'ERROR'; message: MessageKey };

/**
 * Maps a failed confirm-price call to a localized message key by its machine-readable code (`error.details.code`) or HTTP status —
 * never the backend's English text, and never raw exception detail.
 */
export function classifyPricingError(err: unknown): PricingFailure {
  const response = (err as { response?: { status?: number; data?: { error?: { details?: { code?: string } } } } })?.response;
  if (!response) return { kind: 'ERROR', message: 'errNetwork' };
  const code = response.data?.error?.details?.code;
  switch (code) {
    case 'PURCHASE_ALREADY_RECORDED':
      return { kind: 'CONFLICT', message: 'errConflict' };
    case 'ORDER_NOT_PRICEABLE':
      return { kind: 'ERROR', message: 'errNotPriceable' };
    case 'NOT_A_HATLY_SERVICE_ITEM':
    case 'NOT_A_CUSTOM_ITEM':
      return { kind: 'ERROR', message: 'errNotHatlyService' };
    case 'INVALID_FINAL_AMOUNT':
      return { kind: 'ERROR', message: 'errInvalidAmount' };
  }
  switch (response.status) {
    case 403:
      return { kind: 'FORBIDDEN', message: 'errForbidden' };
    case 409:
      return { kind: 'CONFLICT', message: 'errConflict' };
    case 400:
      return { kind: 'ERROR', message: 'errInvalidAmount' }; // class-validator rejection of `amountMinor`
    case 404:
      return { kind: 'ERROR', message: 'errNotFound' };
    default:
      return { kind: 'ERROR', message: 'errUnknown' };
  }
}

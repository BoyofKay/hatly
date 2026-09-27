import { apiClient } from './client';

export interface VendorOrderItem {
  id: string;
  productId: string | null;
  productNameSnapshot: string | null;
  quantity: number;
  unitPriceMinor: number | null;
  optionsSnapshot: Array<{ name: string; valueName: string; priceDeltaMinor: number }>;
  notes: string | null;
  freeTextDescriptionSnapshot: string | null;
  imageUrlsSnapshot: string[] | null;
  pricingUnitSnapshot: 'PIECE' | 'WEIGHT' | null;
  requestedWeightGrams: number | null;
  actualWeightGrams: number | null;
  /** Vendor Custom Item Pricing (Chunk 4C backend addition). Sole source of truth for whether a Custom Request is priced yet — null = pending, non-null = final price recorded. Never substitute unitPriceMinor, which stays permanently null for a Custom Request regardless of pricing state. */
  actualAmountMinor: number | null;
}
export interface VendorOrderSegment {
  id: string;
  groupType: string;
  vendorBranchId: string;
  vendorNoteSnapshot: string | null;
  status: 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY_FOR_PICKUP' | 'PICKED_UP' | 'CANCELLED';
  subtotalMinor: number | null;
  expectedReadyAt: string | null;
  items: VendorOrderItem[];
}

export interface VendorOrder {
  id: string;
  status: string;
  fulfillmentType: string;
  orderNote: string | null;
  paymentMethod: string;
  segments: VendorOrderSegment[];
}

/**
 * CONFIRMED (closed rule): the Vendor only ever acts on their OWN
 * segment, never the Order-level status — every method here reflects
 * that; there is no Order-level transition call anywhere in this
 * file.
 */
export async function listVendorOrders(): Promise<VendorOrder[]> {
  const res = await apiClient.get('/vendor/orders');
  return res.data.data;
}

export async function getVendorOrder(id: string): Promise<VendorOrder> {
  const res = await apiClient.get(`/vendor/orders/${id}`);
  return res.data.data;
}

/**
 * `status` must be one of the segment's own currently-allowed next
 * states (see `segmentNextActions` in the orders page) — this
 * function itself does not validate that; the backend's own
 * transition-rule table is the sole authority and will reject an
 * invalid target with a clear error either way.
 */
export async function updateSegmentStatus(
  segmentId: string,
  status: VendorOrderSegment['status'],
): Promise<VendorOrderSegment> {
  const res = await apiClient.patch(`/vendor/orders/segments/${segmentId}/status`, { status });
  return res.data.data;
}

/**
 * First-actor-wins is entirely server-authoritative (see
 * OrderItemWeightRecordService) — this call either succeeds once or
 * is rejected if already recorded by someone else; no client-side
 * locking exists or is added here.
 */
export async function recordItemWeight(itemId: string, weightGrams: number): Promise<unknown> {
  const res = await apiClient.post(`/vendor/orders/order-items/${itemId}/weight`, { weightGrams });
  return res.data.data;
}

/**
 * Vendor Custom Item Pricing (Chunk 4B/4A). Reuses the existing, real
 * `POST vendor/orders/order-items/:itemId/price` (Chunk 4A) — pure
 * delegation, exactly the same shape as `recordItemWeight` above.
 *
 * `VendorOrderItem.actualAmountMinor` (Chunk 4C backend addition) is
 * now the sole source of truth for pricing state, read fresh from
 * the Vendor Order Detail response after each call — no session-local
 * pricing-state workaround exists here anymore (Chunk 4D removed it).
 */
export async function priceCustomItem(itemId: string, amountMinor: number): Promise<unknown> {
  const res = await apiClient.post(`/vendor/orders/order-items/${itemId}/price`, { amountMinor });
  return res.data.data;
}

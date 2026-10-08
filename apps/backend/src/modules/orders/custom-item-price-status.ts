/**
 * The EXPLICIT price state of a product-less (custom / Hatly Service) order item, so no client ever has to infer "pending" from
 * a null amount (and a `0` is never read as "free"):
 *  - `PENDING`   — no final price has been recorded yet (the item is still being sourced / priced);
 *  - `CONFIRMED` — a final price was recorded (by the driver, the vendor or Hatly operations); `actualAmountMinor` holds it.
 *  - `null`      — a normal catalog item, whose price is its own `unitPriceMinor` snapshot; the concept does not apply.
 */
export type CustomItemPriceStatus = 'PENDING' | 'CONFIRMED';

export function customItemPriceStatus(item: { productId?: string | null; actualAmountMinor?: number | null }): CustomItemPriceStatus | null {
  if (item.productId !== null && item.productId !== undefined) return null;
  return item.actualAmountMinor === null || item.actualAmountMinor === undefined ? 'PENDING' : 'CONFIRMED';
}

/**
 * R2 (decision register 2026-11-06, C-5): an order paid by InstaPay / Vodafone Cash (MANUAL_TRANSFER) is NOT shown to the vendor —
 * not in lists, details, counts, statistics, the change feed or notifications — and the vendor cannot act on it, until Operations
 * have verified the money actually arrived (the Payment is PAID; a customer's receipt alone is never enough). Every other payment
 * method is visible at once. PAID is terminal, so an order never disappears again once shown.
 */
export const vendorVisibleOrderSql = (orderAlias = 'o'): string =>
  `(${orderAlias}.payment_method <> 'MANUAL_TRANSFER' OR EXISTS (SELECT 1 FROM payments vvp WHERE vvp.order_id = ${orderAlias}.id AND vvp.status = 'PAID'))`;

/** Same rule in code for an order already loaded with its payment status. */
export function isOrderVisibleToVendor(paymentMethod: string | null | undefined, paymentStatus: string | null | undefined): boolean {
  return paymentMethod !== 'MANUAL_TRANSFER' || paymentStatus === 'PAID';
}

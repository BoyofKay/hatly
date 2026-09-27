/**
 * How an order is paid (`orders.payment_method`). These are PAYMENT SOURCES with different semantics — never interchangeable:
 *  - COD              cash handed to the driver on delivery. Fulfilment proceeds normally.
 *  - PAY_AT_DELIVERY  an ELECTRONIC payment made when the driver arrives (the method is stored in
 *                     `electronic_payment_method`). Fulfilment proceeds before payment.
 *  - MANUAL_TRANSFER  an ELECTRONIC prepayment (method stored in `electronic_payment_method`) verified by an admin.
 *                     Fulfilment (PREPARING / dispatch) is blocked until the payment is PAID.
 *  - WALLET           the Hatly wallet covers the WHOLE order (`wallet_amount_minor == total_minor`).
 *  - ONLINE           legacy value; a real gateway does not exist, so it is always rejected.
 * A PARTIAL wallet payment is not a source of its own: the order keeps its remainder method (COD or PAY_AT_DELIVERY) and
 * records `wallet_amount_minor > 0`.
 */
export type OrderPaymentMethod = 'COD' | 'ONLINE' | 'MANUAL_TRANSFER' | 'PAY_AT_DELIVERY' | 'WALLET';

export const ORDER_PAYMENT_METHODS: OrderPaymentMethod[] = ['COD', 'ONLINE', 'MANUAL_TRANSFER', 'PAY_AT_DELIVERY', 'WALLET'];

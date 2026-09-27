/**
 * The electronic payment methods Hatly supports (PD-006). Used by MANUAL_TRANSFER (paid before fulfilment) and
 * PAY_AT_DELIVERY (paid electronically when the driver arrives). Which of these are currently OFFERED to customers is a
 * server-side BusinessConfig decision (`CHECKOUT_ENABLED_ELECTRONIC_METHODS`); this enum is the closed set of values the
 * system can ever store.
 */
export enum ElectronicPaymentMethod {
  INSTAPAY = 'INSTAPAY',
  VODAFONE_CASH = 'VODAFONE_CASH',
  ORANGE_CASH = 'ORANGE_CASH',
  ETISALAT_CASH = 'ETISALAT_CASH',
  WE_PAY = 'WE_PAY',
}

export const ELECTRONIC_PAYMENT_METHODS = Object.values(ElectronicPaymentMethod);

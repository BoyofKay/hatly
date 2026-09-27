/**
 * All monetary values are stored and calculated as integers in the
 * smallest currency unit (e.g. piasters for EGP: 1 EGP = 100 piasters).
 * Never use floating point for money — see spec section 30.
 *
 * DB columns backing money fields should be `bigint`, mapped through
 * these helpers at the application boundary.
 */

export type MinorUnits = number; // integer, smallest currency unit

export function toMinorUnits(amount: number): MinorUnits {
  return Math.round(amount * 100);
}

export function toMajorUnits(amount: MinorUnits): number {
  return amount / 100;
}

export function addMoney(a: MinorUnits, b: MinorUnits): MinorUnits {
  return a + b;
}

export function formatMoney(amount: MinorUnits, currency = 'EGP'): string {
  return `${toMajorUnits(amount).toFixed(2)} ${currency}`;
}

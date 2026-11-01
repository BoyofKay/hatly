/**
 * How a customer's delivery address is identified — two ALTERNATIVE methods, never two steps of one flow:
 *
 *  - MANUAL: the customer selects a delivery area (zone) and types the detailed address. No coordinates are collected or stored.
 *    The base delivery fee is the selected zone's fixed fee.
 *  - GPS: the customer's current location / a map point. Coordinates are the address; no zone and no typed text are required.
 *    The base delivery fee is the actual road distance priced with the Admin-configured rate per 100 m and minimum fee, and
 *    serviceability is the existing service-area coverage check.
 *
 * An address with NO mode is a legacy address (saved before the two methods existed): it keeps behaving exactly as it did.
 */
export enum AddressMode {
  GPS = 'GPS',
  MANUAL = 'MANUAL',
}

// A coarse sanity box around Egypt: catches swapped or nonsensical coordinates. Serviceability is the SERVICE AREA's job.
export const EGYPT_LAT = { min: 21.9, max: 31.7 };
export const EGYPT_LNG = { min: 24.6, max: 36.9 };

export function isPointInEgypt(latitude: number, longitude: number): boolean {
  return latitude >= EGYPT_LAT.min && latitude <= EGYPT_LAT.max && longitude >= EGYPT_LNG.min && longitude <= EGYPT_LNG.max;
}

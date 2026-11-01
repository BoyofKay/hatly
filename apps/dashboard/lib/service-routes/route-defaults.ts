// Hatly / Wasally default route locations (PD-012). Pure helpers: no React, no network.
//
// Each default is `{ latitude, longitude, label }` stored under its own Business Config key. Hatly has an ORIGIN and a DESTINATION
// default; Wasally has a DESTINATION default only (a Wasally pick-up is always chosen by the customer, so it has no origin default).
// The two services never share a value. Nothing here ever invents a location: an unset default is "not configured" and the customer
// app then asks the customer to choose.

export const EGYPT_LAT = { min: 21.9, max: 31.7 };
export const EGYPT_LNG = { min: 24.6, max: 36.9 };

export interface RouteDefaultDef {
  key: string;
  service: 'Hatly' | 'Wasally';
  role: 'Origin' | 'Destination';
  title: string;
  help: string;
}

export const ROUTE_DEFAULT_DEFS: RouteDefaultDef[] = [
  {
    key: 'HATLY_SERVICE_DEFAULT_PICKUP_LOCATION',
    service: 'Hatly',
    role: 'Origin',
    title: 'Hatly — default origin',
    help: 'Where a Hatly ("هاتلي من مكان") request starts when the customer does not choose another starting point.',
  },
  {
    key: 'HATLY_SERVICE_DEFAULT_DESTINATION_LOCATION',
    service: 'Hatly',
    role: 'Destination',
    title: 'Hatly — default destination',
    help: 'Where a Hatly request ends when the customer does not choose a destination.',
  },
  {
    key: 'WASALLY_SERVICE_DEFAULT_DESTINATION_LOCATION',
    service: 'Wasally',
    role: 'Destination',
    title: 'Wasally — default destination',
    help: 'Where a Wasally ("وصّلي لمكان") request ends when the customer does not choose another destination. Wasally has no origin default: the customer always chooses where the pick-up happens.',
  },
];

export interface RouteDefaultForm {
  latitude: string;
  longitude: string;
  label: string;
}

export const EMPTY_ROUTE_DEFAULT_FORM: RouteDefaultForm = { latitude: '', longitude: '', label: '' };

export type RouteDefaultStatus = 'NOT_CONFIGURED' | 'CONFIGURED' | 'INVALID';

export interface RouteDefaultValue {
  latitude: number;
  longitude: number;
  label: string;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Mirrors the backend's `isValidServiceLocation`: a number pair inside Egypt and a label of 1–120 characters. */
export function isValidRouteDefault(v: unknown): v is RouteDefaultValue {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    isFiniteNumber(o.latitude) &&
    isFiniteNumber(o.longitude) &&
    o.latitude >= EGYPT_LAT.min &&
    o.latitude <= EGYPT_LAT.max &&
    o.longitude >= EGYPT_LNG.min &&
    o.longitude <= EGYPT_LNG.max &&
    typeof o.label === 'string' &&
    o.label.trim().length >= 1 &&
    o.label.trim().length <= 120
  );
}

/** What the stored value is: not set, usable, or set but unusable (the backend then treats it as not configured). */
export function statusOf(raw: unknown): RouteDefaultStatus {
  if (raw === null || raw === undefined) return 'NOT_CONFIGURED';
  return isValidRouteDefault(raw) ? 'CONFIGURED' : 'INVALID';
}

export function formFromValue(raw: unknown): RouteDefaultForm {
  if (!isValidRouteDefault(raw)) return { ...EMPTY_ROUTE_DEFAULT_FORM };
  return { latitude: String(raw.latitude), longitude: String(raw.longitude), label: raw.label.trim() };
}

export type RouteDefaultResult = { ok: true; value: RouteDefaultValue } | { ok: false; error: string };

/** Validates what the admin typed. Coordinates must be plain decimal numbers inside Egypt; the label is what customers will see. */
export function buildRouteDefault(form: RouteDefaultForm): RouteDefaultResult {
  const label = form.label.trim();
  if (!label) return { ok: false, error: 'Enter the label customers will see (e.g. the place name).' };
  if (label.length > 120) return { ok: false, error: 'The label can be at most 120 characters.' };
  const num = /^-?\d+(\.\d+)?$/;
  if (!num.test(form.latitude.trim()) || !num.test(form.longitude.trim())) {
    return { ok: false, error: 'Latitude and longitude must be decimal numbers (e.g. 30.4181 and 31.5622).' };
  }
  const latitude = Number(form.latitude.trim());
  const longitude = Number(form.longitude.trim());
  if (latitude < EGYPT_LAT.min || latitude > EGYPT_LAT.max) {
    return { ok: false, error: `Latitude must be between ${EGYPT_LAT.min} and ${EGYPT_LAT.max} (Egypt). Latitude and longitude may be swapped.` };
  }
  if (longitude < EGYPT_LNG.min || longitude > EGYPT_LNG.max) {
    return { ok: false, error: `Longitude must be between ${EGYPT_LNG.min} and ${EGYPT_LNG.max} (Egypt). Latitude and longitude may be swapped.` };
  }
  return { ok: true, value: { latitude, longitude, label } };
}

/** The keys that are not usable yet, for the "owner must enter" summary at the top of the card. */
export function missingDefaults(values: Record<string, unknown>): RouteDefaultDef[] {
  return ROUTE_DEFAULT_DEFS.filter((d) => statusOf(values[d.key]) !== 'CONFIGURED');
}

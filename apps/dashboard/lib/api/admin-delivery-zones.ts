import { apiClient } from './client';

/** PD-009 — a Delivery Zone as the admin API returns it. Fees are integer minor units. */
export interface DeliveryZone {
  id: string;
  serviceAreaId: string;
  governorate: string;
  governorateAr: string;
  city: string;
  cityAr: string;
  name: string;
  nameAr: string;
  deliveryFeeMinor: number;
  displayOrder: number;
  isActive: boolean;
  representativeLatitude: number | null;
  representativeLongitude: number | null;
}

export interface DeliveryZoneDetailsInput {
  serviceAreaId: string;
  governorate: string;
  governorateAr: string;
  city: string;
  cityAr: string;
  name: string;
  nameAr: string;
  displayOrder: number;
  /** Both or neither; `null` removes the point (metadata only — never used for pricing). */
  representativeLatitude: number | null;
  representativeLongitude: number | null;
}

/** Zones are structure (MANAGE_SERVICE_AREAS); a price also needs this delivery-pricing permission. */
export const MANAGE_SERVICE_AREAS = 'MANAGE_SERVICE_AREAS';
export const MANAGE_DELIVERY_FEE_MULTIPLIER = 'MANAGE_DELIVERY_FEE_MULTIPLIER';

export async function listDeliveryZones(): Promise<DeliveryZone[]> {
  const res = await apiClient.get('/admin/delivery-zones');
  return res.data.data;
}

export async function createDeliveryZone(input: DeliveryZoneDetailsInput & { deliveryFeeMinor: number }): Promise<DeliveryZone> {
  const { representativeLatitude, representativeLongitude, ...rest } = input;
  // On create an absent point is simply omitted (the API takes "both or neither").
  const body = representativeLatitude == null ? rest : { ...rest, representativeLatitude, representativeLongitude };
  const res = await apiClient.post('/admin/delivery-zones', body);
  return res.data.data;
}

export async function updateDeliveryZone(id: string, input: Partial<DeliveryZoneDetailsInput>): Promise<DeliveryZone> {
  const res = await apiClient.patch(`/admin/delivery-zones/${id}`, input);
  return res.data.data;
}

export async function updateDeliveryZoneFee(id: string, deliveryFeeMinor: number): Promise<DeliveryZone> {
  const res = await apiClient.patch(`/admin/delivery-zones/${id}/delivery-fee`, { deliveryFeeMinor });
  return res.data.data;
}

export async function setDeliveryZoneActive(id: string, active: boolean): Promise<DeliveryZone> {
  const res = await apiClient.patch(`/admin/delivery-zones/${id}/${active ? 'activate' : 'deactivate'}`);
  return res.data.data;
}

/** The backend's machine-readable code / message of a failed call — shown to the admin, never swallowed. */
export function zoneErrorMessage(err: any, fallback: string): string {
  const status = err?.response?.status;
  const body = err?.response?.data;
  if (status === 403) return 'You do not have permission for this action.';
  if (status === 409) return 'A zone with this name already exists in this service area.';
  const message = body?.error?.message ?? body?.message;
  if (Array.isArray(message)) return message.join(', ');
  return typeof message === 'string' ? message : fallback;
}

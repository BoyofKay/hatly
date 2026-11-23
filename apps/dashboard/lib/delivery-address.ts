/**
 * The frozen delivery address of an order as the backend returns it (PD-009): the map pin is OPTIONAL; an address without one
 * is located by its Delivery Zone, frozen with the order (renaming the zone later never changes it).
 */
export interface DeliveryZoneSnapshotView {
  id: string;
  name: string;
  nameAr: string;
  zoneName?: string | null;
  zoneNameAr?: string | null;
  city: string;
  cityAr: string;
  governorate: string;
  governorateAr: string;
}

export interface DeliveryAddressView {
  line1: string;
  latitude?: number | null;
  longitude?: number | null;
  formattedAddress?: string;
  landmark?: string;
  buildingNumber?: string;
  floor?: string;
  apartment?: string;
  city?: string;
  deliveryZone?: DeliveryZoneSnapshotView | null;
}

/** "بلبيس — أبو نصيب" / "Belbeis — Abu Naseeb"; null when the order pre-dates zones. */
export function deliveryAreaLabel(address: Pick<DeliveryAddressView, 'deliveryZone'> | null | undefined, locale: 'ar' | 'en' = 'en'): string | null {
  const zone = address?.deliveryZone;
  if (!zone) return null;
  return locale === 'ar' ? `${zone.zoneNameAr ?? zone.cityAr} | ${zone.nameAr}` : `${zone.zoneName ?? zone.city} | ${zone.name}`;
}

/** Zone (when known) followed by the customer's own written address — what an operator needs when there is no pin. */
export function deliveryAddressText(address: DeliveryAddressView, locale: 'ar' | 'en' = 'en'): string {
  const area = deliveryAreaLabel(address, locale);
  // A GPS address has no written line (the server stores ''): the coordinates are then the address.
  const hasPoint = typeof address.latitude === 'number' && typeof address.longitude === 'number';
  const written =
    address.formattedAddress ??
    (address.line1 && address.line1.trim() ? address.line1 : hasPoint ? `GPS ${address.latitude!.toFixed(5)}, ${address.longitude!.toFixed(5)}` : '');
  const extras = [address.buildingNumber, address.floor, address.apartment, address.landmark].filter((v) => v && v.trim()).join('، ');
  return [area, written, extras || null].filter(Boolean).join(' · ');
}

export interface DemoSector {
  slug: string;
  name: string;
  nameAr: string;
  sortOrder: number;
  customRequests: boolean;
}

export interface DemoOptionValue {
  name: string;
  nameAr: string;
  priceDeltaMinor: number;
}

export interface DemoOption {
  name: string;
  nameAr: string;
  required: boolean;
  multiple: boolean;
  values: DemoOptionValue[];
}

export interface DemoProduct {
  name: string;
  nameAr: string;
  /** Demonstration price in EGP piastres (minor units). For a WEIGHT product it is the price per kilogram. */
  priceMinor: number;
  unit?: 'WEIGHT';
  /** Asset-pack key of a better-matching image (`products/<vendor-slug>/<product-slug>`); default = this vendor's own product key. */
  image?: string;
  options?: DemoOption[];
}

export interface DemoCategory {
  name: string;
  nameAr: string;
  products: DemoProduct[];
}

export interface DemoVendor {
  /** Stable identifier (slug of the English name) — part of every demo key of this vendor and of its asset-pack image keys. */
  slug: string;
  name: string;
  nameAr: string;
  sector: string;
  preparationMinutes: number;
  commissionBasisPoints: number;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  categories: DemoCategory[];
}

/** A general, truthful discovery banner: no offer, price, discount or date. It opens a category. */
export interface DemoBanner {
  key: string;
  title: string;
  titleAr: string;
  sector: string;
  sortOrder: number;
  /** Asset-pack key of the wide (2:1) banner image. */
  imageKey: string;
}

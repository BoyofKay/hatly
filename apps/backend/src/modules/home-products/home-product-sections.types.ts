import { ActiveOfferSummary } from '../offers/offer-consumption.service';
import { MarketplaceVendorView } from '../sectors/marketplace-vendors.service';

/**
 * The three Home product sections, in the order the Customer Home shows them (Offers, then Most ordered, then New). The ids are a stable,
 * public contract — the app maps them to its own `HomeSectionKind`.
 */
export const HOME_SECTION_IDS = ['OFFERS', 'MOST_ORDERED', 'NEW'] as const;
export type HomeSectionId = (typeof HOME_SECTION_IDS)[number];

/** Version of THIS response shape. Only ever incremented for a breaking change; additive fields do not change it. */
export const HOME_PRODUCT_SECTIONS_CONTRACT_VERSION = 1;

/** Exactly the product fields the Customer app's product card reads (the same names `GET vendor-branches/:id/products` uses). */
export interface HomeProductView {
  id: string;
  vendorBranchId: string;
  categoryId: string;
  name: string;
  nameAr: string | null;
  description: string | null;
  descriptionAr: string | null;
  imageUrl: string | null;
  priceMinor: number;
  isAvailable: boolean;
  pricingUnit: string;
  inventoryMode: string;
  quantity: number | null;
  deliveredQuantityCount: number;
  deliveredWeightGramsCount: number;
  /** ISO-8601 — the app decides what counts as "new" from it (and so does the NEW section here). */
  createdAt: string;
  activeOffer: ActiveOfferSummary | null;
}

export type HomeSectionResult =
  | { id: HomeSectionId; status: 'OK'; products: HomeProductView[] }
  /** This section could not be produced; the other sections are unaffected. `products` is empty. */
  | { id: HomeSectionId; status: 'ERROR'; code: 'SECTION_UNAVAILABLE'; products: [] };

export interface HomeProductSectionsResponse {
  contractVersion: number;
  generatedAt: string;
  /** What the response was scoped to: null = the whole marketplace (the Home's behaviour today); a zone id = that zone's service area only. */
  scope: { deliveryZoneId: string | null };
  /** The ranked source vendors (at most 6) the sections were drawn from — the app needs their offer flags for the Offers row. */
  vendors: MarketplaceVendorView[];
  /** Always the requested sections, in Home order. */
  sections: HomeSectionResult[];
}

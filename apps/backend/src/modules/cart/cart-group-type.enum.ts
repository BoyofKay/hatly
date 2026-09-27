/**
 * Shared between Cart-side (`CartVendorGroup`) and Order-side
 * (`OrderVendorSegment`) — an order segment is a snapshot of the cart
 * group it came from, so both sides describe the same distinction:
 *
 * CATALOG: a real, registered `VendorBranch` — items reference real
 * `Product` rows, priced from live catalog data.
 *
 * AD_HOC_SERVICE: an unregistered place the customer describes in
 * free text (a pharmacy, vegetable shop, etc. not on Hatly's
 * catalog) — no `VendorBranch`/`Product` rows exist for it. Pricing
 * is explicitly NOT computed for these groups — see cart-view
 * .interface.ts's `subtotalMinor: number | null` and the Phase 3 Step
 * 3 report for why no formula is invented here.
 */
export enum CartGroupType {
  CATALOG = 'CATALOG',
  AD_HOC_SERVICE = 'AD_HOC_SERVICE',
}

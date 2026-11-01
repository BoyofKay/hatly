/**
 * Where tapping a Home banner leads. Deliberately limited to destinations the customer app already has (no free-form URL, so a banner
 * can never send a customer to an external site): a product page, a vendor branch page, or a sector's vendor listing. NONE = a
 * purely informative banner (not tappable).
 */
export enum HomeBannerActionType {
  NONE = 'NONE',
  PRODUCT = 'PRODUCT',
  VENDOR = 'VENDOR',
  SECTOR = 'SECTOR',
}

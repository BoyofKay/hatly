/**
 * Well-known BusinessConfig keys. Extensible, not exhaustive — same
 * pattern as Permission (permission.enum.ts): the underlying store
 * (BusinessConfig entity) accepts any string key with any JSON value,
 * this just catalogs the keys the application code actually reads by
 * name, so they're not scattered as string literals.
 *
 * Only one key is defined this phase — the confirmed Automatic
 * Dispatch master switch. Do NOT add speculative keys for dispatch
 * thresholds, priority scales, or anything else not yet confirmed as
 * a business rule (see the Phase 2 report's "open decisions" section).
 */
export enum BusinessConfigKey {
  /**
   * Global master switch, SUPER_ADMIN-controlled (delegatable to any
   * ADMIN granted Permission.MANAGE_BUSINESS_CONFIG — see the Phase 2
   * report for why this wasn't made SUPER_ADMIN-only at the role
   * level). true = automatic dispatch operates normally. false =
   * automatic dispatch must not auto-assign; orders become available
   * for manual assignment/reassignment by a permitted Admin instead.
   * Consumed by the future Dispatch module (not built yet) via
   * BusinessConfigService.isAutomaticDispatchEnabled().
   */
  AUTOMATIC_DISPATCH_ENABLED = 'AUTOMATIC_DISPATCH_ENABLED',

  /**
   * PHASE 3 STEP 4 addition. Same delegation model as
   * AUTOMATIC_DISPATCH_ENABLED. true = a cart with 1–3 vendor groups
   * may become a multi-vendor Order. false = order creation rejects
   * any cart with more than one group — the cart itself is never
   * touched/invalidated (see OrderCreationService), only the
   * checkout/order-creation step is gated. An operational safety
   * switch, not a permanent feature flag.
   */
  MULTI_VENDOR_ORDERS_ENABLED = 'MULTI_VENDOR_ORDERS_ENABLED',

  /**
   * PHASE 3 STEP 4 addition — schema/dependency only. Minutes before
   * an OrderVendorSegment's `expectedReadyAt` that the (not yet
   * built) Dispatch engine may consider that segment eligible for
   * assignment. Not read by anything yet — Dispatch doesn't exist.
   * Default seeded at 5, per the approved example value.
   */
  DISPATCH_ASSIGNMENT_LEAD_TIME_MINUTES = 'DISPATCH_ASSIGNMENT_LEAD_TIME_MINUTES',

  /**
   * PHASE 3 DELIVERY-FEE addition. Registered-vendor (CATALOG-only)
   * pricing parameters — see DeliveryFeeCalculationService. Deliberately
   * NOT seeded with any value by any migration: "do not invent business
   * pricing values" means there is no reasonable default here at all.
   * `BusinessConfigService.getRequired()` throws until an authorized
   * Admin/Super Admin sets these via the existing (already
   * permission-gated) BusinessConfig endpoints.
   */
  REGISTERED_VENDOR_PRICE_PER_100M_MINOR = 'REGISTERED_VENDOR_PRICE_PER_100M_MINOR',
  REGISTERED_VENDOR_MINIMUM_DELIVERY_FEE_MINOR = 'REGISTERED_VENDOR_MINIMUM_DELIVERY_FEE_MINOR',
  REGISTERED_VENDOR_ADDITIONAL_VENDOR_FEE_MINOR = 'REGISTERED_VENDOR_ADDITIONAL_VENDOR_FEE_MINOR',

  /**
   * PHASE 3 HATLY-SERVICE-LOCATION addition. Deliberately NOT seeded
   * with any value — the real office coordinates were never supplied
   * and must not be invented. Value shape: `{ latitude, longitude,
   * label }`.
   *
   * NO LONGER READ ANYWHERE as a Hatly Service fallback (same status as
   * HATLY_SERVICE_DEFAULT_DESTINATION_LOCATION below). It used to supply the
   * pickup of a BUY_FROM_PLACE ("هاتلي من مكان") group when the customer
   * had not chosen the place's location — which sent the courier to
   * Hatly's own office to "buy from a place". A BUY_FROM_PLACE request with
   * no customer-chosen pickup now fails checkout validation instead
   * (`BUY_FROM_PLACE_PICKUP_REQUIRED`). Kept only so a row an Admin may
   * already have set is not orphaned. Hatly's own location stays available
   * for genuine Hatly operational purposes, never as a stand-in for a
   * customer-supplied place or address.
   */
  HATLY_SERVICE_DEFAULT_PICKUP_LOCATION = 'HATLY_SERVICE_DEFAULT_PICKUP_LOCATION',

  /**
   * Launch-Readiness Gap Audit fix (Hatly Service location semantics).
   * NO LONGER READ ANYWHERE — kept only so any row an Admin may already
   * have set for it in a live database is not orphaned/unexplained.
   * Originally documented (before this fix) as a fallback DESTINATION
   * for a DELIVER_TO_PLACE ("وصلي لمكان") group with no customer-
   * supplied destination — that was the actual bug: silently routing a
   * customer's DELIVERY to Hatly's own office address misrepresents
   * where their item actually goes, unlike the pickup-side fallback
   * above (which never misrepresents a delivery destination). A
   * DELIVER_TO_PLACE request with no destination now fails checkout
   * validation instead (`DELIVER_TO_PLACE_DESTINATION_REQUIRED`).
   */
  HATLY_SERVICE_DEFAULT_DESTINATION_LOCATION = 'HATLY_SERVICE_DEFAULT_DESTINATION_LOCATION',

  /**
   * PHASE 4 DISPATCH addition. Confirmed business decision. true =
   * new OrderVendorSegments start CONFIRMED automatically (no vendor
   * action needed); false (default, seeded) = segments start PENDING
   * and require the vendor's own accept action, exactly as Phase B
   * built. Defaulting to false preserves Phase B's existing behavior
   * exactly — no existing vendor workflow changes unless an Admin
   * deliberately flips this.
   */
  VENDOR_SEGMENT_AUTO_ACCEPT_ENABLED = 'VENDOR_SEGMENT_AUTO_ACCEPT_ENABLED',

  /**
   * PHASE 4 DISPATCH addition. Deliberately NOT seeded with any value
   * — "do not invent the maximum bicycle distance value." Until an
   * Admin sets this, DriverRankingService treats bicycle-type drivers
   * as ineligible candidates entirely (fails closed — never assigns a
   * bicycle an unbounded distance by default), consistent with this
   * project's established pattern for every other unset numeric
   * safety parameter.
   */
  MAX_BICYCLE_PICKUP_DISTANCE_METERS = 'MAX_BICYCLE_PICKUP_DISTANCE_METERS',

  /**
   * Manual Transfer payment addition. Deliberately NOT seeded with any
   * value — the real transfer destination and support number were
   * never supplied and must not be invented. Value shape:
   * MANUAL_TRANSFER_DESTINATION: { label, phoneOrAccountNumber, accountName? }.
   * CUSTOMER_SERVICE_WHATSAPP_NUMBER: a plain phone-number string.
   * Until both are set, MANUAL_TRANSFER fails closed (see
   * ManualTransferService.getConfig()) — never a fabricated number.
   */
  MANUAL_TRANSFER_DESTINATION = 'MANUAL_TRANSFER_DESTINATION',
  CUSTOMER_SERVICE_WHATSAPP_NUMBER = 'CUSTOMER_SERVICE_WHATSAPP_NUMBER',

  /**
   * PHASE F addition. CONFIRMED: Hatly Service pricing = real road
   * distance (reusing the existing MapProvider, no separate distance
   * engine) × this configurable multiplier. Deliberately NOT seeded —
   * "do not invent a numeric default" — Hatly Service order creation
   * fails closed until an Admin sets this, mirroring the exact
   * discipline already used for the 3 registered-vendor pricing
   * parameters. Gated by the existing MANAGE_DELIVERY_FEE_MULTIPLIER
   * permission (confirmed reuse — no new permission for this).
   */
  HATLY_SERVICE_DISTANCE_MULTIPLIER = 'HATLY_SERVICE_DISTANCE_MULTIPLIER',

  /**
   * PD-009 (supersedes HATLY_SERVICE_DISTANCE_MULTIPLIER for pricing — that key is no longer read by any pricing path and is
   * kept only so historical config rows stay meaningful). APPROVED rule:
   *
   *   Hatly Service delivery fee = the address's ACTIVE Delivery Zone fee × this multiplier
   *
   * Zone-based only (PD-009 amended): coordinates never take part in the price. A positive decimal factor (e.g. 1.5), validated
   * on write. Its approved default (1.5) is
   * seeded as DATA by migration 1700005100000 — never a constant in code; an unset key fails closed. Every Hatly Service order
   * freezes the value it used (`multiplierUsed` in its delivery breakdown).
   */
  HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER = 'HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER',

  /**
   * PHASE F addition. CONFIRMED: settlement frequency (WEEKLY or
   * MONTHLY only) is configurable from the Dashboard, separately for
   * vendors and drivers. Deliberately NOT seeded with a default — no
   * frequency was specified as "the" default, so none is assumed.
   * A settlement period snapshots whichever value was configured at
   * the moment it opened — this key is read only when OPENING a new
   * period, never re-read to reinterpret an already-closed one.
   */
  VENDOR_SETTLEMENT_FREQUENCY = 'VENDOR_SETTLEMENT_FREQUENCY',
  DRIVER_SETTLEMENT_FREQUENCY = 'DRIVER_SETTLEMENT_FREQUENCY',

  /**
   * Customer Authentication Modes (master implementation). Boolean.
   * Default `true` when unset (OTP mode) — preserves the existing,
   * already-working Customer OTP flow exactly as it is today unless
   * an Admin deliberately turns it off. See
   * BusinessConfigService.isCustomerOtpEnabled() for the read helper.
   */
  CUSTOMER_OTP_ENABLED = 'CUSTOMER_OTP_ENABLED',

  /**
   * Loyalty Earning (Chunk C). Integer points earned per 1 EGP of
   * eligible product spending. Default `1` when unset — the approved
   * V1 value — read via BusinessConfigService.getLoyaltyPointsPerEgp().
   * CONFIRMED: kept configuration-driven so this rate is never
   * hardcoded/scattered through the earning calculation itself.
   */
  LOYALTY_POINTS_PER_EGP = 'LOYALTY_POINTS_PER_EGP',

  /**
   * Points -> Wallet Conversion (Chunk D). How many Loyalty Points
   * convert to 1 EGP of Wallet credit — CONFIRMED a deliberately
   * separate config key from LOYALTY_POINTS_PER_EGP above (the
   * earning rate): the two happen to share the same V1 value (100)
   * but are conceptually distinct and may diverge later. Default `100`
   * when unset — the approved V1 rate. This same value also serves as
   * the minimum conversion threshold (see LoyaltyService.
   * convertPointsToWallet's own comment for why: the minimum is
   * defined as "enough points to produce at least 1 EGP," derived
   * from this rate rather than a second, independently-hardcoded
   * minimum that could drift out of sync with it).
   */
  LOYALTY_WALLET_CONVERSION_POINTS_PER_EGP = 'LOYALTY_WALLET_CONVERSION_POINTS_PER_EGP',

  /**
   * CHECKOUT (PD-006). JSON array of the ElectronicPaymentMethod values currently OFFERED to customers for Manual Transfer and
   * Pay-at-Delivery. Unset = all five supported methods. An unknown value in the array is ignored, never offered.
   */
  CHECKOUT_ENABLED_ELECTRONIC_METHODS = 'CHECKOUT_ENABLED_ELECTRONIC_METHODS',

  /** CHECKOUT (PD-006). How long a delivery quote stays honoured, in seconds. Unset = 900 (15 minutes). */
  CHECKOUT_QUOTE_TTL_SECONDS = 'CHECKOUT_QUOTE_TTL_SECONDS',

  /**
   * ETA (PD-006). Minutes added to an estimated delivery time to make the upper end of the range shown to the customer.
   * Unset = no range is invented: the estimate is shown as a single time.
   */
  ETA_RANGE_BUFFER_MINUTES = 'ETA_RANGE_BUFFER_MINUTES',
}

/**
 * Granular admin permissions. Deliberately a flat string enum, not a
 * DB-driven catalog table — matches the existing `Role` enum's own
 * style, and there's no stated requirement for permissions themselves
 * to be created/renamed at runtime (only *grants* of them are dynamic —
 * see AdminPermission). Extensible: add a new value here as new
 * admin-facing actions are built; nothing about PermissionsGuard or
 * AdminPermission needs to change when this list grows.
 *
 * Sourced directly from the approved requirements (doc 13 §15 / doc 14
 * item 39's config-related actions) — not invented.
 */
export enum Permission {
  MANAGE_VENDOR_COMMISSION = 'MANAGE_VENDOR_COMMISSION',
  MANAGE_DELIVERY_FEE_MULTIPLIER = 'MANAGE_DELIVERY_FEE_MULTIPLIER',
  MANAGE_DRIVER_COMMISSION = 'MANAGE_DRIVER_COMMISSION',
  ADJUST_DRIVER_FINANCES = 'ADJUST_DRIVER_FINANCES',
  CLOSE_VENDOR_SETTLEMENTS = 'CLOSE_VENDOR_SETTLEMENTS',
  VIEW_VENDOR_FINANCIAL_REPORTS = 'VIEW_VENDOR_FINANCIAL_REPORTS',
  VIEW_DRIVER_SETTLEMENTS = 'VIEW_DRIVER_SETTLEMENTS',
  CLOSE_DRIVER_SETTLEMENTS = 'CLOSE_DRIVER_SETTLEMENTS',
  ASSIGN_REASSIGN_ORDERS = 'ASSIGN_REASSIGN_ORDERS',
  OVERRIDE_DISPATCH = 'OVERRIDE_DISPATCH',
  CHANGE_DRIVER_ONLINE_STATUS = 'CHANGE_DRIVER_ONLINE_STATUS',
  OPEN_CLOSE_VENDOR_BRANCHES = 'OPEN_CLOSE_VENDOR_BRANCHES',
  MANAGE_BUSINESS_CONFIG = 'MANAGE_BUSINESS_CONFIG',
  MANAGE_VEHICLE_TYPES = 'MANAGE_VEHICLE_TYPES',
  MANAGE_LOYALTY_CONFIG = 'MANAGE_LOYALTY_CONFIG',
  MANAGE_DRIVER_VENDOR_PREFERENCES = 'MANAGE_DRIVER_VENDOR_PREFERENCES',
  MANAGE_HATLY_SERVICE_PRICING = 'MANAGE_HATLY_SERVICE_PRICING',
  VIEW_REPORTS = 'VIEW_REPORTS',
  /**
   * Stage A (vendor/driver identity onboarding) addition. Confirmed:
   * only SUPER_ADMIN or a permitted ADMIN may create a vendor-staff or
   * driver account — no self-registration exists or is planned.
   */
  MANAGE_VENDOR_STAFF = 'MANAGE_VENDOR_STAFF',
  MANAGE_DRIVERS = 'MANAGE_DRIVERS',
  /**
   * Manual Transfer payment addition. Gates the Admin review queue and
   * the approve/reject actions — an Admin needs this explicitly
   * granted; SUPER_ADMIN bypasses as usual.
   */
  VERIFY_MANUAL_PAYMENTS = 'VERIFY_MANUAL_PAYMENTS',
  /**
   * Phase F addition. Proposed in the Phase F design review and
   * approved for implementation — none of the 7 pre-existing financial
   * permissions (all vendor/driver commission-and-settlement specific)
   * fit employee loan/advance management, which covers any employee,
   * not just drivers.
   */
  MANAGE_EMPLOYEE_LOANS = 'MANAGE_EMPLOYEE_LOANS',
  /**
   * Phase G addition (Offers & Promotions). FINAL DECISION: Admin
   * manages Offers; Vendors/Vendor Staff never do (no Vendor-facing
   * Offer endpoint or permission exists anywhere). None of the
   * pre-existing permissions fit — closest candidate
   * MANAGE_VENDOR_COMMISSION is rate-configuration-specific, not
   * promotion management.
   */
  MANAGE_OFFERS = 'MANAGE_OFFERS',
  /**
   * Home promotional banners (2026-10-28). Admin-only content on the customer Home carousel; Vendors/Vendor Staff never manage
   * them. Nothing existing fits: MANAGE_OFFERS prices and activates discounts, this publishes marketing images — a person who
   * runs offers is not automatically someone who should control what every customer sees first. SUPER_ADMIN bypasses as usual.
   */
  MANAGE_HOME_BANNERS = 'MANAGE_HOME_BANNERS',
  /**
   * Phase G addition (Marketplace Sector Taxonomy). Admin-only —
   * Vendors/Vendor Staff never manage sectors or their own branch's
   * sector assignment (no Vendor-facing endpoint or permission exists
   * for this anywhere). Nothing existing fits; closest candidates
   * (MANAGE_VENDOR_COMMISSION, MANAGE_OFFERS) are both about a
   * specific branch's own configuration, not marketplace-wide taxonomy.
   */
  MANAGE_MARKETPLACE_SECTORS = 'MANAGE_MARKETPLACE_SECTORS',
  /**
   * Phase I-A addition (Vendor & VendorBranch Onboarding). Covers the
   * full Vendor/VendorBranch CRUD + activate/deactivate — mirrors the
   * exact single-permission-per-capability-area shape already used by
   * MANAGE_OFFERS/MANAGE_MARKETPLACE_SECTORS. The existing
   * OPEN_CLOSE_VENDOR_BRANCHES permission (defined in Phase 1,
   * confirmed never used anywhere) was considered and not reused: its
   * name scopes it to toggling a branch's open/active state, not the
   * broader create/edit surface this chunk adds — reusing it would
   * split one capability area across two permissions, unlike every
   * other admin capability in this codebase.
   */
  MANAGE_VENDORS = 'MANAGE_VENDORS',
  /**
   * Phase I-A, Chunk 2 addition (Product & ProductCategory
   * Management). NOT merged into `MANAGE_VENDORS` — that permission's
   * own comment scopes it specifically to Vendor/VendorBranch entity
   * CRUD; catalog content (Products/Categories) is a distinct
   * capability area, matching the exact same one-permission-per-area
   * precedent already established by MANAGE_OFFERS/
   * MANAGE_MARKETPLACE_SECTORS/MANAGE_VENDORS themselves.
   */
  MANAGE_CATALOG = 'MANAGE_CATALOG',
  /** Phase I-B addition (Multi-City / Service Area). Deliberately NOT merged into MANAGE_VENDORS/MANAGE_CATALOG — a distinct capability area, per this project's own one-permission-per-area precedent. */
  MANAGE_SERVICE_AREAS = 'MANAGE_SERVICE_AREAS',

  /**
   * Admin-mediated Driver Cash Remainder (Chunk E). The pre-approved
   * monetary Wallet permission (per the Loyalty+Wallet design review)
   * — its first real use is gating remainder approval/rejection,
   * since that is the first Admin operation that actually creates a
   * WalletTransaction. Deliberately distinct from
   * MANAGE_LOYALTY_CONFIG (configuration only, never money movement).
   */
  MANAGE_CUSTOMER_WALLET = 'MANAGE_CUSTOMER_WALLET',

  /**
   * Admin Order Detail View (Chunk 2a). Read-only Admin access to an
   * arbitrary Order's full detail — deliberately distinct from
   * MANAGE_CUSTOMER_WALLET (a real money-movement capability) since
   * viewing an order is a different, narrower capability. The future
   * Failed Delivery Resolution workflow (not built in this chunk)
   * will introduce its own separate MANAGE_ORDER_ISSUES permission for
   * actually resolving a case — this permission is read-only.
   */
  VIEW_ORDERS = 'VIEW_ORDERS',

  /**
   * Failed Delivery Resolution (Chunk 2b). Creating a
   * FailedDeliveryResolution — distinct from VIEW_ORDERS (read-only)
   * and MANAGE_CUSTOMER_WALLET (a different money-movement
   * capability). This permission gates the DECISION only; the actual
   * refund execution (Chunk 2c) is separate work not yet built.
   */
  MANAGE_ORDER_ISSUES = 'MANAGE_ORDER_ISSUES',

  /**
   * M3c (Launch-Readiness Gap Audit, G-10) — Admin Customer Management.
   * Same shape as VIEW_ORDERS: read-only, deliberately distinct from
   * MANAGE_CUSTOMER_WALLET (a real money-movement capability — an
   * admin who can approve a wallet credit is not necessarily the same
   * admin who should be browsing customer profiles, and vice versa).
   * Gates the new customer list/search and detail endpoints only; no
   * customer mutation capability exists anywhere in this codebase, so
   * none is gated here.
   */
  VIEW_CUSTOMERS = 'VIEW_CUSTOMERS',
  /**
   * Launch-readiness G-11. Read-only access to the append-only admin audit log (who did what, to which object, from which address).
   * The log holds client addresses and the names of changed fields, so — like VIEW_CUSTOMERS — it is its own capability: an admin
   * who runs settlements is not automatically someone who should browse the security trail. SUPER_ADMIN bypasses as usual.
   */
  VIEW_AUDIT_LOG = 'VIEW_AUDIT_LOG',

  /**
   * Hatly operations acting ON A VENDOR'S BEHALF on order segments: accept, reject (with a reason), mark preparing, mark ready — for any branch
   * and for Hatly/Wasally service segments. Deliberately NOT implied by any other permission; SUPER_ADMIN always passes (PermissionsGuard).
   * Every such action is stored in the segment history with the actor and `onBehalfOfVendor = true`.
   */
  MANAGE_ORDER_FULFILMENT = 'MANAGE_ORDER_FULFILMENT',

  // ---- Enterprise Admin Panel (2026-10-30). Same flat style; names follow the approved specification (docs/admin-revamp, MS §9.2). ----
  /** Sensitive financial figures (ledger, revenue, liabilities, customer wallet balances). Read-only; money MOVEMENT has its own permissions. */
  VIEW_FINANCIALS = 'VIEW_FINANCIALS',
  /** Unmasked customer phone / email / address. Every reveal is audited. */
  VIEW_CUSTOMER_PII = 'VIEW_CUSTOMER_PII',
  VENDORS_VIEW = 'VENDORS_VIEW',
  CATALOG_VIEW = 'CATALOG_VIEW',
  FLEET_VIEW = 'FLEET_VIEW',
  MARKETING_VIEW = 'MARKETING_VIEW',
  CONFIG_VIEW = 'CONFIG_VIEW',
  MEDIA_VIEW = 'MEDIA_VIEW',
  VIEW_SYSTEM_HEALTH = 'VIEW_SYSTEM_HEALTH',
  /** Block / unblock customers and keep staff notes about them. */
  MANAGE_CUSTOMERS = 'MANAGE_CUSTOMERS',
  MANAGE_MEDIA = 'MANAGE_MEDIA',
  MEDIA_DELETE = 'MEDIA_DELETE',
  MANAGE_CAMPAIGNS = 'MANAGE_CAMPAIGNS',
  CAMPAIGN_APPROVE = 'CAMPAIGN_APPROVE',
  MANAGE_BROADCASTS = 'MANAGE_BROADCASTS',
  BROADCAST_APPROVE = 'BROADCAST_APPROVE',
  /** Records a payment against a CLOSED settlement period (B5). Distinct from closing the period. */
  MANAGE_SETTLEMENT_PAYMENTS = 'MANAGE_SETTLEMENT_PAYMENTS',
  /** Authorises a settlement payment that exceeds the amount due (B5 — authorised overpayment). */
  APPROVE_SETTLEMENT_OVERPAYMENT = 'APPROVE_SETTLEMENT_OVERPAYMENT',
  MANAGE_SYSTEM_JOBS = 'MANAGE_SYSTEM_JOBS',
  MODERATE_REVIEWS = 'MODERATE_REVIEWS',
  /** Second approver for customer wallet adjustments above the configured threshold (creator is never the approver). */
  WALLET_ADJUST_APPROVE = 'WALLET_ADJUST_APPROVE',
  ORDERS_EXPORT = 'ORDERS_EXPORT',
  CUSTOMERS_EXPORT = 'CUSTOMERS_EXPORT',
  FINANCE_EXPORT = 'FINANCE_EXPORT',
  CATALOG_EXPORT = 'CATALOG_EXPORT',
  FLEET_EXPORT = 'FLEET_EXPORT',
  MARKETING_EXPORT = 'MARKETING_EXPORT',
  AUDIT_EXPORT = 'AUDIT_EXPORT',
  REPORTS_EXPORT = 'REPORTS_EXPORT',
  /**
   * Staff hierarchy (2026-11-21). Create, edit, deactivate, delete and reset the password of staff accounts BELOW the holder's own level
   * (ADMIN > OPS_SUPERVISOR > OPS_TEAM), and give them permissions the holder already has. SUPER_ADMIN always passes.
   */
  MANAGE_STAFF_ACCOUNTS = 'MANAGE_STAFF_ACCOUNTS',
  /**
   * Owner decision 2026-11-22: deleting is an ADMIN decision, separate from editing and from day-to-day operations. Every delete
   * (stores, branches, products, categories, sections, offers, zones, areas, vehicle types, drivers, store staff, banners, staff accounts)
   * needs this IN ADDITION to the permission that manages that record. Supervisors and the operations team deactivate instead.
   */
  DELETE_RECORDS = 'DELETE_RECORDS',
}

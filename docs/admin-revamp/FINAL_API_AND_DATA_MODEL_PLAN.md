# Hatly Enterprise Management — Final API and Data Model Plan

**Authority:** subordinate to `FINAL_MASTER_IMPLEMENTATION_SPECIFICATION.md` (MS). Decisions: `FINAL_DECISION_REGISTER.md` (D-xx). **Documentation only** — nothing here has been implemented, migrated or deployed. Date: 2026-10-30.

**Status legend for endpoints:** **REUSE** exists today and is used as is · **EXTEND** exists; additive change (new optional params/fields, never removal) · **NEW** does not exist. Paths marked ᵛ come from a heuristic route parser and are re-confirmed by reading the controller at the start of the owning workstream. `/api/v1` prefix omitted (as in the existing API).

---

## 1. Conventions that apply to every endpoint (stated once)

| Topic | Contract |
|---|---|
| Auth | Dashboard: HttpOnly cookie session + `X-CSRF-Token` on non-GET (existing). Apps: bearer (existing). Every `/admin/*` route has `@RequiresPermission` / `@RequiresAnyPermission`; role-only (`SUPER_ADMIN`) where stated. Unauthenticated → 401; missing permission → 403 `FORBIDDEN` (body names the missing permission key, never data). |
| Pagination | Offset: `page` (≥1), `pageSize` (1–100, default 25) → `{items,page,pageSize,total,totalExact,summary?}`. Keyset: `cursor`, `limit` (1–200, default 50) → `{items,nextCursor,summary?}`. Cursor is opaque base64url of `(sortKey,id)`; invalid cursor → 400 `INVALID_CURSOR`. Which style each list uses is stated per endpoint (MS §3.3). |
| Sorting | `sort=<field>:<asc|desc>`; whitelist per endpoint; unknown → 400 `UNKNOWN_SORT`. Stable tiebreak on id. |
| Filtering | Typed params; unknown params → 400 `UNKNOWN_FILTER`; arrays as repeated params or comma lists (documented per endpoint); dates `YYYY-MM-DD` (Africa/Cairo); `q` ≥ 2 chars. |
| Idempotency | `Idempotency-Key` header (8–128 chars) on the writes marked **I**; replay returns original body + `Idempotent-Replay: true`; same key different body → 409 `IDEMPOTENCY_CONFLICT`. Stored 24 h (`idempotency_keys`) or, for money, in the existing financial-event idempotency store. |
| Errors | `{statusCode,error,message,code,details?,requestId}`; codes in MS §3.4/§6.4. `requestId` echoes `X-Request-Id`. |
| Audit | Mutations audited by the existing interceptor; explicit events (MS §9.4) marked **A+**. |
| Performance | All GETs return `Server-Timing` (when enabled), public catalog GETs per D-63. Every listed list endpoint carries a query-count and payload budget in `docs/performance/budgets.json`. |
| Rate limiting | Existing policies; new heavy endpoints use named policies: `exportRequest` (10/h/user), `mediaUpload` (existing), `integrationCheck` (1/min/integration), `telemetryIngest` (60/min/client), `search` (30/min/user). |
| Money | `*Minor` integers (EGP); no floats. |
| Test shorthand | **P** permission matrix e2e (allowed/forbidden/unauthenticated + route inventory) · **V** validation boundaries · **A** audit assertion · **I** idempotent replay & conflict · **C** concurrency/race · **N** integration (real DB) · **U** unit · **B** budget (query count/payload/latency) · **M** masking · **X** cross-tenant/object isolation. |

---

## 2. Endpoint inventory

### 2.1 Module 1 — Executive Control Tower (CT)
| ID | Method · Path | Status | Permission | Request → Response | Rules | Tests |
|---|---|---|---|---|---|---|
| CT-01 | GET `/admin/control-tower/summary` | EXTEND | VIEW_ORDERS | → existing summary + `asOf`, `operations` (existing) | 10-s Redis/in-memory single-flight cache (WS-P P1-6); money fields only with VIEW_FINANCIALS | P B M |
| CT-02 | GET `/admin/control-tower/deliveries` | REUSE | VIEW_ORDERS | existing | unchanged | P |
| CT-03 | GET `/admin/control-tower/drivers` | REUSE | VIEW_ORDERS | existing | unchanged | P |
| CT-04 | GET `/admin/search?q&types[]` | NEW | per type: VIEW_ORDERS / VIEW_CUSTOMERS / VENDORS_VIEW / CATALOG_VIEW / FLEET_VIEW | → `{groups:[{type,items:[{id,title,subtitle,url,badge}]}]}` ≤5 per group | `q` ≥ 2; types whitelisted; only groups the caller may read; PII masked in subtitles; `search` rate limit | P V M B (P95 ≤ 300 ms, P-05) |
| CT-05 | GET `/admin/executive/kpis?from&to&compare` | NEW | VIEW_REPORTS (+VIEW_FINANCIALS for money KPIs) | → `{asOf, kpis:[{key,value|null,previous|null,deltaPct|null,definitionKey}]}` | range ≤ 366 d; Cairo boundaries; KPI definitions MS §5.1 | P V M B N |
| CT-06 | GET `/admin/executive/timeseries?metric&granularity&from&to` | NEW | VIEW_REPORTS | → `{points:[{bucketStart,value}]}` | metric whitelist; ≤ 400 points; granularity hour/day/week/month | P V B N |
| CT-07 | GET `/admin/alerts?severity&reason&status&cursor` | NEW | VIEW_ORDERS (VIEW_SYSTEM_HEALTH for system alerts) | → keyset list of alerts `{key,severity,reason,entityType,entityId,since,acknowledged}` | unifies dispatch alerts, pending-acceptance > threshold, overdue ready, refunds-to-send aging, low stock, integration degraded, export/job failures | P N B |
| CT-07a | POST `/admin/alerts/:key/acknowledge` | NEW | VIEW_ORDERS | `{note}` → `{acknowledgedAt}` | note ≤ 300; idempotent per (key,user) | P A V |
| CT-08 | GET `/admin/sla/summary?from&to` | NEW | VIEW_REPORTS | → P50/P90 acceptance, preparation, delivery, on-time % | from status events; thresholds from settings | P N |
| CT-09 | GET self permissions/navigation (existing endpoint that `useAdminPermission` calls; confirmed at WS-1 start) | EXTEND | authenticated admin | → adds `groups`, `featureFlags`, `masking:{pii,financial}` | additive | P |
| CT-10 | GET `/admin/saved-views?tableId` | NEW | authenticated admin | → views (own + shared) | | P X |
| CT-11 | POST `/admin/saved-views` | NEW | authenticated admin (shared needs module update permission) | `{tableId,name,scope,filters,sort,columns}` | ≤ 30 per admin/table; name unique per owner/table | P V A |
| CT-12 | PATCH `/admin/saved-views/:id` | NEW | owner (or module admin for shared) | partial | | P X A |
| CT-13 | DELETE `/admin/saved-views/:id` | NEW | owner | 204 | | P X A |

### 2.2 Module 2 — Order Management (ORD)
| ID | Method · Path | Status | Permission | Request → Response | Rules | Tests |
|---|---|---|---|---|---|---|
| ORD-01 | GET `/admin/orders` | EXTEND | VIEW_ORDERS | filters per MS §5.2, `sort`, `cursor|page` → `{items:[orderRow],nextCursor,summary:{count,totalMinor,discountMinor,refundedMinor}}` | keyset on `(created_at,id)`; money in `summary` only with VIEW_FINANCIALS; PII masked; existing params remain valid | P V M B N |
| ORD-02 | GET `/admin/orders/:id` | EXTEND | VIEW_ORDERS | existing detail + `totals{…}`, `adminCanCancel`, `customerCanCancel`, `noteCount` | totals computed server-side only | P M B |
| ORD-03 | GET `/admin/orders/by-number/:orderNumber`ᵛ | REUSE | VIEW_ORDERS | existing | | P |
| ORD-04 | PATCH `/admin/orders/segments/:segmentId/status` | REUSE | MANAGE_ORDER_FULFILMENT | existing | reason required on reject | P A C |
| ORD-05 | POST `/admin/orders/:id/cancel` | NEW | MANAGE_ORDER_ISSUES | `{reasonCode,reasonText?}` + **I** → `{order,money:{refundDestination,refundedMinor,discountRestoredMinor}}` | not DELIVERED/CANCELLED; same use case as customer cancel with admin actor; PD-014/015 effects; 409 `STATE_CONFLICT` if a driver assignment/delivery raced | P V A+ I C N |
| ORD-06 | GET `/admin/orders/:id/timeline?types&actor&cursor` | NEW | VIEW_ORDERS | → merged events `{at,type,actor{id,role,name},summary,data}` | merges status events, segment events, financial events, dispatch attempts/alerts, payments, refunds, notes; keyset by `(at,id)`; financial amounts only with VIEW_FINANCIALS | P M N B |
| ORD-07 | GET `/admin/orders/:id/notes` | NEW | VIEW_ORDERS | → notes | | P |
| ORD-08 | POST `/admin/orders/:id/notes` | NEW | MANAGE_ORDER_ISSUES | `{body ≤1000}` | append-only | P V A+ |
| ORD-09 | POST `/admin/orders/:id/resend-notification` | NEW | MANAGE_ORDER_ISSUES | `{audience: CUSTOMER|VENDOR, type}` | 3/h per order; type whitelist | P V A+ |
| ORD-10 | GET `/admin/orders/hatly-queue?status&cursor` | NEW | VIEW_ORDERS | → Hatly/Wasally orders (pending price, awaiting driver, etc.) | | P B |
| ORD-11 | POST `/admin/orders/items/:itemId/confirm-price` | REUSE | MANAGE_HATLY_SERVICE_PRICING | existing | | P A |
| ORD-12 | POST `/admin/orders/bulk/resend-notification` | NEW | MANAGE_ORDER_ISSUES | `{ids≤50,type,confirmCount}` **I** → `{results}` | D-35 | P V A+ I |
| ORD-13 | POST `/admin/orders/bulk/assign-driver` | NEW | ASSIGN_REASSIGN_ORDERS | `{items:[{orderId,driverId}≤50],confirmCount}` **I** → `{results}` | each via FLT-02 use case | P V A+ I C |
| ORD-14 | GET `/admin/orders/failed-deliveries` | REUSE | MANAGE_ORDER_ISSUES | existing | add filters additive | P |
| ORD-15 | POST `/admin/orders/:id/failed-delivery-resolution` | REUSE | MANAGE_ORDER_ISSUES | existing | | P A |
| ORD-16 | POST `/admin/orders/:id/failed-delivery-refund` | REUSE | MANAGE_ORDER_ISSUES | existing | | P A |

### 2.3 Module 3 — Marketplace (MKT)
| ID | Method · Path | Status | Permission | Request → Response | Rules | Tests |
|---|---|---|---|---|---|---|
| MKT-01 | GET `/admin/sectors` | REUSE (+filters) | MARKETPLACE read: MANAGE_MARKETPLACE_SECTORS | list | add `q`, `active`, pagination (additive) | P B |
| MKT-02 | GET `/admin/sectors/:id` | REUSE | same | | | P |
| MKT-03 | POST `/admin/sectors` | EXTEND | MANAGE_MARKETPLACE_SECTORS | `{nameEn,nameAr,mediaAssetId?,sortOrder?}` (legacy `imageUrl` accepted, deprecated) | asset purpose SECTOR_IMAGE, ACTIVE; names unique; epoch bump | P V A N |
| MKT-04 | PATCH `/admin/sectors/:id` | EXTEND | same | partial + `mediaAssetId` | | P V A |
| MKT-05 | PATCH `/admin/sectors/:id/activate` | REUSE | same | | epoch bump | P A |
| MKT-06 | PATCH `/admin/sectors/:id/deactivate` | REUSE | same | `{confirm:true}` when active vendors exist | 409 `HAS_ACTIVE_DEPENDENTS` without confirm | P V A |
| MKT-07 | GET `/admin/subcategories?sectorId` | REUSE (+filters) | MANAGE_MARKETPLACE_SECTORS | | | P |
| MKT-08 | GET `/admin/subcategories/:id` | REUSE | same | | | P |
| MKT-09 | POST `/admin/subcategories` | EXTEND | same | + `mediaAssetId` | purpose SUBCATEGORY_IMAGE | P V A |
| MKT-10 | PATCH `/admin/subcategories/:id` | EXTEND | same | | | P V A |
| MKT-11 | PATCH `/admin/subcategories/:id/activate` | REUSE | same | | | P A |
| MKT-12 | PATCH `/admin/subcategories/:id/deactivate` | REUSE | same | | | P A |
| MKT-13 | PATCH `/admin/vendor-branches/:id/sector` | REUSE | same | | | P A |
| MKT-14 | PATCH `/admin/vendor-branches/:id/subcategories` | REUSE | same | | | P A |
| MKT-15 | GET `/admin/home-banners` | REUSE | MANAGE_HOME_BANNERS | | | P |
| MKT-16 | GET `/admin/home-banners/:id` | REUSE | same | | | P |
| MKT-17 | POST `/admin/home-banners` | EXTEND | same | + `mediaAssetId`, schedule | purpose HOME_BANNER | P V A |
| MKT-18 | PATCH `/admin/home-banners/:id` | EXTEND | same | | | P V A |
| MKT-19 | POST `/admin/home-banners/:id/image` | REUSE (deprecated) | same | multipart | implemented on the media pipeline (creates asset + assigns) | P A N |
| MKT-20 | PATCH `/admin/home-banners/:id/activate` | REUSE | same | | | P A |
| MKT-21 | PATCH `/admin/home-banners/:id/deactivate` | REUSE | same | | | P A |
| MKT-22 | DELETE `/admin/home-banners/:id` | REUSE | same | | active banner cannot be deleted | P A V |
| MKT-23 | PUT `/admin/marketplace/order` | NEW/EXTEND | MANAGE_MARKETPLACE_SECTORS / MANAGE_HOME_BANNERS | `{entity:SECTOR|SUBCATEGORY|BANNER,orderedIds[]}` | uses existing order columns where present; all ids belong to the same parent | P V A C |
| MKT-24 | GET `/admin/marketplace/home-preview?deliveryZoneId` | NEW | MANAGE_MARKETPLACE_SECTORS or MANAGE_HOME_BANNERS | → public composition | read-only; reuses public services | P B |

### 2.4 Module 4 — Vendor & Branch (VND)
| ID | Method · Path | Status | Permission | Request → Response | Rules | Tests |
|---|---|---|---|---|---|---|
| VND-01 | GET `/admin/vendors` | REUSE (+filters/pagination) | MANAGE_VENDORS / VENDORS_VIEW | | additive filters | P B |
| VND-02 | GET `/admin/vendors/:id` | REUSE | same | | | P |
| VND-03 | POST `/admin/vendors` | EXTEND | MANAGE_VENDORS | + `logoMediaAssetId` | | P V A |
| VND-04 | PATCH `/admin/vendors/:id` | EXTEND | MANAGE_VENDORS | | | P V A |
| VND-05 | POST `/admin/vendors/:id/logo` | REUSE (deprecated) | MANAGE_VENDORS | multipart | on media pipeline | P A N |
| VND-06 | PATCH `/admin/vendors/:id/activate` | REUSE | MANAGE_VENDORS | | | P A |
| VND-07 | PATCH `/admin/vendors/:id/deactivate` | REUSE | MANAGE_VENDORS | | blocked while open orders exist → 409 `HAS_OPEN_ORDERS` with ids (max 20) | P A V N |
| VND-08 | PATCH `/admin/vendors/:id/open` | REUSE | OPEN_CLOSE_VENDOR_BRANCHES | | | P A |
| VND-09 | PATCH `/admin/vendors/:id/close` | REUSE | OPEN_CLOSE_VENDOR_BRANCHES | | | P A |
| VND-10 | PATCH `/admin/vendor-branches/:branchId/commission-rate` | REUSE | MANAGE_VENDOR_COMMISSION | `{ratePercent,reason}` | prospective; 0–100 (2 dp); reason required (additive) | P V A+ |
| VND-11 | PATCH `/admin/vendor-branches/:branchId/auto-accept` | REUSE | MANAGE_ORDER_FULFILMENT | | | P A |
| VND-12 | GET `/admin/vendor-branches?vendorId&sectorId&zoneId&active&open&q` | NEW | MANAGE_VENDORS / VENDORS_VIEW | offset list | | P B |
| VND-13 | GET `/admin/vendor-branches/:id` | NEW | same | composed detail (profile, hours, zones, commission, acceptance, cover) | | P B |
| VND-14 | PATCH `/admin/vendor-branches/:id` | EXTEND/NEW | MANAGE_VENDORS | profile, hours, `coverMediaAssetId` | hours validation; verified existing capability at WS-7 start | P V A |
| VND-15 | GET `/admin/vendor-branches/:id/performance?from&to` | NEW | VENDORS_VIEW (+VIEW_VENDOR_FINANCIAL_REPORTS for money) | metrics MS §5.4 | | P M B N |
| VND-16 | GET `/admin/vendor-staff` | REUSE (+filters) | MANAGE_VENDOR_STAFF | | | P |
| VND-17 | POST `/admin/vendor-staff` | REUSE | MANAGE_VENDOR_STAFF | | | P V A |
| VND-18 | PATCH `/admin/vendor-staff/:id/activate` | REUSE | MANAGE_VENDOR_STAFF | | | P A |
| VND-19 | PATCH `/admin/vendor-staff/:id/deactivate` | REUSE | MANAGE_VENDOR_STAFF | | revokes sessions | P A |
| VND-20 | GET `/admin/vendors/:id/onboarding-checklist` | NEW | VENDORS_VIEW | → `[{key,done,blockingReason}]` | derived | P N |
| VND-21 | GET `/admin/vendor-branches/:id/commission-history` | NEW | MANAGE_VENDOR_COMMISSION or VIEW_VENDOR_FINANCIAL_REPORTS | → audit-derived changes | | P |

### 2.5 Module 5 — Product & Inventory (CAT)
| ID | Method · Path | Status | Permission | Request → Response | Rules | Tests |
|---|---|---|---|---|---|---|
| CAT-01 | GET `/admin/products` | EXTEND | MANAGE_CATALOG / CATALOG_VIEW | filters vendor, branch, category, sector, active, stockState, hasImage, hasOffer, price range, `q`; sort; keyset → rows `{id,name,vendor,branch,priceMinor,stock,state,active,thumbnailUrl}` | summary counts by stock state | P B N |
| CAT-02 | GET `/admin/products/:id` | REUSE | same | + `images[]` | | P |
| CAT-03 | POST `/admin/products` | EXTEND | MANAGE_CATALOG | + `mediaAssetId`, `lowStockThreshold?` | primary asset purpose PRODUCT_PRIMARY | P V A |
| CAT-04 | PATCH `/admin/products/:id` | EXTEND | MANAGE_CATALOG | | | P V A |
| CAT-05 | PATCH `/admin/products/:id/activate` | REUSE | MANAGE_CATALOG | | epoch bump | P A |
| CAT-06 | PATCH `/admin/products/:id/deactivate` | REUSE | MANAGE_CATALOG | | | P A |
| CAT-07 | PATCH `/admin/products/:id/set-inventory-zero` | REUSE | MANAGE_CATALOG | | | P A C |
| CAT-08 | GET `/admin/products/import-template` | REUSE | MANAGE_CATALOG | xlsx | | P |
| CAT-09 | POST `/admin/products/import/validate` | REUSE | MANAGE_CATALOG | multipart | returns row errors | P V |
| CAT-10 | POST `/admin/products/import/apply` | REUSE | MANAGE_CATALOG | multipart + **I** (additive) | re-apply idempotent | P A I N |
| CAT-11 | PUT `/admin/products/:id/media` | NEW | MANAGE_CATALOG | `{items:[{mediaAssetId}]}` ordered; first = primary | ≤ `PRODUCT_MAX_IMAGES`; assets ACTIVE, purpose PRODUCT_*; replaces set transactionally; writes `products.image_url` from primary display URL | P V A N C |
| CAT-12 | POST `/admin/products/bulk` | NEW | MANAGE_CATALOG | `{ids≤50,action:ACTIVATE|DEACTIVATE|SET_STOCK|PRICE_PERCENT,params,reason?,confirmCount}` **I** → `{results}` | PRICE_PERCENT within ±90 and result ≥ 0; preview endpoint variant `?dryRun=true` returns old/new per item | P V A+ I |
| CAT-13 | GET `/admin/inventory?state&vendorId&threshold&cursor` | NEW | MANAGE_CATALOG / CATALOG_VIEW | keyset list + `summary:{low,out,unlimited}` | threshold default `LOW_STOCK_THRESHOLD` | P N B |
| CAT-14 | PATCH `/admin/inventory/settings` (platform setting `LOW_STOCK_THRESHOLD`) | EXTEND (via CFG) | MANAGE_BUSINESS_CONFIG | int 0–1000 | | P V A |
| CAT-15 | GET `/admin/catalog-products` | REUSE | MANAGE_CATALOG | | | P |
| CAT-16 | GET `/admin/catalog-products/:id` | REUSE | same | + listings | | P |
| CAT-17 | POST `/admin/catalog-products` | EXTEND | same | + `mediaAssetId` | | P V A |
| CAT-18 | PATCH `/admin/catalog-products/:id` | EXTEND | same | | | P V A |
| CAT-19 | PATCH `/admin/catalog-products/:id/activate` | REUSE | same | | | P A |
| CAT-20 | PATCH `/admin/catalog-products/:id/deactivate` | REUSE | same | | | P A |
| CAT-21 | POST `/admin/catalog-products/:id/listings` | REUSE | same | | | P V A |
| CAT-22 | DELETE `/admin/catalog-products/:id/listings/:productId` | REUSE | same | | | P A |
| CAT-23 | GET `/admin/product-categories` | REUSE | same | | | P |
| CAT-24 | GET `/admin/product-categories/:id` | REUSE | same | | | P |
| CAT-25 | POST `/admin/product-categories` | REUSE | same | | | P V A |
| CAT-26 | PATCH `/admin/product-categories/:id` | REUSE | same | | | P V A |
| CAT-27 | PATCH `/admin/product-categories/:id/activate` | REUSE | same | | | P A |
| CAT-28 | PATCH `/admin/product-categories/:id/deactivate` | REUSE | same | | | P A |

### 2.6 Module 6 — Delivery & Fleet (FLT)
| ID | Method · Path | Status | Permission | Request → Response | Rules | Tests |
|---|---|---|---|---|---|---|
| FLT-01 | GET `/admin/orders/dispatchable` | REUSE | ASSIGN_REASSIGN_ORDERS | existing | add filters additive | P B |
| FLT-02 | POST `/admin/orders/:orderId/assign-driver` | REUSE | ASSIGN_REASSIGN_ORDERS | existing | | P A C |
| FLT-03 | POST `/admin/orders/:orderId/reassign-driver` | REUSE | ASSIGN_REASSIGN_ORDERS | existing (+`reason` required, additive) | | P V A |
| FLT-04 | GET `/admin/drivers` | EXTEND | MANAGE_DRIVERS / FLEET_VIEW | filters verified, online, vehicleType, zone, busy, `q`; pagination | | P B |
| FLT-05 | POST `/admin/drivers` | REUSE | MANAGE_DRIVERS | | | P V A |
| FLT-06 | PATCH `/admin/drivers/:id/verification` | REUSE | MANAGE_DRIVERS | + `reason` (additive) | | P V A |
| FLT-07 | PATCH `/admin/drivers/:id/vehicle-type` | REUSE | MANAGE_DRIVERS | | | P A |
| FLT-08 | GET `/admin/drivers/vehicle-types` | REUSE | MANAGE_DRIVERS | | | P |
| FLT-09 | GET `/admin/drivers/:id` | NEW | FLEET_VIEW | profile, vehicle, status, last seen, counters | | P M B |
| FLT-10 | GET `/admin/drivers/:id/deliveries?from&to&status&cursor` | NEW | FLEET_VIEW | keyset | | P B |
| FLT-11 | GET `/admin/drivers/:id/earnings?from&to` | NEW | VIEW_DRIVER_SETTLEMENTS | earnings, commission, reimbursements, net per period/day | from financial events + periods (MS §8.2) | P N M |
| FLT-12 | GET `/admin/drivers/:id/performance?from&to` | NEW | FLEET_VIEW | MS §5.6 metrics | | P N |
| FLT-13 | PATCH `/admin/drivers/:driverId/commission-rate` | REUSE | MANAGE_DRIVER_COMMISSION | `{ratePercent,reason}` | prospective | P V A+ |
| FLT-14 | PATCH `/admin/drivers/:id/online-status`ᵛ | verify/NEW | CHANGE_DRIVER_ONLINE_STATUS | `{online,reason}` | exists as permission; endpoint presence verified at WS-8 | P V A |
| FLT-15 | GET `/admin/vehicle-types` | REUSE | MANAGE_VEHICLE_TYPES / FLEET_VIEW | | | P |
| FLT-16 | POST `/admin/vehicle-types` | REUSE | MANAGE_VEHICLE_TYPES | | | P V A |
| FLT-17 | PATCH `/admin/vehicle-types/:id` | REUSE | MANAGE_VEHICLE_TYPES | | | P V A |
| FLT-18 | GET `/admin/cash-remainders` | REUSE | MANAGE_CUSTOMER_WALLET | | | P |
| FLT-19 | GET `/admin/cash-remainders/:id` | REUSE | same | | | P |
| FLT-20 | PATCH `/admin/cash-remainders/:id/approve` | REUSE | same | | idempotent per remainder | P A I C |
| FLT-21 | PATCH `/admin/cash-remainders/:id/reject` | REUSE | same | `{reason}` | | P V A |
| FLT-22 | GET `/admin/fleet/live` | NEW | FLEET_VIEW | drivers with last location (age), active delivery, state | no coordinates in logs; stale flag > 120 s | P B |
| FLT-23 | GET `/admin/delivery-performance?from&to&dimension` | NEW | FLEET_VIEW | SLA aggregates | | P N B |

### 2.7 Module 7 — Customer Management (CUS)
| ID | Method · Path | Status | Permission | Request → Response | Rules | Tests |
|---|---|---|---|---|---|---|
| CUS-01 | GET `/admin/customers` | EXTEND | VIEW_CUSTOMERS | filters; keyset; masked rows | wallet balance filter needs VIEW_FINANCIALS | P M B |
| CUS-02 | GET `/admin/customers/:id` | EXTEND | VIEW_CUSTOMERS | profile, flags, counters, lifetime value (VIEW_FINANCIALS) | | P M |
| CUS-03 | GET `/admin/customers/:id/orders` | NEW | VIEW_CUSTOMERS + VIEW_ORDERS | keyset | | P |
| CUS-04 | GET `/admin/customers/:id/wallet` | NEW | VIEW_CUSTOMERS + VIEW_FINANCIALS | balance + keyset ledger | balance = ledger sum (checked) | P N |
| CUS-05 | GET `/admin/customers/:id/loyalty` | NEW | VIEW_CUSTOMERS | points, ledger | | P |
| CUS-06 | GET `/admin/customers/:id/addresses` | NEW | VIEW_CUSTOMERS | masked unless PII | | P M |
| CUS-07 | GET `/admin/customers/:id/ratings` | NEW | VIEW_CUSTOMERS | | | P |
| CUS-08 | GET `/admin/customers/:id/notes` | NEW | VIEW_CUSTOMERS | | | P |
| CUS-09 | POST `/admin/customers/:id/notes` | NEW | MANAGE_CUSTOMERS | `{body ≤1000}` | append-only | P V A |
| CUS-10 | POST `/admin/customers/:id/block` | NEW | MANAGE_CUSTOMERS | `{reason}` **I** | sets `is_active=false`; revokes refresh tokens; cannot target staff roles | P V A+ I N |
| CUS-11 | POST `/admin/customers/:id/unblock` | NEW | MANAGE_CUSTOMERS | `{reason}` **I** | | P V A+ I |
| CUS-12 | POST `/admin/customers/:id/wallet/adjustments` | NEW | MANAGE_CUSTOMER_WALLET | `{amountMinor(signed),reasonCode,note}` **I** → adjustment `{status}` | thresholds MS §5.7; debit cannot overdraw; applied through wallet service with adjustment id as idempotency key | P V A+ I C N |
| CUS-13 | GET `/admin/wallet-adjustments?status` | NEW | MANAGE_CUSTOMER_WALLET or WALLET_ADJUST_APPROVE | | | P |
| CUS-14 | POST `/admin/wallet-adjustments/:id/approve|reject` | NEW | WALLET_ADJUST_APPROVE | `{reason?}` **I** | approver ≠ requester → 403 `FOUR_EYES` | P V A+ I C |
| CUS-15 | GET `/admin/ratings?target&stars&hidden&cursor` | NEW | MODERATE_REVIEWS | | | P B |
| CUS-16 | POST `/admin/ratings/:id/hide` | NEW | MODERATE_REVIEWS | `{reason}` **I** | counters recomputed in the same transaction | P V A+ I N C |
| CUS-17 | POST `/admin/ratings/:id/unhide` | NEW | MODERATE_REVIEWS | **I** | | P A+ I N |
| CUS-18 | account deletion requests list/process (existing routes in auth/deletion)ᵛ | REUSE | existing role/permission | existing | | P |
| CUS-19 | POST `/admin/customers/:id/reveal` | NEW | VIEW_CUSTOMER_PII | `{field: PHONE|EMAIL|ADDRESS}` → `{value,expiresAt}` | audited each time; 20/min per admin | P V A+ M |
| CUS-20 | GET `/admin/customers/:id/coupons` | NEW | VIEW_CUSTOMERS + MARKETING_VIEW | consumptions + grants | | P |

### 2.8 Module 8 — Finance & Accounting (FIN)
| ID | Method · Path | Status | Permission | Request → Response | Rules | Tests |
|---|---|---|---|---|---|---|
| FIN-01 | GET `/admin/finance/ledger?from&to&type[]&orderId&vendorId&branchId&driverId&funding&min&max&sort&cursor` | NEW | VIEW_FINANCIALS | keyset rows + `summary:{inMinor,outMinor,byType[]}` | requires date range or orderId (else 400 `RANGE_REQUIRED`); range ≤ 366 d | P V B N |
| FIN-02 | GET `/admin/finance/ledger/summary` (same filters) | NEW | VIEW_FINANCIALS | totals by type | identical filter code as FIN-01 | P N |
| FIN-03 | GET `/admin/finance/revenue?from&to&granularity&vendorId` | NEW | VIEW_FINANCIALS | components + Hatly revenue (MS §8.1) | | P N |
| FIN-04 | GET `/admin/finance/commissions?from&to&party` | NEW | VIEW_FINANCIALS | recognized, collected, outstanding | provisional flag while U-01 open | P N |
| FIN-05 | GET `/admin/finance/reconciliation?from&to` | NEW | VIEW_FINANCIALS | R1…R6 results | | P N B |
| FIN-06 | GET `/admin/finance/hatly-funded-discounts?from&to&offerId` | NEW | VIEW_FINANCIALS | recorded, restored, net, rows | | P N |
| FIN-07 | POST `/admin/employee-loans` | REUSE | MANAGE_EMPLOYEE_LOANS | | | P V A |
| FIN-08 | POST `/admin/employee-loans/:loanId/repayments` | REUSE | same | | | P V A I |
| FIN-09 | GET `/admin/employee-loans/:loanId` | REUSE | same | | | P |
| FIN-10 | GET `/admin/employee-loans/employee/:employeeUserId` | REUSE | same | | | P |
| FIN-11 | GET `/admin/employee-loans` | NEW | same | list | | P B |
| FIN-12 | GET `/admin/finance/liabilities?asOf` | NEW | VIEW_FINANCIALS | wallet, loyalty (+rate), refunds outstanding, unpaid settlements, driver cash | | P N |
| FIN-13 | GET `/admin/finance/ledger/:eventId` | NEW | VIEW_FINANCIALS | event + linked events | | P |

### 2.9 Module 9 — Payments, Refunds & Settlements (PAY)
| ID | Method · Path | Status | Permission | Request → Response | Rules | Tests |
|---|---|---|---|---|---|---|
| PAY-01 | GET `/admin/manual-transfer-payments` | EXTEND | VERIFY_MANUAL_PAYMENTS | + filters, pagination | | P B |
| PAY-02 | POST `/admin/manual-transfer-payments/:paymentId/approve` | REUSE | same | | | P A C |
| PAY-03 | POST `…/:paymentId/reject` | REUSE | same | | | P A |
| PAY-04 | POST `…/:paymentId/refund` | REUSE | same | | | P A I |
| PAY-05 | GET `/admin/manual-transfer-payments/refunds` | EXTEND | same | + `status=TO_SEND|SENT|ALL`, pagination | | P B |
| PAY-06 | POST `/admin/manual-transfer-payments/refunds/:eventId/mark-sent` | REUSE | same | `{reference,sentAt}` | idempotent per event | P V A I C |
| PAY-07 | GET `/admin/payments` | NEW | VERIFY_MANUAL_PAYMENTS or VIEW_FINANCIALS | filters method/status/date/order/customer; keyset | | P M B |
| PAY-08 | GET `/admin/payments/:id` | NEW | same | | | P |
| PAY-09 | GET `/admin/refunds` | NEW | VIEW_FINANCIALS | recorded vs sent rows + `summary` | | P N B |
| PAY-10 | GET `/admin/settlements/vendor-periods?vendorId&branchId&status&from&to` | NEW | VIEW_VENDOR_FINANCIAL_REPORTS | offset list incl. derived payment status | | P N B |
| PAY-11 | GET `/admin/settlements/vendor-periods/:id` | NEW | same | statement (lines, totals, payments, exceptions) | | P N |
| PAY-12 | GET `/admin/settlements/driver-periods` | NEW | VIEW_DRIVER_SETTLEMENTS | | | P N B |
| PAY-13 | GET `/admin/settlements/driver-periods/:id` | NEW | same | | | P N |
| PAY-14 | POST `/admin/settlement/vendor-branches/:branchId/close` | REUSE | CLOSE_VENDOR_SETTLEMENTS | existing (+`dryRun` additive: returns proposed period) | | P A I C |
| PAY-15 | POST `/admin/settlement/drivers/:driverId/close` | REUSE | CLOSE_DRIVER_SETTLEMENTS | same | | P A I C |
| PAY-16 | POST `/admin/settlements/:partyType/periods/:periodId/payments` | NEW | MANAGE_SETTLEMENT_PAYMENTS | `{direction,amountMinor,method,reference,paidAt}` **I** | CLOSED period only; amount > 0 and ≤ remaining (unless `allowOverpay+reason`); `paidAt` not future; approval above threshold | P V A+ I C N |
| PAY-17 | GET `/admin/settlements/:partyType/periods/:periodId/payments` | NEW | VIEW_VENDOR_FINANCIAL_REPORTS / VIEW_DRIVER_SETTLEMENTS | | | P |
| PAY-18 | POST `/admin/settlement-payments/:id/void` | NEW | MANAGE_SETTLEMENT_PAYMENTS | `{reason}` **I** | once only; creates no deletion; status derived afterwards | P V A+ I C |
| PAY-19 | POST `/admin/settlements/:partyType/periods/:periodId/statement` | NEW | VIEW_* + FINANCE_EXPORT | `{format:PDF|XLSX,locale}` **I** → export job | uses RPT export machinery | P A+ I |
| PAY-20 | GET `/admin/settlements/summary` | NEW | VIEW_VENDOR_FINANCIAL_REPORTS or VIEW_DRIVER_SETTLEMENTS | outstanding by party | | P N |

### 2.10 Module 10 — Marketing & Growth (MKG)
| ID | Method · Path | Status | Permission | Request → Response | Rules | Tests |
|---|---|---|---|---|---|---|
| MKG-01 | GET `/admin/growth/overview?from&to` | NEW | MARKETING_VIEW | new customers, repeat rate, frequency, coupon-driven orders, loyalty, notification delivery | real data only; null when none | P N |
| MKG-02 | GET `/admin/growth/retention?months` | NEW | MARKETING_VIEW | cohort matrix | ≤ 24 months | P N B |
| MKG-03 | GET `/admin/loyalty/overview` | NEW | MARKETING_VIEW + VIEW_FINANCIALS | issued/redeemed/expired/liability | | P N |
| MKG-04 | loyalty config — `GET/PUT /admin/business-config/:key` | REUSE | MANAGE_LOYALTY_CONFIG | | | P A |
| MKG-05 | POST `/admin/broadcasts` | NEW | MANAGE_BROADCASTS | `{titleEn,titleAr,bodyEn,bodyAr,deepLink?,audienceId,channels,scheduledAt?}` | lengths, deep-link whitelist, quiet hours | P V A |
| MKG-06 | GET `/admin/broadcasts` | NEW | MARKETING_VIEW | | | P B |
| MKG-07 | GET `/admin/broadcasts/:id` | NEW | MARKETING_VIEW | | | P |
| MKG-08 | PATCH `/admin/broadcasts/:id` | NEW | MANAGE_BROADCASTS | DRAFT only | | P V A |
| MKG-09 | POST `/admin/broadcasts/:id/submit` | NEW | MANAGE_BROADCASTS | **I** | audience non-empty | P A+ I |
| MKG-10 | POST `/admin/broadcasts/:id/approve` | NEW | BROADCAST_APPROVE | **I** | creator/last editor ≠ approver | P A+ I |
| MKG-11 | POST `/admin/broadcasts/:id/reject` | NEW | BROADCAST_APPROVE | `{reason}` | | P V A+ |
| MKG-12 | POST `/admin/broadcasts/:id/cancel` | NEW | MANAGE_BROADCASTS | **I** | | P A+ I |
| MKG-13 | POST `/admin/broadcasts/:id/send-test` | NEW | MANAGE_BROADCASTS | → to author's tokens only | 5/h | P A |
| MKG-14 | GET `/admin/broadcasts/:id/recipients?status&cursor` | NEW | MARKETING_VIEW | keyset | PII masked | P M |
| MKG-15 | GET `/admin/broadcasts/:id/stats` | NEW | MARKETING_VIEW | counts from recipients | | P N |
| MKG-16 | POST `/admin/audiences` | NEW | MANAGE_BROADCASTS | `{name,rules}` | rule schema validated | P V A |
| MKG-17 | GET `/admin/audiences` | NEW | MARKETING_VIEW | | | P |
| MKG-18 | POST `/admin/audiences/preview` | NEW | MANAGE_BROADCASTS | `{rules}` → `{count|"<20"}` | statement timeout 10 s | P V B |
| MKG-20 | GET `/customer/inbox?cursor` | NEW | customer (self) | keyset messages | isolation | P X |
| MKG-21 | GET `/customer/inbox/unread-count` | NEW | customer | | | P X |
| MKG-22 | POST `/customer/inbox/:id/read` | NEW | customer | **I** | | P X |
| MKG-23 | POST `/customer/inbox/read-all` | NEW | customer | | | P X |

### 2.11 Module 11 — Coupons, Promotions & Campaigns (CPN)
| ID | Method · Path | Status | Permission | Request → Response | Rules | Tests |
|---|---|---|---|---|---|---|
| CPN-01 | GET `/admin/offers` | EXTEND | MANAGE_OFFERS / MARKETING_VIEW | filters, pagination | | P B |
| CPN-02 | GET `/admin/offers/:id` | REUSE | same | | | P |
| CPN-03 | POST `/admin/offers` | REUSE | MANAGE_OFFERS | existing (+`audienceId?`) | validation MS §5.11 | P V A |
| CPN-04 | PATCH `/admin/offers/:id` | NEW | MANAGE_OFFERS | restricted fields (MS §5.11 edit rules) | locked fields → 409 `OFFER_FIELD_LOCKED` once consumptions exist | P V A N C |
| CPN-05 | PATCH `/admin/offers/:id/activate` | REUSE | MANAGE_OFFERS | | epoch bump | P A |
| CPN-06 | PATCH `/admin/offers/:id/deactivate` | REUSE | MANAGE_OFFERS | | | P A |
| CPN-07 | POST `/admin/offers/:id/clone` | NEW | MANAGE_OFFERS | `{name?}` **I** | copies rules, resets counters, DRAFT/inactive | P A+ I |
| CPN-08 | GET `/admin/offers/:id/performance?from&to` | NEW | MARKETING_VIEW | redemptions, reversed, budget used/remaining, per-customer distribution, Hatly net | = consumption sums | P N |
| CPN-09 | GET `/admin/offers/:id/consumptions?cursor` | NEW | MARKETING_VIEW | keyset incl. reversed flag | | P M |
| CPN-10 | POST `/admin/offers/:id/grants` | NEW | MANAGE_OFFERS | `{customerIds≤500 | audienceId,expiresAt?}` **I** | | P V A+ I |
| CPN-11 | GET `/admin/offers/:id/grants` / DELETE `…/grants/:grantId` | NEW | MANAGE_OFFERS | revoke only if unredeemed | | P A |
| CPN-12 | POST `/admin/campaigns` | NEW | MANAGE_CAMPAIGNS | `{nameEn,nameAr,startsAt,endsAt,audienceId?}` | | P V A |
| CPN-13 | GET `/admin/campaigns` | NEW | MARKETING_VIEW | | | P B |
| CPN-14 | GET `/admin/campaigns/:id` | NEW | MARKETING_VIEW | with items & timeline | | P |
| CPN-15 | PATCH `/admin/campaigns/:id` | NEW | MANAGE_CAMPAIGNS | DRAFT only; edit after approval returns to DRAFT | optimistic `version` | P V A C |
| CPN-16 | PUT `/admin/campaigns/:id/items` | NEW | MANAGE_CAMPAIGNS | `[{type,itemId,sortOrder}]` | windows consistent | P V A |
| CPN-17 | POST `/admin/campaigns/:id/submit` | NEW | MANAGE_CAMPAIGNS | **I** | | P A+ I |
| CPN-18 | POST `/admin/campaigns/:id/approve` | NEW | CAMPAIGN_APPROVE | **I** | four-eyes | P A+ I |
| CPN-19 | POST `/admin/campaigns/:id/reject` | NEW | CAMPAIGN_APPROVE | `{reason}` | | P V A+ |
| CPN-20 | POST `/admin/campaigns/:id/cancel` | NEW | MANAGE_CAMPAIGNS | **I** | deactivates items started | P A+ I N |
| CPN-21 | GET `/admin/campaigns/:id/performance` | NEW | MARKETING_VIEW | | | P N |
| CPN-22 | GET `/admin/campaigns/:id/timeline` | NEW | MARKETING_VIEW | | | P |

### 2.12 Module 12 — Reports & Analytics (RPT)
| ID | Method · Path | Status | Permission | Request → Response | Rules | Tests |
|---|---|---|---|---|---|---|
| RPT-01 | GET `/admin/reports` | NEW | VIEW_REPORTS | catalogue filtered by caller permissions | | P |
| RPT-02 | GET `/admin/reports/:id` | NEW | per report V | definition: parameters schema, columns (with PII/financial flags the caller may see), formats allowed | | P |
| RPT-03 | POST `/admin/reports/:id/run` | NEW | per report V | `{params,sort,page,pageSize≤200}` → `{columns,rows,totals,rowCount,reconciliation?}` | statement timeout; masking; row cap 200 | P V M B N |
| RPT-04 | POST `/admin/reports/:id/exports` | NEW | per report V + X | `{params,format,locale,includeMinor}` **I** → `{exportId,status}` | `exportRequest` limit; size estimate returns 413-style `EXPORT_TOO_LARGE` for XLSX/PDF over caps | P V A+ I B |
| RPT-05 | GET `/admin/exports?mine&status&report&cursor` | NEW | authenticated + per-export V | | others' exports need AUDIT_EXPORT + report V | P X |
| RPT-06 | GET `/admin/exports/:id` | NEW | requester or AUDIT_EXPORT | status, progress, rows, size, expiry | | P X |
| RPT-07 | GET `/admin/exports/:id/download` | NEW | requester (or AUDIT_EXPORT) **and** X re-checked | file stream / signed URL | `no-store`, `attachment`, `nosniff`; expired → 410 `EXPORT_EXPIRED`; audit each download | P A+ X |
| RPT-08 | POST `/admin/exports/:id/cancel` | NEW | requester | | cooperative cancel | P A+ C |
| RPT-09 | DELETE `/admin/exports/:id` | NEW | requester | marks EXPIRED, deletes object | | P A+ |
| RPT-10 | GET/POST `/admin/saved-reports` | NEW | per report V | named parameter sets | | P V X |
| RPT-11 | PATCH `/admin/saved-reports/:id` | NEW | owner | | | P X |
| RPT-12 | DELETE `/admin/saved-reports/:id` | NEW | owner | | | P X |
| RPT-13 | POST `/admin/saved-reports/:id/share` | NEW | owner + module update permission | | recipients must hold V | P V A |
| RPT-14 | POST `/admin/report-schedules` | NEW | per report V + X | `{reportId,params,format,cron-like: daily|weekly|monthly,time(Cairo)}` | delivery in-app; max 10 per user | P V A+ |
| RPT-15 | GET `/admin/report-schedules` | NEW | owner | | | P X |
| RPT-16 | PATCH `/admin/report-schedules/:id` | NEW | owner | pause/resume/edit | | P A |
| RPT-17 | DELETE `/admin/report-schedules/:id` | NEW | owner | | | P A |

### 2.13 Module 13 — Media (MED)
| ID | Method · Path | Status | Permission | Request → Response | Rules | Tests |
|---|---|---|---|---|---|---|
| MED-01 | POST `/admin/media/uploads` (multipart `file`, fields `purpose`,`crop?`,`altEn?`,`altAr?`) | NEW | purpose permission (MS §6.3) | → asset (MS §6.2 step 11) | limit 5 MB streamed; pipeline MS §6.2; rate limit `mediaUpload`; dedupe by sha256 → `deduplicated:true` | P V A+ N X B |
| MED-02 | GET `/admin/media?purpose&status&used&uploader&q&from&to&sort&cursor` | NEW | MEDIA_VIEW | keyset library | thumbs only in list | P B |
| MED-03 | GET `/admin/media/:id` | NEW | MEDIA_VIEW | asset + variants + usage count | | P |
| MED-04 | PATCH `/admin/media/:id` | NEW | MANAGE_MEDIA | `{altEn,altAr,tags}` | | P V A |
| MED-05 | GET `/admin/media/:id/usage` | NEW | MEDIA_VIEW | references list + snapshot count | | P N |
| MED-06 | DELETE `/admin/media/:id` | NEW | MEDIA_DELETE | soft delete | 409 `MEDIA_IN_USE` with references; DB FK guarantees | P A+ N C |
| MED-07 | POST `/admin/media/:id/replace` (multipart) | NEW | MEDIA_DELETE + MANAGE_MEDIA | `{confirmUsageCount}` **I** | transactional re-point of all references; old asset soft-deleted | P V A+ I N C |
| MED-08 | POST `/admin/media/:id/recrop` | NEW | MANAGE_MEDIA | `{crop,purpose?}` → new asset | needs retained source: only when `MEDIA_KEEP_ORIGINAL=true` or from `display` variant (lower quality warning) | P V A+ N |
| MED-09 | POST `/admin/media/:id/restore` | NEW | MEDIA_DELETE | within retention | | P A+ |
| MED-10 | GET `/admin/media/stats` | NEW | MEDIA_VIEW | counts, bytes, unreferenced | | P |
| MED-11 | POST `/admin/media/purge-unreferenced` | NEW | MEDIA_DELETE | `{dryRun=true}` → job | | P A+ N |
| MED-12 | POST `/admin/media/backfill` | NEW | SUPER_ADMIN | → job | resumable, idempotent | P A+ N |
| MED-13 | GET `/media/*` (serving; existing static/private-media redirect) | REUSE | public or signed | | immutable cache headers on content-addressed keys | B (headers) |

### 2.14 Module 14 — Admin Users, RBAC & Audit (IAM)
| ID | Method · Path | Status | Permission | Request → Response | Rules | Tests |
|---|---|---|---|---|---|---|
| IAM-01 | GET `/admin/users`ᵛ | REUSE/EXTEND | SUPER_ADMIN | filters, pagination | | P |
| IAM-02 | POST `/admin/users`ᵛ | REUSE/verify | SUPER_ADMIN | create admin | existing path confirmed at WS-10 | P V A+ |
| IAM-03 | PATCH `/admin/users/:id`ᵛ | REUSE/verify | SUPER_ADMIN | | cannot demote last SUPER_ADMIN/self | P V A C |
| IAM-04 | PATCH `/admin/users/:id/activate|deactivate`ᵛ | REUSE/verify | SUPER_ADMIN | | revokes sessions; last-super-admin guard | P A+ C |
| IAM-05 | GET `/admin/users/:userId/permissions` | REUSE | SUPER_ADMIN | | | P |
| IAM-06 | POST `/admin/users/:userId/permissions` | REUSE | SUPER_ADMIN | `{permission}` or `{permissions[]}` | before/after in audit | P V A+ |
| IAM-07 | DELETE `/admin/users/:userId/permissions/:permission` | REUSE | SUPER_ADMIN | | | P A+ |
| IAM-08 | GET `/admin/permissions` | EXTEND | SUPER_ADMIN | catalogue with group/label/danger/flag | single registry | P |
| IAM-09 | DELETE `/auth/mfa` (own) | REUSE | self | | | P A |
| IAM-10 | DELETE `/admin/users/:id/mfa` | REUSE | SUPER_ADMIN | `{reason≥10,confirm}` | revokes refresh tokens; forces re-enrolment | P V A+ N |
| IAM-11 | GET `/admin/permission-templates` | NEW | SUPER_ADMIN | | | P |
| IAM-12 | POST `/admin/permission-templates` | NEW | SUPER_ADMIN | custom | ⊆ catalogue | P V A+ |
| IAM-13 | PATCH `/admin/permission-templates/:id` | NEW | SUPER_ADMIN | custom only | system templates immutable (409) | P V A+ |
| IAM-14 | DELETE `/admin/permission-templates/:id` | NEW | SUPER_ADMIN | custom only | | P A+ |
| IAM-15 | POST `/admin/users/:userId/apply-template` | NEW | SUPER_ADMIN | `{templateId,mode: ADD|REPLACE}` **I** | copy semantics; diff in audit | P V A+ I |
| IAM-16 | GET `/admin/audit-logs` | EXTEND | VIEW_AUDIT_LOG | + filters actor/action/target/outcome/date, keyset | | P B |
| IAM-17 | GET `/admin/audit-logs/entity/:type/:id` | NEW | VIEW_AUDIT_LOG | | | P |
| IAM-18 | audit export — via RPT S21 | NEW | VIEW_AUDIT_LOG + AUDIT_EXPORT | | | P A+ |
| IAM-19 | GET `/admin/users/:id/sessions` | NEW | SUPER_ADMIN | active refresh-token families (no token values) | | P |
| IAM-20 | DELETE `/admin/sessions/:id` | NEW | SUPER_ADMIN | | | P A+ |
| IAM-21 | POST `/admin/users/:id/force-logout` | NEW | SUPER_ADMIN | **I** | | P A+ I |

### 2.15 Module 15 — System Monitoring (SYS)
| ID | Method · Path | Status | Permission | Request → Response | Rules | Tests |
|---|---|---|---|---|---|---|
| SYS-00 | GET `/health`, `/health/ready` | REUSE | public | existing | unchanged | existing |
| SYS-01 | GET `/admin/system/overview` | NEW | VIEW_SYSTEM_HEALTH | tiles: status, last check, latency | UNKNOWN when stale | P N |
| SYS-02 | GET `/admin/system/integrations` | NEW | VIEW_SYSTEM_HEALTH | per integration: configured, status, latency, lastError(masked) | DISABLED when unconfigured | P N |
| SYS-03 | POST `/admin/system/integrations/:key/check` | NEW | MANAGE_SYSTEM_JOBS | → fresh result | `integrationCheck` limit; read-only deep check; never sends paid messages | P A+ B |
| SYS-04 | GET `/admin/system/metrics/requests?from&to&group` | NEW | VIEW_SYSTEM_HEALTH | rate, error rate, P50/P95/P99 by route group | route patterns only | P N |
| SYS-05 | GET `/admin/system/metrics/database-cache` | NEW | VIEW_SYSTEM_HEALTH | pool, slow-query count, migrations status, Redis/circuit, cache hit ratios | | P N |
| SYS-06 | GET `/admin/system/metrics/client?app&platform&deviceClass&network&version&from&to` | NEW | VIEW_SYSTEM_HEALTH | aggregated client telemetry (Release-tagged only by default) | min sample size 20 else "no data" | P N |
| SYS-07 | GET `/admin/system/jobs?type&status&cursor` | NEW | VIEW_SYSTEM_HEALTH | | | P |
| SYS-08 | GET `/admin/system/jobs/:id` | NEW | VIEW_SYSTEM_HEALTH | | no payload secrets | P |
| SYS-09 | POST `/admin/system/jobs/:id/retry` | NEW | MANAGE_SYSTEM_JOBS | **I** | FAILED idempotent types only | P A+ I |
| SYS-10 | POST `/admin/system/jobs/:id/cancel` | NEW | MANAGE_SYSTEM_JOBS | **I** | | P A+ I |
| SYS-11 | GET `/admin/system/errors?from&to` | NEW | VIEW_SYSTEM_HEALTH | top error codes/route groups | no payloads | P |
| SYS-12 | POST `/telemetry/client-metrics` | NEW | public + `telemetryIngest` | MS §11.2 payload → 202 | ≤ 4 KB; whitelist keys; scrub; sampling returned via PERF-07 | V B (abuse tests) |
| SYS-13 | GET `/admin/system/alert-rules` | NEW | VIEW_SYSTEM_HEALTH | thresholds (edit via CFG settings) | | P |

### 2.16 Module 16 — Platform Configuration (CFG)
| ID | Method · Path | Status | Permission | Request → Response | Rules | Tests |
|---|---|---|---|---|---|---|
| CFG-01 | GET `/admin/business-config` | EXTEND | MANAGE_BUSINESS_CONFIG / CONFIG_VIEW | all keys with schema metadata and effective value | sensitive masked | P M |
| CFG-02 | GET `/admin/business-config/:key` | REUSE | same | | | P |
| CFG-03 | PUT `/admin/business-config/:key` | REUSE | MANAGE_BUSINESS_CONFIG | `{value,reason?}` | validated by schema registry; reason required for financial keys | P V A+ |
| CFG-04 | DELETE `/admin/business-config/:key` | REUSE | same | reset to default | | P A |
| CFG-05 | GET `/admin/business-config/:key/history` | NEW | same | audit-derived before/after (masked if sensitive) | | P M |
| CFG-06 | GET `/admin/business-config/schema` | NEW | CONFIG_VIEW or MANAGE | typed metadata | | P |
| CFG-07 | GET/PUT `/admin/hatly-service-pricing-config` | REUSE | MANAGE_HATLY_SERVICE_PRICING | | | P V A |
| CFG-08 | delivery zones: GET list/id, POST, PATCH, PATCH delivery-fee, PATCH activate/deactivate (`/admin/delivery-zones…`, 7 routes) | REUSE | MANAGE_SERVICE_AREAS / MANAGE_DELIVERY_FEE_MULTIPLIER | | | P A |
| CFG-09 | service areas: GET list/id, POST, PATCH, activate/deactivate (`/admin/service-areas…`, 6 routes) | REUSE | MANAGE_SERVICE_AREAS | | | P A |
| CFG-10 | GET `/hatly-service/route-defaults` (+ admin edit via CFG-03 keys) | REUSE | public / MANAGE_BUSINESS_CONFIG | | | P |
| CFG-11 | GET `/admin/feature-flags` / PUT `/admin/feature-flags/:key` | NEW (thin wrapper over CFG) | MANAGE_BUSINESS_CONFIG | | flags listed in MS §3.9 | P V A+ |
| CFG-12 | GET `/config/client` | NEW | public, cached 60 s | `{telemetrySampleRate, featureFlags (public ones)}` | no secrets | V B |

### 2.17 Performance cross-cutting endpoints/behaviours (PERF)
| ID | Method · Path / behaviour | Status | Permission | Contract | Tests |
|---|---|---|---|---|---|
| PERF-01 | `Server-Timing` on all responses | NEW (interceptor) | n/a | MS §11.1 | B |
| PERF-02 | Public catalog `Cache-Control` + `ETag` on `/sectors`, `/sectors/:id/subcategories`, `/home-banners`, `/home/product-sections`, `/vendors`, `/vendor-branches/:id`, `…/categories`, `…/products`, `/products`, `/catalog-products/:id`, `/delivery-zones` | EXTEND | public | `Cache-Control: public, max-age=PUBLIC_CATALOG_CACHE_SECONDS, stale-while-revalidate=PUBLIC_CATALOG_SWR_SECONDS`; `ETag` strong from body hash; `If-None-Match` → 304; `Vary: Accept-Language, Accept-Encoding`; requests with `Authorization` that change the response (personalised favourites flags etc.) get `private, no-cache` — the personalised fields are verified per endpoint at WS-P1 and personalised endpoints keep `no-store` | P(B) header contract, N 304 |
| PERF-03 | GET `/vendor/orders/changes?since=<cursor>` | NEW | vendor roles (own branch) | `{cursor,newOrderIds[],changedSegmentIds[]}`; ETag/304; ≤ 1 kB when empty | P X B |
| PERF-04 | GET `/driver/deliveries` conditional (ETag/304) | EXTEND | driver | additive | P B |
| PERF-05 | POST `/driver/location/batch` | NEW | driver | `{points:[{lat,lng,at,accuracy}]≤20}` → 202; ignores points older than 10 min; monotonic time check | P V B X |
| PERF-06 | `POST /telemetry/client-metrics` | = SYS-12 | | | |
| PERF-07 | `GET /config/client` | = CFG-12 | | | |
| PERF-08 | Customer API additive image fields: `thumbnailUrl` (vendors, products, sectors, banners, subcategories), `images[]` (product detail) | EXTEND | public | contract tests assert old fields unchanged | P(contract) |
| PERF-09 | Chaos switches (staging only) | NEW (env-guarded) | n/a | refuse to enable when `NODE_ENV=production` or production DB host pattern | U |

---
## 3. Data model plan

**Conventions.** Primary keys `uuid` (same generator as existing entities); timestamps `timestamptz` (`created_at` default now(), `updated_at` where mutable); money `bigint` minor units with `CHECK (… >= 0)` unless signed by design; enums as `varchar` + `CHECK (… IN (…))` (matches the existing migration style; adding a value is a one-line additive migration); foreign keys named `FK_<table>_<column>`, indexes `IDX_`/`UQ_`; all new tables get a down migration that drops them (data loss on down is acceptable only for tables created in the same release; documented). Retention is enforced by jobs named in §3.4. "Backfill" = data movement for pre-existing rows.

### 3.1 New tables

| Table | Columns (type, constraints) | Keys & indexes | Lifecycle | Retention | Owner WS |
|---|---|---|---|---|---|
| `background_jobs` | id; type varchar(40); status varchar(12) CHECK in QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELLED/EXPIRED; payload jsonb; result jsonb null; progress smallint 0–100; attempts int; max_attempts int; run_after timestamptz; locked_by varchar(64) null; locked_at null; heartbeat_at null; requested_by_user_id uuid null FK users; cancel_requested bool; error_code varchar(40) null; error_message varchar(300) null; created_at; finished_at null; expires_at null | PK; `IDX_jobs_claim (status, run_after) WHERE status='QUEUED'`; `IDX_jobs_type_status_created (type,status,created_at)`; `IDX_jobs_requested_by (requested_by_user_id, created_at)` | QUEUED→RUNNING→SUCCEEDED/FAILED/CANCELLED; stale RUNNING requeued by heartbeat timeout | rows 90 days after `finished_at`; payload/result of expired exports cleared | WS-1 |
| `idempotency_keys` | scope varchar(40); key varchar(128); request_hash char(64); response_ref varchar(80) null; status_code smallint null; created_at; expires_at | PK (scope,key); `IDX_idem_expires (expires_at)` | write on first use, replay returns ref | purge expired every hour | WS-1 |
| `saved_views` | id; owner_user_id FK; scope CHECK PRIVATE/SHARED; table_id varchar(60); name varchar(80); filters jsonb; sort varchar(60) null; columns jsonb null; created_at; updated_at | `UQ_saved_views_owner_table_name (owner_user_id, table_id, name)`; `IDX_saved_views_table (table_id, scope)` | CRUD | until deleted; removed with the owner user | WS-2/WS-6 |
| `alert_acknowledgements` | alert_key varchar(120); acknowledged_by FK users; note varchar(300) null; acknowledged_at | PK (alert_key, acknowledged_by); `IDX_alert_ack_key (alert_key)` | upsert | 90 days | WS-6 |
| `order_notes` | id; order_id FK orders; author_user_id FK; body varchar(1000); created_at | `IDX_order_notes_order (order_id, created_at)` | append-only | life of order | WS-6 |
| `customer_notes` | id; customer_user_id FK; author_user_id FK; body varchar(1000); created_at | `IDX_customer_notes_customer (customer_user_id, created_at)` | append-only | life of customer; anonymized with account deletion (author kept, body retained only if the deletion policy allows — follows the existing deletion process) | WS-9 |
| `wallet_adjustments` | id; customer_user_id FK; amount_minor bigint CHECK <> 0; reason_code varchar(30); note varchar(300) null; status CHECK PENDING/APPROVED/REJECTED/APPLIED; requested_by FK; decided_by FK null; decided_at null; wallet_transaction_id FK null; idempotency_key varchar(128) UNIQUE; created_at | `IDX_walladj_status (status, created_at)`; `IDX_walladj_customer (customer_user_id, created_at)`; CHECK `decided_by IS NULL OR decided_by <> requested_by` | PENDING→APPROVED→APPLIED, or REJECTED; auto-APPLIED path when below threshold | permanent (financial) | WS-9 |
| `media_assets` | id; purpose varchar(30); status CHECK ACTIVE/DELETED; original_name varchar(255) null (display only, sanitized); mime_type varchar(40); bytes int; width smallint; height smallint; sha256 char(64); alt_en varchar(200) null; alt_ar varchar(200) null; tags text[]; uploaded_by FK users; created_at; deleted_at null; deleted_by null; legacy_source_url text null | PK; `UQ_media_sha_active (sha256) WHERE status='ACTIVE'`; `IDX_media_library (status, purpose, created_at desc)`; `IDX_media_uploader (uploaded_by, created_at)`; GIN on tags | upload→ACTIVE→DELETED(soft)→purged | DELETED rows' binaries purged after `MEDIA_RETENTION_DAYS`; metadata row kept (status `PURGED` flag via `purged_at`) | WS-3 |
| `media_variants` | id; asset_id FK media_assets ON DELETE CASCADE; name CHECK DISPLAY/THUMB/ORIGINAL; storage_key varchar(300); width; height; bytes; mime_type | `UQ_media_variant (asset_id, name)`; `UQ_media_variant_key (storage_key)` | created with asset | with asset binary purge | WS-3 |
| `product_media` | id; product_id FK products ON DELETE CASCADE; media_asset_id FK media_assets ON DELETE RESTRICT; sort_order smallint; is_primary bool | `UQ_product_media_primary (product_id) WHERE is_primary`; `UQ_product_media_order (product_id, sort_order)`; `UQ_product_media_asset (product_id, media_asset_id)`; `IDX_product_media_asset (media_asset_id)` | replaced as a set by CAT-11 | with product | WS-3/WS-7 |
| `report_exports` | id; report_id varchar(40); params jsonb; params_hash char(64); format CHECK CSV/XLSX/PDF; locale CHECK ar/en; include_minor bool; status CHECK QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELLED/EXPIRED; job_id FK background_jobs null; requested_by FK; row_count int null; file_bytes bigint null; storage_key varchar(300) null; checksum_sha256 char(64) null; error_code varchar(40) null; created_at; started_at; finished_at; expires_at; last_downloaded_at null; download_count int default 0; source_schedule_id uuid null | `IDX_exports_user (requested_by, created_at desc)`; `IDX_exports_status (status, expires_at)` | per MS §7.5 | files `EXPORT_RETENTION_HOURS` (72 h); metadata 12 months | WS-4 |
| `saved_reports` | id; owner_user_id; report_id; name varchar(80); params jsonb; shared_with_permission varchar(40) null; created_at; updated_at | `UQ_saved_reports (owner_user_id, report_id, name)` | CRUD | until deleted | WS-4 |
| `report_schedules` | id; owner_user_id; report_id; params jsonb; format; locale; frequency CHECK DAILY/WEEKLY/MONTHLY; run_at_local time; weekday smallint null; day_of_month smallint null; status CHECK ACTIVE/PAUSED; last_run_at; next_run_at; created_at | `IDX_sched_next (status, next_run_at)` | scheduler job creates `report_exports` rows | until deleted; auto-paused if owner loses permission | WS-4 |
| `settlement_payments` | id; party_type CHECK VENDOR/DRIVER; period_id uuid (FK to the matching period table enforced by two nullable FK columns `vendor_period_id`, `driver_period_id` with CHECK exactly one non-null); direction CHECK PAYOUT/COLLECTION; amount_minor bigint CHECK > 0; method varchar(30); reference varchar(120); paid_on date (Cairo); status CHECK RECORDED/VOIDED; recorded_by FK; voided_by FK null; voided_at null; void_reason varchar(300) null; idempotency_key varchar(128) UNIQUE; approval_status CHECK NONE/PENDING/APPROVED/REJECTED; approved_by null; created_at | `IDX_setpay_vendor (vendor_period_id, status)`; `IDX_setpay_driver (driver_period_id, status)`; `IDX_setpay_paid_on (paid_on)` | RECORDED→VOIDED (once) | permanent (financial) | WS-5 |
| `permission_templates` | id; key varchar(40) UNIQUE; name_en; name_ar; is_system bool; permissions text[]; created_by null; updated_at | PK; unique key | system rows upserted at startup; custom CRUD | permanent | WS-1 |
| `audiences` | id; name varchar(80); rules jsonb; created_by; created_at; updated_at; archived_at null | `IDX_audiences_created (created_at)` | CRUD; archived not deleted when referenced | permanent | WS-9 |
| `notification_broadcasts` | id; campaign_id uuid null; title_en/title_ar varchar(60); body_en/body_ar varchar(240); deep_link varchar(200) null; audience_id FK; channels text[]; status CHECK (MS §10.2); scheduled_at null; created_by; approved_by null; approved_at null; rejection_reason null; started_at; finished_at; version int; created_at | `IDX_bc_status (status, scheduled_at)`; CHECK `approved_by IS NULL OR approved_by <> created_by` | per MS §10.2 | 24 months | WS-9 |
| `broadcast_recipients` | id; broadcast_id FK; customer_user_id FK; status CHECK PENDING/SENDING/SENT/FAILED/SKIPPED_NO_TOKEN/SKIPPED_CAP/SKIPPED_OPTED_OUT; attempts smallint; last_error varchar(120) null; sent_at null | `UQ_bcr (broadcast_id, customer_user_id)`; `IDX_bcr_claim (broadcast_id, status)` | expansion → send | 90 days after completion (aggregate counts retained on the broadcast row) | WS-9 |
| `customer_inbox_messages` | id; customer_user_id FK; broadcast_id FK null; title_en/title_ar; body_en/body_ar; deep_link null; created_at; read_at null | `UQ_inbox (customer_user_id, broadcast_id) WHERE broadcast_id IS NOT NULL`; `IDX_inbox_customer (customer_user_id, created_at desc)`; `IDX_inbox_unread (customer_user_id) WHERE read_at IS NULL` | created at send | 12 months | WS-9 |
| `coupon_grants` | id; offer_id FK; customer_user_id FK; granted_by FK; granted_at; expires_at null; redeemed_at null; revoked_at null | `UQ_grant (offer_id, customer_user_id)`; `IDX_grant_customer (customer_user_id)` | grant→redeem/revoke/expire | with offer | WS-9 |
| `campaigns` | id; name_en/name_ar; status CHECK (MS §10.2); starts_at; ends_at; audience_id null; created_by; approved_by null; approved_at null; rejection_reason null; version int; created_at; updated_at | `IDX_campaigns_status (status, starts_at)`; CHECK four-eyes | per MS §10.2 | 24 months | WS-9 |
| `campaign_items` | campaign_id FK; item_type CHECK OFFER/BANNER/BROADCAST; item_id uuid; sort_order smallint | PK (campaign_id,item_type,item_id) | replaced as a set | with campaign | WS-9 |
| `campaign_events` | id; campaign_id FK; from_status; to_status; actor_user_id null (system); note varchar(300) null; at | `IDX_campev (campaign_id, at)` | append-only | with campaign | WS-9 |
| `system_metric_buckets` | bucket_start timestamptz; instance_id varchar(40); metric_key varchar(60); dims jsonb; count bigint; sum double precision; min double precision; max double precision; histogram jsonb | PK (bucket_start, instance_id, metric_key, dims_hash); `IDX_metrics_key_time (metric_key, bucket_start)` | upsert per flush; rollup job | 14 days @1 min; hourly rollups 90 days | WS-1 (foundation), WS-10 (pages) |
| `integration_checks` | id; key varchar(40); status CHECK OK/DEGRADED/DOWN/DISABLED/UNKNOWN; latency_ms int null; detail varchar(200) null; checked_at | `IDX_intchk (key, checked_at desc)` | one row per probe | 30 days (latest per key always kept) | WS-1 (table), WS-10 (probes, pages) |

### 3.2 Altered tables (all additive, nullable or defaulted; old code unaffected)
| Table | Change | Backfill |
|---|---|---|
| `vendors` | `logo_media_asset_id uuid null FK media_assets ON DELETE RESTRICT` | legacy registration job (§3.5) |
| `vendor_branches` | `cover_media_asset_id uuid null FK RESTRICT` | none (no cover today) |
| `marketplace_sectors`, `marketplace_subcategories`, `home_banners`, `products`, `catalog_products` | `media_asset_id uuid null FK RESTRICT` (index `IDX_<table>_media_asset`) | legacy registration job |
| `products` | `low_stock_threshold int null CHECK >= 0` | none |
| vendor settlement period table | `net_payable_minor bigint null` | deterministic SQL for CLOSED periods = `gross_sales_minor − total_commission_owed_minor`; OPEN periods stay null until close (close writes it); verified by test; flagged `provisional` in API until U-01 |
| `offers` | `audience_id uuid null FK audiences`, `created_by uuid null FK users` | none |
| `ratings` | `hidden_at timestamptz null`, `hidden_by uuid null`, `hidden_reason varchar(300) null` (**decision:** columns on `ratings`, not a separate table); denormalized counters recomputed in the same transaction on hide/unhide | none |
| `admin_audit_logs` | verify `target_type`, `target_id`; if absent add nullable columns + `IDX_audit_target (target_type, target_id, created_at)`; historical rows not rewritten (best-effort parse of route ids into `target_*` is **not** done; history for entities starts at deployment, stated in the UI as "recorded from <date>") | none |
| `users` | none (`is_active` exists); index `(created_at)` | — |
| `customer_notifications` | none (stays order-bound) | — |

### 3.3 Index plan (additive; all created with `CREATE INDEX CONCURRENTLY IF NOT EXISTS` in non-transactional migrations; each justified by EXPLAIN on the acceptance dataset — an unjustified index is dropped from the migration, MS §7.7)
| Table | Index | Serves |
|---|---|---|
| `orders` | `(created_at)`, `(status, created_at)`, `(vendor_branch_id, created_at)`, `(customer_id, created_at)` | ORD-01, S02, S04, CT-05, CUS-03 |
| `orders` | trigram `(order_number gin_trgm_ops)` — only if `pg_trgm` is available (checked in migration; absent → skipped, prefix search only) | suffix search |
| `order_vendor_segments` | `(vendor_branch_id, created_at)`, `(status, updated_at)` | VND-15, alerts |
| `financial_events` | `(created_at)`, `(type, created_at)`, `(vendor_branch_id, created_at)`, `(driver_id, created_at)` if the column exists | FIN-01…06, S09, S10 |
| `payments` | `(created_at)`, `(status, created_at)` | PAY-07, S16 |
| `refund_payouts` | `(created_at)` | PAY-09 |
| `deliveries` | `(driver_id, created_at)`, `(delivered_at)` | FLT-10…12, S08, S14 |
| `offer_consumptions` | `(offer_id, created_at)`, `(customer_user_id, created_at)` | CPN-08/09, CUS-20 |
| `wallet_transactions` | `(customer_id, created_at)`, `(type, created_at)` | CUS-04, S23 |
| `loyalty_transactions` | `(customer_id, created_at)` | CUS-05 |
| `admin_audit_logs` | `(created_at)`, `(actor_user_id, created_at)`, `(target_type, target_id, created_at)` | IAM-16/17 |
| `ratings` | `(target_type, target_id, created_at)` if not present | CUS-15 |
| Performance-phase indexes | determined by WS-P0 EXPLAIN verdicts (e.g., vendor listing, product listing by branch/category/active, best-selling aggregation support) — each added in migration M-77 with the before/after plan attached | P1-3 |

### 3.4 Retention and purge jobs
`EXPORT_FILE_PURGE` (hourly), `MEDIA_PURGE` (daily), `idempotency` purge (hourly), `METRIC_ROLLUP` (hourly) + raw purge (daily), jobs table purge (daily), integration-check purge (daily), `broadcast_recipients` purge (daily). All idempotent, batched (1,000 rows), logged as business events with counts.

### 3.5 Migration plan (ordered; each additive and reversible; exact class names/timestamps assigned at creation, ordering is the contract)
| Seq | Name | Content | Transactional | Owner WS | Down |
|---|---|---|---|---|---|
| M-66 | `JobsAndIdempotency` | `background_jobs`, `idempotency_keys`, `saved_views` | yes | WS-1 | drop tables |
| M-67 | `ReportingIndexes` | order/financial/payment/delivery/offer/wallet/loyalty/audit/users indexes (§3.3) | **no** (`CONCURRENTLY`) | WS-1 | drop indexes |
| M-68 | `PermissionTemplates` | `permission_templates` + system template seed (idempotent upsert) | yes | WS-1 | drop |
| M-69 | `SystemMetrics` | `system_metric_buckets`, `integration_checks` | yes | WS-1 | drop |
| M-70 | `MediaPlatform` | `media_assets`, `media_variants`, `product_media`, `*_media_asset_id` columns + indexes | yes | WS-3 | drop columns then tables |
| M-71 | `ReportExports` | `report_exports`, `saved_reports`, `report_schedules` | yes | WS-4 | drop |
| M-72 | `SettlementPayments` | `settlement_payments`, `net_payable_minor` + deterministic backfill | yes | WS-5 | drop (column drop only if untouched by later writes — documented) |
| M-73 | `OrderCustomerNotesAdjustments` | `order_notes`, `customer_notes`, `wallet_adjustments`, `ratings.hidden_*`, `alert_acknowledgements` | yes | WS-6/WS-9 | drop |
| M-74 | `CatalogInventory` | `products.low_stock_threshold` | yes | WS-7 | drop column |
| M-75 | `MarketingCampaigns` | `audiences`, `notification_broadcasts`, `broadcast_recipients`, `customer_inbox_messages`, `coupon_grants`, `campaigns`, `campaign_items`, `campaign_events`, `offers.audience_id/created_by` | yes | WS-9 | drop |
| M-76 | `AuditTargets` | `admin_audit_logs` target columns/index (only if absent) | no (index) | WS-1 | drop index/columns |
| M-77 | `PerformanceIndexes` | indexes proven by WS-P0 (§3.3 last row) | **no** | WS-P1 | drop indexes |
Rules for every migration: verified `up`/`down` on a disposable database; old application code verified against the new schema (backward-compat test); no data deletion; `CONCURRENTLY` index creation checks for `INVALID` leftovers and retries; applied to Production **only** in a separately authorised deployment following the existing `prod.sh plan/backup/migrate` procedure (not part of this specification).

### 3.6 Backfills
| ID | What | Method | Idempotent | Verification |
|---|---|---|---|---|
| B-1 | Legacy images → `media_assets` (+variants beside originals) | `MEDIA_VARIANT_BACKFILL` job (resumable, batch 100); never modifies `*_url`; unreadable objects marked `LEGACY_UNREADABLE` | yes (`legacy_source_url` unique) | counts: every non-null `*_url` has an asset or an `LEGACY_UNREADABLE` record |
| B-2 | `net_payable_minor` for CLOSED vendor periods | SQL in M-72 | yes | test: = gross − commission for all closed |
| B-3 | System permission templates | startup upsert | yes | e2e |
| B-4 | `products.media_asset_id` etc. | covered by B-1 (FK set only by Admin saves; the backfill may set the FK when an asset is created for the same URL **and** the entity's URL equals the original) | yes | integration |
| B-5 | None for audit history (see §3.2) | — | — | UI shows "recorded from" |

### 3.7 Compatibility and deprecation
* **No endpoint, response field, enum value or column is removed.** Deprecated (still accepted): `imageUrl`/`logoUrl` write fields, `POST /admin/vendors/:id/logo`, `POST /admin/home-banners/:id/image`, vendor product image upload (re-implemented on the media pipeline, same URL contract).
* Customer/Driver API: only additive fields (`thumbnailUrl`, `images[]`, inbox endpoints, new headers). Contract snapshot tests of the pre-change responses must stay green.
* Old Customer/Driver builds on the new backend and new builds on the old backend (404 fallbacks for aggregate/inbox/batch-location) are tested pairs.
* Permission enum names unchanged; new names only added; `VIEW_REPORTS`, `VIEW_VENDOR_FINANCIAL_REPORTS`, `VIEW_DRIVER_SETTLEMENTS` become enforced — an e2e test documents which routes newly require them and Release notes list the grants to make before enabling the pages.

### 3.8 Data-protection notes
Exports and audit metadata never store raw PII beyond what the viewer is entitled to; `customer_notes`/`order_notes` are staff-only; `customer_inbox_messages` isolated per customer; `system_metric_buckets` contain no identifiers; media `original_name` is sanitized and never used in keys; account deletion follows the existing process and additionally removes inbox messages and anonymizes notes' author links only (notes body removal rule decided with the deletion policy owner — recorded as an open detail in WS-9, default: delete note bodies on account deletion).

---
*End of Final API and Data Model Plan.*

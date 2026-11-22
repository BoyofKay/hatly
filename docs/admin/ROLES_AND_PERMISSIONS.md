# Who does what — Hatly staff levels (owner decision 2026-11-22)

Four levels. Each level includes everything the level below it can do. The server enforces every row; hiding a button is only a convenience.
The presets are the recommended starting point — the super admin (or an admin, for the levels below) can still add or remove single permissions per person.

| Level | In one line |
|---|---|
| **Operations team** (فريق التشغيل) | Watches orders and acts on them; watches drivers and stores. |
| **Operations supervisor** (مشرف التشغيل) | + the day-to-day critical decisions: cancel, refund, driver shift closing, driver cash, open/close stores. |
| **Admin** (مدير) | + edit and delete records, store settlements and the monthly period closing. |
| **Super admin** (المدير العام) | Everything, including commissions, business settings, approvals and the audit trail. |

✓ = included in the level's preset. "—" = not included.

## Orders (daily operation)
| Action | Team | Supervisor | Admin | Super | Permission |
|---|:-:|:-:|:-:|:-:|---|
| See orders, the operations board, alerts | ✓ | ✓ | ✓ | ✓ | VIEW_ORDERS |
| Accept / prepare / ready **on a store's behalf**; unavailable items; work order exceptions | ✓ | ✓ | ✓ | ✓ | MANAGE_ORDER_FULFILMENT |
| Assign / reassign a driver | ✓ | ✓ | ✓ | ✓ | ASSIGN_REASSIGN_ORDERS |
| **Cancel an order**; failed-delivery decision and refund; order notes | — | ✓ | ✓ | ✓ | MANAGE_ORDER_ISSUES |
| Verify / reject a manual transfer; record a transfer refund as sent | — | ✓ | ✓ | ✓ | VERIFY_MANUAL_PAYMENTS |
| See customer phone / address in full | — | ✓ | ✓ | ✓ | VIEW_CUSTOMER_PII |
| Confirm a Hatly-service item price | — | — | — | ✓ | MANAGE_HATLY_SERVICE_PRICING |

## Drivers
| Action | Team | Supervisor | Admin | Super | Permission |
|---|:-:|:-:|:-:|:-:|---|
| Live fleet (where drivers are, who is online) | ✓ | ✓ | ✓ | ✓ | FLEET_VIEW |
| Put a driver online / offline | — | ✓ | ✓ | ✓ | CHANGE_DRIVER_ONLINE_STATUS |
| Override dispatch, change a driver's capacity | — | ✓ | ✓ | ✓ | OVERRIDE_DISPATCH |
| **Close a driver's shift** (Drivers today / Closing) | — | ✓ | ✓ | ✓ | CLOSE_DRIVER_SETTLEMENTS |
| **Driver cash in hand** — approve / reject a cash remainder | — | ✓ | ✓ | ✓ | MANAGE_CUSTOMER_WALLET |
| Create, edit, verify drivers; vehicle type | — | — | ✓ | ✓ | MANAGE_DRIVERS |
| Delete a driver | — | — | ✓ | ✓ | MANAGE_DRIVERS + DELETE_RECORDS |
| Driver commission rate | — | — | — | ✓ | MANAGE_DRIVER_COMMISSION |
| Automatic dispatch on / off | — | — | — | ✓ | MANAGE_BUSINESS_CONFIG |

## Stores and menus
| Action | Team | Supervisor | Admin | Super | Permission |
|---|:-:|:-:|:-:|:-:|---|
| See stores and menus | ✓ | ✓ | ✓ | ✓ | VENDORS_VIEW, CATALOG_VIEW |
| **Open / close a store** (also temporary closures) | — | ✓ | ✓ | ✓ | OPEN_CLOSE_VENDOR_BRANCHES |
| Create / edit stores and branches; activate / deactivate | — | — | ✓ | ✓ | MANAGE_VENDORS |
| Menu: products, categories, options, menu import, photos | — | — | ✓ | ✓ | MANAGE_CATALOG |
| Store staff accounts | — | — | ✓ | ✓ | MANAGE_VENDOR_STAFF |
| Sections, service areas, vehicle types; rename / order / activate delivery zones | — | — | ✓ | ✓ | MANAGE_MARKETPLACE_SECTORS, MANAGE_SERVICE_AREAS, MANAGE_VEHICLE_TYPES |
| **Delete** any of the above | — | — | ✓ | ✓ | the area permission **+ DELETE_RECORDS** |
| Commission rate, who accepts orders (acceptance mode) | — | — | — | ✓ | MANAGE_VENDOR_COMMISSION |
| Create a delivery zone, change a zone's fee | — | — | — | ✓ | MANAGE_SERVICE_AREAS + MANAGE_DELIVERY_FEE_MULTIPLIER |

## Money
| Action | Team | Supervisor | Admin | Super | Permission |
|---|:-:|:-:|:-:|:-:|---|
| Customer wallet adjustment — request | — | ✓ | ✓ | ✓ | MANAGE_CUSTOMER_WALLET |
| Customer wallet adjustment — approve (second person) | — | — | — | ✓ | WALLET_ADJUST_APPROVE |
| **Store settlement — period (monthly) closing** | — | — | ✓ | ✓ | CLOSE_VENDOR_SETTLEMENTS |
| **Store / driver settlement payments** (record, void) | — | — | ✓ | ✓ | MANAGE_SETTLEMENT_PAYMENTS |
| Approve a payment above the amount due | — | — | — | ✓ | APPROVE_SETTLEMENT_OVERPAYMENT |
| Ledger, revenue, receivables, reconciliation | — | — | ✓ | ✓ | VIEW_FINANCIALS, VIEW_VENDOR_FINANCIAL_REPORTS |
| Employee loans | — | — | — | ✓ | MANAGE_EMPLOYEE_LOANS |

## Customers, marketing, reports
| Action | Team | Supervisor | Admin | Super | Permission |
|---|:-:|:-:|:-:|:-:|---|
| See customers | ✓ | ✓ | ✓ | ✓ | VIEW_CUSTOMERS |
| Block / unblock a customer, staff notes | — | — | ✓ | ✓ | MANAGE_CUSTOMERS |
| Hide / show reviews | — | — | ✓ | ✓ | MODERATE_REVIEWS |
| Offers, home banners, media | — | — | ✓ | ✓ | MANAGE_OFFERS, MANAGE_HOME_BANNERS, MANAGE_MEDIA |
| Campaigns and broadcasts — create / approve | — | — | — | ✓ | MANAGE_CAMPAIGNS / CAMPAIGN_APPROVE, MANAGE_BROADCASTS / BROADCAST_APPROVE |
| Reports; order and fleet exports | — | ✓ | ✓ | ✓ | VIEW_REPORTS, ORDERS_EXPORT, FLEET_EXPORT |
| Catalog, report and finance exports | — | — | ✓ | ✓ | CATALOG_EXPORT, REPORTS_EXPORT, FINANCE_EXPORT |

## Reports, executive dashboard, financial reports
Every report checks its own permissions, and **money columns are hidden** from anyone without the financial permission (they see counts, not amounts).

| Page / report | Team | Supervisor | Admin | Super |
|---|:-:|:-:|:-:|:-:|
| Operations board, Home, order alerts | ✓ | ✓ | ✓ | ✓ |
| **Reports** — operations, sales, customers, catalog, fleet (counts) | — | ✓ | ✓ | ✓ |
| Same reports **with money amounts** (GMV, revenue, values) | — | — | ✓ | ✓ |
| **Executive dashboard** — KPIs, trends, SLA (counts) | — | ✓ | ✓ | ✓ |
| Executive dashboard **money KPIs** (GMV, revenue) | — | — | ✓ | ✓ |
| Driver settlement reports | — | ✓ | ✓ | ✓ |
| **Financial reports** — ledger, revenue, receivables, liabilities, reconciliation, finance report family | — | — | ✓ | ✓ |
| Store financial reports | — | — | ✓ | ✓ |
| Security / audit reports | — | — | — | ✓ |

Permissions behind it: reports and the executive dashboard need VIEW_REPORTS; money needs VIEW_FINANCIALS (store figures: VIEW_VENDOR_FINANCIAL_REPORTS; driver figures: VIEW_DRIVER_SETTLEMENTS); audit needs VIEW_AUDIT_LOG.

## Who creates whom (top-down only)
| Creator | Can create | Cannot create |
|---|---|---|
| **Super admin** | admins, supervisors, operations team; store staff; drivers | another super admin (only from the server setup) |
| **Admin** | supervisors, operations team; store staff; drivers | admins (same level), super admins |
| **Supervisor** | operations team | supervisors (same level) and above; store staff; drivers |
| **Operations team** | nobody | — |

The same rule applies to editing, resetting a password, deactivating and deleting a staff account: only accounts **below** your own level, never your own account, and only with permissions you hold yourself. Enforced by the server and covered by the e2e test `144-staff-accounts`.

## Staff and system
| Action | Team | Supervisor | Admin | Super | Permission |
|---|:-:|:-:|:-:|:-:|---|
| Change my own password | ✓ | ✓ | ✓ | ✓ | (everyone) |
| Create / edit / deactivate / reset password of staff **below** my level | — | ✓ (team) | ✓ (supervisors, team) | ✓ | MANAGE_STAFF_ACCOUNTS |
| Delete a staff account below my level | — | — | ✓ | ✓ | MANAGE_STAFF_ACCOUNTS + DELETE_RECORDS |
| Business settings, OTP switch | — | — | — | ✓ | MANAGE_BUSINESS_CONFIG |
| Audit log | — | — | — | ✓ | VIEW_AUDIT_LOG |
| Role templates, granting any permission to any admin | — | — | — | ✓ | super admin only |

### Notes
- Owner decisions 2026-11-22: keep **one** super admin (admins can do almost everything except security and audit); supervisors keep the executive dashboard **without money figures** while the owner tests it.
- "Refunds" for a cancelled or failed order are **recorded** by the supervisor; sending the money is done outside the system and then marked as sent.
- Two decisions from the earlier notes are still open and affect money rows above: the driver cash balance rule and the store net-payable rule.
- Source of truth: `apps/backend/src/modules/admin-platform/permission-templates/permission-templates.service.ts` (presets) and each endpoint's `@RequiresPermission`. The e2e test `144-staff-accounts` checks the split (team ⊂ supervisor ⊂ admin; cancel/refund/shift closing/driver cash at supervisor; edit/delete/store settlement at admin).

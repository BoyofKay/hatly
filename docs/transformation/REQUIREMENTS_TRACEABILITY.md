# Requirements traceability matrix

Status vocabulary: **VERIFIED** (implemented and tested), **IMPLEMENTED** (built, tests incomplete), **PARTIAL**, **DESIGNED** (specified, not built), **BLOCKED** (external dependency), **DECISION** (owner decision outstanding), **WITHDRAWN**.
Section numbers refer to the Transformation brief. Updated at the end of every slice; the "as of" line states which.

_As of: Slices 1–2 and the Command Center / Vendor Business Hub wave DEPLOYED to Production (2026-10-31). Vendor-side staff management, closures/holidays, inventory ledger and the financial centre remain open._

## Operations (brief §4, §6)

| ID | Requirement | App | Backend | DB | Permission | UI | Tests | Status |
|---|---|---|---|---|---|---|---|---|
| OPS-1 | Unified operations workspace with queues and counts | Admin | `admin-platform` (control-tower, alerts), exception queue | `order_exceptions` | VIEW_ORDERS | Operations Command Center (`/control-tower`) + `/exceptions` | Playwright control-tower 15 ×3, order-exceptions | **VERIFIED** (deployed); other queues keep their own pages |
| OPS-2 | Order side panel, assign/reassign, driver eligibility | Admin | `admin/orders/:id/assign-driver`, `reassign-driver`, drivers directory | – | ASSIGN_REASSIGN_ORDERS | partly | e2e + Playwright | PARTIAL → Slice 3 |
| OPS-3 | Internal notes, escalation, exception review | Admin | `order_notes`; exception notes / escalate / assign (`admin/order-exceptions/*`) | `order_exception_events` | MANAGE_ORDER_FULFILMENT | `/exceptions` case panel | e2e 125, Playwright `order-exceptions` | **VERIFIED** (Slice 1) |
| OPS-4 | Safe bulk operations (export, notes, assign when auto-dispatch OFF) | Admin | existing assign endpoint | – | ASSIGN_REASSIGN_ORDERS | Control Tower: CSV export of visible rows, selected-orders assign (auto-dispatch OFF only) | Playwright control-tower | PARTIAL — export + assign built; bulk notes not |
| OPS-5 | Search/filter incl. driver, exception, payment status, priority; no silent cap | Admin, Vendor | `admin/orders`, `vendor/orders` (500 cap) | indexes | VIEW_ORDERS | `/order-management` | e2e 96 | PARTIAL → Slices 3–4 |
| OPS-6 | Reliable live updates without wasteful polling (D-72) | Admin, Vendor | `vendor/orders/changes`, `admin/changes` | `change_events` + triggers | VIEW_ORDERS / vendor branch | vendor list + `/exceptions` | e2e 127 (10), unit 8, Playwright 4 | **VERIFIED** for the vendor list and exceptions queue; other admin lists still poll |
| OPS-7 | Keyboard shortcuts, search palette, saved views | Admin | – | browser storage | – | Control Tower: shortcuts + saved views (per browser); palette exists | Playwright | PARTIAL — Control Tower only; server-side saved views not wired |
| EXC-1 | Vendor (or Ops on behalf) marks item(s) unavailable for ONE order, own segment only | Vendor, Admin | `POST vendor/orders/segments/:id/unavailable-items`, `POST admin/orders/segments/:id/unavailable-items` | `order_exceptions`, `order_exception_items` | role + branch ownership / MANAGE_ORDER_FULFILMENT | vendor order page control | e2e 125 (authorization, join-same-case, on-behalf), Playwright | **VERIFIED** |
| EXC-2 | Customer chooses: continue without item(s) OR cancel entire order; no substitution | Customer | `GET orders/:id/item-unavailability`, `POST …/respond` | exception decision columns | customer owner | Customer app card (two answers, confirm before cancel) | e2e 125; Flutter 12 tests | **VERIFIED** locally; reaches customers only with a Customer release |
| EXC-3 | No response ≠ consent; Ops contacts customer and records decision | Admin | `POST admin/order-exceptions/:id/record-decision` | `order_exception_events` | MANAGE_ORDER_FULFILMENT (continue) / MANAGE_ORDER_ISSUES (cancel) | `/exceptions` | e2e 125, Playwright | **VERIFIED** |
| EXC-4 | Continue-without updates amounts per existing rules only (PD-002/003/004, C4); isolate unresolved cases | Backend | `OrderItemRemovalService` | `order_items.removed_*` | – | isolation reasons shown | e2e 125: COD, wallet (+race), Manual Transfer, multi-vendor, weighed, coupon, empty order | **VERIFIED** (isolated cases are reported, not guessed) |
| EXC-5 | Never offer "continue" if the order would become empty | Backend | `ORDER_WOULD_BE_EMPTY` isolation → Operations → existing cancellation | – | – | – | e2e 125 | **VERIFIED** |
| EXC-6 | Marking unavailable does not change catalogue availability/stock | Backend | restore util + readers skip removed items | – | – | – | e2e 125 (stock unchanged, weight gate, loyalty) | **VERIFIED** |
| EXC-9 | Every financially isolated case visible in the queue with reason, priority, responsible, next step; critical cases never hidden; no unsupported adjustment | Admin | `admin/order-exceptions` (+`isolated`, `resolve`) | `order_exceptions.isolation_*` | VIEW_ORDERS / MANAGE_ORDER_FULFILMENT | `/exceptions` | e2e 126, Playwright | **VERIFIED** |
| EXC-10 | Staff told of new/escalated/isolated cases; vendor staff when action is required | Admin, Vendor | `StaffAlertsService`, `request-vendor-action` | `staff_notifications`, `notification_preferences` | role + permission + branch | alerts bell | e2e 126 | **VERIFIED** (in-app; push only with a registered staff device) |
| EXC-7 | Delayed preparation: vendor reminder, Ops escalation, no customer spam, no invented ETA | Vendor, Admin | detector job, notifications | exception type DELAYED_PREPARATION | – | queue | – | DESIGNED → Slice 2/3 |
| EXC-8 | Product substitution | – | – | – | – | – | – | **WITHDRAWN** (D-77) |
| WGT-1 | Actual-weight difference settled per C4, no approval step | Backend | existing | – | – | – | e2e 80 | **VERIFIED** (D-76) |
| WGT-2 | Vendor-defined minimum weight and step; customer estimate | Vendor, Customer | product fields (new, defaulted) | product columns | MANAGE_CATALOG | Slice 5 | – | DESIGNED |

## Vendor (brief §5)

| ID | Requirement | Backend | DB | UI | Status |
|---|---|---|---|---|---|
| VND-1 | Arabic-first RTL shell on the shared kit | – | – | `VendorShell` (default Arabic, drawer on phones, single language control) | **VERIFIED** (Playwright `vendor-hub`; deployed) |
| VND-2 | Owner / Manager / Operator + per-branch scope, independent accounts, session control | `POST/PATCH/DELETE vendor/team/members…` — a manager creates/activates/deactivates OPERATORS and moves them between OWN branches (never self, managers, shared-branch accounts; no role change); audited (`via: vendor_manager`) | existing `users`/`vendor_staff` | `/team` | **VERIFIED locally** (e2e 129, Playwright `vendor-operations`) — creating/promoting managers and role changes stay with Admin: **DECISION isolated** (owner); a distinct Owner role is not modelled |
| VND-3 | Branch open/close, weekly hours, scheduled closures, holidays, precedence | `GET|PATCH vendor/branches/:id`; `GET/POST/DELETE vendor/branches/:id/closures` (+ admin `admin/vendor-branches/:id/closures`); customer-facing `isOpen` = switch AND no active closure; checkout refuses an active closure (`BRANCH_TEMPORARILY_CLOSED`) | `vendor_branch_closures` (additive, migration 73) | `/my-branches` (`BranchClosures`, Cairo time), Admin branch page | **VERIFIED locally** (e2e 129, integration, Playwright). Closure = overlay, explicit end, no holiday calendar, never rewrites the manual switch. **DECISION isolated:** whether the manual closed switch should also block checkout (today display-only, unchanged) |
| VND-4 | Orders with human numbers, history, search, filters, paging, export without customer data | `GET vendor/orders/history` | – | `/order-history` | **VERIFIED** (e2e 128, Playwright) |
| VND-5 | Product workspace: search/filter/sort, duplicate (no stock), bulk, Excel, options, media | vendor catalog | – | products UI | PARTIAL → Slices 4–5 |
| VND-6 | Inventory: reasons, history, stocktake, reconciliation | `GET vendor/inventory/movements`; stocktakes `GET/POST vendor/inventory/stocktakes…` (count → variance → apply by a manager, refuses below zero); ledger written by a trigger on `products` so no path can skip it | `stock_movements`, `stock_ledger_info`, `stocktakes`, `stocktake_lines` (migration 73) | `/stock-history` (Movements / Stocktake), `/stock` | **VERIFIED locally** (e2e 129, integration trigger/rollback tests, Playwright). History starts at `stock_ledger_info.started_at`; nothing earlier is reconstructed; an uncontexted change is shown as "source not recorded". No new automatic deduction |
| VND-7 | Financial center (statements, exports) with VendorLedger = commission receivable | `GET vendor/finance` (sales, commission RECEIVABLE of Hatly, customer payments by method, cancelled parts, closed periods + recorded settlement payments, 12-month history); admin `GET/PUT admin/vendors/:id/settlement-terms` (WEEKLY/MONTHLY only; CLOSE_VENDOR_SETTLEMENTS, audited) | `vendor_settlement_terms` (migration 73) | `/finance`, `/earnings`, Admin vendor page | **VERIFIED locally** (e2e 129, Playwright). No net payable shown and driver→vendor payments marked "not recorded" (**DECISION isolated**: PLT-4). Export of the statement is NOT built (CSV exists on the order statement only) |
| VND-8 | Analytics, ratings (read-only, report to Admin), notifications, profile approvals | `vendor/insights`, `staff/notifications` | – | `/insights`, `/notifications` | PARTIAL — analytics + notifications VERIFIED; ratings view, profile approvals NOT built |

## Platform (brief §9–§17)

| ID | Requirement | Status |
|---|---|---|
| PLT-1 | Quantity limits at product / platform / campaign level, most restrictive wins, server-side | DESIGNED → Slice 5 |
| PLT-2 | Notification architecture: outbox, preferences, dedupe, retry, escalation, honest delivery status | **VERIFIED locally** (outbox, dedupe per case/event, retry/DEAD, preferences, honest states; e2e 126, unit, integration). Providers BLOCKED: no FCM/WhatsApp/SMS/e-mail configured in Production |
| PLT-3 | Campaign funding approval; vendor-funded / co-funded maths; stacking | **DECISION** — isolated, not invented |
| PLT-4 | Driver settlement frequency; driver→vendor financial treatment | **DECISION** — isolated, not invented |
| PLT-5 | Admin 360 profiles; employee sessions/devices/security events | PARTIAL → later |
| PLT-6 | Audit of every important action (actor, role, entity, before/after, reason, correlation id) | PARTIAL: admin audited; vendor writes not yet → Slices 1, 4 |
| PLT-7 | Quality gates: dashboard CI job, Playwright per-file runner, accessibility automation | DESIGNED → Slice 3 |

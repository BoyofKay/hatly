# Hatly — Final Consolidated Decision Register

Date 2026-11-06. **This is the source of truth for implementation planning.** Where any other document disagrees, this register wins:
- `HATLY_AUDIT_CLOSURE_AND_BLUEPRINT_2026-11-06.md`
- `HATLY_SPEC_VS_CODE_GAP_2026-11-06.md`
- `HATLY_SECTION15_DESIGN_2026-11-06.md`
- `HATLY_FINAL_DECISION_RECONCILIATION_2026-11-06.md`
- the unified specification

Documentation only. Repository, HEAD `8b1c0e3`, uncommitted work, configuration, data and the three tunnels are untouched.

Sources:
- **SPEC** — the unified specification
- **C-1…C-5** — first clarifications
- **A–N** — approved decisions
- **Q0–Q7** — final answers
- `BE/` = `apps/backend/src/modules/`

---

## 1. Register

### Orders
| ID | Rule | Source |
|---|---|---|
| R1 | Order types: Instant, Scheduled, Pickup, plus Hatly Service (R40). Type fixed after confirmation; changing it = cancel and recreate | SPEC §2, M |
| R2 | Gateway and InstaPay/Vodafone Cash orders stay Pending Payment. They are **not shown to the vendor** and do not enter dispatch until payment is confirmed (gateway webhook or Operations verifying receipt). A customer receipt is not proof | SPEC §2/§5, G, C-5 |
| R3 | Customers may self-cancel a store order until the driver picks up, even after preparation started. Hatly bears the preparation cost: Operations records any vendor compensation manually, as a separate entry. After pickup → Operations handles the case and its money | A |
| R4 | Partial cancellation: remaining items continue; amounts and fees recalculated | SPEC §2 |
| R5 | Scheduled orders: the customer chooses arrival date and time; the system computes preparation and dispatch; no fixed horizon; slots offered only where hours, capacity and delivery are feasible; never dispatched at creation; time changes when feasible, audited (old and new); delays alert Operations and never auto-reschedule | I |

### Vendors and catalogue
| ID | Rule | Source |
|---|---|---|
| R6 | One commercial model per vendor at a time: commission **or** subscription; amount and cycle set in Admin | E |
| R7 | **Price reductions take effect directly** under the vendor's authorised permissions. **Price increases, new products and product-detail changes need Hatly approval**; the approved version stays live until then. Excel and bulk paths apply the same rule per change and never bypass approval | Q0, H (supersedes C-4) |
| R8 | **Vendors cannot pause or close order acceptance themselves during operating hours.** They submit a pause request in the Vendor Dashboard; Hatly Admin approves or rejects. Admin may also pause or reopen a store directly. A pause blocks new orders only; confirmed and scheduled orders continue | Q6, SPEC §3, N |
| R44 | Vendors may **request** changes to operating hours, working days or temporary closures in the Vendor Dashboard; **every such request needs Hatly Admin approval before taking effect**. Admin may change hours, close or reopen a store directly. All changes (approved or direct) affect **new orders only**; confirmed and scheduled orders continue under their existing arrangements. Requests and direct changes record who, when, before/after and reason | U2, Q6 |
| R9 | A closed or paused store accepts no new orders, and auto-accept cannot bypass hours or pauses. Outside hours, instant orders are refused and scheduled orders may target future open slots | N, I |
| R10 | Branches: independent products, stock, hours, orders and finances; stock transfers as separate dispatch and receipt entries; owners see consolidated reports; managers only their assigned branches | SPEC §3/§9 |
| R11 | Dashboard OFF → Hatly manages, owner read-only. Dispatched orders keep the workflow they were dispatched under; undispatched orders move; nothing is reassigned; the change is logged (time, employee, party) | K, SPEC §3 |
| R12 | Acceptance mode per vendor: automatic / vendor / Hatly. Automatic never bypasses hours, stock, product validity or scheduling | SPEC §4 |
| R42 | Vendor owners define roles and fine-grained permissions; branch managers are limited to assigned branches unless the owner widens access. Admin permissions are managed separately | Reconciliation guidance |

### Dispatch and drivers
| ID | Rule | Source |
|---|---|---|
| R13 | Global auto/manual dispatch toggle. Admin can change the driver in either mode. Toggling never alters existing assignments | SPEC §4, B |
| R14 | GPS proximity when available; otherwise round-robin among available drivers with capacity. GPS is never mandatory for eligibility | SPEC §4 |
| R15 | No driver available → queue with automatic reconsideration; alert after a configurable wait; never auto-cancel | SPEC §4 |
| R16 | No accept/reject. The driver acknowledges, then moves. Default window 5 min, configurable, same for manual and automatic assignments. Overdue → Operations alert only; no automatic reassignment; the old 30-second release is removed | B |
| R17 | Only Operations releases and reassigns; drivers with a problem call Operations. Driver-initiated release ("driver rejects") is removed | B |
| R18 | Multiple active orders per vehicle capacity; admin override records reason, approver, time and before/after | SPEC §4 |
| R19 | One driver per order, including multi-vendor orders; each vendor segment tracked separately for preparation and pickup | F, C-2 |
| R36 | Failed delivery after pickup: goods back to the Hatly office; Operations confirms receipt, condition and custody, then decides redeliver / return to vendor / financial resolution. No closure on the driver's claim; no automatic compensation or deduction; reason, employee and time recorded | C, SPEC §8 |

### Payments and wallet
| ID | Rule | Source |
|---|---|---|
| R20 | Approved methods: COD; gateway (cards and e-wallets, provider-agnostic, trusted webhooks, idempotent, success/failure/cancel/refund, transaction id + amount + status + time); InstaPay/Vodafone Cash with manual verification; Hatly Wallet; mixed per wallet rules. `PAY_AT_DELIVERY` (electronic at the door, unverified) is **not approved**: no new orders; historical rows kept | SPEC §5, G |
| R21 | Unverified manual transfers auto-cancel after a configurable time and release stock. Money arriving later → review and refund; never auto-reactivate | SPEC §5 |
| R22 | Refunds go to the original source: wallet portion to the wallet, card portion to the card or original method. Refunds are never redirected to the wallet automatically. Hatly bears non-refundable gateway fees on entitled refunds | SPEC §5, L |
| R23 | Wallet: own ledger, separate from driver and vendor balances; no negative balance; no cash-out; customer-to-customer transfers allowed, final, non-reversible; no top-up of another customer's wallet. **Top-ups** need verified gateway payment or verified manual transfer. **Permitted non-top-up credits:** (a) documented adjustments for money owed to the customer — driver change, price differences, including weighted-product reductions; (b) Hatly goodwill credits through an authorised, audited Admin operation; (c) refunds of wallet-funded amounts. Each credit is typed by source and is never treated as a top-up | L, Q3 |
| R23a | **Monetary wallet balances never expire** | Q4 |
| R24 | Loyalty is a separate balance; points never expire; earned only on eligible completed store orders, never on Hatly Service; redeemed **only as discounts** under the loyalty rules; **never converted into wallet money** | L, M, Q3, Q4 |

### Driver money
| ID | Rule | Source |
|---|---|---|
| R25 | COD: the driver pays the vendor for goods at pickup with own money, collects goods + delivery fee from the customer, and recovers the goods value | SPEC §6, D |
| R26 | Electronically paid orders: the driver still pays the vendor at pickup; Hatly reimburses the goods value in the driver's settlement; delivery earnings calculated separately | D |
| R27 | Wallet + COD: the driver collects only the remaining cash; the wallet part is recorded as collected by Hatly | D |
| R28 | The driver's Hatly commission % (per driver, e.g. 0/5/10/15/20%) applies **only to the driver's delivery compensation**, never to goods value, Hatly service revenue or any platform fee. **Normal orders:** driver compensation = the delivery fee **including the additional-vendor delivery charge, always**. **Hatly Service:** driver compensation = the **ordinary base delivery fee** for the route; the **multiplier premium** (charge − base fee) is **Hatly's independent service revenue**, recorded separately and never subject to the driver %. Historical orders are not recalculated (R43 principle) | D, Q1, U1 |
| R29 | Daily settlement at the office: an Operations employee creates it in Admin; the system records who and when; the driver pays or receives the balance; no electronic objection or driver approval; late settlement never blocks new orders | D |
| R30 | The statement shows delivered orders, total delivery fees, Hatly % and amount, driver net entitlement, amounts owed to Hatly, collections by payment source, payable/owed, final settlement and the employee | SPEC §6 |
| R31 | Goods principal, driver delivery fee, Hatly delivery commission, Hatly service revenue and vendor commission are never combined in one entry | SPEC §6/§13, D, Q1 |
| R43 | Deliveries recorded while the driver had no commission rate are flagged **"historical commission rate undefined"**. History and balances stay as they are; no rate is assumed; any adjustment or retrospective payment needs a separate explicit decision and never happens automatically. The same applies to vendor segments with no commission rate | Q2 |
| R45 | A customer cancellation before pickup creates **no driver compensation entitlement from assignment alone**. If the driver had started travelling to the vendor or had arrived (as shown by the driver's recorded movement steps), Operations decides **case by case** whether to compensate. Approved compensation is a **Hatly operational expense** (never delivery-fee earnings, never subject to the driver %), recorded with reason, approver and time. **No deduction from the driver** in any case | U3, A, SPEC §8 |

### Vendor money
| ID | Rule | Source |
|---|---|---|
| R32 | Vendor receivables and Hatly commission are separate balances: receivables are transferred in full, commission is collected independently, no automatic netting or deduction | E, C-1 |
| R33 | Per-vendor commission collection period and subscription cycle; overdue → alert; Admin may suspend new orders manually (never automatically); confirmed orders continue | E |
| R33a | **Subscription fees are charged at the start of each cycle. Plan changes take effect from the next cycle**; the current cycle is never recalculated | Q5 |
| R34 | Vendor compensation is a separate entry; commission is not auto-reversed because of compensation or refunds | E |
| R35 | Pickup orders: Hatly commission is due when the vendor confirms handover to the customer | SPEC §7 |
| R37 | Quantity stock by category (restaurants exempt); per-branch stock; commission on the actual discounted price; Hatly-funded promotion share recorded per promotion configuration; a simple price reduction needs no separate settlement | SPEC §9 |

### Hatly Service
| ID | Rule | Source |
|---|---|---|
| R40 | Distinct product; wallet payment allowed; earns no loyalty. The customer may self-cancel **until the driver records the purchase as completed**; after that, the customer contacts Operations, which handles the case and its money. **Scheduled Hatly Service orders are not supported** until a separate decision defines the workflow. Charge split: base delivery fee = driver compensation, multiplier premium = Hatly service revenue (R28) | M, Q7, Q1, U1 |

### Platform
| ID | Rule | Source |
|---|---|---|
| R38 | Backward compatibility by default; old versions not blocked; release and version management in Admin; forced updates only by explicit approval in exceptional cases (critical security or operational issue) | J |
| R39 | Separate, interconnected ledgers (SPEC §13 list). Each entry has a unique id, type, source, beneficiary, amount, currency, status, due/recognition/collection dates, order or settlement reference, executing employee, idempotency key; corrections are new entries, never edits | SPEC §13 |
| R41 | Fine-grained permissions by screen, action and employee; audit of sensitive actions; suspicious cases go to human review, with no automatic penalties | SPEC §12 |

**45 numbered rules plus R23a and R33a (47 entries), all consistent.** The original R1–R42 are kept. R23a, R33a and R43 come from Q2, Q4 and Q5; R44 and R45 from U2 and U3. R7, R8, R23, R24, R28, R31 and R40 were rewritten from Q0, Q1, Q3, Q6 and Q7; R28 and R40 again from U1. No other rule changed.

---

## 2. Remaining unresolved business decisions

**None.** U1, U2 and U3 were approved on 2026-11-06 and are now R28/R40 (U1), R44 (U2) and R45 (U3). Items left to engineering are in §4; implementation still needs your approval per phase.

---

## 3. Code conflicts with the register (documentation only)

These are needed for planning; **nothing was changed**.

| Register | Current behaviour | Evidence |
|---|---|---|
| R2 | Vendors see unpaid manual-transfer orders (only preparing is blocked) | `BE/orders/vendor-orders.service.ts:105` |
| R3 | Customer cancellation refused once any vendor is PREPARING or a driver is assigned | `BE/orders/customer-cancellation-rule.ts` |
| R7 | Price increases and product edits apply directly; the Excel import applies directly. *(Reductions applying directly is correct.)* | `BE/products/vendor-products.controller.ts:53,110,124` |
| R8/R9/R44 | Vendor open switch is display-only; hours not enforced at checkout; no pause request; **vendor edits weekly hours directly** (`vendor-business.service.ts:290`) and **creates or deletes closures directly** — both must become Admin-approved requests | `checkout-planner.service.ts:60`, `vendor-operations.controllers.ts:47` |
| R11, R12, R42 | No dashboard ON/OFF; boolean auto-accept; no vendor roles or permissions | `vendor-branch.entity.ts:92`, `vendor-staff.entity.ts` |
| R16/R17 | 30-second deadline + automatic release while auto is ON; DRIVER role may move ASSIGNED_TO_DRIVER → READY_FOR_PICKUP | `delivery-assignment.service.ts:279`, `automatic-dispatch.service.ts:322`, `order-state-machine.service.ts:108` |
| R18, R14 | Single active order per driver; no round-robin | `drivers.is_available`, `driver-ranking.service.ts` |
| R20 | `PAY_AT_DELIVERY` accepted at checkout; no gateway | `BE/orders/order-payment-method.ts`, `checkout-planner.service.ts:159,182` |
| R21 | No auto-cancel of unverified transfers | — |
| R23 | No top-up and no customer-to-customer transfer; credit types not separated into top-up vs adjustment vs goodwill | `BE/wallet/wallet-transaction-type.enum.ts` |
| R24 | **Loyalty points are converted into wallet money** (`LOYALTY_REDEMPTION` wallet credit). Existing balances created this way are kept (R43 principle: no automatic adjustment) | `BE/loyalty/loyalty.service.ts:430-490` |
| R28/R31/R40 | Driver % applied to the full `delivery_fee_minor`. Correct for normal orders (it already includes the additional-vendor charge); **wrong for Hatly Service**, where it covers the whole multiplied charge. The multiplier premium is never recorded as Hatly service revenue. `baseFeeMinor` is already frozen in the charge snapshot, so the split is computable for new orders | `order-financial-events.service.ts:153`; `HATLY_SERVICE_CHARGE_RECOGNIZED` unused |
| R29/R30 | No DAILY frequency label; statement lacks goods principal and collections by source | `settlement-frequency.enum.ts` |
| R32 | Vendor statement nets `earnings − commission + reimbursements` | `BE/finance/settlement.service.ts:188` |
| R33a | No subscription model | — |
| R36 | Failed-delivery outcomes are financial only; no custody step | `failed-delivery-outcome.enum.ts` |
| R40 | Hatly Service cancellable only until a driver is **assigned**; should be until the purchase is recorded | `customer-cancellation-rule.ts` (PD-014 note) |
| R43 | Missing-rate deliveries silently produce no events (settlements show 0 fee and 0 commission); no flag | `order-financial-events.service.ts:120,146` |

---

## 4. Engineering defaults (no user decision; configurable)

| Item | Value |
|---|---|
| Acknowledgement window | default 5 min; allowed 1–30 min; stored on each assignment when offered |
| Acknowledgement alert | at the deadline, then every 5 min, at most 3 repeats, then CRITICAL to the shift supervisor; clears on acknowledge or release |
| No-driver alert wait | default 5 min after the order becomes dispatchable |
| GPS freshness | location ≤ 5 min old counts as GPS available; otherwise round-robin |
| Round-robin | least recently assigned eligible driver with capacity |
| Daily settlement window | from the previous close to the moment the employee closes |
| Subscription cycle options | WEEKLY, MONTHLY, QUARTERLY, custom N days |
| Vendor overdue | due date + configurable grace (default 0); alert only |
| `PAY_AT_DELIVERY` | hidden at checkout; new orders refused with a clear error code |
| Vendor preparation-cost compensation (R3) | manual `VENDOR_COMPENSATION` entry (Hatly → vendor) with reason and employee |
| Redelivery charge after failure (old D23) | none automatic; Operations decides per case under R36 |
| Vendor commission recognition time (old D29) | at handover: to the customer for pickup orders (R35), to the driver for delivery orders (today's behaviour) |
| Expected scale (old D32) | planning input for P4 sizing, not a business rule |
| Redelivery charge after failure (old D23) | none automatic; Operations decides per case under R36 |
| Vendor commission recognition time (old D29) | at handover: to the customer for pickup orders (R35), to the driver for delivery orders (today's behaviour) |
| Expected scale (old D32) | planning input for P4 sizing, not a business rule |
| Driver cancellation compensation (R45) | manual `OPERATIONAL_EXPENSE` entry (Hatly → driver, category "cancelled trip"); allowed only if the assignment shows EN_ROUTE or ARRIVED; never touches delivery-fee or commission events |
| Historical undefined rate (R43) | read-only flagging query, run only with your authorisation; flagged in statements and reconciliation; no balance change |

---

## 5. Unified specification — errata to adopt

No approved rule changes; these only bring the text in line with the answers.
1. **§2:** add R3's cost clause, and R40's Hatly Service cancellation point and "no scheduling".
2. **§3:** replace "Vendors can request a pause… Hatly must approve" with R8 (incl. "Admin may pause or reopen directly"). Add R7's wording: reductions direct; increases, new products and detail changes approved; bulk paths never bypass.
3. **§4:** add "acknowledgement applies to manual and automatic assignments; drivers cannot release an assignment; the 30-second release is withdrawn" (R16/R17).
4. **§5:**
   - mark `PAY_AT_DELIVERY` as not approved (R20)
   - replace "Wallet credit is permitted only after gateway confirmation or manual transfer verification" with R23's top-up vs adjustment vs goodwill rule
   - add R23a: wallet money never expires
5. **§6:** replace "The delivery fee belongs to the driver before deduction of Hatly's commission" with R28. Add R43.
6. **§7:** add R33a, subscription billing.
7. **§9:** add R24, loyalty as discounts only, never wallet money, never expiring.
8. **§13:** add "Hatly Service revenue" to the separate ledgers.
9. **§3:** add R44 (hours, working days and closures by approved request; Admin direct changes; new orders only).
10. **§6:** add R28's split (normal: fee incl. additional-vendor charge; Hatly Service: base fee to the driver, premium to Hatly) and R45 (cancellation compensation as a Hatly operational expense; no driver deduction).

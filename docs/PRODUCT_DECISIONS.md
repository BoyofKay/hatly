# Hatly — Canonical Product Decisions

This is the canonical, append-only record of business decisions that code, tests and UI must honour.
Each decision has a stable ID, a status and the date it was locked. **A decision listed here is not an
open question.** Historical reports (e.g. the Group 8 E2E report) are preserved as written; where they
called one of these items "open" or "not implemented", the entry below supersedes them.

Implementation status is tracked separately from approval: **APPROVED** means the product rule is locked;
**NOT IMPLEMENTED** means the backend does not yet behave this way. The impact audit for the three
decisions below is in [`IMPACT_AUDIT_POST_GROUP_8.md`](./IMPACT_AUDIT_POST_GROUP_8.md).

---

## POST-GROUP-8 APPROVED PRODUCT DECISIONS

Locked after Group 8 was closed. They came out of Group 8 open items 19 ("wallet payment is not
implemented") and the "partial cancellation money" item; they are **not** Group 8 findings to reopen.

### PD-001 — Wallet payment is REQUIRED in V1

Status: **APPROVED — IMPLEMENTED; AMENDED (rules 3–4 and the refund waterfall below replace the original wording).**

Wallet must be usable as a payment method at Customer Checkout in V1. **The Wallet is an independent payment source.**

1. The customer may pay the **full** order with Wallet.
2. The customer may pay **partially** with Wallet.
3. Wallet is consumed **first**; the remaining amount is paid by another supported method: **Cash on Delivery, Pay at Delivery
   or Manual Transfer.**
4. **Wallet may therefore be combined with `COD`, `PAY_AT_DELIVERY` and `MANUAL_TRANSFER`.** *(Amended — the original rule 4,
   "Wallet + Manual Transfer is NOT allowed", is withdrawn.)* With a transfer: the wallet part is settled at once and needs no
   approval; the `Payment` row holds **only the remainder** (`amountMinor = total − wallet`, never the full total); PREPARING and
   dispatch stay blocked until that remainder is `PAID`. A full-wallet order creates no external `Payment` row.
5. **Wallet + Online Payment is not part of V1.**
6. Wallet balance must **never become negative**.
7. The Wallet debit and the corresponding order payment are **atomic** — one database transaction. The amount is **server-authoritative**:
   the client may send `useWallet` and a cap that can only *lower* it.
8. The operation is **concurrency-safe and idempotent**.
9. The Wallet ledger remains **append-only** (a debit is a new row, never an edit).
10. Loyalty → Wallet conversion stays a **separate** flow; Driver Cash Remainder → Wallet credit stays a **separate** flow.
11. Refund and cancellation behaviour must be compatible with the existing Wallet ledger design
    (`ORDER_PAYMENT` debit / `ORDER_REFUND` credit types already exist in the ledger).
12. **Refund waterfall — EXTERNAL PAYMENT FIRST → WALLET SECOND.** The wallet is attributed as paying the *first* part of the order, the
    external payment the rest. When the amount owed drops (vendor segment cancellation, failed-delivery refund), what the external
    (Manual Transfer) payment still has to cover is `owed − wallet`; it is refunded down to that first, and only when it is exhausted
    (`owed < wallet`) does the excess go back to the **wallet**. The customer's net payment always equals the amount still owed, and
    no refund ever exceeds what was actually paid, per component. Example — total 100 = wallet 30 + transfer 70:
    owed 60 → refund **40** through the transfer, wallet keeps 30 (net 60); owed 20 → refund the whole 70 transfer, then 10 to the wallet (net 20).
    A whole-order cancellation returns the paid transfer (existing manual-transfer refund flow, or the PD-004 pending entitlement if it is
    not verified yet) and the wallet part to the wallet. COD / Pay-at-Delivery amounts were never collected and are never refunded.
    A failed-delivery `REFUND_CUSTOMER` (`refundAmountMinor`) is split by the same waterfall and capped at what was paid.

### PD-002 — Partial Vendor Cancellation removes the cancelled segment from the active order

Status: **APPROVED (clarified) — NOT IMPLEMENTED** (Group 8 E2E currently characterises: totals unchanged after a segment cancel).
*Clarification history: locked after Group 8; clarified once, below, to state that the Order is not cancelled, to make the
Additional Vendor Fee rule general, and to record the zero-active-segments edge case as unresolved.*

Scope: a multi-vendor **CATALOG** order in which one Vendor cancels **its own** Vendor Segment.

1. The **Order itself is NOT automatically cancelled**, and is never treated as cancelled merely because one Vendor cancelled.
2. The cancelled segment is **removed from the active financial/order flow**.
3. The Order total is **recalculated from the remaining active Vendor Segments** plus the unchanged fixed Delivery Fee.
4. The cancelled Vendor's item/subtotal amount is removed.
5. Discounts belonging to the cancelled segment are removed from the current Order total.
6. Flash Sale allocation/consumption belonging to the cancelled segment is reversed/released according to the approved Flash Sale rules.
7. The **Additional Vendor Fee is recalculated from the number of remaining active Vendors**:
   **Additional Vendor Fee = configured fee × (remaining active vendor count − 1)**.
   - 3 Vendors → 2 Vendors: one Additional Vendor Fee is removed.
   - 2 Vendors → 1 Vendor: the remaining Additional Vendor Fee is removed.
8. The **Delivery Fee remains FIXED** and is not recalculated (PD-003). **No new Maps/Routes request** is made because of the cancellation.
9. The remaining Vendor Segments continue normally.
10. The Order **returns to / remains in the appropriate active workflow** according to the state of the remaining Vendor Segments.
11. Any customer refund / financial settlement is based on the **actual difference** between what was previously paid/owed and the newly recalculated total.
12. Inventory restoration for the cancelled segment remains required (already implemented in Group 8).
13. Commission for the cancelled segment must not remain booked (already implemented for pickup-time booking in Group 8).
14. Payment/refund behaviour is **atomic and idempotent**.

Worked example (normative; 2 → 1 vendors):

| | Before | After Vendor B cancels |
|---|---|---|
| Vendor A | 200 | 200 |
| Vendor B | 300 | — |
| Additional Vendor Fee | 20 | **0** |
| Delivery Fee | 40 | **40 (unchanged)** |
| Vendor B discount | −50 | — |
| **Total** | **510** | **240** |

**UNRESOLVED EDGE CASE (U1) — zero active Vendor Segments.** If the cancellation leaves *no* active Vendor Segment,
this decision does **not** define what happens (in particular: it does **not** decide that the Order is cancelled
automatically, nor any automatic refund). No cancellation/refund behaviour may be invented for it; it needs a
**separate product decision**. See "Unresolved edge cases" below.

### PD-003 — The Delivery Fee is FIXED during partial cancellation

Status: **APPROVED INVARIANT.** (Currently true in code, because nothing recalculates it — it must stay true when PD-002 is implemented.)

When a Vendor Segment is cancelled:

- do **not** recalculate road distance;
- do **not** call Google Maps / Routes again;
- do **not** change the existing Delivery Fee;
- do **not** remove the Delivery Fee because the order went from several vendors to one;
- only the **Additional Vendor Fee** is removed, when applicable (PD-002 rule 4).

The Delivery Fee is the already-established fixed fee of the order. Anything that would call
`DeliveryFeeCalculationService.calculate(...)` after order creation violates this invariant.


### PD-004 — Manual Transfer: pending refund entitlement when a vendor cancels before the transfer is verified

Status: **APPROVED — IMPLEMENTED** (backend). Builds on PD-002 (partial cancellation, implemented) and does not change PD-003.

A customer may already have sent a Manual Transfer while the payment is still `PENDING` / `CUSTOMER_CLAIMED_TRANSFER` /
`UNDER_REVIEW` (an admin has not verified it). A vendor-segment cancellation in that window must not lose the customer's
refund entitlement — and must not create a payable for money Hatly may never have received.

1. Cancellation determines the financial entitlement **independently of payment approval**.
2. If the cancellation reduces what is ultimately owed, the difference is recorded as a **pending refund entitlement** on the
   payment (`payments.pending_refund_minor` / `pending_refund_status` = `PENDING`) — **not** as a refund event.
3. **No refund/payable event is written before the transfer is verified `PAID`** (it may still be rejected).
4. The entitlement is **re-derived, never accumulated**: `max(0, amount the customer was asked to pay − amount currently owed)`.
   Several cancellations therefore always leave exactly the final overpayment. `Payment.amountMinor` (what the customer may
   have sent) is never rewritten. A whole-order cancellation makes the entitlement the whole amount.
5. On **approval (`PAID`)**, in the same transaction, the payment is reconciled against the order's current amount owed and
   the refunds already recorded; a `PENDING` entitlement becomes **exactly one** refund payable (`CONVERTED`) for
   `paid − owed − already refunded` (re-derived from the order, never from the stored value).
6. On **rejection**, the entitlement is `VOIDED` and **nothing is paid** — Hatly never confirmed receipt. A cancellation after
   a rejection creates no entitlement.
7. **Already-`PAID`** transfers keep the immediate per-segment refund (PD-002). **COD / PAY_AT_DELIVERY** have no payment row and never
   get an entitlement or a refund event.
8. Idempotent and concurrency-safe: the entitlement is a pure function of (paid, owed); conversion uses the fixed event key
   `manual-transfer-refund:{paymentId}:pending-conversion` and a terminal state; approval locks the **order row before the
   payment row** (as cancellation does), so cancellation and approval serialize and can neither double-refund nor lose it.

Not covered (would need a new decision): a refund on an order whose total is unknown (`totalMinor` null) is never guessed — the
entitlement is left `PENDING` and nothing is refunded automatically.


### PD-005 — Customer cancellation of an order

Status: **APPROVED — IMPLEMENTED** (backend: `POST /orders/:id/cancel`). Uses the PD-002 / PD-004 money handling unchanged.
**Amended by PD-006 (below): the rule is now also blocked by any vendor segment that has started preparing.**

1. A customer may cancel **their own whole order** only while it is **`PENDING` or `CONFIRMED`**.
2. From **`PREPARING`** on (`READY_FOR_PICKUP`, `ASSIGNED_TO_DRIVER`, `PICKED_UP`, `ON_THE_WAY`, `DELIVERED`, `FAILED_DELIVERY`) and once
   `CANCELLED`, the backend **refuses** (400 `ORDER_NOT_CANCELLABLE_BY_CUSTOMER` / `ORDER_ALREADY_CANCELLED`). Hiding a UI button is not the rule.
3. Ownership comes from the authenticated customer, never the request; someone else's order is a 404.
4. **Whole order only.** A customer cancelling an individual vendor segment is **not** part of this decision and remains a separate,
   open product decision.
5. Single- and multi-vendor: every still-active vendor segment is cancelled with the order, atomically; segments already cancelled
   stay as they were and are never processed twice.
6. Money: delivery fee 0 and nothing owed; stock and flash-sale allocation restored exactly once; a `PAID` Manual Transfer gets the
   existing idempotent refund of what was not already refunded; an unverified transfer updates the PD-004 pending entitlement
   (refunded on later approval, voided on rejection); COD / PAY_AT_DELIVERY create no refund event.
7. Concurrent or repeated cancellations produce exactly one cancellation, one refund and one restoration.

**Amendment (PD-006, approved and implemented) — resolves the note that used to end this section.** The order-level status only moves
to `CONFIRMED`/`PREPARING`/`READY_FOR_PICKUP` once every active vendor segment is ready, so a vendor can be preparing its segment
while the order is still `PENDING`. The approved rule is therefore:

- The customer may cancel the whole order only while **every still-active vendor segment is before `PREPARING`** (`PENDING` or
  `CONFIRMED`) **and** the order itself is `PENDING`/`CONFIRMED`. If **any** active segment has reached `PREPARING` or later, the
  backend refuses with `ORDER_NOT_CANCELLABLE_BY_CUSTOMER` and `details.reason = 'VENDOR_SEGMENT_PREPARING'`.
- A segment that a vendor already cancelled is ignored by this check.
- The customer can **never** cancel a single vendor segment (whole order only). A vendor keeps cancelling their **own** segment
  (PD-002), unchanged.
- The order/details/tracking views expose `customerCanCancel` (computed by the same server rule, `customerCancellationBlock`) so the
  app only *offers* the action when it will succeed; the server re-checks on the request.


### PD-006 — Checkout + Order Lifecycle

Status: **APPROVED — IMPLEMENTED** (backend + customer app). Migration `1700004200000-CheckoutOrderLifecycle` (additive, reversible).
Everything money- or eligibility-related below is decided **by the server**; the app only displays and relays the customer's choices.
**Amended (production-readiness slice)** — the quote token, order number, ETA and native Maps/location entries below replace their
original wording; see each subsection.

**A. Delivery address**
1. The **map pin (latitude/longitude) is the authoritative location.** The map provider's address text (`formattedAddress`) is only an
   assistive suggestion; the app stores it only if the customer accepts it. The customer types the details the driver needs
   (governorate, city, building, floor, apartment, landmark, instructions, label). `line1` is required (non-empty, ≤ 255).
2. The server validates the address (well-formed, inside Egypt) and **service-area eligibility** (the point must fall in an active
   service area and every vendor branch in the cart must deliver to it). An unserviceable address blocks the order with a machine-readable
   code (`ADDRESS_OUT_OF_SERVICE_AREA`, `VENDOR_DOES_NOT_DELIVER`, `VENDOR_OUTSIDE_DELIVERY_AREA`, `INVALID_DELIVERY_LOCATION`).
3. A customer has at most one **default** address (their first becomes the default). Checkout preselects it **only if it is serviceable**.
4. The order stores an **immutable address snapshot**; later edits/deletes of the saved address never change past orders. A pickup order
   has no address snapshot.

**B. Delivery quote** — `POST /checkout/quote` (read-only, no locks): overall fee with breakdown (base fee, additional-vendor charge,
vendor count, distance, per-vendor distance), eligibility, overall ETA range, per-vendor preparation time, coupon, payment options.
The response carries an HMAC-signed `quoteToken` that **freezes the delivery fee** for the inputs it was made for (customer, cart, address,
coupon). `POST /orders` with that token honours the frozen fee. If the token expired (`CHECKOUT_QUOTE_TTL_SECONDS`, default 900 s), the
inputs changed, or the amounts would now differ, the order is **not** created: `409 QUOTE_STALE` with `reason`
(`QUOTE_EXPIRED` / `INPUTS_CHANGED` / `AMOUNTS_CHANGED`), the changed fields and the **current quote**; the customer confirms again.
**Amended — the token is now REQUIRED for a `DELIVERY` order.** `POST /orders` for a delivery fulfilment without a valid,
unexpired, input-matching `quoteToken` is refused with `400` and `details.code = 'QUOTE_TOKEN_REQUIRED'` (a clear, machine-readable
domain error, never a generic 500). A **`PICKUP`** order has no delivery fee to freeze and still does not need one. The check is
positioned **after** every other business validation (address/eligibility/inventory/coupon/wallet/final-price) has already had the
chance to raise its own specific error, so the token requirement never masks a different, more specific rejection. The token
remains bound to customer, cart, fulfilment type, lines, address and coupon (`inputsHash`) and to its expiry
(`CHECKOUT_QUOTE_TTL_SECONDS`); it never bypasses any of that validation — it only freezes the delivery-fee number. All
internal/test callers that created delivery orders without first fetching a quote were migrated before this was enforced.

**C. Fulfilment** — Delivery, or Pickup **only** for an order from a **single registered vendor whose branch supports pickup**
(`PICKUP_SINGLE_VENDOR_ONLY`, `PICKUP_REGISTERED_VENDOR_ONLY`, `BRANCH_PICKUP_DISABLED`). Pickup has no delivery fee and no address.

**D. Payment**
| Method | Meaning |
|---|---|
| `COD` | cash on delivery |
| `PAY_AT_DELIVERY` | paid electronically to the driver on arrival; the chosen electronic method is stored |
| `MANUAL_TRANSFER` | electronic **prepayment**; the payment stays pending until an admin approves it; the electronic method is stored on the order and the payment |
| `HATLY_WALLET` (`WALLET`) | paid entirely from the Hatly wallet |
| electronic methods | `INSTAPAY`, `VODAFONE_CASH`, `ORANGE_CASH`, `ETISALAT_CASH`, `WE_PAY` — required for `PAY_AT_DELIVERY` and `MANUAL_TRANSFER`; which are **offered** is BusinessConfig `CHECKOUT_ENABLED_ELECTRONIC_METHODS` (unset = all five) |
1. The wallet is **partial or full and server-authoritative**: the client sends `useWallet` (and optionally a `walletAmountMinor` cap that can only lower
   the amount); the server applies `min(balance, total, cap)`. If it covers the whole total the order becomes `WALLET` (no electronic
   method); otherwise the remainder is paid by the chosen method (COD, PAY_AT_DELIVERY **or MANUAL_TRANSFER** — PD-001, amended).
2. The wallet is refused for an order with a weighed or still-unpriced item (its final amount is unknown — C4/C5).
3. Wallet debits and refunds go through the ledger with idempotency keys (`order-payment:{orderId}`, `order-refund:{orderId}:cancel`,
   `order-refund:{orderId}:segment:{segmentId}`); **refunds of a wallet-paid amount return to the wallet.**
4. `Order` stores `paymentMethod`, `electronicPaymentMethod`, `walletAmountMinor` and `amountDueMinor` (total − wallet).

**E. Gating (enforced in the state machines, not in the UI)** — while a `MANUAL_TRANSFER` payment is not `PAID`, the order **and** the
vendor segment cannot move to `PREPARING`, and the order cannot move to `ASSIGNED_TO_DRIVER`. "Order created" is never shown as "paid".

**F. Coupons** — a coupon is a `SUBTOTAL_DISCOUNT` offer with a `coupon_code`; it is **never applied automatically** and applies only when the code is
entered. The server validates it, scopes it to **that offer's vendor branch**, and freezes it on the order (order coupon snapshot + segment
`couponCodeSnapshot`). A coupon on a vendor that already has an automatic subtotal offer is refused (`COUPON_CONFLICTS_WITH_OFFER`).
A refused code returns a machine-readable reason (`COUPON_NOT_FOUND`, `_EXPIRED`, `_NOT_STARTED`, `_MINIMUM_NOT_MET`, `_NOT_APPLICABLE_TO_CART`,
`_USAGE_LIMIT_REACHED`, `_CUSTOMER_LIMIT_REACHED`, `_BUDGET_EXHAUSTED`, …).

**G–I. Atomic creation and snapshots** — order creation is one transaction (cart lock → wallet lock → order, segments, items, payment, ledger,
status history). Names, prices, options, coupon, delivery breakdown, address, payment choice and the quote are stored as snapshots; the
order views read snapshots, never the live catalog.

**J. ETA** — operational only, never financial, never invented. It is derived on read: each active vendor segment's `expectedReadyAt` (from
the branch's configured `preparation_time_minutes`; **null = no estimate**) plus the travel time frozen with the quote. If any ingredient is
unknown the answer is `UNAVAILABLE` with a reason (`PREPARATION_TIME_NOT_CONFIGURED`, `TRAVEL_TIME_UNAVAILABLE`, …). The range's upper end
adds BusinessConfig `ETA_RANGE_BUFFER_MINUTES` (unset = no buffer, a single value). A past ETA on an open order is reported as `delayed`
and changes nothing (no money, no cancellation).
**Amended.** While a payment blocks fulfilment (PD-006.E — an unapproved `MANUAL_TRANSFER`), the ETA is `UNAVAILABLE` with reason
`PAYMENT_NOT_APPROVED`, never a normal preparation countdown — a pending review must never look like preparation has started. The
instant that payment is approved (`PAID`), every non-cancelled segment's preparation timing is **re-anchored** from the approval
moment (not from order-creation time), so the countdown reflects when preparation could actually begin. This never invents an ETA
and never auto-cancels an order for payment delay; it changes no financial snapshot.

**K. Customer cancellation** — see the amendment under PD-005.

**L–N. Views** — order list tabs (server-defined; `?tab=`): **active** = `PENDING`…`ON_THE_WAY`; **completed** = `DELIVERED`; **cancelled** =
`CANCELLED` **and `FAILED_DELIVERY`** (an undelivered order is neither ongoing nor completed). Order details expose the timeline (status history),
per-vendor status/ETA, pricing, discount/coupon, frozen delivery breakdown, wallet/payment state and the address snapshot. **Tracking V1**
(`GET /orders/:id/tracking`): status, ETA, timeline, per-vendor status + preparation ETA, payment state, support entry. **No live map, no driver card,
no driver location** — none of that exists yet and nothing is faked.

**Order number.** **Amended — Hatly now has a dedicated, human-friendly order number.** Every order gets an immutable,
server-generated `orderNumber` (`HT-NNNNNN`), stored in its own `varchar` column: `NOT NULL`, `UNIQUE`, indexed. It is assigned
exactly once, inside the same transaction that creates the order, from a dedicated Postgres sequence (`order_number_seq`,
started at an offset so the running order count is never obvious from the number). It is exposed on every customer-facing order
response (create, list, details, tracking) and shown everywhere the app used to show a shortened internal id — the Success
screen, the Orders list, Order Details, Tracking, and the pre-filled support message — labelled "رقم الطلب". The internal UUID
(`id`) is never shown to the customer; it still exists for internal joins/foreign keys and routing. Admin/support lookup accepts
either the internal id or the order number through the same endpoint (`GET /admin/orders/by-number/:orderNumber`, resolving to
the same service method as the id lookup, without duplicating lookup logic).

**Migration notes.** Legacy orders keep working: address snapshot columns are unchanged (`delivery_address_snapshot` is now nullable for
pickup); `amount_due_minor` is back-filled to `total_minor`; legacy orders get a best-effort status history flagged `actor_role = 'LEGACY'`;
new order/segment/item snapshot columns are nullable and views fall back to the live name only for rows that pre-date snapshots.
The migration's `down()` restores the previous schema.

**Known limitations (deliberately not decided or built)**
- **Interactive map.** **Amended — native Maps SDK wiring now exists on both platforms.** iOS reads `GOOGLE_MAPS_API_KEY` from a
  git-ignored `ios/Flutter/Local.xcconfig` into `Info.plist`'s `GMSApiKey`; `AppDelegate.swift` only calls
  `GMSServices.provideAPIKey` when that value is non-empty, so a missing key is a silent no-op, never a crash. Android reads the
  same key, the same way, from `local.properties` or an environment variable into a Gradle manifest placeholder. This is a
  **mobile-restricted key** (locked to the app's bundle id/package + SHA fingerprint) — it must never be the same value as the
  backend's own server-side `GOOGLE_MAPS_API_KEY` (used for Directions/Geocoding), and neither key is committed to the repo. The
  `GoogleMap` widget itself still only compiles in with `--dart-define=HATLY_MAPS_ENABLED=true`; with the flag off (the default)
  or with no key registered, the picker falls back to **GPS + address search + assistive reverse-geocoding through the server**
  (`GET /geo/reverse`, `GET /geo/search`), which still produces a real, server-validated pin. Every location-permission state —
  granted, services-disabled, denied, permanently-denied, position-unavailable — is handled with a clear, non-crashing message;
  permanently-denied is the only one that offers a direct path to the OS Settings app. Google Places autocomplete is still **not
  implemented** — no concrete product/technical requirement for it was found.
- **Per-method transfer destinations.** Only one `MANUAL_TRANSFER_DESTINATION` exists in BusinessConfig; all five electronic methods share it
  (the chosen method is stored on the order/payment and sent in the proof message). Until an operator sets both this key and
  `CUSTOMER_SERVICE_WHATSAPP_NUMBER` (Business Config, existing convention — no code path invents either), Manual Transfer stays
  reported as unavailable (`payment.options.manualTransfer.available: false`, `reason: 'NOT_CONFIGURED'`) at quote time, and order
  creation itself refuses it outright (`409 MANUAL_TRANSFER_NOT_CONFIGURED`) — never a broken/silently-failing payment option.
- Preparation time is configured per vendor branch (admin API); branches without one show "no estimate", never a default.
- **Server-side Maps provider (`MAPS_PROVIDER`).** The delivery distance/ETA/fee calculation (`DeliveryFeeCalculationService`)
  always goes through the existing `MapProvider` interface. `MAPS_PROVIDER=google` (the default, and the **only** value ever
  accepted when `NODE_ENV=production` — enforced at application bootstrap, not merely by convention) requires a real
  `GOOGLE_MAPS_API_KEY` and calls the real Google Distance Matrix/Geocoding APIs; with no key, it fails closed
  (`400 DELIVERY_FEE_UNAVAILABLE` for pricing, `SMS_PROVIDER_UNAVAILABLE`'s Maps-side counterpart for geocoding), exactly as
  before — no fake distance is ever substituted in production. `MAPS_PROVIDER=deterministic` is a new, dev/test-only
  implementation of the *same* interface: a straight-line (Haversine) approximation with no network calls and no credentials, so
  the full delivery checkout/quote/order flow can be exercised locally or in a fresh environment without a real Maps key. The
  application refuses to start with this value if `NODE_ENV=production`. E2E/integration tests pin `MAPS_PROVIDER=google`
  explicitly (with the existing fake-fetch boundary), independent of whatever a developer's local `.env` happens to say.

### PD-007 — Driver Core + Dispatch Foundation

Status: **APPROVED — IMPLEMENTED** (backend + driver app). Closes the operational loop (dispatchable → assigned →
accepted-by-acting → pickup → out for delivery → delivered/failed) on top of the pre-existing driver/dispatch
architecture (`Driver`/`Delivery`/`DispatchAlert` entities, `DeliveryAssignmentService`, `AdminDispatchService`,
`AutomaticDispatchService`, `DriverRankingService`, `OrderStateMachineService`'s driver transitions,
`FailedDeliveryResolutionService`) — none of that was redesigned; this records three genuine, confirmed gaps this
milestone closed in it.

1. **Driver verification approval.** `Driver.verificationStatus` defaults to `PENDING` at creation and
   `DriverRankingService` requires exactly `APPROVED` before a driver is ever ranked/assigned — no endpoint
   anywhere previously moved a driver out of `PENDING`, so an Admin-created driver could never actually receive
   work. `PATCH admin/drivers/:id/verification` (`MANAGE_DRIVERS`, the same permission as the rest of that
   controller) now sets `APPROVED` or `REJECTED` — no new state, the entity's existing three-value union.
2. **Driver accept/reject stays exactly as previously decided — NOT reopened.** Assignment itself (moving a
   delivery to `ASSIGNED_TO_DRIVER`) already is the point of acceptance in this architecture; the driver simply
   acts (`PICKED_UP`) or explicitly rejects (`ASSIGNED_TO_DRIVER → READY_FOR_PICKUP`, freeing them for
   reassignment) — both already existed and are unchanged. No separate Accept/Reject action or state was added.
3. **Controlled failed-delivery reasons.** A driver reporting `FAILED_DELIVERY` through `driver/deliveries/:id/status`
   must now supply a reason from `DriverFailedDeliveryReason` (`CUSTOMER_UNREACHABLE`, `CUSTOMER_REFUSED`,
   `ADDRESS_NOT_FOUND`, `UNSAFE_LOCATION`, `VEHICLE_ISSUE`, `OTHER`) when one is supplied at all — omitting it
   entirely remains valid, preserving the existing optional-reason contract. `Order.failureReason` itself is
   unchanged (still a plain string column, no migration) — this only constrains what a DRIVER may put in it; an
   Admin-initiated `FAILED_DELIVERY` (still permitted) keeps its existing free-text reason. The generic,
   multi-role `PATCH orders/:id/status` endpoint does **not** enforce this same vocabulary — deliberately out of
   scope for this milestone (see its own transition-table test) — only the driver app's real action endpoint does.
   The failed-delivery resolution queue/refund path (`FailedDeliveryResolutionService`) is unchanged: it already
   discovers `FAILED_DELIVERY` orders on its own and remains the sole authority over any refund.
4. **COD/PAY_AT_DELIVERY collection amount.** `DriverDeliveryView` now also exposes `amountDueMinor` (never
   `totalMinor`, which can overstate it once a wallet credit already covered part of the order) and
   `electronicPaymentMethod` — purely additive exposure of fields the order model already computed; no new
   ledger, no new calculation, no financial-state change on delivery.

**Not changed by this milestone (deliberately):** route optimization, live driver maps, surge pricing, batching,
an Admin Control Tower UI, and timeout-driven automatic reassignment when a driver never acts within
`acceptDeadlineAt` (already flagged as future work by `DeliveryAssignmentService`'s own comment — still open).

---

### PD-008 — Timeout-driven automatic driver reassignment (closes PD-007's flagged open item)

Status: **APPROVED — IMPLEMENTED** (backend only). Closes the "still open" item PD-007 explicitly flagged: a
driver assigned a delivery who never acts before `acceptDeadlineAt` (the existing 30s window
`DeliveryAssignmentService` already set on every assignment, previously unenforced by anything) is now
automatically released and reassigned, entirely by reusing existing machinery — no new order/delivery state, no
new ranking/eligibility/capacity/retry rule, no Accept/Reject action.

1. **Trigger.** `AutomaticDispatchService` runs a periodic sweep (`reassignTimedOutDeliveries()`) that finds every
   Delivery whose `acceptDeadlineAt` has passed while its Order is still exactly `ASSIGNED_TO_DRIVER`.
2. **Mechanism, byte-for-byte reused.** Each expired delivery is released via the SAME
   `ASSIGNED_TO_DRIVER → READY_FOR_PICKUP` transition the driver's own rejection path and
   `AdminDispatchService.reassign()` already use, then re-ranked and reassigned via the SAME
   `DriverRankingService`/`DeliveryAssignmentService` primitives `attemptAutomaticDispatch()` already uses. No
   eligibility/ranking rule was added or changed.
3. **No "don't re-offer the same driver" rule invented.** If the just-timed-out driver is still the only/best
   eligible candidate (e.g. a solo-driver service area), the fresh ranking call can legitimately re-select them,
   with a fresh `acceptDeadlineAt` — this is the unmodified ranking's normal behavior, not a new rule, and no
   blacklist/cooldown was added (would have been an invented business rule).
4. **No eligible driver.** Same existing outcome as `attemptAutomaticDispatch()`'s own "no eligible driver" case:
   the order stays at `READY_FOR_PICKUP` and the existing `DispatchAlert` (`NO_ELIGIBLE_DRIVER`) is raised — no
   new alert type, no automatic retry loop beyond the next scheduled sweep tick.
5. **`AUTOMATIC_DISPATCH_ENABLED` unchanged.** The sweep itself is gated by the same existing config key with the
   same semantics; no new config key was introduced for this feature.

**Technical hardening note (Dispatch Hardening milestone, technical only — no business decision changed, so this
is recorded here rather than as a new PD number):** the sweep above is now safe under multiple concurrently-
running app instances. The whole-sweep Redis lock (`dispatch-timeout-sweep-lock`) uses an ownership token and an
atomic Lua compare-and-delete release (`AutomaticDispatchService.acquireSweepLock`/`releaseSweepLock`) instead of
a blind `DEL`, closing a genuine bug where a sweep outliving its own lock TTL could delete a DIFFERENT instance's
legitimately re-acquired lock. The sweep query is now batch-limited (`dispatch.sweepBatchLimit`, technical config,
never `BusinessConfig`) and backed by a new partial index (`idx_deliveries_accept_deadline_at` — see the
`DeliveryAcceptDeadlineIndex` migration). `onModuleDestroy` now awaits any in-flight sweep before shutdown. A
genuine Postgres deadlock was found and fixed under true concurrency between this sweep's release transaction and
a driver's own status-update transaction (both locked Order and Delivery in opposite orders); the fix was
reordering the sweep's own locks to Order-then-Delivery, matching this codebase's existing lock-ordering
discipline elsewhere (see `automatic-dispatch.service.ts`'s own comment on `releaseIfStillExpired`) — not a new
retry-on-deadlock mechanism. See that file's own doc comments for the full design reasoning, and its `.spec.ts` /
the e2e suite's "Dispatch Hardening milestone" describe block for the concurrency proofs (multi-instance
contention, admin-vs-timeout race, driver-progression-vs-timeout race, restart recovery, Redis-outage,
notification-failure).

**Known limitation, deliberately not addressed here (pre-existing, not introduced by this milestone):** if a
process crashes between committing the release transition (`ASSIGNED_TO_DRIVER → READY_FOR_PICKUP`) and the
subsequent re-ranking/reassignment call, the order safely lands at `READY_FOR_PICKUP` with no `DispatchAlert`
raised for it (alerting only happens after a ranking/assignment attempt is actually made) and no automatic retry
beyond the next scheduled sweep tick picking it up on its OWN next expiry check — which won't happen, since its
`acceptDeadlineAt` was already cleared by the release. The identical exposure already existed before this
milestone for a driver's own explicit rejection followed by the same crash window. Candidate open business
question for a future milestone: should Hatly periodically retry ANY orphaned `READY_FOR_PICKUP` order, not only
freshly-ready or freshly-timed-out ones? Not decided here — no new retry-business-rule was invented to fill this
gap.

---

## Derived rules to CONFIRM before implementation (not part of the locked text above)

These are consequences the locked decisions do not spell out. They are listed so nobody has to guess later;
none of them changes what is locked above.

| # | Question | Working assumption (to confirm) |
|---|---|---|
| C1 | ~~3 vendors → 2: is one Additional Vendor Fee removed?~~ | **RESOLVED by the PD-002 clarification** — fee × (remaining active vendors − 1). |
| C2 | ~~Every segment cancelled~~ | **WITHDRAWN — no assumption is made.** Moved to unresolved edge case U1 below. (An earlier draft of this table assumed the order becomes CANCELLED; that assumption is retracted.) |
| C3 | Cancelled segment used a SUBTOTAL_DISCOUNT | The discount leaves the order total (PD-002 rule 5) but the offer's consumption/budget is **not** returned — the existing approved rule ("SUBTOTAL_DISCOUNT rows are never reversed") is kept. |
| C4 | Weighed items when Wallet pays | Wallet is debited on the order total known at checkout; a later weight delta is settled in the cash-on-delivery portion (increase) or credited back to Wallet (decrease). |
| C5 | Unpriced orders (Hatly Service, vendor custom items) | Wallet is an electronic method → not allowed while the price is unknown (same rule as `ELECTRONIC_PAYMENT_NOT_ALLOWED_FOR_UNPRICED_ORDER`). |
| C6 | `PAY_AT_DELIVERY` (weighted-order cash variant) and PICKUP orders | Treated like COD for the "remaining amount" and eligible for Wallet. |
| C7 | ~~How the client asks for Wallet~~ | **RESOLVED by PD-006** — `useWallet` (+ an optional `walletAmountMinor` that can only LOWER the amount); the server decides the amount. |

---

## Unresolved edge cases (need a separate product decision — do NOT implement or assume)

| ID | Edge case | Why it is open |
|---|---|---|
| U1 | A vendor cancellation leaves **zero** active Vendor Segments (the last active segment is cancelled). | PD-002 says the Order is not automatically cancelled because *one* vendor cancelled, but with nothing left to fulfil, whether the Order is cancelled, how the Delivery Fee and any payment are refunded, and what the customer is told are **undecided**. Current behaviour (Group 8, unchanged): the Order simply stays in its status with no active segment, and nothing advances it. |

---

## Group 8 open-item cross-reference

| Group 8 report item | Now |
|---|---|
| 19 — Wallet payment is NOT implemented | Requirement → **PD-001** |
| "Partial cancellation money" (totals/fee/discounts/allocation not recalculated) | Requirement → **PD-002** (clarified) + **PD-003**; the zero-active-segments case remains open → **U1** |
| Delivery fee "may be recalculated" | Forbidden → **PD-003** |
| 20 — no customer wallet endpoint | Still true today; a wallet balance/history endpoint is a prerequisite of PD-001 (see audit) |
| All other Group 8 open items | Unchanged and still open |

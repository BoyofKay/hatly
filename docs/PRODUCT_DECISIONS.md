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

### PD-009 — Delivery Zones (V1 serviceability + pricing without geocoding) and zone-based Hatly Service pricing

Status: **APPROVED — IMPLEMENTED** (backend, Admin Dashboard, customer app, driver app). Migrations
`1700005000000-DeliveryZones` and `1700005100000-HatlyServiceDeliveryFeeMultiplier` (additive, reversible).
**Amends PD-006.A** (the map pin is no longer mandatory) and **supersedes the Phase F Hatly Service formula**.

**A. Delivery Zone.** A named local delivery area (e.g. "بلبيس — أبو نصيب") inside an existing **Service Area**: governorate,
city, name (EN + AR), active flag, **delivery fee in integer minor units** (`bigint`, ≥ 0), display order, and an OPTIONAL
representative point that is **metadata only** — never used for pricing or containment, and never invented (both NULL or both
set). Zones are deactivated, never deleted. Admin: `admin/delivery-zones` — `MANAGE_SERVICE_AREAS` for list/edit/order/point/
activate/deactivate; creating a zone or changing its fee **also** needs `MANAGE_DELIVERY_FEE_MULTIPLIER` (the existing delivery-
pricing permission). Customers: read-only `GET /delivery-zones` (active zones of active service areas).

**B. Saved address.** Every new/edited address carries the `deliveryZoneId` the customer **selected** (must be active); a detailed
free-form address (`line1`) is required; building / floor / apartment / landmark / label are optional; **the map pin is optional**
(latitude + longitude as a pair). Governorate and city are **derived from the zone** by the server. Addresses saved before zones
keep `delivery_zone_id = NULL` and are **never guessed into a zone** — the app asks the customer to choose one
(`zoneStatus: MISSING`); an address whose zone was deactivated reports `UNAVAILABLE`. Geocoding stays assistive only.

**C. Serviceability and the delivery fee (server-authoritative).**
| Address | Serviceability | Base delivery fee |
|---|---|---|
| has a map pin | the existing service-area radius check (unchanged) | the existing `max(minimum, distance fee)` (unchanged) |
| no pin, **active** zone | the zone (its service area restricts branches exactly like a pin's area) | **the zone's fee** |
| no pin, no zone | `ADDRESS_ZONE_REQUIRED` | — |
| zone inactive / deleted / its service area inactive | `DELIVERY_ZONE_UNAVAILABLE` (also when a pin exists — no fallback zone) | — |

`total = baseFee + additionalVendorFee × (vendorCount − 1)` — the ONE existing `composeDeliveryFee` formula for both sources, so
partial vendor cancellation (PD-002/PD-003) works unchanged off the frozen breakdown. The quote fingerprint includes the zone,
its **current fee** and the pricing source: changing the zone, or an admin changing the zone's fee, makes an earlier quote stale
(`QUOTE_STALE`) — a fee is never silently kept. A zone price has no distance and no travel ETA (none is invented).

**D. Hatly Service — ZONE-BASED (amended).** **Hatly Service fee = the address's ACTIVE Delivery Zone fee ×
`HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER`.** The active zone is the ONLY serviceability and pricing source for Hatly Service:
coordinates are optional and never take part in the price (a pinned and a pin-less address in the same zone pay the same; a pin
outside every service-area radius changes nothing). No zone → `ADDRESS_ZONE_REQUIRED` (also for a pinned legacy address — there
is no fallback to distance pricing); inactive zone → `DELIVERY_ZONE_UNAVAILABLE`. The customer's own place stays required by type
(BUY_FROM_PLACE pickup / DELIVER_TO_PLACE destination — never a Hatly default). The multiplier is a Business Config value
(positive, ≤ 10, ≤ 4 decimals, validated on write); its approved default **1.5** is seeded as data by migration — never a
constant in code; unset fails closed. `HATLY_SERVICE_DISTANCE_MULTIPLIER` is retired and read by nothing. The quote shows both
parts (`delivery.hatlyService = { zoneDeliveryFeeMinor, multiplier }`); a quote becomes stale when the zone fee changes
(`INPUTS_CHANGED`) or the multiplier changes (`AMOUNTS_CHANGED`). COD-only / unpriced-order payment rules are unchanged.
Dispatch: no location is invented — a BUY_FROM_PLACE order is ranked from the customer's chosen place; a DELIVER_TO_PLACE order
from a pin-less address has no point to rank from and is left to manual dispatch.

**E. Snapshots.** The order's `delivery_address_snapshot` freezes the zone (`deliveryZoneId` + `deliveryZone` names, city,
governorate) and the written address / coordinates when present; the delivery breakdown freezes `pricingSource`,
`zoneDeliveryFeeMinorUsed` (and, for Hatly Service, `multiplierUsed` + `chargeMinor`). Renaming, re-pricing or
deactivating a zone, or changing the multiplier, never changes a placed order. Customer / admin / driver views show
"المدينة — المنطقة" before the written address; the driver app shows no Maps button when there is no pin.

**F. Dev seed.** `npm run seed:dev-delivery-zones` — `hatly_dev` only, idempotent, additive. Seeds **Abu Naseeb / أبو نصيب**
(the only Belbeis area name verified for this project); further areas are added by an admin (or a `DEV_DELIVERY_ZONES_FILE`).
No coordinates are seeded; the fee defaults to the configured minimum delivery fee.

**G. Maps deferred — `MAPS_PROVIDER=none` (APPROVED by the owner 2026-10-24 — IMPLEMENTED).** A deployment may run with Google Maps
deliberately disabled (no Google Cloud billing/key needed). It is an explicit, reversible environment setting, allowed in production;
the development stub `deterministic` stays forbidden there. While Maps are disabled:
1. **Pricing + serviceability:** the address's ACTIVE Delivery Zone is the ONLY source for EVERY delivery order — registered vendors
   too, pin or not (the Hatly Service rule of D applied to all; **amends C row 1** for this mode). A pin is kept on the order for the
   driver but never priced and never decides serviceability (it is only sanity-checked to lie in Egypt). No zone →
   `ADDRESS_ZONE_REQUIRED`; inactive zone / service area → `DELIVERY_ZONE_UNAVAILABLE`; a branch of another service area →
   `VENDOR_OUTSIDE_DELIVERY_AREA`. Quote and order use the same planner and the frozen breakdown says `pricingSource: DELIVERY_ZONE`
   (no distance, no ETA — none is invented).
2. **Dispatch ranking:** drivers are ranked by **straight-line (haversine) distance** to the first pickup point — an ordering heuristic
   only, never a price and never shown to anyone; every other eligibility rule is unchanged (online, available, approved, known
   location, same service area). **Bicycle drivers are not auto-ranked** (their limit is a road-distance rule that cannot be verified);
   an admin with `OVERRIDE_DISPATCH` can still assign one. Each ranking logs `dispatch ranking basis=STRAIGHT_LINE`.
3. **Address search / place suggestions** (`/geo/search`, `/geo/reverse`) answer "nothing" (no error); the customer types the address.
   `POST /cart/delivery-fee-quote` (coordinates only, unused by the current app) fails closed with `DELIVERY_FEE_UNAVAILABLE`.
4. **Visibility:** a boot WARN ("Maps DISABLED") and an env-validation warning; no Google request is ever made (`UnavailableMapProvider`
   throws `MAPS_DISABLED` on every call).
5. **Back to Google:** add `GOOGLE_MAPS_API_KEY` and set `MAPS_PROVIDER=google` — the rules of A–F apply again unchanged.
Tests: unit (`env.validation`, `location.module`, `unavailable-map.provider`, `delivery-fee-calculation`, `driver-ranking`,
`checkout-planner`) and e2e `105-maps-disabled`.

### PD-011 — Two ALTERNATIVE address methods (GPS / manual) and the Hatly & Wasally multiplier (amends PD-009 B, C, D, G)

Status: **APPROVED by the owner 2026-10-30 — IMPLEMENTED LOCALLY, NOT DEPLOYED.** Migration `1700006100000-AddressMode` (additive: one nullable column + CHECK
constraints; existing addresses keep `mode = NULL`).

**A. Two methods, never two steps.** Every NEW address uses exactly one method (`addresses.mode`):
- **MANUAL** — the customer picks an active delivery area (zone) and writes the detailed address. No GPS permission, no map, no coordinates are collected
  or accepted. Base delivery fee = the selected zone's fixed fee (Admin → Delivery Zones).
- **GPS** — the customer's current location / a map point; the coordinates ARE the address (no zone, no typed text required; `line1` is stored as `''`).
  Serviceability = the existing **service-area coverage** check (radius is Admin-configured, never hardcoded), validated on the server. Base delivery fee =
  the actual **road distance** (Google Maps provider) priced with the Admin **price per 100 m** and **minimum fee** and the existing rounding
  (`max(minimum, rounded distance ÷ 100 × rate)`), computed at checkout from the vendor branch(es) → the customer. A point is NOT required to map to a zone.
- GPS needs the road-distance provider: with `MAPS_PROVIDER=none` (Production until Maps + billing are authorized) it is reported **unavailable**
  (`DISTANCE_PRICING_UNAVAILABLE`, `GET /addresses/capabilities`) — never silently priced by a zone fee or a straight-line distance.
- An address with no mode (saved before this decision) behaves exactly as before. Editing preserves the method; switching is explicit and CLEARS the other
  method's fields (the app says what is discarded first).

**B. Hatly and Wasally** use the SAME two base-pricing methods, then ONE multiplier: `final fee = base fee × HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER`
(Business Config, approved default 1.5, Admin → Settings; never hardcoded; never applied to the per-100 m rate; ordinary delivery = base fee only).
MANUAL base = the zone fee; GPS base = the road-distance fee of the order's route (Hatly: place → customer; Wasally: customer → place). The order freezes the
method, base fee, multiplier, final fee, the distance inputs and the address method; later changes never alter it.

**C. Out of scope / unchanged:** the Hatly and Wasally route-ENDPOINT defaults and selection (no default points are invented — `HATLY_SERVICE_DEFAULT_*` stay unread);
the Egyptian phone policy; wallet money-math.

### PD-012 — Hatly & Wasally ROUTE ENDPOINTS (origin → destination, customer choice or per-service default) (amends PD-011 B/C, supersedes the 2026-10-02 "customer-supplied only" location rule)

Status: **APPROVED by the owner 2026-10-30 — IMPLEMENTED LOCALLY, NOT DEPLOYED.** Migration `1700006200000-AdHocRouteLabels` (additive: two nullable label columns on `cart_vendor_groups`).

**A. Every Hatly / Wasally request has a route ORIGIN → DESTINATION.** Each end is, in this order: the customer's own choice → the service's configured default (Admin → Settings) → otherwise the request is refused with a clear code. The customer's own delivery address is **never silently substituted** for a missing end (the customer may pick it explicitly, like any saved address with a pin).
- **Hatly ("هاتلي من مكان", `BUY_FROM_PLACE`)**: origin default `HATLY_SERVICE_DEFAULT_PICKUP_LOCATION`, destination default `HATLY_SERVICE_DEFAULT_DESTINATION_LOCATION`; both changeable independently.
- **Wasally ("وصّلي لمكان", `DELIVER_TO_PLACE`)**: the **origin is always the customer's** (current GPS, a saved address with a pin, or a map point — never assumed to be home; there is no origin default); destination default `WASALLY_SERVICE_DEFAULT_DESTINATION_LOCATION`, changeable.
- Hatly and Wasally **never share a default**. Defaults are `{ latitude, longitude, label }`, validated on write (inside Egypt, label 1-120 chars), **never seeded or invented**; an Admin clears one with `DELETE /admin/business-config/:key` (only these three keys are clearable). Codes: `DELIVER_TO_PLACE_ORIGIN_REQUIRED`, `HATLY_DEFAULT_PICKUP_NOT_CONFIGURED`, `HATLY_DEFAULT_DESTINATION_NOT_CONFIGURED`, `WASALLY_DEFAULT_DESTINATION_NOT_CONFIGURED`.

**B. Pricing is unchanged in principle (PD-011):** the customer's delivery-address METHOD decides the base fee — MANUAL/legacy: the selected zone's fixed fee (the route does not change it); GPS: the actual road distance of the **resolved route origin → destination**, priced with the Admin rate per 100 m and minimum fee. Final fee = base × `HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER`, once. GPS with Maps unavailable stays `DISTANCE_PRICING_UNAVAILABLE` (never a zone fallback).

**C. Server-authoritative and frozen.** The planner resolves the route for the quote AND the order. The quote shows it (origin → destination, label, source CUSTOMER/DEFAULT); the quote fingerprint includes both ends, so changing an end (or the Admin default it fell back to) makes an earlier quote stale (`QUOTE_STALE`). The order freezes the route (coordinates, labels, sources) in the delivery breakdown and in the segment's pickup/destination snapshot slots; later default changes never alter a placed order. Old orders (breakdown without `route`) are untouched.

**D. API.** `GET /hatly-service/route-defaults` (customer), `PATCH /cart/adhoc-route` (each end independently; `null` = back to the default), `pickupLabel` / `destinationLabel` on `POST /cart/adhoc-items`, `deliveryRoute` on the customer order details.

**E. Owner must enter (nothing is invented):** the real coordinates + names of the three defaults (Dashboard → Settings → "Hatly & Wasally default route points"). Until then customers choose both ends themselves (the app says so).

### PD-013 — Order operations: partial rejection, on-behalf handling, branch acceptance mode, never-silent dispatch, Hatly/Wasally readiness (APPROVED 2026-10-30; implemented locally, NOT deployed)

**A. Partial rejection (extends PD-002/PD-003/PD-004; no money rule changed).** A vendor (or Hatly operations on its behalf) rejects ONE vendor part with a **required reason** (≤ 500 chars; empty/blank is a 400). Only that segment is cancelled; the others continue. The base delivery fee stays fixed, the additional-vendor fee drops per rejected vendor, SUBTOTAL_DISCOUNT / Flash Sale allocation behave exactly as PD-002/PD-003 already define, there is no new coupon policy and no gateway refund. When the **last** active segment is rejected the whole order is cancelled and refunded. A repeated or concurrent rejection never refunds twice (the second is a 400; the refund writes are atomic with the cancellation and idempotency-keyed). One `ORDER_PART_CANCELLED` customer notification per order (the `(order, type)` uniqueness is kept).
**Manual Transfer refunds.** A refund against an approved transfer stays a ledger **obligation** (`MANUAL_TRANSFER_REFUND_RECORDED`). Operations (permission `VERIFY_MANUAL_PAYMENTS`) mark it **sent** once the money really went out (`refund_payouts`, one marker per refund, a repeat is a 409). The customer and the Dashboard say "sent" only then. An unverified transfer shows "will be settled after review" (PD-004), never "refunded".

**B. Who may act.** Vendor staff use the Vendor Dashboard. Hatly operations act **on the vendor's behalf** through `PATCH admin/orders/segments/:id/status`, permission `MANAGE_ORDER_FULFILMENT` (SUPER_ADMIN always) — the SAME transition code as the vendor endpoint (state table, payment gate, readiness, dispatch, money). Every transition writes `order_vendor_segment_events` in the same transaction: actor user, role, previous/new state, time, reason, on-behalf flag. The customer sees what happened and why, never which staff member (role shown as "Hatly"/"vendor").

**C. Acceptance mode is per branch** (`vendor_branches.auto_accept_enabled`, default manual). Automatic = the new segment is created **CONFIRMED** (accepted only — never preparing, never ready) with a SYSTEM history row. Changed on the branch page (`MANAGE_VENDOR_COMMISSION`). The old global `VENDOR_SEGMENT_AUTO_ACCEPT_ENABLED` setting was dead (nothing read it) and is retired from the Dashboard and the backend reader; the config row/enum value stays so the seeded row remains valid.

**D. Dispatch is never silent.** Automatic assignment first. Otherwise exactly one **open** alert per (order, reason): `AUTO_ASSIGN_DISABLED`, `NO_ELIGIBLE_DRIVER`, `ASSIGNMENT_ERROR`, `DRIVER_NOT_RESPONDING` (after 3 consecutive unanswered attempts). Every attempt is a `dispatch_attempts` row. A successful assignment (automatic or manual) resolves the order's open alerts. Admin assign/reassign stays the fallback. A dispatch failure never makes an already-committed vendor transition look failed (the error is stored as an ASSIGNMENT_ERROR alert, not thrown at the vendor).

**E. Hatly & Wasally segments have no vendor.** Once the existing payment gate passes (COD/pay-at-delivery/wallet at once; Manual Transfer only after approval) the segment moves to READY_FOR_PICKUP by itself through the same state machine (SYSTEM actor, full history). Triggered at order creation and by a 10-second pass for approvals. **Consequence recorded for the owner:** these orders leave PENDING immediately, so the customer's own cancel window (PENDING/CONFIRMED only) closes at once; an admin can still cancel. **Resolved by PD-014 A:** the customer may cancel until a driver is assigned.

**F. Operations visibility.** Control Tower `operations` facts (pending acceptance, **5-minute** overdue threshold, `expectedReadyAt` overdue, open alerts by reason, refunds to send, partially rejected active orders, `actionRequired`), a Dashboard navigation counter and persistent banner polling every 20 s, manual-address vendor filtering by `deliveryZoneId`.

**Resolved by PD-014 B:** coupon / discount restoration on a rejected segment. **Left as before:** a driver becoming unavailable after assignment is handled by the existing timeout/hand-back flow and manual reassignment.

### PD-014 — Customer cancellation of Hatly / Wasally orders, and discount / coupon restoration on rejection or cancellation (APPROVED 2026-10-30; implemented locally, NOT deployed)

**A. Customer cancellation of Hatly / Wasally orders (resolves the open point in PD-013 E).** A Hatly or Wasally order has no vendor: it is READY_FOR_PICKUP as soon as the payment gate passes (COD / pay-at-delivery / wallet at once; Manual Transfer after approval). The customer may cancel it **until a driver is assigned** — i.e. while the order is PENDING, CONFIRMED (e.g. a Manual Transfer awaiting approval — unchanged), or **READY_FOR_PICKUP and made only of service segments**. From ASSIGNED_TO_DRIVER on the customer is refused (`400 ORDER_NOT_CANCELLABLE_BY_CUSTOMER`). An order with a vendor part keeps the PD-005/006 rule (blocked once a vendor part is preparing/ready); a service segment's automatic "ready" never blocks a mixed order (carts cannot mix vendor and service items today, so this is defensive). One definition, `customerCancellationBlock`, serves the customer endpoint, the order-details `customerCanCancel` flag and — re-checked under the order lock — the state machine. Admin cancellation is unchanged (same transition table and permissions).
**Money (existing whole-order cancellation, unchanged):** wallet → one idempotent `ORDER_REFUND` credit of what the wallet paid; COD → the amount due simply disappears (no refund event); Manual Transfer PAID → one `MANUAL_TRANSFER_REFUND_RECORDED` **obligation** of the amount paid, "sent" only when operations mark it; unverified transfer → the PD-004 pending entitlement. Open dispatch alerts of the cancelled order are resolved; a driver is freed only if one actually holds the order (a cancellation from READY_FOR_PICKUP frees nobody — a stale delivery row may name a driver who is on another order by now).
**Race with driver assignment.** Both run in one transaction that takes the **order row lock first** and re-reads the status under it: the customer path (segments locked first, then order) re-checks READY_FOR_PICKUP-service-only → CANCELLED; the assignment (order lock, status must be READY_FOR_PICKUP, delivery row, driver, READY→ASSIGNED in the same transaction) re-checks the status. Whichever takes the lock second sees the other's result: a cancelled order cannot be assigned (`409 ORDER_NOT_ASSIGNABLE`, nothing written, driver stays free) and an assigned order cannot be cancelled by the customer (`400`). Repeated/concurrent cancellations: one wins, the rest are `400 ORDER_ALREADY_CANCELLED`, the refund is idempotency-keyed (`order-refund:<order>:cancel`; transfers: one refund per payment).

**B. Discount / coupon restoration.** *How the existing model works:* a coupon is an Offer with a code (SUBTOTAL_DISCOUNT); it applies to ONE vendor branch's segment and never spreads over other vendors; automatic SUBTOTAL_DISCOUNT offers work the same way, per segment. The discount is frozen on the segment (`offerDiscountAmountMinor`) and consumed in ONE `offer_consumptions` row per segment (`discount_applied_minor`), counted by `offers.consumed_units_count` (usage limit), `offers.consumed_discount_minor` (budget cap) and the per-customer limit (rows of that customer). Flash-sale discounts are separate, per item, and already reversed on rejection.
*Rule (PD-014):* when a vendor part is rejected, **the entire discount attributable to that part is given back — and only that part's**: restored = that segment's consumption row (ratio 100 % of the part; there is no apportioning over other vendors and therefore **no rounding step** — every amount is an integer in minor units that was frozen at checkout, and the order's discount becomes the sum of the remaining parts' frozen discounts, so `total = subtotal + delivery − discount` keeps holding). Restoration = mark that row reversed (kept as history: `is_reversed`, `reversed_at`), `consumed_units_count − 1`, `consumed_discount_minor − discount_applied_minor`, each floored at 0 and never by more than the row recorded (an offer is never credited beyond what was consumed), and the per-customer limit counts only non-reversed rows (so the customer can use the code again). When the last part is rejected or the whole order is cancelled (customer, admin, vendor) every still-unreversed segment discount is restored. Exactly once: only `is_reversed = false` rows are touched, under the order lock and a lock on the Offer row; a repeat or concurrent request finds nothing.
*Interaction with the refund:* **restoring the entitlement moves no money.** The customer never paid the discount, so the refund is computed from the reduced order total by the existing PD-002/003/004 logic — rejected part = its subtotal − its discount, plus the additional-vendor fee that disappears (base delivery fee fixed) — and wallet / Manual Transfer / amount-due follow that amount. Example: part B 200.00 with a 12.00 coupon, 2 vendors → the customer is refunded 200.00 − 12.00 + 5.00 = 193.00 (wallet credit, or transfer obligation, or the COD amount due shrinks by it) **and** the coupon's use/budget comes back; the 12.00 is not credited a second time. Supersedes the earlier "SUBTOTAL_DISCOUNT rows are never reversed" characterization (C3).
*Financial event (PD-015):* the informational `HATLY_FUNDED_OFFER_DISCOUNT_RECORDED` event is never amended; a compensating `HATLY_FUNDED_OFFER_DISCOUNT_RESTORED` event is appended instead (see PD-015); a coupon whose offer window has since ended is restored in the counters but is naturally not usable after `endAt`.

### PD-015 — Compensating event for the Hatly-funded offer discount (APPROVED 2026-10-30; implemented locally, NOT deployed)

**What exists.** At order creation one INFORMATIONAL event `HATLY_FUNDED_OFFER_DISCOUNT_RECORDED` (key `hatly-funded-offer-discount:<orderId>`, amount = the order's whole offer discount: flash-sale + subtotal/coupon) records the promotional cost Hatly funds. It moves no money and never enters vendor/driver settlement (commission is on the pre-offer subtotal). Financial events are append-only: a correction is a NEW event, never an edit (FinancialEvent's own rule).
**What is added.** `HATLY_FUNDED_OFFER_DISCOUNT_RESTORED` — the compensating event. Whenever PD-014 reverses an offer consumption (a vendor part rejected, or the order cancelled by customer / admin / vendor), **one** compensating event is appended **per reversed consumption row**: INFORMATIONAL, `amountMinor` **positive** (= that row's `discount_applied_minor`, the amount restored), `relatedEventId` = the original event, `orderVendorSegmentId` = the affected segment (a flash-sale row's segment is its item's), idempotency key `hatly-funded-offer-discount-restored:<consumptionId>`, written in the SAME transaction as the reversal (`FinancialEventService.record(params, manager)`), so it commits or rolls back with the rejection/cancellation. The original event is never modified or deleted.
**Net value.** `net = recorded − restored` (`FinancialEventService.hatlyFundedDiscountSummary`; also `hatlyFundedDiscount` on the admin order detail, shown on the order page). For every order that recorded the original, `net` always equals the discount the order still carries (`orders.discount_minor`) — and is 0 after a full cancellation. The compensation is never also counted as a refund: the customer's money (wallet / transfer / amount due) is derived from the order total as before (PD-002/003/004/014), and these events carry no money.
**Idempotency / concurrency.** Triple guard: (1) the reversal only touches `is_reversed = false` consumptions under the order lock and a lock on the Offer, so a repeat finds nothing to compensate; (2) the per-consumption idempotency key (unique index) makes a second write return the first; (3) the write is inside the caller's transaction. Concurrent rejection/cancellation: one wins, the others find nothing (tested with 3–4 parallel requests, e2e and real-PostgreSQL integration).
**Settlement / reports.** Settlement reads only VENDOR_COMMISSION / DRIVER_* events; the new event is not read by it. It deliberately carries **no `vendorBranchId`** (settlement derives a vendor's "first activity" from any event with that column; this informational event must not move it) — the branch is reachable through the segment. A report of Hatly's promotional cost must read `recorded − restored` (the summary), never the original alone.
**Edge cases.** An order that never recorded the original event (none exists for orders with a discount since Phase G) is not compensated — a restoration without an original would make the net negative; the entitlement itself is still restored. Orders cancelled BEFORE this release have no compensation (their original event stays as recorded); no backfill was done — owner decision if wanted.

### PD-016 — Final owner decisions of 2026-10-31: C4 confirmed, no product substitution, unavailable-product resolution (APPROVED — specification only; nothing implemented yet)

These decisions are FINAL. They supersede the earlier proposals in the Marketplace Transformation brief (customer approval of a weight price difference; replacement products).

**A. C4 is approved exactly as defined, with no customer-approval step.**
1. The actual-weight price difference is settled as C4 says: the wallet is debited on the total known at checkout; an increase is settled in the cash-on-delivery portion, a decrease is credited back to the wallet. The customer is not asked to approve the difference and the order is not paused for it.
2. Unchanged and still authoritative: the formula `round(unitPriceMinor × weightGrams / 1000)` on the frozen unit price, "first actor wins" (Vendor or Driver) in `OrderItemWeightRecordService`, the single correction path `applyOrderItemAmountDelta`, and the existing tests (backend e2e `80-weighted-payments`, the weight specs). Customers still cannot write the final weight.
3. Verified 2026-10-31: no weight-approval table, endpoint, screen, notification or test exists in the repository, so there is nothing to remove from code. None will be added. Any wording elsewhere that asks for customer approval of a weight difference is withdrawn.
4. Still in scope (not touched by this decision): the vendor-defined minimum weight and step per product, and the customer estimate before adding to the cart.

**B. Product substitution is removed from the program.**
No replacement suggestion, replacement selection, replacement approval, replacement notification type, deep link, data model, API, screen or acceptance test will be built. Verified 2026-10-31: the repository contains none of these today.

**C. A product is unavailable after the order was placed — the approved workflow.**
1. **Who and when.** The vendor (or Hatly operations on the vendor's behalf, permission `MANAGE_ORDER_FULFILMENT`) marks one or more items of the vendor's OWN segment unavailable for this order, before the segment is picked up and while it is not cancelled. A vendor never touches another vendor's segment or the parent order.
2. **What the customer is asked.** Exactly two options: **continue the order without the unavailable item(s)**, or **cancel the entire order**. There is no replacement, no price increase, no partial acceptance of a different product.
3. **Customer response.** Recorded with the choice, timestamp and channel (app, or phone/WhatsApp recorded by an Operations employee together with that employee's identity). The first valid response wins; repeats are idempotent. **Silence is never consent and nothing happens automatically on a timeout.**
4. **No response.** The case stays an open operational exception, appears in the Operations queue and notifies the relevant staff. Operations contacts the customer by phone or WhatsApp, and contacts the vendor when needed, and **records the customer's documented decision** (who, when, what). Operations may execute only what the customer decided; it cannot consent for the customer.
5. **Continue without the item(s).** The item amount leaves the order through the existing correction path (`applyOrderItemAmountDelta`, delta = −the item's current amount), and money follows the existing approved rules, nothing new: cash on delivery — the amount due falls; wallet — the difference is credited back (C4); manual transfer — a refund obligation under PD-004, "sent" only when Operations marks it; the delivery fee stays fixed (PD-003); commission is recognised later from the delivered snapshot as today; an already-frozen discount is not recalculated, exactly as for a weight decrease. If this would remove every item of the order, "continue" is not allowed — the order is cancelled instead.
6. **Cancel the entire order.** Executed only through the existing cancellation paths, the existing state machine and the existing authorization (Operations needs Supervisor/Manager-level authority and a documented reason; refunds, coupon restoration and the compensating event follow PD-014/PD-015). The customer's choice is recorded either way. Default taken while building this: an in-app "cancel" choice is recorded and placed in the Operations queue for execution; it does not create a new customer-side cancellation permission (PD-005/PD-014 stay as they are).
7. **Record and visibility.** Every step is in the order timeline and the audit log (actor, role, previous/new state, reason, correlation id). Delay alerts to the vendor and escalation to Operations follow the Notification design; the customer is not sent repeated reminders.
8. **Reuse, no duplicates.** One operational exception record (introduced for the Operations Command Center), the existing order notes, the existing customer notification channel and deep link to the order, and the existing financial helper. No substitution tables or notification types are created.
9. **Stock.** Marking an item unavailable for one order does not by itself change the product's catalogue availability or stock; the vendor does that as a separate action.

### PD-010 — Pickup completion (U2) and redispatch after a driver hand-back (U3)

Status: **APPROVED — IMPLEMENTED** (backend + dashboard + customer app). Migration `1700005300000-OrderStatusCollected`
(adds `COLLECTED` to `orders_status_enum`; `down` is a no-op, same convention as `OrderStatusFailedDelivery`).

**A. Pickup completion (U2)**
1. **State.** `READY_FOR_PICKUP → COLLECTED`, terminal (no transition out of it). Only a `PICKUP` order can be collected
   (`409 NOT_A_PICKUP_ORDER`); `DELIVERED` stays delivery-only. A pickup order can never reach `ASSIGNED_TO_DRIVER` through
   any endpoint (`409 PICKUP_ORDER_NOT_DISPATCHABLE`, enforced in the state machine under the order lock).
2. **Actor.** The branch's vendor staff (`VENDOR` / `VENDOR_MANAGER`, ownership checked by branch — another branch gets the
   same 404 as a non-existent order); an `ADMIN` holding `MANAGE_ORDER_ISSUES` as the support fallback (the existing rule
   for an admin moving an order); `SUPER_ADMIN`. Customers and drivers cannot. Immediate — no OTP, QR or proof.
3. **At COLLECTED** (same mechanisms as a delivery order, nothing parallel): `VENDOR_COMMISSION_RECOGNIZED` per segment —
   same rate rule and idempotency key (`vendor-commission:{segmentId}`) as at a delivery's `PICKED_UP`, so it is booked at
   most once; loyalty earning (inside the transition's transaction, like `DELIVERED`); best-selling counts; customer push
   `ORDER_COLLECTED`. Nothing driver-side: no driver commission, no reimbursement, no proof of delivery, no cash remainder.
4. **Weighed items.** The existing "weight recorded before it is finally picked up" gate applies to `COLLECTED` too.
5. **Payment.** A **new** pickup order is cash at the counter only (`COD`): Wallet, Manual Transfer and Pay at Delivery are
   not offered by the quote and refused by the server (`400 PICKUP_CASH_ONLY`). Existing pickup orders keep their method.
6. **Never collected.** Unchanged: the vendor (or an admin) cancels it at `READY_FOR_PICKUP`.
7. **Derived (no new rule):** `COLLECTED` is listed with `DELIVERED` wherever the meaning is "the customer received the
   order": the customer's "completed" tab, the ETA (no countdown), vendor/product ratings (driver rating stays
   delivery-only — there is no driver), segment locking and weight-recording closure.

**B. Redispatch after a driver hand-back (U3)**
1. When a **driver** hands an assigned order back (`ASSIGNED_TO_DRIVER → READY_FOR_PICKUP`, driver app or the generic
   endpoint), automatic dispatch makes **one immediate attempt** — only while `AUTOMATIC_DISPATCH_ENABLED` — through the
   existing `attemptAutomaticDispatch` (same ranking, atomic assignment, locks, push, alerts).
2. The releasing driver is **excluded from that attempt only** (no blacklist, no cooldown); the ranking itself is unchanged.
3. Nobody else eligible → the existing `NO_ELIGIBLE_DRIVER` alert; the order waits for an admin. No delay, no retry loop.
4. `reassignmentCount` is not incremented (same as a timeout re-assignment); it counts admin reassignments.
5. An admin who assigns it first wins (the attempt stops on `ORDER_NOT_ASSIGNABLE`); a failure of the attempt never fails
   the driver's request (logged; the order stays visible as "released" in the Control Tower).
6. Not changed: an admin-initiated release, and the timeout sweep (PD-008, which may legitimately re-pick the same driver).

**C. Technical note.** A driver's status change re-checks delivery ownership under the order lock (Operational Completion
milestone), so a driver who was just reassigned away can never advance the order.

### Control Tower milestone — operational hardening (technical; no new business rule)

Status: **IMPLEMENTED**. Migration `1700005200000-DriverAvailabilityReflectsActiveDelivery` (data correction).

- **Admin Control Tower** (`/control-tower`; read-only `admin/control-tower/summary|deliveries` need `VIEW_ORDERS`, the dispatcher
  driver picker `admin/control-tower/drivers` needs `ASSIGN_REASSIGN_ORDERS`). Every figure is a query over existing data — no new
  state, no polling, no retry rule. "Waiting without a dispatch alert" is reported as a fact (it includes the PD-008 orphan
  case); no automatic retry interval was introduced. `/dispatch` now forwards to it.
- **Assignment is atomic.** Order status check, driver lock-out, delivery row, alert resolution and the
  `READY_FOR_PICKUP → ASSIGNED_TO_DRIVER` transition are one transaction (previously a refused assignment could leave a driver
  locked out and the delivery pointing at an un-notified driver). **Reassignment** validates everything first and releases +
  re-assigns in one transaction; refusals change nothing (`ORDER_NOT_REASSIGNABLE`, `DRIVER_UNAVAILABLE`,
  `DRIVER_ALREADY_ASSIGNED`, and `ASSIGNMENT_CHANGED` when the caller's `expectedCurrentDriverId` is stale).
- **DispatchAlert** is now resolved by the assignment that fixes it (its documented contract; nothing set `resolvedAt` before).
- **A released order** (back to `READY_FOR_PICKUP`) no longer reports the driver it was released from.
- **`OVERRIDE_DISPATCH` for SUPER_ADMIN**: in-handler permission checks now apply the guard's rule (SUPER_ADMIN holds all).
- **Driver availability** = "has no active delivery": a new driver is available (previously defaulted false, so admin-created
  drivers could never be dispatched); existing rows realigned by migration.
- **PICKUP orders are never assigned a driver** (PD-006.C: the customer collects them; no address) — neither automatically nor
  manually. **Open product question (not decided here):** the state machine has no "customer collected" step, so a PICKUP order
  has no defined completion after `READY_FOR_PICKUP` (see U2). **Resolved by PD-010.**

### Operational Completion milestone (technical; no new business rule)

Status: **IMPLEMENTED**. No migration.

- **Driver-row writes are column-targeted.** The location heartbeat, online toggle, verification, commission rate and vehicle
  type used to `save()` the whole driver row read moments earlier — a concurrent assignment's `is_available = false` was then
  written back to `true` (a busy driver offered new orders). Each writer now updates only its own column(s).
- **A driver's status change re-checks ownership under the order lock** (`OrderTransitionParams.actingDriverId`, Order → Delivery
  lock order). Before, a driver whose order an admin reassigned at that instant could still move it (reproduced: `PICKED_UP`
  by the old driver while the delivery named the new one).
- **Released orders are visible, not retried.** An order back at `READY_FOR_PICKUP` because its driver was released (driver
  hand-back, or the timeout sweep) is flagged on its Control Tower row (`released: { at, byRole }`, from its status history),
  filterable (`?releasedOnly=true`), and counted under "needs attention" when no open alert carries it
  (`releasedAwaitingManualAssignment`). No retry was added in this milestone (U3). **Superseded by PD-010 B:** a driver
  hand-back now gets one immediate redispatch without that driver; the flag/count still show what is left waiting.
- **Driver vehicle type** is managed by an admin with `MANAGE_DRIVERS` (`PATCH admin/drivers/:id/vehicle-type`, `null` clears;
  the active catalog for the picker: `GET admin/drivers/vehicle-types`). Only an existing, **active** `vehicle_types` row can be
  given; no category is invented. It stays **optional for dispatch** (only an `isBicycle` type is distance-limited, at ranking
  time); a change applies from the next ranking and never revisits an assignment already made.
- **Pickup orders are findable**: admin order search filters by `fulfillmentType`; the Control Tower's "pickup orders ready"
  count opens that list. They are still never assigned a driver (completion: PD-010 A).
- **Error messages**: Vendor pages and the login page read the backend error envelope. Login keeps "Invalid phone number or
  password." for a 401 only; a 429 (rate limit / account lock) now says so instead of claiming the password was wrong.

---

## Derived rules to CONFIRM before implementation (not part of the locked text above)

These are consequences the locked decisions do not spell out. They are listed so nobody has to guess later;
none of them changes what is locked above.

| # | Question | Working assumption (to confirm) |
|---|---|---|
| C1 | ~~3 vendors → 2: is one Additional Vendor Fee removed?~~ | **RESOLVED by the PD-002 clarification** — fee × (remaining active vendors − 1). |
| C2 | ~~Every segment cancelled~~ | **WITHDRAWN — no assumption is made.** Moved to unresolved edge case U1 below. (An earlier draft of this table assumed the order becomes CANCELLED; that assumption is retracted.) |
| C3 | Cancelled segment used a SUBTOTAL_DISCOUNT | The discount leaves the order total (PD-002 rule 5) but the offer's consumption/budget is **not** returned — the existing approved rule ("SUBTOTAL_DISCOUNT rows are never reversed") is kept. |
| C4 | Weighed items when Wallet pays | **APPROVED exactly as defined (owner, 2026-10-31 — see PD-016 A; it supersedes any customer-approval step).** Wallet is debited on the order total known at checkout; a later weight delta is settled in the cash-on-delivery portion (increase) or credited back to Wallet (decrease). |
| C5 | Unpriced orders (Hatly Service, vendor custom items) | Wallet is an electronic method → not allowed while the price is unknown (same rule as `ELECTRONIC_PAYMENT_NOT_ALLOWED_FOR_UNPRICED_ORDER`). |
| C6 | `PAY_AT_DELIVERY` (weighted-order cash variant) and PICKUP orders | Treated like COD for the "remaining amount" and eligible for Wallet. |
| C7 | ~~How the client asks for Wallet~~ | **RESOLVED by PD-006** — `useWallet` (+ an optional `walletAmountMinor` that can only LOWER the amount); the server decides the amount. |

---

## Unresolved edge cases (need a separate product decision — do NOT implement or assume)

| ID | Edge case | Why it is open |
|---|---|---|
| U1 | ~~A vendor cancellation leaves **zero** active Vendor Segments~~ **RESOLVED by PD-013 A** — the whole order is cancelled and refunded. (Original wording:) A vendor cancellation leaves **zero** active Vendor Segments (the last active segment is cancelled). | PD-002 says the Order is not automatically cancelled because *one* vendor cancelled, but with nothing left to fulfil, whether the Order is cancelled, how the Delivery Fee and any payment are refunded, and what the customer is told are **undecided**. Current behaviour (Group 8, unchanged): the Order simply stays in its status with no active segment, and nothing advances it. |
| U2 | ~~Completion of a PICKUP order~~ | **RESOLVED — PD-010 A.** |
| U3 | ~~Automatic retry of a released order~~ | **RESOLVED — PD-010 B** (driver hand-back). A timeout release keeps PD-008's own behaviour. |

---

## Group 8 open-item cross-reference

| Group 8 report item | Now |
|---|---|
| 19 — Wallet payment is NOT implemented | Requirement → **PD-001** |
| "Partial cancellation money" (totals/fee/discounts/allocation not recalculated) | Requirement → **PD-002** (clarified) + **PD-003**; the zero-active-segments case remains open → **U1** |
| Delivery fee "may be recalculated" | Forbidden → **PD-003** |
| 20 — no customer wallet endpoint | Still true today; a wallet balance/history endpoint is a prerequisite of PD-001 (see audit) |
| All other Group 8 open items | Unchanged and still open |

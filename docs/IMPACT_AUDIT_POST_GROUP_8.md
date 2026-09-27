# Impact audit — PD-001 (Wallet payment), PD-002 (Partial vendor cancellation), PD-003 (Fixed delivery fee)

Audit only. **No behaviour was changed** by this task. Decisions: [`PRODUCT_DECISIONS.md`](./PRODUCT_DECISIONS.md).
Paths are relative to `apps/backend/`. Findings are from reading the code as of Group 8's close
(unit 96/1216, integration 13/221, E2E 15/213 — all green).

## 0. Current state in one paragraph

Checkout accepts `COD | ONLINE | MANUAL_TRANSFER | PAY_AT_DELIVERY` (`CreateOrderDto`); `ONLINE` is rejected;
only `MANUAL_TRANSFER` writes a `payments` row. The Wallet is a derived-balance, append-only ledger
(`wallet_transactions`) that is only credited today (loyalty conversion, approved cash remainder); the
ledger types `ORDER_PAYMENT` / `ORDER_REFUND` and a `chk_wallet_transaction_type` CHECK already allow them,
and there is no customer wallet endpoint. `Order.deliveryFeeMinor` is **base fee + additional-vendor charge combined**;
the split is only preserved in `deliveryFeeBreakdownSnapshot` (`additionalVendorChargeMinor`). A vendor cancelling its
segment changes the segment status and (Group 8) restores stock and stops commission, but does **not** touch
`orders.subtotal_minor / discount_minor / total_minor`, offers, or any payment.

---

## 1. PD-001 — Wallet payment at checkout

### 1.1 Files/modules that will change
| Area | File(s) | Change needed |
|---|---|---|
| Request contract | `src/modules/orders/dto/create-order.dto.ts` | Express "use wallet" (full/partial) — new field or new method value; reject Wallet + `MANUAL_TRANSFER`/`ONLINE`. |
| Order model | `src/modules/orders/entities/order.entity.ts` (`paymentMethod` union, `payment_method varchar(20)`) | Represent wallet-applied amount and the cash-due remainder. |
| Checkout transaction | `src/modules/orders/order-creation.service.ts` (single `dataSource.transaction`; payment block ~L275–310, `Payment` insert ~L674) | Lock the customer, compute balance, append `ORDER_PAYMENT` debit, write payment record, compute cash due — all in the existing transaction. |
| Wallet service | `src/modules/wallet/wallet.service.ts` | Manager-aware `getBalance`, a debit path that refuses to go below zero (today `recordTransaction` accepts any non-zero delta). |
| Payments | `src/modules/payments/entities/payment.entity.ts` (`method 'COD'\|'ONLINE'\|'MANUAL_TRANSFER'`), `payment-state-machine.service.ts` | A wallet payment record (method fits `varchar(20)`; no DB CHECK on `method`). |
| Cash collection | `src/modules/driver-cash-remainder/driver-cash-remainder.service.ts` (`amountDue = order.totalMinor`), `src/modules/delivery/driver-deliveries.service.ts` (exposes `totalMinor`) | Amount due at the door is `total − wallet applied`, not `total`. |
| Refund / cancel | `src/modules/orders/order-state-machine.service.ts` (cancel path refunds only PAID Manual Transfer), `src/modules/failed-delivery-resolution/failed-delivery-resolution.service.ts` (`UNSUPPORTED_PAYMENT_METHOD_FOR_AUTOMATIC_REFUND` for non-manual) | Credit `ORDER_REFUND` for the wallet-paid portion on cancellation / failed-delivery refund. |
| Read models | `src/modules/orders/customer-orders.service.ts`, `admin-orders.service.ts`, cart view/pricing | Show wallet-applied and cash-due; cart/checkout preview needs the balance. |
| New endpoint | new controller/module under `src/modules/wallet/` | Customer wallet balance (+ history). Does not exist today (Group 8 item 20); required for a checkout UI. |
| Logging | `src/common/logging/business-events.ts` (`WALLET_DEBIT` exists) | Emit on checkout debit/refund. |
| Clients | `apps/customer-app` checkout, `apps/dashboard` order detail, `apps/driver-app` collect-cash screen | UI for wallet use; driver must show the cash to collect. |

### 1.2 Tests that need new or changed coverage
- **Must change (currently pin the old behaviour):** `test/e2e/80-weighted-payments.e2e-spec.ts` — "WALLET payment is NOT implemented…" and the unsupported-method loop that lists `WALLET`; `order-creation.service.spec.ts` payment-method cases.
- **New:** full-wallet / partial-wallet+COD / Wallet+Manual-Transfer refused; concurrent double-spend (N parallel checkouts on one balance → balance never < 0); idempotent retry of the same checkout; rollback when a later checkout write fails (extend `test/e2e/97-resilience.e2e-spec.ts` triggers, `test/integration/transaction-rollback.int-spec.ts`); cancel/failed-delivery refund to wallet; cash remainder computed against cash-due; driver view shows cash due; weighted + wallet (C4) and unpriced + wallet (C5).
- **Existing to keep green / extend:** `wallet.service.spec.ts` (already has `ORDER_PAYMENT` cases), `idempotency-constraints.int-spec.ts`, `85-cash-failed-wallet` (cash remainder), `referential-integrity`/`schema-integrity` int specs if a column is added.

### 1.3 Migrations
Ledger: **none** — `ORDER_PAYMENT`/`ORDER_REFUND` are in the enum and the CHECK, `wallet_transactions.order_id` already has its FK (Group 7A), idempotency key is uniquely indexed.
Orders: **one additive migration is recommended** — a stored `wallet_applied_minor bigint NOT NULL DEFAULT 0` (or an equivalent cash-due snapshot) so the driver/customer/admin views and cash-remainder math do not depend on re-summing the ledger. Not strictly required (it *can* be derived from `ORDER_PAYMENT` rows by `order_id`), but a snapshot matches how `Payment.amount_minor` already works. If a wallet payment is a `payments` row, no change to that table.

### 1.4 Financial / idempotency implications
- Balance is **derived** (`SUM(amount_delta_minor)`), so "never negative" cannot be a table CHECK; it must be enforced by serialising per customer. `LoyaltyService.convertPointsToWallet` already does this (`SELECT … FOR UPDATE` on the `users` row, then balance check, then insert) — reuse that exact pattern inside the checkout transaction.
- Idempotency key per order, e.g. `order-payment:<orderId>`; unique index already exists. A retried checkout must not debit twice (the cart lock + `ACTIVE` status already makes double-submit create one order — Group 8 test).
- Wallet-paid money is **Hatly-held**, so cancellations/failed deliveries need an explicit credit; nothing today does it.
- `Payment.amountMinor` is documented as mirroring `Order.totalMinor`; with a wallet split it must be defined per method.
- Driver settlement / COD cash accounting must use cash-due, not `totalMinor`, wherever cash collected is inferred.

### 1.5 Data model verdict
**Supportable without a schema change** (ledger types, FK, unique idempotency key, `payments.method varchar(20)` all exist). One small additive column is recommended, not required.

---

## 2. PD-002 — Partial vendor cancellation (recalculate from remaining active segments; order NOT cancelled)

*Updated for the PD-002 clarification: the Order is not cancelled by a partial cancellation; Additional Vendor Fee = fee × (remaining active vendors − 1); zero-active-segments is unresolved (U1).*

### 2.1 Code paths and what must change
| Area | Where | Today | Needed |
|---|---|---|---|
| Trigger | `src/modules/orders/order-vendor-segment-state-machine.service.ts` (`CANCELLED` branch) | Locks segment + order; restores TRACKED stock (Group 8). | Also recompute order money and run refund/adjustment, in the same transaction. |
| Order totals | `orders.subtotal_minor`, `discount_minor`, `total_minor` (set once in `order-creation.service.ts` ~L474–494) | Never updated on segment cancel. | Recompute from remaining segments: `Σ subtotal(remaining) − Σ discount(remaining) + fixed delivery fee (adjusted for additional-vendor charge only)`. The weight-delta helper `apply-order-item-amount-delta.util.ts` also mutates these — both writers must agree (prefer one derive-from-segments function). |
| Segment amounts | `order_vendor_segments.subtotal_minor` (gross), `offer_discount_amount_minor`; `order_items.offer_discount_amount_minor` (flash) | Present per segment/item. | Sufficient to rebuild the total; no new source of truth needed. |
| Delivery fee | `Order.deliveryFeeMinor` = base + `additionalVendorChargeMinor` (combined); `deliveryFeeBreakdownSnapshot.additionalVendorChargeMinor`, `additionalVendorFeeMinorUsed` | Immutable after creation. | New fee = `deliveryFeeMinor − additionalVendorChargeMinor + additionalVendorFeeMinorUsed × (remainingActiveVendors − 1)` (3→2 removes one fee, 2→1 removes the last; `additionalVendorFeeMinorUsed` is stored in the snapshot, so no config lookup is needed); **never** call `DeliveryFeeCalculationService.calculate` (PD-003). Base = stored `deliveryFeeMinor − additionalVendorChargeMinor`. |
| Flash Sale | `src/modules/offers/offer-consumption.service.ts` `reverseFlashSaleConsumptionForOrder` (order-wide, idempotent via `is_reversed`); consumptions link to `order_item_id` | Only reversed on whole-order cancel. | Segment-scoped reversal (by the segment's `order_item_id`s), same `is_reversed` idempotency and `Math.max(0, …)` guards. |
| Subtotal-discount offers | `offer_consumptions` rows keyed by `order_vendor_segment_id`; `consumed_units_count`, `consumed_discount_minor` | Never reversed (approved rule; Group 8 characterisation test `55-offers`). | Discount leaves the total; consumption/budget stays consumed (C3). |
| Hatly-funded discount event | `recordHatlyFundedDiscountEvent` — idempotency key `hatly-funded-offer-discount:<orderId>`, amount = discount at creation | Stale after a cancel. | An adjusting informational event. |
| Payment / refund | `payments` (Manual Transfer, `amount_minor` = total at creation), `manual-transfer-refund.service.ts` (idempotency key `manual-transfer-refund:<paymentId>` — **one refund per payment**), `failed-delivery-resolution.service.ts` (checks `REFUND_EXCEEDS_PAYMENT_AMOUNT` vs original amount) | Full refund only, on whole-order cancel. | Partial refund = the difference; the per-payment key cannot express a second refund (a later whole-order cancel would collide or double-refund) → key per adjustment (e.g. per segment) and cumulative-refund validation. Wallet portion → `ORDER_REFUND` ledger row (PD-001). COD → no money moves, only the amount due changes. |
| Amount due at door | `driver-deliveries.service.ts` (`totalMinor`), `driver-cash-remainder.service.ts` | Reads `order.totalMinor` (would auto-follow a recalculated total). | Verify with wallet split (PD-001). |
| Commission | `src/modules/finance/order-financial-events.service.ts` | Booked at PICKED_UP, excludes cancelled segments (Group 8). Segment cancel is blocked after pickup. | No change; add a test that a recalculated order books the same commission. |
| Vendor settlement | `src/modules/finance/settlement.service.ts` (`grossSalesMinor` sums **all** CATALOG segments in the period, no status filter) | Counts cancelled segments (and cancelled orders). | Exclude cancelled segments/orders — adjacent defect to fix with this work. |
| Loyalty / ratings / best-selling | `loyalty.service.ts`, `rating*.ts`, `best-selling-cache.service.ts` | Already skip cancelled segments. | None. |
| Order stays active / workflow re-evaluation | `order-vendor-segment-state-machine.service.ts` (calls `OrderReadinessService.checkAndAdvance` **only** when a segment becomes `READY_FOR_PICKUP`), `order-readiness.service.ts` (ignores cancelled segments) | If the remaining segments are already all READY when the last *unready* vendor cancels, nothing re-runs readiness, so the Order stays un-advanced (PENDING/…) until something else triggers it. | A segment cancellation must also re-run the readiness/advance (and automatic dispatch) check so the Order follows the remaining segments (PD-002 rules 1, 10). Never cancel the Order because of it. |
| **Zero active segments (U1)** | `order-readiness.service.ts` (`relevantSegments.length > 0`) | The Order is left with no active segment and nothing advances it. | **Nothing — unresolved, needs a separate product decision (U1).** Do not add auto-cancel/refund. The implementation must only ensure the recompute does not crash or invent behaviour for this case (e.g. leave state untouched and log). |
| Customer notice | `push-notification.service.ts` | No "part of your order was cancelled" message. | New notification + customer/admin order views showing the adjustment. |

### 2.2 Tests
- **Change:** `test/e2e/60-order-lifecycle.e2e-spec.ts` — the multi-vendor cancel test's "OPEN DECISION" block (asserts subtotal/total unchanged) becomes the new expected behaviour (the PD-002 worked example is a ready-made fixture: 200/300/20/40/−50 → 240).
- **New E2E:** per payment method (COD, Manual Transfer PAID, wallet, wallet+COD) the customer refund/adjustment equals `old total − new total`; delivery fee identical before/after and **zero** Maps calls during the cancel (`boundary.mapsCalls`, PD-003); 3→2 vendors (one fee removed) and 2→1 (last fee removed) per the general formula; Order stays non-cancelled and re-evaluates readiness/dispatch after the cancel (including the "others already READY" ordering); zero-active-segments (U1) is *not* specified — no test may assert a cancel/refund outcome for it; flash-sale allocation released and re-buyable (extend `55-offers`); subtotal-discount not returned (C3, keep characterisation); stock restored once; commission absent; concurrency — two vendors cancelling at once, vendor cancel racing an admin whole-order cancel, retry idempotency; injected failure mid-adjustment rolls everything back (`97-resilience` pattern).
- **Unit:** `order-vendor-segment-state-machine.service.spec.ts`, `order-state-machine.service.spec.ts`, `offer-consumption.service.spec.ts`, `manual-transfer-refund.service.spec.ts`, `failed-delivery-resolution.service.spec.ts`, `settlement.service.spec.ts`, `order-financial-events.service.spec.ts`; a pure "recompute totals" function deserves table-driven tests including the worked example.
- **Integration:** `order-flow.int-spec.ts`, `transaction-rollback.int-spec.ts`, `idempotency-constraints.int-spec.ts`.

### 2.3 Migrations
None strictly required for the math (all inputs are stored). **Likely** additive, for auditability and correct refunds: an adjustment record per cancelled segment (or use `financial_events`) so a second refund key/amount is representable, and optionally `orders.original_total_minor` to keep the pre-cancel total. Payment `amount_minor` should stay as the original charge.

### 2.4 Data model verdict
The **recalculation** is supportable without schema change (segment and item amounts, discounts and the fee breakdown are all persisted). **Refund bookkeeping is not** cleanly supportable as-is because refunds are keyed once per payment — that needs a keying change (code, possibly a small additive table/column).

---

## 3. PD-003 — Fixed Delivery Fee

- Today true by construction: `DeliveryFeeCalculationService.calculate` is called only from `order-creation.service.ts` (checkout) and `cart.service.ts` (fee quote); the stored `deliveryFeeMinor`/snapshot are never rewritten.
- To keep it true: the PD-002 recompute must derive from the **stored** `deliveryFeeMinor` and `additionalVendorChargeMinor`, must not import or call the fee/Maps services, and needs a regression test asserting zero Maps calls and an unchanged fee.
- Precondition to guard: orders created before this work have the snapshot; `additionalVendorChargeMinor` is present for every catalog order (pickup: fee 0, charge absent → treat as 0). Ad-hoc (Hatly Service) orders are single-segment and out of scope.
- Migration: none.

---

## 4. Documentation, comments and tests that referenced the old state
Located by search; historical Group 8 results were **not** rewritten. Only comments were annotated (no behaviour or assertion changed):

| Location | What it said | Now |
|---|---|---|
| `test/e2e/80-weighted-payments.e2e-spec.ts` (header + the "WALLET payment is NOT implemented" test) | wallet payment not implemented — pinned | annotated: current behaviour; V1 requires it (PD-001) |
| `test/e2e/60-order-lifecycle.e2e-spec.ts` ("OPEN DECISION … NOT recalculated") | open decision | annotated: characterises current behaviour; decided by PD-002/PD-003 |
| `src/modules/orders/dto/create-order.dto.ts`, `src/modules/orders/order-vendor-segment-state-machine.service.ts`, `src/modules/delivery-fee/delivery-fee-calculation.service.ts` | (no mention) | comment pointers to PD-001 / PD-002 / PD-003 |
| `test/e2e/README.md` | — | short "post-Group-8 decisions" note |
| `src/modules/payments/entities/payment.entity.ts` ("`method` covers all three values… future gateway") | describes only gateways | not edited — still accurate; the wallet record shape is a PD-001 design item |

No canonical product document existed in the repository (only `README.md`); `docs/PRODUCT_DECISIONS.md` is now that document and is linked from `README.md`. The Group 8 report itself is not a repo file.

## 5. Suggested order of the later work (informational)
1. Customer wallet balance/history endpoint + `WalletService` manager-aware, non-negative debit.
2. Wallet checkout (PD-001) with cash-due plumbing (driver view, cash remainder).
3. Central "recompute order money from segments" function, then segment-cancel adjustment + refunds (PD-002/PD-003), including the settlement filter fix and C2.

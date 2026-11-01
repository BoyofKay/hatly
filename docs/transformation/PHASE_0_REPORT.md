# Phase 0 report — safety, reconciliation, dependencies, baseline (2026-10-31)

## 1. Safety

| Item | Result |
|---|---|
| Archive | `~/Downloads/hatly-backups/hatly-worktree-20261031-182035-full.tar.gz` — 28,798,069 bytes (mode 600), 2,711 entries, **includes `.git`** (both commits, index and every modified/untracked file; the 6 deletions are recorded in `…full.git-status.txt`). |
| Integrity | SHA-256 `afd5b305fd7e41f708dd5df5d78ac0c5dc2de5f14fe22360cee3139e2a7d555d` (`…full.tar.gz.sha256`, `shasum -c` OK); `gzip -t` OK; **restored into a temp directory and compared with the live tree: no differences**; `git status` on the restored copy lists the same 642 entries as the live tree. |
| Excluded (regenerable or secret) | `node_modules`, `build`, `dist`, `.next`, `.dart_tool`, `Pods`, `.gradle`, `Archive.zip` (1 GB duplicate), `uploads-storage`, test reports; **secrets**: `.env*`, `android/key.properties`, key/keystore/cert files. They were not touched and still exist in place. |
| Git state at archive time | branch `master`, HEAD `ebfab84`, 376 modified, 260 untracked, 6 deleted, 0 staged, 0 stashes. Nothing is committed by this program. |

## 2. Documentation reconciliation

| Conflict found | Resolution |
|---|---|
| Decision Register D-26 / API plan lines: "vendor payable = gross − commission" | Already marked **superseded** (B1/B5) in D-26 and `IMPLEMENTATION_ADDENDUM.md`. VendorLedger = Hatly's commission receivable. |
| Transformation brief: customer must approve a weight price difference; product substitution | **Withdrawn** — D-76/D-77, PD-016. C4 in `PRODUCT_DECISIONS.md` marked approved. No code existed to remove. |
| PD-005 / PD-014 customer cancellation vs "customer chooses to cancel when an item is unavailable" | Customer cancellation permissions are **unchanged**; the in-app choice is recorded and executed by authorized Operations through the existing admin cancellation path (PD-016 C6). |
| C3 "SUBTOTAL_DISCOUNT never reversed" | Already superseded by PD-014 (noted in code and docs); not part of this program. |
| `FINAL_IMPLEMENTATION_ROADMAP.md` workstreams WS-0…WS-P vs the transformation phases | Not duplicated: the transformation phases in section 4 below are an overlay; WS items already delivered are listed in `IMPLEMENTATION_ADDENDUM.md`. |
| D-72 (cheap change detection) approved but unbuilt | Scheduled in Slice 2 below. |
| `docs/PRODUCT_DECISIONS.md` says the repo has no git in older notes | Corrected facts: git exists with 2 commits; the working tree is the only source of the current work. |

Isolated (not decided, not invented): campaign stacking policy, vendor-funded/co-funded discount maths and commission treatment, driver settlement frequency, driver-to-vendor payments after pickup, per-vendor settlement frequency (needs a contract-terms decision), providers (FCM/SMS/WhatsApp/email).

## 3. Architecture dependencies

```
migration lane (single, sequential)  ──►  order_exceptions (71)  ──►  vendor roles/branch schedule  ──►  inventory history  ──►  limits
                                              │
 notification outbox + change detection ──────┤──► Ops queues / live badges ──► vendor alerts ──► delayed-preparation escalation
                                              │
 item-removal money engine (reuses segment-cancellation machinery) ──► customer response ──► Ops recorded decision ──► cancel via existing admin path
```

Key reuse points (verified in code): `applyOrderItemAmountDelta` (item → segment → order totals), `OrderWalletRefundService.refundExcess`, `ManualTransferRefundService.reconcileReducedTotal`, `OfferConsumptionService.reverseFlashSaleConsumptionForOrder`, `AdminOrderExtrasService.cancel` (state machine), `recordOrderNotification` (customer notifications; unknown types degrade to the server text in older apps), `AdminAuditService`. Commission is computed at delivery from `segment.subtotalMinor`, so a corrected subtotal carries through without new code.

Backward compatibility rules for this program: new response fields are additive; removed items are **omitted from the existing `items` arrays** (older Customer/Driver/Vendor clients simply never show them) and returned in a new `removedItems` array; new notification types fall back to server text in older apps; no existing endpoint changes its contract.

## 4. Slice plan (dependency-aware)

1. **Order Exceptions + unavailable-product workflow (backend)** — migration 71, exception service and queues, item-removal money engine, vendor/admin/customer endpoints, audit, tests.
2. **Change detection + notification outbox** — `GET …/changes?since=` (D-72) for vendor and admin; outbox with dedupe/retry/status; staff in-app notifications.
3. **Operations Command Center UI** — queues, order side panel, exception actions, saved views, shortcuts, filters, safe bulk actions.
4. **Vendor Foundation** — shell, Arabic-first RTL, roles (Owner/Manager/Operator), branch schedule/closures, order management, products.
5. **Catalog and inventory** — variants, weight min/step, media pipeline, stock history/stocktake, quantity limits.
6. Customer/Driver app slices for the two-option response (Customer) — backend stays backward-compatible.
7. Later phases (financial statements, campaigns, Admin 360, reliability) after their isolated decisions.

## 5. Test baseline (before any program change; tree at archive state)

| Suite | Result |
|---|---|
| Backend type-check | exit 0 |
| Backend unit (`npx jest`) | 160 suites / 2,427 tests passed |
| Backend integration | 25 suites / 306 tests passed |
| Backend e2e (`NODE_OPTIONS=--max-old-space-size=6144 npm run test:e2e`) | 74 suites / 1,046 tests passed |
| Dashboard type-check / unit | exit 0 / 34 of 34 passed |
| Dashboard Playwright | not re-run in Phase 0 (needs a disposable DB + per-file runs because of real rate limits). Last verified 2026-10-31: existing specs pass per file; `enterprise-admin.spec.ts` 71 passed; `admin-driver-integrated.spec.ts` 1 passed |
| Customer app (`flutter test`) | 1,132 passed, 2 skipped (analyze: 0 errors / 0 warnings) |
| Driver app (`flutter test`) | 62 passed |

Not covered by any automated gate today (recorded, not hidden): no ESLint config in backend or dashboard, no dashboard CI job, backend e2e CI job is non-blocking, no automated accessibility run, no device-level performance measurement.


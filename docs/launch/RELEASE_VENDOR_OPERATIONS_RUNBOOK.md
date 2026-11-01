# Admin + Vendor transformation (vendor operations) — release and rollback runbook (migration 73)

Scope: backend + dashboard release that adds the vendor-operations capabilities (a branch manager's team management, branch closures/holidays, the stock-movement ledger and stocktakes, the Financial Centre with per-vendor settlement frequency) and the redesign of the remaining legacy Admin pages and the Operations Command Center on phones. Production is at migration 72 (release `20261031T214027Z-bcf556957636`). The Customer and Driver apps are not part of this release.

## Migration `1700007200000-VendorOperationsFoundations` (73) — why no maintenance window is needed

It is **purely additive**: five new tables (`vendor_branch_closures`, `stock_ledger_info`, `stock_movements`, `stocktakes`, `stocktake_lines`, `vendor_settlement_terms`), one trigger function and two triggers on `products`. No existing column, row, index or constraint is touched.

Compatibility with the **previous** backend (the rollback target), verified by reading both directions:

| Question | Answer |
|---|---|
| Does the old backend keep working against schema 73? | Yes. It does not know the new tables. The only interaction is the trigger on `products`: when the old code changes `quantity` of a tracked product (order placement, cancellation, vendor edit) the trigger writes a `stock_movements` row marked `UNATTRIBUTED` / `source_captured = false`. The trigger runs in the same transaction, uses only existing columns, and cannot fail on valid data (foreign keys point at `products`/`vendor_branches`, which exist). Stock behaviour is unchanged. |
| Does schema 73 change what customers or vendors see under the old backend? | No. Closures only matter to code that reads them (the new backend). |
| Can the new backend run against schema 72? | No — it queries the new tables. Migrate first, then start the new apps. |
| Is anything lost if migration 73 is reverted? | Only what the feature recorded: closures, ledger rows, counts, per-vendor settlement terms. `down()` drops those objects and the trigger. Never revert after real use without exporting those tables first. |

Therefore: **migrate while the old apps keep serving** (a single short DDL transaction per migration; `transaction: each`), then restart onto the new release. The brief restart of the apps is the only user-visible interruption (seconds).

## Gates before the window

- Fresh archive of the exact tree, checksum + gzip verified; release bundle from `deploy/production/make-release-bundle.sh` (refuses secrets/artifacts); checksum verified on the host.
- `prod.sh env-check` PASSED with the new image (only the known warnings allowed: Redis not TLS on the private network, Maps `none`, no SMS provider, no FCM).
- `prod.sh plan` lists **exactly one** pending migration: `VendorOperationsFoundations1700007200000` (72 applied).
- Fresh backup (DB + uploads) taken immediately before, with manifest; restore drill OK; copy of the dump kept OFF the host.
- **Migration rehearsal** on a throw-away database restored from that dump: run 73, compare row counts of every business table before/after (identical), verify the new tables and both triggers exist, then update one tracked product's quantity inside a rolled-back transaction and confirm a ledger row was produced and rolled back with it; drop the scratch database.
- Previous release `20261031T214027Z-bcf556957636` stays on disk with its images tagged.

## Sequence

```bash
REL=<release id>; BD=~/Library/Caches/hatly-releases/$REL; H=ubuntu@152.228.240.4; PD=/opt/hatly-prod; OLD=20261031T214027Z-bcf556957636
# upload + verify + extract, build images under the new tag, env-check, plan  (same as the previous runbook, §1)
# backup + restore drill + off-host copy + rehearsal                             (§2)
ssh $H "PROD_RELEASE=$REL CONFIRM_MIGRATE=hatly_prod $PD/releases/$REL/deploy/production/prod.sh migrate"   # 72 → 73, takes its own backup first
ssh $H "cd $PD && echo $REL > RELEASE && ln -sfn releases/$REL current && $PD/current/deploy/production/prod.sh apps && $PD/current/deploy/production/prod.sh status"
```

## Verification (no credentials are entered)

- `api.hatly.dev/api/v1/health/ready` → database up, redis up; public catalogue endpoints unchanged (`/sectors`, `/home-banners`, `/config/client`).
- New vendor/admin routes answer **401** without a session (mounted and guarded), never 404 and never 200: `/vendor/team/members`, `/vendor/branches/<id>/closures`, `/vendor/inventory/movements`, `/vendor/inventory/stocktakes`, `/vendor/finance`, `/admin/vendors/<id>/settlement-terms`, `/admin/vendor-branches/<id>/closures`.
- Dashboard routes 200: all existing ones plus `/stock-history` and `/finance` (vendor area).
- Database (read-only): 73 migrations; the six new tables; the two triggers on `products`; row counts of every business table identical to the pre-window baseline; `stock_ledger_info.started_at` set; `stock_movements` has rows only if a tracked product changed after the migration.
- Logs: no errors; no `Redis unavailable for rate limiting`.
- **Not verifiable by the agent:** any signed-in screen. Owner checklist is in the final report.

## Rollback decision tree

| Situation | Action |
|---|---|
| Failure BEFORE migrate | Nothing changed. Fix and retry. |
| Migrate failed | The migration rolls itself back (DB stays at 72). Old release keeps serving: `prod.sh apps` with `RELEASE` unchanged. |
| 73 applied, new apps unhealthy | **The old release is safe to run** against schema 73 (see the table above): `echo $OLD > RELEASE && ln -sfn releases/$OLD current && prod.sh apps`. Prefer fix-forward for configuration issues. |
| Reverting 73 is required | Only after exporting `vendor_branch_closures`, `stock_movements`, `stocktakes`, `stocktake_lines`, `vendor_settlement_terms`; then `typeorm migration:revert` of the LAST migration only. |
| Data problem | Restore the verified dump into a NEW database and compare; never overwrite the live database. |

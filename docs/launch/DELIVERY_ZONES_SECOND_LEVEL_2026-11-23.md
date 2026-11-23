# Delivery Zone → Neighborhood/Village (2026-11-23)

## Approved model

- **Parent Delivery Zone**: a bilingual name (`zoneName`, `zoneNameAr`) under the configured city/service area.
- **Child Neighborhood/Village**: exactly one English `name` and exactly one Arabic `nameAr` per row. Each row has its own base `deliveryFeeMinor`. Multiple children may share a parent. The customer selects parent first, then one child.
- **Address label**: `Zone | Neighborhood/Village`, localized. Server persists the chosen child ID as the existing `addresses.delivery_zone_id`; the checkout's existing manual-pricing path uses the selected child row's fee. GPS pricing remains unaffected.
- **Historical orders**: existing order snapshot fields and calculated delivery fees are never rewritten.

## Existing-data policy — do not skip

The current repository contains only the older flat table schema; Claude's newer combined locality entries may exist in a different/unpushed copy or a deployed database. **Never assume the names, fees, or English ↔ Arabic pairings of those records.** The additive migration intentionally retains every older row, identifier, fee, status, and foreign key unchanged, and gives it a null parent until reviewed. The admin shows a legacy warning.

Migration: `1700008200000-DeliveryZoneNeighborhoods.ts`.

Once deployed to an isolated environment with a verified backup, inspect existing records by running (from `apps/backend`):

```bash
npm run delivery:neighborhood-reconcile
```

This runs a read-only inventory by default (including current row counts referencing each record).

For combined names, prepare an explicitly approved mapping file. Example (names are **illustrative placeholders, not actual Hatly locality data**):

```json
[
  {
    "sourceZoneId": "00000000-0000-4000-8000-000000000001",
    "existingName": "Original combined EN string",
    "existingNameAr": "Original combined AR string",
    "zoneName": "Parent zone EN",
    "zoneNameAr": "المنطقة الرئيسية",
    "children": [
      {"name": "Child A", "nameAr": "قرية أ"},
      {"name": "Child B", "nameAr": "قرية ب"}
    ]
  }
]
```

**Fee decision (2026-11-23): all newly created or reconciled individual neighborhoods/villages start at 15 EGP (1500 piastres)**. Admin may change each fee afterward. The reconciliation script overrides any fee amounts in the mapping file and starts all child records at 1500 minor units. Existing combined source rows preserve their original current fees to avoid changing old saved-address pricing and frozen order snapshots. Matching English/Arabic values by their delimiter positions is not permitted. Review all combined names, existing fees, and any address links before applying.

Only after reconciliation review and a backup, use an **exact** target database allow-list:

```bash
DELIVERY_NEIGHBORHOOD_MAPPING_FILE=/secure/reviewed-mapping.json \
DELIVERY_NEIGHBORHOOD_ALLOW_DATABASE=hatly_dev \
DELIVERY_NEIGHBORHOOD_APPLY=YES_PRESERVE_LEGACY \
npm run delivery:neighborhood-reconcile
```

Use the actual database name, **not** `hatly_dev` unless it really is that database. Do not copy the example mapping into live data.

The operation uses one database transaction and checks the original source record's exact bilingual text and status. For a single existing child with matching names, it adds the parent names and sets its editable current fee to 15.00 EGP. For a combined record, it creates one row per reviewed child, preserves the old record and all existing address/fee history, and marks only that old combined record `is_selectable = false` so new customers cannot choose a combined label.

**Existing saved addresses that reference a previously combined record remain linked to it.** They retain their historical label and fee until their owners explicitly select a precise new child. Never infer which child was meant from street text, and never silently reassign these addresses. The deployment should be considered *not fully reconciled* until all existing combined records are reviewed.

## Verification gates

1. Capture a pre-migration backup and a count of every zone, localized name, fee, status and linked-address count; compare after migration.
2. Run the backend TypeScript build, e2e delivery-zone tests, dashboard typecheck/Playwright and Flutter address/driver tests against a migrated test DB before deployment.
3. Create two or more children under one parent with different fees; verify distinct selectable options, correct `Zone | Child` address labels and checkout quotes based on the chosen child.
4. Attempt entering comma-delimited multiple children in either language; both dashboard and API must reject.
5. Verify edited old addresses, old frozen order snapshots and GPS-based fees stay intact.
6. Review and approve each unclassified legacy parent/child mapping before executing the gated reconciliation.
7. Verify production only after staging evidence is reviewed; do not auto-deploy an untested migration.

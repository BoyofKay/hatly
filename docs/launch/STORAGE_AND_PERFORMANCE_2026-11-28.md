# Storage and performance: owner decisions and measurements (2026-11-28)

## Decisions (owner)
| Topic | Decision |
|---|---|
| Picture already in the library for another use | Reuse it if it meets the intended use's spec (size; square for logos; banner shape). Otherwise refuse with a clear message. |
| Customer and driver photos | Compress on the server: WebP, at most 1280 px, metadata (GPS, camera) removed. Existing photos are converted too, in place. |
| Order attachments | Request photos, voice notes and proof photos are removed **90 days** after the order ends. The order, its items and its amounts stay. |
| Where files live | OVH server disk for now. Move to Cloudflare R2 when income allows; the code already supports S3-type storage, so the move is configuration plus a one-time copy. |
| Before launch | Arabic search spelling, driver search by distance, load test. |

## What was built (branch `feature/uat-fixes-20261127`; nothing deployed yet)
- **Media reuse rule:** `meetsPurposeSpec` for assignment, product photos and uploads that match an existing picture.
- **Photo compression:** new uploads are stored as WebP. The production actions `recompress-dry-run` and `recompress-apply` recompress existing photos in place: same names and formats, a backup first, a file is changed only when the result is 10% or more smaller.
- **Retention:** `AttachmentRetentionService` runs every 6 hours (`ATTACHMENT_RETENTION_DAYS`, default 90). It sets `orders.attachments_purged_at` and never removes a file that a live cart still uses.
- **Arabic search:** `hatly_norm()` maps أ/إ/آ/ٱ→ا, ى→ي, ة→ه, ؤ→و, ئ→ي, drops diacritics and tatweel, converts Arabic-Indic digits and lower-cases. The normalised names are stored once as generated columns with trigram indexes. It covers global search, sector store search, a store's products and the catalog.
- **Dispatch:** reads only drivers inside the pickup area's box, plus drivers without GPS, who still queue in turn (R14). Service areas and vehicle types are loaded once, not per driver. A partial index supports it. The ranking rules are unchanged.

## Load test (local copy, 4 CPU cores shared by the database, the API and the load tool)
Data: 300 stores, 50,000 products with Arabic and English names, 3,000 online drivers. 100 simultaneous clients, 20 seconds per endpoint.

| Endpoint | Requests/s | Median | p99 |
|---|---|---|---|
| Search, specific Arabic term | 275 | 0.30 s | 1.0 s |
| Search, very common word (6,250 matches) | **63** (was 19 before stored names) | 1.5 s (was 4.3 s) | 2.2 s |
| Sector store list (300 stores) | 435 | 0.22 s | 0.29 s |
| Health (baseline) | ~2,100 | 0.04 s | 0.08 s |

**Dispatch:** the driver query takes about 1 ms. Before the change, one ranking made about 2 queries per located driver (about 5,000 for 2,500 drivers). Now it makes 2 in total.

**Reading the numbers:**
- 100 clients sending back to back is far more than 100 real customers. A customer searches a few times a minute, so 63 searches a second of the worst kind is roughly 1,000–3,000 customers searching at the same moment.
- The limit is database CPU. The next steps, in order:
  1. a short cache for popular searches (an owner decision: results could be up to N seconds old);
  2. a bigger database machine, or a separate database server;
  3. a dedicated search engine (Meilisearch or Typesense) only if traffic outgrows those.

## Not done / still open
- Off-site backups are still not configured. The deploy log says "off-site: NOT CONFIGURED". This is the highest risk on the list.
- Moving to Cloudflare R2 is deferred by owner decision.
- Ten older backend end-to-end suites fail on `main` too (rules added without updating the tests). They need a separate clean-up.

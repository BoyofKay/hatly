# Rate limiting, resource protection and media delivery (M5 Batch 4)

## How limits are applied

Every request passes two limits (`apps/backend/src/app.module.ts`, `common/throttling/`):

* `default` — **per route, per client**: 100 per minute unless the route declares its own policy.
* `aggregate` — **across all routes, per client**: 600 per minute. Before this, the "global" limit was per route only, so one
  client could make 100 requests/minute to each of ~200 routes.

"Client" is the **logged-in user** when there is one, otherwise the **socket IP**. On `@Public()` routes (search, browsing) a valid
bearer token is verified (HS256, same rules as the JWT strategy) only to pick the bucket, so testers behind one router/office
are not a shared bucket. A forged or expired token is anonymous.

Counters live in **Redis** (`RedisThrottlerStorage`, one atomic Lua call per limit), so limits hold across several backend
instances. If Redis is slow/down the limiter falls back to per-instance counting and a short circuit breaker stops waiting on it;
rate limiting never takes the API down. Overhead measured: ~0.05 ms per limit check.

`TRUST_PROXY` still decides how the IP is derived (Batch 1).

## Limits by endpoint risk

| Category | Endpoint(s) | Limit / window | Key | Redis | Notes |
|---|---|---|---|---|---|
| Any route (default) | all | 100 / min per route | user, else IP | yes | env `RATE_LIMIT_ROUTE_PER_MINUTE` |
| Whole API (aggregate) | all | 600 / min per client | user, else IP | yes | env `RATE_LIMIT_CLIENT_PER_MINUTE` |
| Registration, OTP request, customer register | `POST /auth/register`, `/auth/login`, `/auth/customer/password/register` | 5 / min | IP | yes | unchanged; plus OTP resend cooldown + attempt limits in `OtpService` |
| OTP verify, password logins | `/auth/otp/verify`, `/auth/password/login`, `/auth/driver/login`, `/auth/customer/password/login` | 10 / min | IP | yes | unchanged |
| **Failed password logins, per account** | the three password routes | 10 failures / 15 min, then 429 **before any bcrypt work** | phone number | yes | **new**: rotating IPs no longer allows unlimited guessing; unknown phones counted too (no enumeration); success resets; fails open if Redis is down |
| Token refresh | `POST /auth/refresh` | 20 / min | IP | yes | unchanged; plus reuse detection (Batch 2) |
| Search | `GET /search` | 60 / min | user, else IP | yes | **new** (was the default); the app debounces at 400 ms |
| Checkout quote | `POST /checkout/quote` | 30 / min | user | yes | **new** |
| Order creation | `POST /orders` | 10 / min | user | yes | **new** |
| Image upload (base64) | `POST /uploads` | 30 / min | user | yes | unchanged number; now per user (was per IP) |
| Product image upload | `POST /vendor/products/:id/image` | 20 / min | user | yes | **new** |
| Excel import | `/vendor/products/import/*`, `/admin/products/import/*` | 10 / min | user | yes | **new** |
| Marketplace/catalog reads, cart, orders, admin | everything else | default + aggregate | user, else IP | yes | no change needed |
| Health | `/health*` | default | IP | yes | unchanged |
| Media files | `/uploads/files/*` | not rate limited | - | - | served by Express static (local) or a 302 to object storage (S3); no database or Redis access |

## Resource protection beyond request counts

* **Concurrent uploads** (`UPLOAD_MAX_CONCURRENT`, default 6): measured ~20–45 MB of memory per in-flight 5 MB upload (~400 MB
  for 8). Authenticated uploads beyond the cap **queue** (no body read, nothing reset) and get a 503 + `Retry-After` only after
  15 s or when 50 are waiting. Unauthenticated uploads are not metered and still receive the normal 401 (answering early would
  reset the connection for large bodies and break an expired-token refresh).
* **Multipart limits**: one file, <= 10 fields, <= 16 KB per field (Excel import 2 MB, product image 5 MB).
* **Body limits**: 100 KB default, 8 MB for the base64 upload route (Batch 1).
* **Database pool** (Batch 3): transactions are capped at pool size − 1; acquire timeout 10 s.
* **Failed logins** are refused before bcrypt runs (bcrypt is the most CPU-expensive thing an anonymous client can trigger).

## Media architecture

```
Customer app -> CachedNetworkImage (disk + memory cache, honours Cache-Control)
             -> /uploads/files/<name>   (stable reference stored in the database)
                 local driver : Express static  (dev; never routed through Nest controllers)
                 s3 + private : 302 -> short-lived signed GET URL straight to object storage (HMAC only, ~17 µs, no network)
                 s3 + public  : absolute public/CDN URL stored; the API is not involved
```

* The backend never proxies image bytes except the **local** development driver. With S3/R2 the bytes flow client <-> storage.
* Uploads pass through the API once (base64 JSON or multipart), are validated by byte signature, size (5 MB) and type
  (JPEG/PNG/WebP), stored under a server-generated `<uuid>.<ext>` key, and referenced by that stable path. No filesystem path is
  ever exposed.
* Caching: generated (`<uuid>`) files are `public, max-age=31536000, immutable` (local) and stored in object storage with
  `private|public, max-age=31536000, immutable` (public mode uses `public` so a CDN may cache). Seeded `marketplace/...` files
  keep one day and revalidate with ETag -> 304. The redirect response itself is `private, max-age=270`.
* **Upload-side optimisation (new):** the three image pickers downscale on the device (long edge 1600 px, quality 85) instead of
  sending full-resolution camera photos.

### Image variants (thumbnail / card / detail)

**Not implemented, intentionally.** Today there are 14 real images (subcategory tiles, 512x512 WebP, avg 44 KB, max 64 KB) and the
asset contract already bounds tiles to < 150 KB and product heroes to < 300 KB WebP. No vendor/product image exists yet. A
resize pipeline (server-side image library, derived-key storage, background work, cache invalidation) would be a large new
subsystem for a bandwidth saving that cannot be measured yet. Revisit when real product photography exists: the natural place is
resizing at upload inside `UploadsService` (it already decodes and validates), or Cloudflare Image Resizing on the public R2 domain
with no backend work at all.

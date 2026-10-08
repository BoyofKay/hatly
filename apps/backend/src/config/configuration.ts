import { buildDatabaseSslOptions } from './database-ssl';
import { parseAllowedOrigins, parseTrustProxy, resolveRuntimeEnvironment, isStrictEnvironment } from './env.validation';

const runtimeEnvironment = () => resolveRuntimeEnvironment(process.env.NODE_ENV) ?? 'development';

export default () => ({
  env: process.env.NODE_ENV ?? 'development',

  /**
   * M5 Batch 1 — HTTP hardening. `strict` = production/staging (validated at boot by env.validation.ts, which has already
   * rejected an invalid/empty CORS list or an unsafe TRUST_PROXY there). In development/test an empty CORS list keeps the open
   * local-workflow behaviour; `trustProxy` is false unless explicitly configured; the Swagger UI is on outside strict
   * environments and opt-in (ENABLE_API_DOCS=true) inside them.
   */
  http: {
    strict: isStrictEnvironment(runtimeEnvironment()),
    corsAllowedOrigins: parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS).origins,
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY).value,
    enableApiDocs: process.env.ENABLE_API_DOCS === 'true' || (process.env.ENABLE_API_DOCS !== 'false' && !isStrictEnvironment(runtimeEnvironment())),
  },
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',

  database: {
    url: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true',
    sslOptions: buildDatabaseSslOptions(process.env),
    // Connection pool (M5 Batch 3). `max` defaults to node-postgres' own 10. The acquire timeout is bounded (node-postgres' default is
    // "wait forever"), so pool exhaustion surfaces as a fast, loggable error instead of every request hanging until a restart.
    poolMax: Number(process.env.DB_POOL_MAX) || 10,
    connectionTimeoutMs: Number(process.env.DB_CONNECTION_TIMEOUT_MS) || 10_000,
  },

  // Rate limiting (see common/throttling/rate-limit-policies.ts and docs/security/rate-limiting.md).
  rateLimits: {
    routePerMinute: Number(process.env.RATE_LIMIT_ROUTE_PER_MINUTE) || 100,
    clientPerMinute: Number(process.env.RATE_LIMIT_CLIENT_PER_MINUTE) || 600,
  },

  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },

  /**
   * Dispatch Hardening milestone. Purely TECHNICAL/operational runtime parameters for the
   * timeout-driven reassignment sweep (AutomaticDispatchService) — deliberately NOT BusinessConfig:
   * none of these is a business/pricing/ranking/capacity rule, they only control how often and how
   * much the sweep does per tick. Environment-configurable (so ops can tune cadence/safety margins
   * without a code deploy) with the exact defaults already established in the previous milestone.
   */
  dispatch: {
    /** How often the sweep runs. See AutomaticDispatchService's own doc comment for the full reasoning (relative to the fixed 30s acceptDeadlineAt window, unchanged). */
    sweepIntervalMs: parseInt(process.env.DISPATCH_SWEEP_INTERVAL_MS ?? '10000', 10),
    /** Redis lock TTL for one sweep's mutual exclusion — must safely exceed how long a single (batch-limited) sweep can realistically take. */
    sweepLockTtlMs: parseInt(process.env.DISPATCH_SWEEP_LOCK_TTL_MS ?? '20000', 10),
    /** Max expired deliveries one sweep processes — bounds transaction/lock duration and guarantees forward progress on a large backlog across multiple ticks (oldest-expired-first) rather than one unbounded pass. */
    sweepBatchLimit: parseInt(process.env.DISPATCH_SWEEP_BATCH_LIMIT ?? '50', 10),
  },

  auth: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  },

  otp: {
    ttlSeconds: parseInt(process.env.OTP_TTL_SECONDS ?? '300', 10),
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS ?? '5', 10),
    resendCooldownSeconds: parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS ?? '60', 10),
    // Hard safety switch, independent of NODE_ENV: OTP codes are only ever
    // logged when this is explicitly true. Must never be true in any
    // deployed environment. Defaults to false so a misconfigured/missing
    // env var fails safe (no logging) rather than failing open.
    logCodeForLocalDev: process.env.OTP_LOG_CODE_FOR_LOCAL_DEV === 'true',
  },

  storage: {
    /** `local` (default — development; files under uploads-storage) or `s3` (S3-compatible object storage). */
    driver: process.env.STORAGE_DRIVER ?? 'local',
    /** Path-style addressing (`host/bucket/key`) — needed by MinIO and many S3-compatible stores. */
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === 'true',
    /** `private` (default): bucket not public, reads via short-lived signed URLs. `public`: bucket/CDN is public by policy. */
    access: process.env.STORAGE_ACCESS ?? 'private',
    publicBaseUrl: process.env.STORAGE_PUBLIC_BASE_URL,
    signedUrlTtlSeconds: parseInt(process.env.STORAGE_SIGNED_URL_TTL_SECONDS ?? '300', 10),
    keyPrefix: process.env.STORAGE_KEY_PREFIX ?? '',
    endpoint: process.env.STORAGE_ENDPOINT,
    region: process.env.STORAGE_REGION,
    bucket: process.env.STORAGE_BUCKET,
    accessKey: process.env.STORAGE_ACCESS_KEY,
    secretKey: process.env.STORAGE_SECRET_KEY,
  },

  /**
   * CHUNK 12B-1 CORRECTION. Used by LocalFilesystemUploadProvider —
   * the real (non-stub) default UPLOAD_PROVIDER binding. Separate
   * from `storage` above (the still-unused S3-style vars, reserved
   * for a future real object-storage provider swap) — this section is
   * specifically for the local-disk fallback this chunk implements,
   * per the explicit instruction not to require external cloud
   * infrastructure not already configured in this repository.
   */
  uploads: {
    localDir: process.env.UPLOADS_LOCAL_DIR,
    publicUrlPrefix: process.env.UPLOADS_PUBLIC_URL_PREFIX ?? '/uploads/files',
    // Image uploads allowed in flight at once (memory protection; see common/middleware/upload-concurrency.middleware.ts).
    maxConcurrent: Number(process.env.UPLOAD_MAX_CONCURRENT) || 6,
  },

  /**
   * Unifonic SMS provider (production OTP delivery). Both required
   * for real SMS to send — UnifonicSmsProvider fails closed (returns
   * success: false, never a fake success) if either is missing,
   * matching the same discipline already used for the local-upload-
   * storage vars above.
   */
  sms: {
    unifonicAppSid: process.env.UNIFONIC_APP_SID,
    unifonicSenderId: process.env.UNIFONIC_SENDER_ID,
  },

  fcm: {
    projectId: process.env.FCM_PROJECT_ID,
    clientEmail: process.env.FCM_CLIENT_EMAIL,
    privateKey: process.env.FCM_PRIVATE_KEY,
  },

  maps: {
    provider: process.env.MAPS_PROVIDER ?? 'google',
    googleApiKey: process.env.GOOGLE_MAPS_API_KEY,
  },

  business: {
    defaultCity: process.env.DEFAULT_CITY ?? 'Belbeis',
    defaultCurrency: process.env.DEFAULT_CURRENCY ?? 'EGP',
  },
});

import * as net from 'net';
import * as path from 'path';
import ms = require('ms');

/**
 * Startup configuration validation (M5 Batch 1).
 *
 * Called once, by `ConfigModule.forRoot({ validate })`, with the merged environment (`.env` + process env) BEFORE any
 * provider is constructed — so a production process with missing or unsafe configuration refuses to boot with one clear
 * error that lists every problem, instead of failing later (or worse, running) half-configured.
 *
 * Two tiers:
 *  - Always required (every environment, including the local `hatly_dev` workflow): only what the application cannot run
 *    without, plus well-formedness of anything that IS set.
 *  - Strict (NODE_ENV=production or staging): everything a deployed environment must have, and the unsafe development
 *    conveniences (placeholder secrets, localhost infrastructure, open CORS, OTP-code logging, plain-text DB, the
 *    deterministic maps stub) are rejected.
 *
 * SECRETS: messages name the variable and the rule that failed. They never contain a value (the one exception is NODE_ENV,
 * which is not a secret) — this output ends up in deployment logs.
 */
export type RuntimeEnvironment = 'development' | 'test' | 'staging' | 'production';
type Env = Record<string, unknown>;

export interface EnvIssues {
  errors: string[];
  warnings: string[];
}

export class ConfigurationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Invalid configuration — the application will not start:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
    this.name = 'ConfigurationError';
  }
}

const KNOWN_ENVIRONMENTS: RuntimeEnvironment[] = ['development', 'test', 'staging', 'production'];
export const MIN_SECRET_LENGTH = 32;

const str = (env: Env, key: string): string | undefined => {
  const v = env[key];
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
};

export function resolveRuntimeEnvironment(raw: unknown): RuntimeEnvironment | null {
  const v = raw === undefined || raw === null || String(raw).trim() === '' ? 'development' : String(raw).trim();
  return (KNOWN_ENVIRONMENTS as string[]).includes(v) ? (v as RuntimeEnvironment) : null;
}

export const isStrictEnvironment = (e: RuntimeEnvironment): boolean => e === 'production' || e === 'staging';

/** Comma-separated absolute origins (`https://dashboard.example.com`), never a wildcard, never with a path. */
export function parseAllowedOrigins(raw: string | undefined): { origins: string[]; invalid: string[] } {
  const origins: string[] = [];
  const invalid: string[] = [];
  for (const token of (raw ?? '').split(',').map((t) => t.trim()).filter(Boolean)) {
    try {
      const url = new URL(token);
      const okScheme = url.protocol === 'https:' || url.protocol === 'http:';
      // `new URL('https://a.com/').origin` drops a trailing slash; anything with a path/query/credentials is not an origin.
      const isBareOrigin = url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password && !token.endsWith('*');
      if (!okScheme || !isBareOrigin || token.includes('*')) invalid.push(token);
      else origins.push(url.origin);
    } catch {
      invalid.push(token);
    }
  }
  return { origins: [...new Set(origins)], invalid };
}

/**
 * `TRUST_PROXY`: unset/`false` = do not trust forwarded headers (the safe default — otherwise anyone can spoof their IP and
 * defeat per-IP rate limiting). A hop count (`1` = one reverse proxy/load balancer in front) or a comma-separated list of
 * proxy addresses/CIDRs/keywords (`loopback`, `linklocal`, `uniquelocal`). `true`/`*` (trust everything) is rejected.
 */
export function parseTrustProxy(raw: string | undefined): { value: number | string[] | false; error?: string } {
  const v = (raw ?? '').trim();
  if (v === '' || v.toLowerCase() === 'false') return { value: false };
  if (/^\d+$/.test(v)) {
    const hops = Number(v);
    return hops >= 1 && hops <= 10 ? { value: hops } : { value: false, error: 'a hop count must be between 1 and 10' };
  }
  if (v.toLowerCase() === 'true' || v === '*') {
    return { value: false, error: 'trusting every proxy is unsafe — use a hop count (e.g. 1) or the proxy address list' };
  }
  const tokens = v.split(',').map((t) => t.trim()).filter(Boolean);
  const keyword = new Set(['loopback', 'linklocal', 'uniquelocal']);
  const valid = tokens.every((t) => {
    if (keyword.has(t)) return true;
    const [addr, bits] = t.split('/');
    if (!net.isIP(addr)) return false;
    if (bits === undefined) return true;
    const max = net.isIPv4(addr) ? 32 : 128;
    return /^\d+$/.test(bits) && Number(bits) <= max;
  });
  return valid ? { value: tokens } : { value: false, error: 'expected a hop count or a comma-separated list of IPs/CIDRs/keywords' };
}

const PLACEHOLDER_SECRET = /change[-_ ]?me|changeme|replace[-_ ]?me|your[-_ ]?secret|example|placeholder|default|password|^dev|^test|^secret/i;

function checkSecret(name: string, value: string | undefined, strict: boolean, errors: string[]): void {
  if (!value) {
    errors.push(`${name} is required.`);
    return;
  }
  if (!strict) return;
  if (value.length < MIN_SECRET_LENGTH) errors.push(`${name} must be at least ${MIN_SECRET_LENGTH} characters in ${'production/staging'}.`);
  else if (PLACEHOLDER_SECRET.test(value)) errors.push(`${name} looks like a placeholder/development value; set a long random secret.`);
  else if (new Set(value).size < 10) errors.push(`${name} has too little variety to be a random secret.`);
}

function checkInteger(env: Env, key: string, errors: string[], min = 1): void {
  const v = str(env, key);
  if (v === undefined) return;
  if (!/^\d+$/.test(v) || Number(v) < min) errors.push(`${key} must be an integer >= ${min}.`);
}

function checkBoolean(env: Env, key: string, errors: string[]): void {
  const v = str(env, key);
  if (v !== undefined && v !== 'true' && v !== 'false') errors.push(`${key} must be "true" or "false".`);
}

const isLocalHost = (host: string): boolean => ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'].includes(host.toLowerCase());

export function collectEnvIssues(env: Env): EnvIssues {
  const errors: string[] = [];
  const warnings: string[] = [];

  const environment = resolveRuntimeEnvironment(env.NODE_ENV);
  if (!environment) {
    errors.push(`NODE_ENV must be one of ${KNOWN_ENVIRONMENTS.join(', ')} (got "${String(env.NODE_ENV)}").`);
    return { errors, warnings };
  }
  const strict = isStrictEnvironment(environment);

  // ---- always: what the application cannot run without, and well-formedness of anything set ----
  const port = str(env, 'PORT');
  if (port !== undefined && (!/^\d+$/.test(port) || Number(port) > 65535)) errors.push('PORT must be an integer between 0 and 65535.');

  const dbUrl = str(env, 'DATABASE_URL');
  if (!dbUrl) {
    errors.push('DATABASE_URL is required.');
  } else {
    try {
      const u = new URL(dbUrl);
      if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') errors.push('DATABASE_URL must be a postgres:// or postgresql:// URL.');
      if (strict) {
        if (isLocalHost(u.hostname)) errors.push('DATABASE_URL must not point at localhost in production/staging.');
        const dbName = u.pathname.replace(/^\//, '');
        if (!dbName) errors.push('DATABASE_URL must name a database.');
        if (/(^|_)(dev|test|local)$/i.test(dbName)) errors.push('DATABASE_URL points at a development/test database name; production must use its own database.');
        if (!u.password) errors.push('DATABASE_URL must include credentials (user and password) in production/staging.');
      }
    } catch {
      errors.push('DATABASE_URL is not a valid URL.');
    }
  }
  checkBoolean(env, 'DB_SSL', errors);
  checkBoolean(env, 'DB_SSL_REJECT_UNAUTHORIZED', errors);
  checkInteger(env, 'DB_POOL_MAX', errors, 2); // a transaction plus the reads made inside it need at least two connections
  checkInteger(env, 'DB_CONNECTION_TIMEOUT_MS', errors);
  checkInteger(env, 'RATE_LIMIT_ROUTE_PER_MINUTE', errors);
  checkInteger(env, 'RATE_LIMIT_CLIENT_PER_MINUTE', errors);
  checkInteger(env, 'UPLOAD_MAX_CONCURRENT', errors);

  checkSecret('JWT_ACCESS_SECRET', str(env, 'JWT_ACCESS_SECRET'), strict, errors);
  checkSecret('JWT_REFRESH_SECRET', str(env, 'JWT_REFRESH_SECRET'), strict, errors);
  if (str(env, 'JWT_ACCESS_SECRET') && str(env, 'JWT_ACCESS_SECRET') === str(env, 'JWT_REFRESH_SECRET')) {
    errors.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different (a leaked access secret must not forge refresh tokens).');
  }
  for (const key of ['JWT_ACCESS_EXPIRES_IN', 'JWT_REFRESH_EXPIRES_IN']) {
    const v = str(env, key);
    if (v !== undefined && !(typeof (ms as unknown as (v: string) => unknown)(v) === 'number')) errors.push(`${key} must be a duration such as "15m" or "30d".`);
  }

  for (const key of ['OTP_TTL_SECONDS', 'OTP_MAX_ATTEMPTS', 'OTP_RESEND_COOLDOWN_SECONDS', 'DISPATCH_SWEEP_INTERVAL_MS', 'DISPATCH_SWEEP_LOCK_TTL_MS', 'DISPATCH_SWEEP_BATCH_LIMIT']) {
    checkInteger(env, key, errors);
  }
  checkBoolean(env, 'OTP_LOG_CODE_FOR_LOCAL_DEV', errors);
  checkBoolean(env, 'ENABLE_API_DOCS', errors);
  checkBoolean(env, 'ALLOW_UNAUTHENTICATED_REDIS', errors);

  const redisUrl = str(env, 'REDIS_URL');
  if (redisUrl !== undefined) {
    try {
      const u = new URL(redisUrl);
      if (u.protocol !== 'redis:' && u.protocol !== 'rediss:') errors.push('REDIS_URL must be a redis:// or rediss:// URL.');
      if (strict && isLocalHost(u.hostname)) errors.push('REDIS_URL must not point at localhost in production/staging.');
      // Security milestone: Redis holds the refresh-token sessions, OTP state and the rate-limit counters. In a deployed environment it
      // must require a password (or the operator must acknowledge a private, unauthenticated instance explicitly).
      if (strict && !u.password && str(env, 'ALLOW_UNAUTHENTICATED_REDIS') !== 'true') {
        errors.push('REDIS_URL must carry a password in production/staging (redis://:<password>@host:6379 or rediss://…). Only for a private-network instance without AUTH, set ALLOW_UNAUTHENTICATED_REDIS=true to acknowledge it explicitly.');
      }
      if (strict && u.protocol === 'redis:') warnings.push('REDIS_URL is not TLS (redis://): acceptable only on a private network (e.g. the staging compose network); use rediss:// for a managed/remote Redis.');
    } catch {
      errors.push('REDIS_URL is not a valid URL.');
    }
  }

  // ---- object storage (M5 Batch 2): `local` needs nothing; `s3` needs the full S3-compatible set ----
  const storageDriver = str(env, 'STORAGE_DRIVER') ?? 'local';
  if (storageDriver !== 'local' && storageDriver !== 's3') errors.push('STORAGE_DRIVER must be "local" or "s3".');
  checkBoolean(env, 'STORAGE_FORCE_PATH_STYLE', errors);
  const storageAccess = str(env, 'STORAGE_ACCESS') ?? 'private';
  if (storageAccess !== 'private' && storageAccess !== 'public') errors.push('STORAGE_ACCESS must be "private" or "public".');
  if (str(env, 'STORAGE_SIGNED_URL_TTL_SECONDS') !== undefined) {
    const ttl = str(env, 'STORAGE_SIGNED_URL_TTL_SECONDS')!;
    if (!/^\d+$/.test(ttl) || Number(ttl) < 1 || Number(ttl) > 3600) errors.push('STORAGE_SIGNED_URL_TTL_SECONDS must be an integer between 1 and 3600.');
  }
  const keyPrefix = str(env, 'STORAGE_KEY_PREFIX');
  if (keyPrefix !== undefined && !/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\/?$/.test(keyPrefix)) errors.push('STORAGE_KEY_PREFIX may only contain letters, digits, "-", "_" and "/" (no "..", no leading "/").');
  const storageEndpoint = str(env, 'STORAGE_ENDPOINT');
  if (storageEndpoint !== undefined) {
    try {
      const u = new URL(storageEndpoint);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') errors.push('STORAGE_ENDPOINT must be an http(s) URL.');
      else if (strict && u.protocol !== 'https:') errors.push('STORAGE_ENDPOINT must use https:// in production/staging.');
    } catch {
      errors.push('STORAGE_ENDPOINT is not a valid URL.');
    }
  }
  if (storageDriver === 's3') {
    for (const key of ['STORAGE_REGION', 'STORAGE_BUCKET', 'STORAGE_ACCESS_KEY', 'STORAGE_SECRET_KEY']) {
      if (!str(env, key)) errors.push(`${key} is required when STORAGE_DRIVER=s3.`);
    }
    if (storageAccess === 'public') {
      const base = str(env, 'STORAGE_PUBLIC_BASE_URL');
      if (!base || !/^https:\/\/[^/\s]+(\/[^\s]*)?$/.test(base)) errors.push('STORAGE_PUBLIC_BASE_URL (an https:// URL) is required when STORAGE_ACCESS=public.');
    }
  } else if (storageDriver === 'local' && strict && str(env, 'STORAGE_ACCESS') === 'public') {
    errors.push('STORAGE_ACCESS applies only to STORAGE_DRIVER=s3.');
  }

  const maps = str(env, 'MAPS_PROVIDER');
  if (maps !== undefined && maps !== 'google' && maps !== 'deterministic' && maps !== 'none') errors.push('MAPS_PROVIDER must be "google", "none" or "deterministic".');

  const prefix = str(env, 'UPLOADS_PUBLIC_URL_PREFIX');
  if (prefix !== undefined && !(prefix.startsWith('/') && !prefix.includes('..') && !prefix.includes('//')) && !/^https:\/\/[^/\s]+(\/[^\s]*)?$/.test(prefix)) {
    errors.push('UPLOADS_PUBLIC_URL_PREFIX must be a path starting with "/" (served by this API) or an https:// URL (external storage).');
  }

  const cors = parseAllowedOrigins(str(env, 'CORS_ALLOWED_ORIGINS'));
  if (cors.invalid.length > 0) errors.push(`CORS_ALLOWED_ORIGINS contains ${cors.invalid.length} invalid entr${cors.invalid.length === 1 ? 'y' : 'ies'}; each must be an exact http(s) origin such as https://dashboard.example.com (no wildcard, no path).`);

  // Two-factor secrets at rest. A dedicated key is validated wherever it is set; when the admin MFA policy is ON in a deployed
  // environment it is REQUIRED (otherwise the key would be derived from JWT_REFRESH_SECRET and a routine secret rotation would silently
  // orphan every enrolled authenticator).
  const mfaKey = str(env, 'MFA_ENCRYPTION_KEY');
  if (mfaKey !== undefined && Buffer.from(mfaKey, 'base64').length !== 32) errors.push('MFA_ENCRYPTION_KEY must be 32 random bytes, base64-encoded (e.g. `openssl rand -base64 32`).');
  const mfaPolicyOn = str(env, 'DASHBOARD_ADMIN_MFA_REQUIRED') === 'true';
  // Security milestone: required in production/staging even with the policy OFF — admins can enrol voluntarily at any time, and an
  // authenticator enrolled under the JWT_REFRESH_SECRET-derived key becomes unusable after a routine secret rotation (or after a key is
  // introduced later). The key must exist BEFORE the first enrolment (docs/security/mfa-rollout.md).
  if (strict && mfaKey === undefined) {
    errors.push(
      mfaPolicyOn
        ? 'DASHBOARD_ADMIN_MFA_REQUIRED=true needs MFA_ENCRYPTION_KEY in production/staging (so rotating JWT_REFRESH_SECRET cannot orphan enrolled authenticators).'
        : 'MFA_ENCRYPTION_KEY is required in production/staging (`openssl rand -base64 32`): admins can enrol an authenticator at any time, and without a dedicated key a JWT_REFRESH_SECRET rotation would orphan it. Set it before the first enrolment and never change it.',
    );
  }

  const trust = parseTrustProxy(str(env, 'TRUST_PROXY'));
  if (trust.error) errors.push(`TRUST_PROXY: ${trust.error}.`);

  const fcm = ['FCM_PROJECT_ID', 'FCM_CLIENT_EMAIL', 'FCM_PRIVATE_KEY'].map((k) => str(env, k));
  const fcmSet = fcm.filter(Boolean).length;
  if (fcmSet > 0 && fcmSet < 3) errors.push('FCM_PROJECT_ID, FCM_CLIENT_EMAIL and FCM_PRIVATE_KEY must be set together (partial push configuration).');
  const unifonic = ['UNIFONIC_APP_SID', 'UNIFONIC_SENDER_ID'].map((k) => str(env, k));
  const unifonicSet = unifonic.filter(Boolean).length;
  if (unifonicSet === 1) errors.push('UNIFONIC_APP_SID and UNIFONIC_SENDER_ID must be set together (partial SMS configuration).');

  // ---- strict: what a deployed environment must have, and development conveniences it must not have ----
  if (strict) {
    if (str(env, 'OTP_LOG_CODE_FOR_LOCAL_DEV') === 'true') errors.push('OTP_LOG_CODE_FOR_LOCAL_DEV must not be enabled in production/staging (it writes OTP codes to the log).');

    if (!redisUrl) errors.push('REDIS_URL is required in production/staging (no localhost default is used).');

    if (str(env, 'DB_SSL') !== 'true' && str(env, 'ALLOW_INSECURE_DB') !== 'true') {
      errors.push('DB_SSL=true is required in production/staging. Only if the database is on a private network that does not offer TLS, set ALLOW_INSECURE_DB=true to acknowledge it explicitly.');
    }
    if (str(env, 'DB_SSL_REJECT_UNAUTHORIZED') === 'false') errors.push('DB_SSL_REJECT_UNAUTHORIZED=false (disabling certificate verification) is not allowed in production/staging; provide the CA via DB_SSL_CA instead.');

    if (cors.origins.length === 0 && cors.invalid.length === 0) errors.push('CORS_ALLOWED_ORIGINS is required in production/staging: a comma-separated list of the exact web origins (e.g. the admin dashboard) allowed to call this API.');
    for (const origin of cors.origins) {
      if (origin.startsWith('http://') && !isLocalHost(new URL(origin).hostname)) errors.push('CORS_ALLOWED_ORIGINS must use https:// for every non-local origin in production/staging.');
    }

    // Local-disk storage needs an explicit, durable, absolute directory; object storage (STORAGE_DRIVER=s3) replaces it.
    if (storageDriver === 'local') {
      const uploadsDir = str(env, 'UPLOADS_LOCAL_DIR');
      if (!uploadsDir) errors.push('UPLOADS_LOCAL_DIR is required in production/staging as an explicit absolute path on persistent storage (the relative default is not durable).');
      else if (!path.isAbsolute(uploadsDir)) errors.push('UPLOADS_LOCAL_DIR must be an absolute path in production/staging.');
    }

    // `none` = Maps deliberately deferred (PD-009 G): no map provider at all, so nothing can be priced or ranked on a distance that
    // was never measured — every delivery is priced and bounded by its active Delivery Zone, dispatch ranks by straight-line distance.
    if (maps === 'deterministic') errors.push('MAPS_PROVIDER=deterministic is a development stub and must not be used in production/staging.');
    else if (maps === 'none') {
      warnings.push(
        'MAPS_PROVIDER=none: Google Maps is disabled — delivery fees and serviceability come from the selected Delivery Zone only, address search/suggestions are off, and dispatch ranks drivers by straight-line distance (bicycle drivers are not auto-ranked).',
      );
      if (str(env, 'GOOGLE_MAPS_API_KEY')) warnings.push('GOOGLE_MAPS_API_KEY is set but unused while MAPS_PROVIDER=none.');
    } else if (!str(env, 'GOOGLE_MAPS_API_KEY')) errors.push('GOOGLE_MAPS_API_KEY is required in production/staging when MAPS_PROVIDER is google (or set MAPS_PROVIDER=none to run without Maps).');

    if (unifonicSet === 0) {
      if (str(env, 'ALLOW_MISSING_SMS_PROVIDER') === 'true') warnings.push('SMS provider (Unifonic) is not configured (ALLOW_MISSING_SMS_PROVIDER=true): OTP/phone-verification messages cannot be sent.');
      else errors.push('UNIFONIC_APP_SID and UNIFONIC_SENDER_ID are required in production/staging for OTP delivery. If this deployment intentionally has no SMS, set ALLOW_MISSING_SMS_PROVIDER=true to acknowledge it.');
    }
    if (fcmSet === 0) {
      if (str(env, 'ALLOW_MISSING_PUSH_PROVIDER') === 'true') warnings.push('Firebase push (FCM) is not configured (ALLOW_MISSING_PUSH_PROVIDER=true): push notifications are disabled.');
      else errors.push('FCM_PROJECT_ID, FCM_CLIENT_EMAIL and FCM_PRIVATE_KEY are required in production/staging for push notifications. If this deployment intentionally has no push, set ALLOW_MISSING_PUSH_PROVIDER=true to acknowledge it.');
    }

    if (!str(env, 'TRUST_PROXY')) warnings.push('TRUST_PROXY is not set: forwarded headers are ignored, so behind a load balancer every client shares the proxy IP for rate limiting. Set TRUST_PROXY to the number of proxies in front of the API if there is one.');
    if (str(env, 'ENABLE_API_DOCS') === 'true') warnings.push('ENABLE_API_DOCS=true: the Swagger UI is publicly reachable.');
  }

  return { errors, warnings };
}

/** `ConfigModule.forRoot({ validate })` hook: returns the environment unchanged, or throws one error listing every problem. */
export function validateEnvironment(env: Env): Env {
  const { errors } = collectEnvIssues(env);
  if (errors.length > 0) throw new ConfigurationError(errors);
  return env;
}

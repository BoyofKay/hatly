/**
 * HTTP end-to-end environment (Group 8). Dedicated, disposable PostgreSQL database and
 * Redis logical database — never the development or integration ones — with hard guards.
 * External providers get DUMMY credentials so the real provider classes run, but every
 * outbound HTTP call is intercepted at the network edge (see external-boundary.ts).
 */
import * as os from 'os';
import * as path from 'path';

export const E2E_DB_NAME = 'hatly_e2e_test';
export const E2E_REDIS_DB = 14;
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? `postgres://hatly:hatly@localhost:5432/${E2E_DB_NAME}`;
export const E2E_REDIS_URL = process.env.E2E_REDIS_URL ?? `redis://localhost:6379/${E2E_REDIS_DB}`;

export function assertIsolatedInfrastructure(): void {
  const dbName = new URL(E2E_DATABASE_URL).pathname.replace(/^\//, '');
  if (dbName !== E2E_DB_NAME) throw new Error(`Refusing to run E2E: database "${dbName}" is not "${E2E_DB_NAME}".`);
  const redisDb = Number(new URL(E2E_REDIS_URL).pathname.replace(/^\//, '') || 0);
  if (redisDb !== E2E_REDIS_DB) throw new Error(`Refusing to run E2E: Redis db ${redisDb} is not the dedicated db ${E2E_REDIS_DB}.`);
}

export const DUMMY_UNIFONIC_APP_SID = 'e2e-dummy-unifonic-app-sid';
export const DUMMY_MAPS_KEY = 'e2e-dummy-maps-key';

export function e2eEnv(): Record<string, string> {
  return {
    NODE_ENV: 'test',
    PORT: '0',
    API_PREFIX: 'api/v1',
    DATABASE_URL: E2E_DATABASE_URL,
    DB_SSL: 'false',
    REDIS_URL: E2E_REDIS_URL,
    JWT_ACCESS_SECRET: 'e2e-access-secret',
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_SECRET: 'e2e-refresh-secret',
    JWT_REFRESH_EXPIRES_IN: '30d',
    OTP_TTL_SECONDS: '300',
    OTP_MAX_ATTEMPTS: '5',
    OTP_RESEND_COOLDOWN_SECONDS: '60',
    OTP_LOG_CODE_FOR_LOCAL_DEV: 'false',
    STORAGE_ENDPOINT: '', STORAGE_REGION: '', STORAGE_BUCKET: '', STORAGE_ACCESS_KEY: '', STORAGE_SECRET_KEY: '',
    FCM_PROJECT_ID: '', FCM_CLIENT_EMAIL: '', FCM_PRIVATE_KEY: '',
    // Pinned explicitly, never inherited from whatever the developer's own .env happens to say — E2E always
    // exercises the REAL GoogleMapsProvider (against the fake-fetch boundary below), never the deterministic
    // dev-only approximation, regardless of local MAPS_PROVIDER settings.
    MAPS_PROVIDER: 'google',
    GOOGLE_MAPS_API_KEY: DUMMY_MAPS_KEY,
    UNIFONIC_APP_SID: DUMMY_UNIFONIC_APP_SID,
    UNIFONIC_SENDER_ID: 'HatlyE2E',
    BOOTSTRAP_ADMIN_PHONE: '', BOOTSTRAP_ADMIN_NAME: '', BOOTSTRAP_ADMIN_PASSWORD: '',
    UPLOADS_LOCAL_DIR: path.join(os.tmpdir(), 'hatly-e2e-uploads'),
  };
}

export function applyE2eEnv(): void {
  assertIsolatedInfrastructure();
  Object.assign(process.env, e2eEnv());
}

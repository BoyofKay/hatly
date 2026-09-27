/**
 * Single source of truth for the real-infrastructure integration
 * environment (Group 6). Everything here is deliberately LOCAL and
 * disposable: a dedicated PostgreSQL database and a dedicated Redis
 * logical database — never the normal development ones — plus hard
 * guards that refuse to run if either points anywhere else.
 */
import * as os from 'os';
import * as path from 'path';

export const INTEGRATION_DB_NAME = 'hatly_integration_test';
export const INTEGRATION_REDIS_DB = 15;
/** Every Redis key a test creates lives under this prefix so cleanup never touches anything else. */
export const REDIS_TEST_KEY_PREFIX = 'hatly:inttest:';

export const INTEGRATION_DATABASE_URL =
  process.env.INTEGRATION_DATABASE_URL ?? `postgres://hatly:hatly@localhost:5432/${INTEGRATION_DB_NAME}`;
export const INTEGRATION_REDIS_URL =
  process.env.INTEGRATION_REDIS_URL ?? `redis://localhost:6379/${INTEGRATION_REDIS_DB}`;

export function databaseNameOf(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}

export function redisDbIndexOf(url: string): number {
  const p = new URL(url).pathname.replace(/^\//, '');
  return p === '' ? 0 : Number(p);
}

/** Refuses to continue unless both targets are the dedicated integration ones. */
export function assertIsolatedInfrastructure(): void {
  const dbName = databaseNameOf(INTEGRATION_DATABASE_URL);
  if (!dbName.startsWith(INTEGRATION_DB_NAME)) {
    throw new Error(
      `Refusing to run integration tests: database "${dbName}" is not a dedicated "${INTEGRATION_DB_NAME}*" database.`,
    );
  }
  const redisDb = redisDbIndexOf(INTEGRATION_REDIS_URL);
  if (!Number.isInteger(redisDb) || redisDb === 0) {
    throw new Error('Refusing to run integration tests: Redis logical database 0 (the default) is reserved for development.');
  }
}

/**
 * Environment applied BEFORE any application module is imported. Set
 * explicitly (including empty strings) rather than left unset, because
 * both `dotenv` and `@nestjs/config` only fill variables that are not
 * already present in process.env — so a developer's local `.env`
 * (real API keys, dev DB) can never leak into an integration run.
 */
export function integrationEnv(): Record<string, string> {
  return {
    NODE_ENV: 'test',
    PORT: '0',
    API_PREFIX: 'api/v1',
    DATABASE_URL: INTEGRATION_DATABASE_URL,
    DB_SSL: 'false',
    REDIS_URL: INTEGRATION_REDIS_URL,
    JWT_ACCESS_SECRET: 'integration-test-access-secret',
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_SECRET: 'integration-test-refresh-secret',
    JWT_REFRESH_EXPIRES_IN: '30d',
    OTP_LOG_CODE_FOR_LOCAL_DEV: 'false',
    STORAGE_ENDPOINT: '',
    STORAGE_REGION: '',
    STORAGE_BUCKET: '',
    STORAGE_ACCESS_KEY: '',
    STORAGE_SECRET_KEY: '',
    FCM_PROJECT_ID: '',
    FCM_CLIENT_EMAIL: '',
    FCM_PRIVATE_KEY: '',
    // Pinned explicitly, never inherited from whatever the developer's own .env happens to say.
    MAPS_PROVIDER: 'google',
    GOOGLE_MAPS_API_KEY: '',
    UNIFONIC_APP_SID: '',
    UNIFONIC_SENDER_ID: '',
    BOOTSTRAP_ADMIN_PHONE: '',
    BOOTSTRAP_ADMIN_NAME: '',
    BOOTSTRAP_ADMIN_PASSWORD: '',
    UPLOADS_LOCAL_DIR: path.join(os.tmpdir(), 'hatly-integration-uploads'),
  };
}

export function applyIntegrationEnv(): void {
  assertIsolatedInfrastructure();
  Object.assign(process.env, integrationEnv());
}

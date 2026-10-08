import { collectEnvIssues, ConfigurationError, parseAllowedOrigins, parseTrustProxy, validateEnvironment } from './env.validation';
import { buildDatabaseSslOptions } from './database-ssl';

/** The existing local `hatly_dev` workflow's environment shape (apps/backend/.env.example, development values). */
const DEV_ENV = {
  NODE_ENV: 'development',
  PORT: '3000',
  API_PREFIX: 'api/v1',
  DATABASE_URL: 'postgres://hatly:hatly@localhost:5432/hatly_dev',
  DB_SSL: 'false',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'change-me-access-secret',
  JWT_REFRESH_SECRET: 'change-me-refresh-secret',
  JWT_ACCESS_EXPIRES_IN: '15m',
  JWT_REFRESH_EXPIRES_IN: '30d',
  OTP_LOG_CODE_FOR_LOCAL_DEV: 'true',
  MAPS_PROVIDER: 'deterministic',
  UPLOADS_LOCAL_DIR: '',
  UPLOADS_PUBLIC_URL_PREFIX: '/uploads/files',
  FCM_PROJECT_ID: '',
  FCM_CLIENT_EMAIL: '',
  FCM_PRIVATE_KEY: '',
};

const SECRET_A = 'q7Zr2KfX9mLp4TnB8vYc1WdH6sJg3EaU';
const SECRET_B = 'Hx5Nk0RbV8tQe2MzC7yLw4PdFj9AoS1G';

/** A complete, valid production environment. */
const PROD_ENV = {
  NODE_ENV: 'production',
  PORT: '3000',
  DATABASE_URL: 'postgres://hatly_app:Tr0ub4dor-Xk29@db.internal.example:5432/hatly_prod',
  DB_SSL: 'true',
  REDIS_URL: 'rediss://:r3dis-pass@cache.internal.example:6380',
  JWT_ACCESS_SECRET: SECRET_A,
  JWT_REFRESH_SECRET: SECRET_B,
  CORS_ALLOWED_ORIGINS: 'https://admin.hatly.example',
  UPLOADS_LOCAL_DIR: '/var/lib/hatly/uploads',
  MAPS_PROVIDER: 'google',
  GOOGLE_MAPS_API_KEY: 'AIzaSyFakeKeyForTestOnly000000000000000',
  UNIFONIC_APP_SID: 'sid-1',
  UNIFONIC_SENDER_ID: 'Hatly',
  FCM_PROJECT_ID: 'hatly-prod',
  FCM_CLIENT_EMAIL: 'svc@hatly-prod.iam.gserviceaccount.com',
  FCM_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
  TRUST_PROXY: '1',
};

const errorsOf = (env: Record<string, unknown>) => collectEnvIssues(env).errors;
const without = (env: Record<string, unknown>, ...keys: string[]) => Object.fromEntries(Object.entries(env).filter(([k]) => !keys.includes(k)));

describe('environment validation — development keeps the existing hatly_dev workflow', () => {
  it('boots with the current dev .env shape (placeholder secrets, localhost infrastructure, deterministic maps, OTP logging)', () => {
    expect(errorsOf(DEV_ENV)).toEqual([]);
    expect(() => validateEnvironment(DEV_ENV)).not.toThrow();
  });

  it('needs no production-only credentials (no CORS list, SMS, FCM, Google key, absolute uploads dir)', () => {
    expect(errorsOf(without(DEV_ENV, 'FCM_PROJECT_ID', 'FCM_CLIENT_EMAIL', 'FCM_PRIVATE_KEY', 'UPLOADS_LOCAL_DIR'))).toEqual([]);
  });

  it('treats an unset NODE_ENV as development', () => {
    expect(errorsOf(without(DEV_ENV, 'NODE_ENV'))).toEqual([]);
  });

  it('still requires what the application cannot run without: DATABASE_URL and both JWT secrets', () => {
    const errors = errorsOf(without(DEV_ENV, 'DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'));
    expect(errors).toEqual(expect.arrayContaining(['DATABASE_URL is required.', 'JWT_ACCESS_SECRET is required.', 'JWT_REFRESH_SECRET is required.']));
  });

  it('rejects malformed values in any environment (bad numbers/booleans/durations/URLs/NODE_ENV)', () => {
    const errors = errorsOf({ ...DEV_ENV, PORT: 'abc', OTP_MAX_ATTEMPTS: '0', DB_SSL: 'yes', JWT_ACCESS_EXPIRES_IN: 'soon', REDIS_URL: 'http://x', MAPS_PROVIDER: 'osm' });
    expect(errors.join('\n')).toMatch(/PORT/);
    expect(errors.join('\n')).toMatch(/OTP_MAX_ATTEMPTS/);
    expect(errors.join('\n')).toMatch(/DB_SSL must be/);
    expect(errors.join('\n')).toMatch(/JWT_ACCESS_EXPIRES_IN/);
    expect(errors.join('\n')).toMatch(/REDIS_URL/);
    expect(errors.join('\n')).toMatch(/MAPS_PROVIDER/);
    expect(errorsOf({ ...DEV_ENV, NODE_ENV: 'prod' })[0]).toMatch(/NODE_ENV must be one of/);
  });

  it('rejects identical access/refresh secrets in every environment', () => {
    expect(errorsOf({ ...DEV_ENV, JWT_REFRESH_SECRET: DEV_ENV.JWT_ACCESS_SECRET }).join('\n')).toMatch(/must be different/);
  });
});

describe('environment validation — production/staging fail fast', () => {
  it('accepts a complete, safe production configuration', () => {
    expect(errorsOf(PROD_ENV)).toEqual([]);
    expect(errorsOf({ ...PROD_ENV, NODE_ENV: 'staging' })).toEqual([]);
  });

  it.each([
    ['DATABASE_URL', /DATABASE_URL is required/],
    ['JWT_ACCESS_SECRET', /JWT_ACCESS_SECRET is required/],
    ['JWT_REFRESH_SECRET', /JWT_REFRESH_SECRET is required/],
    ['REDIS_URL', /REDIS_URL is required/],
    ['CORS_ALLOWED_ORIGINS', /CORS_ALLOWED_ORIGINS is required/],
    ['UPLOADS_LOCAL_DIR', /UPLOADS_LOCAL_DIR is required/],
    ['GOOGLE_MAPS_API_KEY', /GOOGLE_MAPS_API_KEY is required/],
    ['UNIFONIC_APP_SID', /UNIFONIC/],
    ['FCM_PRIVATE_KEY', /FCM_PROJECT_ID, FCM_CLIENT_EMAIL and FCM_PRIVATE_KEY/],
    ['DB_SSL', /DB_SSL=true is required/],
  ])('rejects production with %s missing', (key, pattern) => {
    const errors = errorsOf(without(PROD_ENV, key, ...(key === 'UNIFONIC_APP_SID' ? ['UNIFONIC_SENDER_ID'] : []), ...(key === 'FCM_PRIVATE_KEY' ? ['FCM_PROJECT_ID', 'FCM_CLIENT_EMAIL'] : [])));
    expect(errors.join('\n')).toMatch(pattern);
    expect(() => validateEnvironment(without(PROD_ENV, key))).toThrow(ConfigurationError);
  });

  it('reports EVERY problem at once, not one per restart', () => {
    const error = (() => {
      try {
        validateEnvironment({ NODE_ENV: 'production' });
      } catch (e) {
        return e as ConfigurationError;
      }
    })()!;
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(error.errors.length).toBeGreaterThanOrEqual(8);
  });

  it('rejects the unsafe development conveniences in production', () => {
    expect(errorsOf({ ...PROD_ENV, JWT_ACCESS_SECRET: 'change-me-access-secret' }).join('\n')).toMatch(/JWT_ACCESS_SECRET .*placeholder|at least 32/);
    expect(errorsOf({ ...PROD_ENV, JWT_REFRESH_SECRET: 'short' }).join('\n')).toMatch(/JWT_REFRESH_SECRET must be at least 32/);
    expect(errorsOf({ ...PROD_ENV, JWT_ACCESS_SECRET: 'a'.repeat(40) }).join('\n')).toMatch(/too little variety/);
    expect(errorsOf({ ...PROD_ENV, OTP_LOG_CODE_FOR_LOCAL_DEV: 'true' }).join('\n')).toMatch(/OTP_LOG_CODE_FOR_LOCAL_DEV/);
    expect(errorsOf({ ...PROD_ENV, MAPS_PROVIDER: 'deterministic' }).join('\n')).toMatch(/MAPS_PROVIDER=deterministic/);
    expect(errorsOf({ ...PROD_ENV, DATABASE_URL: 'postgres://u:p@localhost:5432/hatly_prod' }).join('\n')).toMatch(/DATABASE_URL must not point at localhost/);
    expect(errorsOf({ ...PROD_ENV, DATABASE_URL: 'postgres://u:p@db.example:5432/hatly_dev' }).join('\n')).toMatch(/development\/test database/);
    expect(errorsOf({ ...PROD_ENV, REDIS_URL: 'redis://localhost:6379' }).join('\n')).toMatch(/REDIS_URL must not point at localhost/);
    expect(errorsOf({ ...PROD_ENV, DB_SSL: 'false' }).join('\n')).toMatch(/DB_SSL=true is required/);
    expect(errorsOf({ ...PROD_ENV, DB_SSL_REJECT_UNAUTHORIZED: 'false' }).join('\n')).toMatch(/DB_SSL_REJECT_UNAUTHORIZED=false/);
    expect(errorsOf({ ...PROD_ENV, UPLOADS_LOCAL_DIR: './uploads-storage' }).join('\n')).toMatch(/absolute path/);
  });

  it('allows a plain-text private-network database only with the explicit acknowledgement', () => {
    expect(errorsOf({ ...PROD_ENV, DB_SSL: 'false', ALLOW_INSECURE_DB: 'true' })).toEqual([]);
  });

  it('allows an intentionally absent SMS/push provider only with an explicit acknowledgement, and warns about it', () => {
    const env = without(PROD_ENV, 'UNIFONIC_APP_SID', 'UNIFONIC_SENDER_ID', 'FCM_PROJECT_ID', 'FCM_CLIENT_EMAIL', 'FCM_PRIVATE_KEY');
    expect(errorsOf(env).length).toBe(2);
    const acknowledged = collectEnvIssues({ ...env, ALLOW_MISSING_SMS_PROVIDER: 'true', ALLOW_MISSING_PUSH_PROVIDER: 'true' });
    expect(acknowledged.errors).toEqual([]);
    expect(acknowledged.warnings.join('\n')).toMatch(/SMS provider/);
    expect(acknowledged.warnings.join('\n')).toMatch(/push/);
  });

  it('rejects partial SMS/FCM configuration in every environment', () => {
    expect(errorsOf({ ...DEV_ENV, UNIFONIC_APP_SID: 'only-one' }).join('\n')).toMatch(/UNIFONIC_APP_SID and UNIFONIC_SENDER_ID must be set together/);
    expect(errorsOf({ ...DEV_ENV, FCM_PROJECT_ID: 'p' }).join('\n')).toMatch(/must be set together/);
  });

  it('NEVER puts a secret or credential value in an error or warning', () => {
    const secretish = {
      ...PROD_ENV,
      JWT_ACCESS_SECRET: 'tooShortSecretValueXYZ',
      JWT_REFRESH_SECRET: 'tooShortSecretValueXYZ',
      DATABASE_URL: 'postgres://dbuser:SuperSecretDbPassword@localhost:5432/hatly_dev',
      REDIS_URL: 'redis://:RedisSecretPass@localhost:6379',
      GOOGLE_MAPS_API_KEY: '',
      FCM_PRIVATE_KEY: 'PRIVATE-KEY-MATERIAL',
      FCM_PROJECT_ID: '',
      CORS_ALLOWED_ORIGINS: 'https://ok.example/with/path',
    };
    const { errors, warnings } = collectEnvIssues(secretish);
    const text = [...errors, ...warnings].join('\n');
    for (const value of ['tooShortSecretValueXYZ', 'SuperSecretDbPassword', 'RedisSecretPass', 'PRIVATE-KEY-MATERIAL', 'dbuser']) {
      expect(text).not.toContain(value);
    }
    try {
      validateEnvironment(secretish);
    } catch (e) {
      expect((e as Error).message).not.toContain('SuperSecretDbPassword');
    }
  });
});

const S3_ENV = {
  STORAGE_DRIVER: 's3',
  STORAGE_REGION: 'eu-west-1',
  STORAGE_BUCKET: 'hatly-media',
  STORAGE_ACCESS_KEY: 'AKIAFAKEFORTESTS',
  STORAGE_SECRET_KEY: 'fake/secret+key/for/tests/only0123456789',
};

describe('environment validation — object storage (STORAGE_DRIVER)', () => {
  it('development needs no storage configuration at all: the local filesystem is the default', () => {
    expect(errorsOf(DEV_ENV)).toEqual([]);
    expect(errorsOf({ ...DEV_ENV, STORAGE_DRIVER: 'local' })).toEqual([]);
    expect(errorsOf({ ...DEV_ENV, STORAGE_DRIVER: '', STORAGE_BUCKET: '', STORAGE_ACCESS_KEY: '' })).toEqual([]);
  });

  it('rejects an unknown driver or access policy', () => {
    expect(errorsOf({ ...DEV_ENV, STORAGE_DRIVER: 'gcs' }).join('\n')).toMatch(/STORAGE_DRIVER must be/);
    expect(errorsOf({ ...DEV_ENV, ...S3_ENV, STORAGE_ACCESS: 'open' }).join('\n')).toMatch(/STORAGE_ACCESS must be/);
  });

  it.each(['STORAGE_REGION', 'STORAGE_BUCKET', 'STORAGE_ACCESS_KEY', 'STORAGE_SECRET_KEY'])('STORAGE_DRIVER=s3 requires %s (in every environment)', (key) => {
    expect(errorsOf({ ...DEV_ENV, ...without(S3_ENV, key) }).join('\n')).toMatch(new RegExp(`${key} is required when STORAGE_DRIVER=s3`));
    expect(errorsOf({ ...DEV_ENV, ...S3_ENV })).toEqual([]);
  });

  it('production with s3 does not need UPLOADS_LOCAL_DIR, while production with local storage still does', () => {
    expect(errorsOf({ ...without(PROD_ENV, 'UPLOADS_LOCAL_DIR'), ...S3_ENV })).toEqual([]);
    expect(errorsOf(without(PROD_ENV, 'UPLOADS_LOCAL_DIR')).join('\n')).toMatch(/UPLOADS_LOCAL_DIR is required/);
  });

  it('a custom endpoint must be a valid URL, and https in production/staging', () => {
    expect(errorsOf({ ...DEV_ENV, ...S3_ENV, STORAGE_ENDPOINT: 'not a url' }).join('\n')).toMatch(/STORAGE_ENDPOINT is not a valid URL/);
    expect(errorsOf({ ...DEV_ENV, ...S3_ENV, STORAGE_ENDPOINT: 'ftp://x.example' }).join('\n')).toMatch(/must be an http\(s\) URL/);
    expect(errorsOf({ ...DEV_ENV, ...S3_ENV, STORAGE_ENDPOINT: 'http://127.0.0.1:9000' })).toEqual([]); // local MinIO-style service in dev
    expect(errorsOf({ ...without(PROD_ENV, 'UPLOADS_LOCAL_DIR'), ...S3_ENV, STORAGE_ENDPOINT: 'http://objects.example' }).join('\n')).toMatch(/STORAGE_ENDPOINT must use https/);
    expect(errorsOf({ ...without(PROD_ENV, 'UPLOADS_LOCAL_DIR'), ...S3_ENV, STORAGE_ENDPOINT: 'https://objects.example' })).toEqual([]);
  });

  it('public access needs an https public base URL; private (the default) does not', () => {
    expect(errorsOf({ ...DEV_ENV, ...S3_ENV, STORAGE_ACCESS: 'public' }).join('\n')).toMatch(/STORAGE_PUBLIC_BASE_URL/);
    expect(errorsOf({ ...DEV_ENV, ...S3_ENV, STORAGE_ACCESS: 'public', STORAGE_PUBLIC_BASE_URL: 'http://cdn.example' }).join('\n')).toMatch(/STORAGE_PUBLIC_BASE_URL/);
    expect(errorsOf({ ...DEV_ENV, ...S3_ENV, STORAGE_ACCESS: 'public', STORAGE_PUBLIC_BASE_URL: 'https://cdn.example/media' })).toEqual([]);
    expect(errorsOf({ ...DEV_ENV, ...S3_ENV, STORAGE_ACCESS: 'private' })).toEqual([]);
  });

  it('validates the signed-URL TTL and key prefix', () => {
    for (const ttl of ['0', '3601', 'abc', '-5', '1.5']) {
      expect(errorsOf({ ...DEV_ENV, ...S3_ENV, STORAGE_SIGNED_URL_TTL_SECONDS: ttl }).join('\n')).toMatch(/STORAGE_SIGNED_URL_TTL_SECONDS/);
    }
    expect(errorsOf({ ...DEV_ENV, ...S3_ENV, STORAGE_SIGNED_URL_TTL_SECONDS: '600' })).toEqual([]);
    for (const prefix of ['../x', '/abs', 'a b', 'a//b']) {
      expect(errorsOf({ ...DEV_ENV, ...S3_ENV, STORAGE_KEY_PREFIX: prefix }).join('\n')).toMatch(/STORAGE_KEY_PREFIX/);
    }
    expect(errorsOf({ ...DEV_ENV, ...S3_ENV, STORAGE_KEY_PREFIX: 'hatly/media/' })).toEqual([]);
  });

  it('the configuration error never echoes the secret values', () => {
    const message = errorsOf({ ...DEV_ENV, ...S3_ENV, STORAGE_ENDPOINT: 'nope' }).join('\n');
    expect(message).not.toContain(S3_ENV.STORAGE_SECRET_KEY);
    expect(message).not.toContain(S3_ENV.STORAGE_ACCESS_KEY);
  });
});

describe('environment validation — database connection pool', () => {
  it('is optional (the node-postgres defaults apply) and accepts sane values', () => {
    expect(errorsOf(DEV_ENV)).toEqual([]);
    expect(errorsOf({ ...DEV_ENV, DB_POOL_MAX: '20', DB_CONNECTION_TIMEOUT_MS: '5000' })).toEqual([]);
    expect(errorsOf({ ...DEV_ENV, DB_POOL_MAX: '', DB_CONNECTION_TIMEOUT_MS: '' })).toEqual([]);
  });

  it('requires a pool of at least two connections (a transaction plus the reads made inside it) and positive integers', () => {
    for (const bad of ['1', '0', '-3', 'ten', '2.5']) expect(errorsOf({ ...DEV_ENV, DB_POOL_MAX: bad }).join('\n')).toMatch(/DB_POOL_MAX must be an integer >= 2/);
    for (const bad of ['0', 'soon', '-1']) expect(errorsOf({ ...DEV_ENV, DB_CONNECTION_TIMEOUT_MS: bad }).join('\n')).toMatch(/DB_CONNECTION_TIMEOUT_MS must be an integer >= 1/);
  });

  it('applies in production too', () => {
    expect(errorsOf({ ...PROD_ENV, DB_POOL_MAX: '1' }).join('\n')).toMatch(/DB_POOL_MAX/);
    expect(errorsOf({ ...PROD_ENV, DB_POOL_MAX: '25' })).toEqual([]);
  });
});

describe('environment validation — rate limits and upload concurrency', () => {
  it('are optional and accept positive integers', () => {
    expect(errorsOf(DEV_ENV)).toEqual([]);
    expect(errorsOf({ ...DEV_ENV, RATE_LIMIT_ROUTE_PER_MINUTE: '200', RATE_LIMIT_CLIENT_PER_MINUTE: '1200', UPLOAD_MAX_CONCURRENT: '4' })).toEqual([]);
    expect(errorsOf({ ...DEV_ENV, RATE_LIMIT_ROUTE_PER_MINUTE: '', RATE_LIMIT_CLIENT_PER_MINUTE: '', UPLOAD_MAX_CONCURRENT: '' })).toEqual([]);
  });

  it.each(['RATE_LIMIT_ROUTE_PER_MINUTE', 'RATE_LIMIT_CLIENT_PER_MINUTE', 'UPLOAD_MAX_CONCURRENT'])('%s must be a positive integer (never 0 = "unlimited by accident")', (key) => {
    for (const bad of ['0', '-1', 'many', '1.5']) expect(errorsOf({ ...DEV_ENV, [key]: bad }).join('\n')).toMatch(new RegExp(`${key} must be an integer >= 1`));
  });
});

describe('CORS origins and TRUST_PROXY parsing', () => {
  it('accepts exact http(s) origins, normalising a trailing slash', () => {
    expect(parseAllowedOrigins('https://a.example, https://b.example/ ,http://localhost:5173')).toEqual({
      origins: ['https://a.example', 'https://b.example', 'http://localhost:5173'],
      invalid: [],
    });
  });

  it('rejects wildcards, paths, other schemes and garbage — never silently allows them', () => {
    const { origins, invalid } = parseAllowedOrigins('*, https://*.example.com, https://a.example/x, ftp://a.example, nonsense, https://ok.example');
    expect(origins).toEqual(['https://ok.example']);
    expect(invalid).toHaveLength(5);
  });

  it('production requires https for non-local origins and a non-empty list', () => {
    expect(errorsOf({ ...PROD_ENV, CORS_ALLOWED_ORIGINS: 'http://admin.hatly.example' }).join('\n')).toMatch(/must use https/);
    expect(errorsOf({ ...PROD_ENV, CORS_ALLOWED_ORIGINS: '*' }).join('\n')).toMatch(/invalid entr/);
    expect(errorsOf({ ...PROD_ENV, CORS_ALLOWED_ORIGINS: 'https://a.example,http://localhost:5173' })).toEqual([]);
  });

  it('TRUST_PROXY: off by default, a hop count or an address list when set, never "trust everything"', () => {
    expect(parseTrustProxy(undefined)).toEqual({ value: false });
    expect(parseTrustProxy('false')).toEqual({ value: false });
    expect(parseTrustProxy('1')).toEqual({ value: 1 });
    expect(parseTrustProxy('loopback, 10.0.0.0/8')).toEqual({ value: ['loopback', '10.0.0.0/8'] });
    expect(parseTrustProxy('true').error).toMatch(/unsafe/);
    expect(parseTrustProxy('*').error).toMatch(/unsafe/);
    expect(parseTrustProxy('0').error).toBeDefined();
    expect(parseTrustProxy('11').error).toBeDefined();
    expect(parseTrustProxy('10.0.0.0/99').error).toBeDefined();
    expect(parseTrustProxy('not-an-ip').error).toBeDefined();
    expect(errorsOf({ ...PROD_ENV, TRUST_PROXY: 'true' }).join('\n')).toMatch(/TRUST_PROXY/);
  });
});

describe('database TLS options', () => {
  it('is off for the local dev workflow', () => {
    expect(buildDatabaseSslOptions({ DB_SSL: 'false' })).toBe(false);
    expect(buildDatabaseSslOptions({})).toBe(false);
  });

  it('DB_SSL=true verifies the server certificate by default and can trust a provider CA', () => {
    expect(buildDatabaseSslOptions({ DB_SSL: 'true' })).toEqual({ rejectUnauthorized: true });
    expect(buildDatabaseSslOptions({ DB_SSL: 'true', DB_SSL_CA: '-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----' })).toEqual({
      rejectUnauthorized: true,
      ca: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----',
    });
  });

  it('only an explicit DB_SSL_REJECT_UNAUTHORIZED=false disables verification (which production rejects at boot)', () => {
    expect(buildDatabaseSslOptions({ DB_SSL: 'true', DB_SSL_REJECT_UNAUTHORIZED: 'false' })).toEqual({ rejectUnauthorized: false });
  });
});

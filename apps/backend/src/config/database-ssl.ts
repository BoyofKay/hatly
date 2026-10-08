/**
 * Database TLS options from the environment (M5 Batch 1). One builder shared by the running application (`app.module.ts`)
 * and the TypeORM CLI/seed data source (`database/data-source.ts`), so the two can never disagree.
 *
 *  - `DB_SSL` not `true`  → no TLS (local `hatly_dev` workflow unchanged).
 *  - `DB_SSL=true`        → TLS with certificate verification ON. `DB_SSL_CA` (PEM text; literal `\n` sequences allowed so it
 *                           fits a single env line) trusts a provider-specific CA. `DB_SSL_REJECT_UNAUTHORIZED=false` turns
 *                           verification off — rejected at startup in production/staging (see env.validation.ts).
 * Never logs or returns anything other than the options object handed to the driver.
 */
export type DatabaseSslOptions = false | { rejectUnauthorized: boolean; ca?: string };

export function buildDatabaseSslOptions(env: Record<string, string | undefined>): DatabaseSslOptions {
  if (env.DB_SSL !== 'true') return false;
  const ca = env.DB_SSL_CA?.trim();
  return {
    rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
    ...(ca ? { ca: ca.replace(/\\n/g, '\n') } : {}),
  };
}

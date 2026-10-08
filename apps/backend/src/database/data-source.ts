import 'dotenv/config';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { buildDatabaseSslOptions } from '../config/database-ssl';

/**
 * Used by the TypeORM CLI only (migration:generate/run/revert — see
 * package.json scripts). The running application gets its connection
 * via TypeOrmModule.forRootAsync in app.module.ts instead.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl: buildDatabaseSslOptions(process.env),
  // CRITICAL: without this the pg driver returns every PostgreSQL bigint
  // (all `*_minor` money columns, wallet/financial/offer amounts, counters)
  // as a JavaScript STRING even though the entities declare `number`.
  // Every `a + b` over such a value then silently CONCATENATES —
  // measured against a real database, WalletService.getBalance returned
  // "0100002500-150099999999999" instead of a number. Mocked unit tests
  // could never see it. Values are integer minor units far below
  // Number.MAX_SAFE_INTEGER (~9e15 = 90 trillion EGP), so parsing to a
  // JS number is exact for every realistic amount.
  parseInt8: true,
  // Discovered, not hand-listed: this list used to be maintained by hand
  // and had silently drifted 15 entities behind the running application
  // (Offer*, WalletTransaction, LoyaltyPointsTransaction, Favorite,
  // OrderItemWeightRecord, ...), which is exactly how a CLI-only
  // "Entity metadata for X#y was not found" failure got in. Every
  // `*.entity.ts` under src/ is loaded so the CLI and the running app
  // can never disagree about the entity set again (integration test:
  // `entity-metadata.int-spec.ts` pins the count against the files).
  entities: [path.join(__dirname, '..', '**', '*.entity{.ts,.js}')],
  migrations: [path.join(__dirname, 'migrations', '*{.ts,.js}')],
  synchronize: false, // never true outside of a throwaway local sandbox — migrations are the source of truth
  logging: process.env.NODE_ENV === 'development',
});

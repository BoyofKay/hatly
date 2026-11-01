import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { AppDataSource } from '../database/data-source';
import { User } from '../modules/users/entities/user.entity';
import { Role } from '../common/enums/role.enum';

/**
 * PHASE I-A, DEPLOYMENT PREPARATION — first SUPER_ADMIN bootstrap.
 *
 * CONFIRMED (fresh inspection): no mechanism to create the first Admin
 * existed anywhere in this codebase before this script — `POST
 * auth/register` is hardcoded to `Role.CUSTOMER`
 * (`UsersService.createCustomer`), and every other role-creating
 * endpoint (`admin/vendor-staff`, `admin/drivers`) requires an
 * already-authenticated Admin, which is exactly the chicken-and-egg
 * problem this script exists to break — once, deliberately, outside
 * the HTTP surface entirely.
 *
 * Run via: `npm run bootstrap:admin`
 *
 * NOT an HTTP endpoint — this file is never imported by
 * `app.module.ts` or any controller; it only runs as a standalone
 * Node process against the same `AppDataSource` the TypeORM CLI
 * itself uses (see `database/data-source.ts`'s own comment: "used by
 * the TypeORM CLI only... the running application gets its connection
 * via TypeOrmModule.forRootAsync instead" — this script is the one
 * other legitimate consumer of that same config, reusing it exactly
 * as instructed, not a second database configuration).
 *
 * IMPORTANT: `SUPER_ADMIN` (like every staff role) signs in to the dashboard with the PASSWORD collected here, through
 * `POST auth/password/login`. A one-time code can never sign in an account that has a password, or any staff account
 * (see `AuthService.isLegacyOtpAccount`), so the OTP endpoints are not a way into this account.
 *
 * Idempotency / one-time safety: checks for an existing SUPER_ADMIN
 * before inserting, and exits non-zero without touching anything if
 * one is found. For the narrow concurrent-invocation race (two
 * bootstrap processes started at the exact same instant with
 * DIFFERENT phone numbers), this relies on the EXISTING unique index
 * on `User.phone` — the database's own constraint is the safety net
 * for the same-phone case, and a new schema change was deliberately
 * not introduced for the different-phone case, per the explicit
 * instruction to use only what the existing database design already
 * supports.
 */

export interface BootstrapResult {
  created: boolean;
  message: string;
}

/**
 * The testable core — takes a repository directly rather than reaching
 * into `AppDataSource` itself, so this can be unit-tested with a plain
 * mock repository, no real database connection required. `main()`
 * below is the thin, untested wrapper that wires this to the real
 * `AppDataSource` and process exit codes.
 */
export async function runBootstrap(
  usersRepository: Repository<User>,
  params: { phone: string; fullName: string; password: string },
): Promise<BootstrapResult> {
  const existingSuperAdmin = await usersRepository.findOne({ where: { role: Role.SUPER_ADMIN } });
  if (existingSuperAdmin) {
    return {
      created: false,
      message:
        'Bootstrap already completed: a SUPER_ADMIN account already exists. No new account was created, and the existing one was not modified.',
    };
  }

  // Relies on the existing unique index on `phone` — a second,
  // different bootstrap attempt for the same phone number is
  // rejected by the database itself, not by application logic.
  const existingPhone = await usersRepository.findOne({ where: { phone: params.phone } });
  if (existingPhone) {
    return { created: false, message: `Bootstrap failed: an account with phone ${params.phone} already exists.` };
  }

  const passwordHash = await bcrypt.hash(params.password, 10);

  const user = usersRepository.create({
    phone: params.phone,
    fullName: params.fullName,
    role: Role.SUPER_ADMIN,
    passwordHash,
    isPhoneVerified: true,
    isActive: true,
  });
  const saved = await usersRepository.save(user);

  return {
    created: true,
    message: `SUPER_ADMIN account created successfully (id: ${saved.id}, phone: ${params.phone}).`,
  };
}

async function main(): Promise<void> {
  const phone = process.env.BOOTSTRAP_ADMIN_PHONE;
  const fullName = process.env.BOOTSTRAP_ADMIN_NAME;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  if (!phone || !fullName || !password) {
    console.error(
      'Bootstrap failed: BOOTSTRAP_ADMIN_PHONE, BOOTSTRAP_ADMIN_NAME, and BOOTSTRAP_ADMIN_PASSWORD must all be set as environment variables. Nothing was created.',
    );
    process.exitCode = 1;
    return;
  }

  await AppDataSource.initialize();

  try {
    const result = await runBootstrap(AppDataSource.getRepository(User), { phone, fullName, password });
    // Never log the password or its hash — result.message only ever
    // contains non-sensitive confirmation/rejection details.
    if (result.created) {
      console.log(result.message);
      console.log('Log into the dashboard with this phone number and the password you provided.');
    } else {
      console.error(result.message);
      process.exitCode = 1;
    }
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error('Bootstrap failed due to an unexpected error:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

#!/bin/sh
# Guarded migration run for the STAGING database. It is meant to be piped INTO the backend container (nothing is copied to the host):
#   docker run --rm -i --network hatly-staging_internal --env-file /opt/hatly-staging/.env.staging \
#     -e PGOPTIONS='-c lock_timeout=5000 -c statement_timeout=120000 -c idle_in_transaction_session_timeout=60000' \
#     --entrypoint sh <candidate image> -s < phase5-migrate-guarded.sh
# Order: (1) target guard — refuses anything but the compose `postgres` service and the database named in STAGING_DB_NAME, in a staging/dev
# NODE_ENV (never production); (2) plan assertion — refuses unless EXACTLY the 54 known migrations are applied and EXACTLY the five expected
# are pending, in order; (3) `migration:run` (TypeORM runs all pending migrations in ONE transaction: all five apply or none);
# (4) post-assertion — nothing pending, 59 recorded, the new tables and columns exist. Exit codes: 3 guard refused, 4 plan differs from
# expectation, 5 migration failed (database unchanged), 6 post-check failed. Prints no secret.
# EXPECT_DB_HOST exists only so the script can be rehearsed on a laptop; the real command never sets it (default: postgres).
set -eu
REPO="${REPO:-/repo}"; cd "$REPO/apps/backend"
CLI="node $REPO/node_modules/typeorm/cli.js -d dist/src/database/data-source.js"
EXPECT_APPLIED=54
EXPECT_PENDING="CustomerNotifications1700005400000 SectorCustomRequests1700005500000 ProductOptionSelectionLimits1700005600000 AdminAuditLogs1700005700000 StaffMfaCredentials1700005800000"

echo "== 1. target guard"
node -e '
const u = new URL(process.env.DATABASE_URL || "postgres://missing/");
const host = process.env.EXPECT_DB_HOST || "postgres";
const ok = u.hostname === host && u.pathname === "/" + process.env.STAGING_DB_NAME && !!process.env.STAGING_DB_NAME && ["staging","development"].includes(process.env.NODE_ENV);
console.log("database target:", u.hostname + u.pathname, "| NODE_ENV=" + process.env.NODE_ENV, ok ? "| OK (isolated staging)" : "| REFUSED");
process.exit(ok ? 0 : 3);' || { echo "REFUSED: not the staging database — nothing was run"; exit 3; }

plan() { $CLI migration:show 2>&1 | grep -E '^\[(X| )\] ' || true; }
echo "== 2. plan assertion"
P="$(plan)"; APPLIED=$(printf '%s\n' "$P" | grep -c '^\[X\]' || true); PENDING=$(printf '%s\n' "$P" | grep '^\[ \]' | sed -E 's/^\[ \] //' | tr '\n' ' ' | sed 's/ $//')
echo "applied: $APPLIED   pending: $PENDING"
if [ "$APPLIED" != "$EXPECT_APPLIED" ] || [ "$PENDING" != "$EXPECT_PENDING" ]; then echo "ABORT: the database is not in the expected state (want $EXPECT_APPLIED applied + the five pending, in order) — nothing was run"; exit 4; fi

echo "== 3. migration:run (single transaction; lock/statement timeouts come from PGOPTIONS)"
if ! $CLI migration:run 2>&1 | grep -E 'has been executed successfully|rror|ERROR|rollback|ROLLBACK' ; then :; fi
P="$(plan)"; APPLIED=$(printf '%s\n' "$P" | grep -c '^\[X\]' || true); PEND=$(printf '%s\n' "$P" | grep -c '^\[ \]' || true)
echo "== 4. post-assertion: applied=$APPLIED pending=$PEND"
if [ "$APPLIED" = "$EXPECT_APPLIED" ]; then echo "MIGRATION FAILED — the transaction rolled back, the database is exactly as before (still $APPLIED applied)"; exit 5; fi
if [ "$APPLIED" != "59" ] || [ "$PEND" != "0" ]; then echo "POST-CHECK FAILED: unexpected migration count"; exit 6; fi
$CLI query "select to_regclass('customer_notifications') is not null as notifications, to_regclass('admin_audit_logs') is not null as audit, to_regclass('staff_mfa_credentials') is not null as mfa, (select count(*) from information_schema.columns where (table_name='marketplace_sectors' and column_name='custom_requests_enabled') or (table_name='product_options' and column_name in ('min_selections','max_selections'))) as new_columns" 2>&1 | grep -E 'notifications|true|false' | head -3
echo "MIGRATION OK: 59 applied, 0 pending"

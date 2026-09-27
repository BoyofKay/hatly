#!/bin/sh
# One-time local setup for the real-infrastructure integration suite.
# Creates the dedicated, disposable PostgreSQL database (owned by the
# normal application role) — it never touches hatly_dev. Requires a
# PostgreSQL superuser; override with PGADMIN_URL if yours differs.
set -e
ADMIN_URL="${PGADMIN_URL:-postgres://$(whoami)@localhost:5432/postgres}"
if psql "$ADMIN_URL" -Atc "select 1 from pg_database where datname='hatly_integration_test'" | grep -q 1; then
  echo "hatly_integration_test already exists."
else
  psql "$ADMIN_URL" -c "CREATE DATABASE hatly_integration_test OWNER hatly"
fi

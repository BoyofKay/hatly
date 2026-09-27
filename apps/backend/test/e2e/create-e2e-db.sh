#!/bin/sh
# One-time local setup for the HTTP end-to-end suite: a dedicated, disposable
# PostgreSQL database (never hatly_dev / hatly_integration_test). Requires a
# PostgreSQL superuser; override with PGADMIN_URL if yours differs.
set -e
ADMIN_URL="${PGADMIN_URL:-postgres://$(whoami)@localhost:5432/postgres}"
if psql "$ADMIN_URL" -Atc "select 1 from pg_database where datname='hatly_e2e_test'" | grep -q 1; then
  echo "hatly_e2e_test already exists."
else
  psql "$ADMIN_URL" -c "CREATE DATABASE hatly_e2e_test OWNER hatly"
fi

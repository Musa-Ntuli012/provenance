#!/bin/bash
# Creates the runtime (RLS-constrained) role next to the owner role.
# Runs once on first container boot. Passwords come from the compose
# environment, never hardcode them here.
set -euo pipefail

: "${APP_ROLE_PASSWORD:?APP_ROLE_PASSWORD must be set}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'provenance_app') THEN
    CREATE ROLE provenance_app LOGIN PASSWORD '${APP_ROLE_PASSWORD}';
  END IF;
END
\$\$;
SQL

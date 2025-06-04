#!/bin/bash
# Apply migrations in server/migrations sequentially
set -e

MIGRATIONS_DIR="$(dirname "$0")/../migrations"
DB="$DATABASE_URL"
if [ -z "$DB" ]; then
  echo "DATABASE_URL not set" >&2
  exit 1
fi

# Ensure migrations tracking table exists
psql "$DB" <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  id SERIAL PRIMARY KEY,
  filename TEXT UNIQUE NOT NULL,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
SQL

for file in $(ls "$MIGRATIONS_DIR" | sort); do
  if [ -f "$MIGRATIONS_DIR/$file" ]; then
    APPLIED=$(psql "$DB" -tAc "SELECT 1 FROM schema_migrations WHERE filename='$file'")
    if [ "$APPLIED" != "1" ]; then
      echo "Applying $file"
      psql "$DB" -f "$MIGRATIONS_DIR/$file"
      psql "$DB" -c "INSERT INTO schema_migrations(filename) VALUES ('$file')"
    fi
  fi
done

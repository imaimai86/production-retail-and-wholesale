#!/bin/bash
# Deploy schema to PostgreSQL
# Usage: DATABASE_URL=postgres://user:pass@host/db ./db.sh

set -e

SCHEMA_DIR="$(dirname "$0")/.."
psql "$DATABASE_URL" -f "$SCHEMA_DIR/schema.sql"

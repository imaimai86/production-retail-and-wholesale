#!/bin/bash
set -e
DUMP_FILE=/backup/dump.sql
if [ -f "$DUMP_FILE" ]; then
  echo "Restoring database from $DUMP_FILE"
  psql -U "$POSTGRES_USER" "$POSTGRES_DB" < "$DUMP_FILE"
fi
backup() {
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > "$DUMP_FILE"
  echo "Database backed up to $DUMP_FILE"
}
trap backup SIGTERM SIGINT
exec /usr/local/bin/docker-entrypoint.sh postgres

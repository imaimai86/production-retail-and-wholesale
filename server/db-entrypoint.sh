#!/bin/bash
set -e

backup_file="/var/lib/postgresql/backup/backup.sql"

cleanup() {
  echo "Exporting database to $backup_file"
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" > "$backup_file"
}
trap cleanup EXIT

/usr/local/bin/docker-entrypoint.sh postgres &

# wait for server to start
until pg_isready -U "$POSTGRES_USER"; do
  sleep 1
done

if [ -f "$backup_file" ]; then
  echo "Importing database from $backup_file"
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$backup_file"
fi

wait

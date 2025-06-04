#!/bin/bash
set -e
cd "$(dirname "$0")/server"

npm install

if [ -n "$DATABASE_URL" ]; then
  ./script/migrate.sh
fi

npm run start &
cd - >/dev/null

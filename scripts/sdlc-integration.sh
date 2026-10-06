#!/usr/bin/env bash
# Run the integration suite (npm run test:integration) the way the SDLC pipeline does.
# Uses DATABASE_URL if set, otherwise starts a throwaway Postgres container with Docker.
# Run from the repo root. Env: CI, SDLC_INTEGRATION_CI (see README.md "SDLC pipeline: integration tests").
set -euo pipefail

# TODO(temporary): remove this skip once CI provides a database
if [ -n "${CI:-}" ] && [ "${SDLC_INTEGRATION_CI:-}" != "run" ]; then
  echo "WARNING: TEMPORARY: integration tests skipped in CI. Set SDLC_INTEGRATION_CI=run once CI has a database."
  exit 0
fi

if ! node -e 'const s=require("./server/package.json").scripts||{}; process.exit(s["test:integration"]?0:1)'; then
  echo "ERROR: no test:integration script in server/package.json (see add-db-integration-tests)"
  exit 1
fi

if [ -n "${DATABASE_URL:-}" ]; then
  :
elif command -v docker >/dev/null 2>&1; then
  PW="$(openssl rand -hex 8)"
  NAME="prw-sdlc-db-$$"
  cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  docker run -d --rm --name "$NAME" -e POSTGRES_USER=app -e POSTGRES_PASSWORD="$PW" \
    -e POSTGRES_DB=app -p 127.0.0.1::5432 postgres:16 >/dev/null
  PORT="$(docker port "$NAME" 5432/tcp | head -n1 | sed -E 's/.*://')"
  case "$PORT" in
    ''|*[!0-9]*) echo "ERROR: could not determine database container port"; exit 1 ;;
  esac
  ready=0
  for ((attempt = 1; attempt <= 60; attempt++)); do
    if docker exec "$NAME" pg_isready -h 127.0.0.1 -U app -d app >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 1
  done
  if [ "$ready" -ne 1 ]; then
    echo "ERROR: database container not ready after 60 attempts"
    exit 1
  fi
  export DATABASE_URL="postgres://app:${PW}@127.0.0.1:${PORT}/app"
else
  echo "ERROR: integration tests need DATABASE_URL or docker"
  exit 1
fi

rc=0
npm run test:integration --prefix server || rc=$?
exit "$rc"

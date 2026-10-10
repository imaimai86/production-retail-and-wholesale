#!/usr/bin/env bash
# Run the integration suite (npm run test:integration) the way the SDLC pipeline does.
# Database: DATABASE_URL from the shell, else from the repo-root .env (local host only), else a throwaway Docker Postgres.
# Run from the repo root. Env: CI, SDLC_INTEGRATION_CI, SDLC_DB, SDLC_ALLOW_REMOTE_DB (see README.md "SDLC pipeline: integration tests").
# Exit codes: 0 suite passed (or skipped in CI), 1 tests failed or another error, 3 infrastructure missing
# (no test:integration script, or neither DATABASE_URL nor docker), so callers can tell "tests are red" from "cannot run".
set -euo pipefail

# TODO(temporary): remove this skip once CI provides a database
if [ -n "${CI:-}" ] && [ "${SDLC_INTEGRATION_CI:-}" != "run" ]; then
  echo "WARNING: TEMPORARY: integration tests skipped in CI. Set SDLC_INTEGRATION_CI=run once CI has a database."
  exit 0
fi

if ! node -e 'const s=require("./server/package.json").scripts||{}; process.exit(s["test:integration"]?0:1)'; then
  echo "ERROR: no test:integration script in server/package.json (see add-db-integration-tests)"
  exit 3
fi

# Database, first match wins:
#   1. DATABASE_URL already set in the shell
#   2. DATABASE_URL in the repo-root .env (the file the server reads); local hosts only, and only if it answers
#   3. a throwaway Postgres container (Docker)
# SDLC_DB=docker skips 1 and 2. SDLC_ALLOW_REMOTE_DB=1 allows a non-local host in .env.
# The suite creates and drops its own prw_test_* databases, so parallel runs can share one server.
[ "${SDLC_DB:-}" = docker ] && unset DATABASE_URL
if [ -z "${DATABASE_URL:-}" ] && [ "${SDLC_DB:-}" != docker ] && [ -f .env ]; then
  DB_FROM_ENV="$(node -e '
    const raw = (require("./server/node_modules/dotenv").parse(require("fs").readFileSync(".env")).DATABASE_URL || "").trim();
    if (!raw) process.exit(0);
    let u;
    try { u = new URL(raw); } catch (e) { console.error("WARNING: DATABASE_URL in .env is not a valid URL; ignoring it."); process.exit(0); }
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (!["localhost", "127.0.0.1", "::1"].includes(host) && process.env.SDLC_ALLOW_REMOTE_DB !== "1") {
      console.error("WARNING: DATABASE_URL in .env points at " + host + ", not this machine; ignoring it (SDLC_ALLOW_REMOTE_DB=1 allows it).");
      process.exit(0);
    }
    const port = Number(u.port || 5432);
    const s = require("net").connect({ host, port, timeout: 2000 });
    s.on("connect", () => { process.stdout.write(raw); s.end(); });
    const down = () => { console.error("WARNING: nothing is listening on " + host + ":" + port + " (DATABASE_URL in .env); ignoring it."); process.exit(0); };
    s.on("timeout", down); s.on("error", down);
  ' || true)"
  if [ -n "$DB_FROM_ENV" ]; then
    export DATABASE_URL="$DB_FROM_ENV"
    echo "Using DATABASE_URL from .env"
  fi
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
  exit 3
fi

rc=0
npm run test:integration --prefix server || rc=$?
exit "$rc"

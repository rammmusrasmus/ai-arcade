#!/bin/sh
set -e

echo "[entrypoint] preparing /data"
mkdir -p /data/storage/public

echo "[entrypoint] applying database migrations"
node /app/api/dist/db/migrate.js

echo "[entrypoint] ensuring admin account (from ADMIN_EMAILS)"
node /app/api/dist/db/seed.js || echo "[entrypoint] seed skipped/failed (non-fatal)"

echo "[entrypoint] starting AI Arcade"
exec node /app/api/dist/server.js

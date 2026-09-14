#!/bin/sh
set -e

echo "[entrypoint] preparing /data"
mkdir -p /data/storage/public

echo "[entrypoint] applying database migrations"
node /app/api/dist/db/migrate.js

# No admin account is pre-created: an ADMIN_EMAILS address gets the admin role when it
# registers (and confirms the emailed code) in the desktop app.

echo "[entrypoint] starting AI Arcade"
exec node /app/api/dist/server.js

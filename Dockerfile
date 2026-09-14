# syntax=docker/dockerfile:1
# AI Arcade server — one container: the desktop app's API + multiplayer relay + stored games.
# All persistent state lives under /data (mount a volume).

# ---------- builder ----------
FROM node:22-slim AS builder
WORKDIR /repo

# install deps against just the manifests first (better layer caching)
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/desktop/package.json apps/desktop/
# the desktop workspace's Electron binary is never used on the server
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm ci

COPY . .
RUN npm run build:shared \
 && npm run build --workspace @ai-arcade/api \
 && npm prune --omit=dev   # drop electron / vite / tsc etc. before we copy node_modules

# ---------- runtime ----------
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=4000 \
    DATABASE_URL=file:/data/ai-arcade.db \
    STORAGE_DIR=/data/storage
WORKDIR /app/api

# node_modules from the builder = the linux build of @libsql/client and friends
COPY --from=builder /repo/node_modules /app/node_modules
# replace the workspace symlinks with the real built package
RUN rm -rf /app/node_modules/@ai-arcade
COPY --from=builder /repo/packages/shared/package.json /app/node_modules/@ai-arcade/shared/package.json
COPY --from=builder /repo/packages/shared/dist         /app/node_modules/@ai-arcade/shared/dist
COPY --from=builder /repo/apps/api/package.json /app/api/package.json
COPY --from=builder /repo/apps/api/dist         /app/api/dist
COPY --from=builder /repo/apps/api/drizzle      /app/api/drizzle
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

VOLUME /data
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["/entrypoint.sh"]

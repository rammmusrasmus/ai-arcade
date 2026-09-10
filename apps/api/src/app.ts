import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { resolveUser } from "./auth/index.js";
import { env } from "./env.js";
import { AppError, forbidden, registerErrorHandler } from "./lib/errors.js";
import { authRoutes } from "./routes/auth.js";
import { authoringRoutes } from "./routes/authoring.js";
import { downloadRoutes } from "./routes/download.js";
import { gameRoutes } from "./routes/games.js";
import { moderationRoutes } from "./routes/moderation.js";
import { multiplayerRoutes } from "./routes/multiplayer.js";
import { uploadRoutes } from "./routes/uploads.js";
import { storage } from "./storage/index.js";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// Cookie-authenticated mutations to these paths are allowed without the
// app header / matching Origin (they establish the session in the first place).
const CSRF_EXEMPT = new Set(["/auth/logout"]);

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      env.NODE_ENV === "development"
        ? { transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } } }
        : true,
    bodyLimit: 1 * 1024 * 1024,
    trustProxy: env.isProd,
  });

  await app.register(cookie, { secret: env.AUTH_SECRET });

  await app.register(cors, {
    origin(origin, cb) {
      // Allow same-origin / native clients (no Origin header) and known web origins.
      if (!origin || env.webOrigins.includes(origin)) return cb(null, true);
      // CORS_ORIGINS="*" reflects any origin (safe here: cross-origin mutations
      // still need a bearer token or the CSRF header + trusted Origin).
      if (env.corsAny) return cb(null, true);
      if (env.corsOrigins.includes(origin)) return cb(null, true);
      try {
        const host = new URL(origin).hostname;
        if (host === "localhost" || host === "127.0.0.1") return cb(null, true);
      } catch {
        /* fall through */
      }
      cb(null, false);
    },
    credentials: true,
    exposedHeaders: [
      "x-game-id",
      "x-game-slug",
      "x-game-version",
      "x-entry-path",
      "x-bundle-sha256",
    ],
  });

  await app.register(multipart, {
    limits: {
      fileSize: env.MAX_BUNDLE_BYTES,
      files: 1,
      fields: 10,
      fieldSize: 100 * 1024,
    },
  });

  // Static: extracted game bundles + uploaded images, served at /files.
  await app.register(fastifyStatic, {
    root: storage.publicRoot(),
    prefix: "/files/",
    index: false,
    setHeaders(res, path) {
      res.setHeader("x-content-type-options", "nosniff");
      res.setHeader("access-control-allow-origin", "*");
      const isGameAsset = path.replace(/\\/g, "/").includes("/public/games/");
      if (isGameAsset) {
        // Force every game document into an opaque origin so it cannot make
        // credentialed same-origin calls back to this API.
        res.setHeader(
          "content-security-policy",
          "sandbox allow-scripts allow-pointer-lock allow-downloads allow-modals",
        );
      }
    },
  });

  /* ---- auth context + CSRF guard ---- */

  app.addHook("onRequest", async (req) => {
    const resolved = await resolveUserWithSource(req);
    req.user = resolved?.user ?? null;
    (req as unknown as { authSource?: "cookie" | "bearer" }).authSource = resolved?.source;
  });

  app.addHook("onRequest", async (req) => {
    if (!MUTATING.has(req.method)) return;
    const source = (req as unknown as { authSource?: "cookie" | "bearer" }).authSource;
    if (source !== "cookie") return; // bearer clients are not CSRF-prone
    if (CSRF_EXEMPT.has(req.url.split("?")[0]!)) return;
    const appHeader = req.headers["x-aa-app"] === "1";
    const origin = req.headers.origin;
    const originOk = typeof origin === "string" && env.webOrigins.includes(origin);
    if (!appHeader && !originOk) {
      throw forbidden("CSRF check failed: missing X-AA-App header or trusted Origin");
    }
  });

  registerErrorHandler(app);

  app.get("/health", async () => ({
    ok: true,
    time: new Date().toISOString(),
    github: env.githubEnabled,
    devLogin: env.DEV_LOGIN_ENABLED && !env.isProd,
  }));

  await app.register(async (api) => {
    await authRoutes(api);
    await gameRoutes(api);
    await authoringRoutes(api);
    await downloadRoutes(api);
    await moderationRoutes(api);
    await uploadRoutes(api);
    await multiplayerRoutes(api);
  });

  // Optionally serve the built web app (apps/web/dist) from this origin, so one
  // URL / tunnel covers browsing, uploading, moderation, games and the relay.
  const webDist =
    process.env.WEB_DIST ||
    resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  if (existsSync(join(webDist, "index.html"))) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: "/",
      decorateReply: false,
      wildcard: false,
    });
    app.setNotFoundHandler((req, reply) => {
      const wantsHtml = (req.headers.accept ?? "").includes("text/html");
      if (req.method === "GET" && wantsHtml) {
        return reply.type("text/html").sendFile("index.html", webDist);
      }
      reply.code(404).send({ error: { code: "not_found", message: "Not found" } });
    });
    app.log.info(`serving web app from ${webDist}`);
  }

  return app;
}

async function resolveUserWithSource(req: Parameters<typeof resolveUser>[0]) {
  const header = req.headers.authorization;
  const source: "cookie" | "bearer" = header?.startsWith("Bearer ") ? "bearer" : "cookie";
  const user = await resolveUser(req);
  return user ? { user, source } : null;
}

export { AppError };

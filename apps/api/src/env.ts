import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/* --------------------------------------------------------------- */
/* Tiny .env loader (no dependency).                                */
/* Loads <repo>/.env then apps/api/.env; never overrides a value   */
/* already present in process.env.                                 */
/* --------------------------------------------------------------- */

const here = dirname(fileURLToPath(import.meta.url));
const candidates = [
  resolve(here, "../../../.env"), // monorepo root
  resolve(here, "../.env"), // apps/api/.env
];

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key in process.env) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

for (const path of candidates) loadEnvFile(path);

/* --------------------------------------------------------------- */
/* Schema                                                          */
/* --------------------------------------------------------------- */

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : /^(1|true|yes|on)$/i.test(v)));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  API_PORT: z.coerce.number().int().default(4000),
  API_HOST: z.string().default("127.0.0.1"),
  PUBLIC_API_URL: z.string().url().default("http://127.0.0.1:4000"),
  WEB_ORIGIN: z.string().default("http://127.0.0.1:5173"),

  // Signs session cookies + OAuth state. Long, because a weak secret here would
  // let an attacker forge sessions — this is a "keys to the login data" secret.
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 chars — generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""),

  DATABASE_URL: z.string().default("file:./data/ai-arcade.db"),

  STORAGE_DRIVER: z.enum(["local"]).default("local"),
  STORAGE_DIR: z.string().default("./data/storage"),

  GITHUB_CLIENT_ID: z.string().optional().default(""),
  GITHUB_CLIENT_SECRET: z.string().optional().default(""),
  DEV_LOGIN_ENABLED: bool(false),
  PASSWORD_AUTH_ENABLED: bool(true),
  ADMIN_EMAILS: z.string().optional().default(""),

  // Outgoing mail for the mandatory "confirm it's you" login code. Leave
  // SMTP_HOST blank in development — codes are logged to the server console
  // instead of emailed, so the flow still works with no mail provider set up.
  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASS: z.string().optional().default(""),
  SMTP_FROM: z.string().optional().default("AI Arcade <noreply@ai-arcade.local>"),

  MAX_BUNDLE_BYTES: z.coerce.number().int().default(50 * 1024 * 1024),
  MAX_UNZIPPED_BYTES: z.coerce.number().int().default(200 * 1024 * 1024),
  MAX_BUNDLE_FILES: z.coerce.number().int().default(2000),

  // Extra allowed CORS origins (comma-separated), or "*" to reflect any origin.
  // Cross-origin mutations still require a bearer token or CSRF header, so "*" is
  // acceptable for sharing the API with remote clients (tunnel / LAN / deploy).
  CORS_ORIGINS: z.string().optional().default(""),

  // Lockstep multiplayer relay (lobby + verbatim order/hash relay for games).
  MULTIPLAYER_ENABLED: bool(true),
  MP_PATH: z.string().default("/mp"),
  MP_MAX_LOBBIES: z.coerce.number().int().default(500),
  // Public ws:// or wss:// URL the browser/game should connect to. Defaults to
  // PUBLIC_API_URL with the scheme swapped and MP_PATH appended.
  PUBLIC_WS_URL: z.string().optional().default(""),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProd: raw.NODE_ENV === "production",
  webOrigins: raw.WEB_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean),
  adminEmails: new Set(
    raw.ADMIN_EMAILS.split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  ),
  githubEnabled: Boolean(raw.GITHUB_CLIENT_ID && raw.GITHUB_CLIENT_SECRET),
  passwordAuthEnabled: raw.PASSWORD_AUTH_ENABLED,
  smtpConfigured: Boolean(raw.SMTP_HOST),
  corsAny: raw.CORS_ORIGINS.trim() === "*",
  corsOrigins: raw.CORS_ORIGINS.split(",").map((s) => s.trim()).filter((s) => s && s !== "*"),
  /** Normalised multiplayer relay path, always starting with "/". */
  mpPath: raw.MP_PATH.startsWith("/") ? raw.MP_PATH : `/${raw.MP_PATH}`,
  /** Public WebSocket URL for the relay (scheme-swapped PUBLIC_API_URL + MP_PATH unless overridden). */
  publicWsUrl:
    raw.PUBLIC_WS_URL ||
    raw.PUBLIC_API_URL.replace(/^http(s?):\/\//, "ws$1://").replace(/\/+$/, "") +
      (raw.MP_PATH.startsWith("/") ? raw.MP_PATH : `/${raw.MP_PATH}`),
  /** Absolute path to the storage directory. */
  storageDir: resolve(process.cwd(), raw.STORAGE_DIR),
  /** Absolute path to the sqlite file (when DATABASE_URL is file:). */
  sqlitePath: raw.DATABASE_URL.startsWith("file:")
    ? resolve(process.cwd(), raw.DATABASE_URL.slice("file:".length))
    : null,
};

export type Env = typeof env;

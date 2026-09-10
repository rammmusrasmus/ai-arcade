import { resolve } from "node:path";
import { defineConfig } from "drizzle-kit";

// Kept dependency-free so drizzle-kit can bundle this config on its own.
const raw = process.env.DATABASE_URL ?? "file:./data/ai-arcade.db";
const url = raw.startsWith("file:")
  ? `file:${resolve(process.cwd(), raw.slice("file:".length))}`
  : raw;

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: { url },
  verbose: true,
  strict: true,
});

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { env } from "../env.js";
import * as schema from "./schema.js";

if (env.sqlitePath) {
  mkdirSync(dirname(env.sqlitePath), { recursive: true });
}

export const libsql = createClient({
  url: env.sqlitePath ? `file:${env.sqlitePath}` : env.DATABASE_URL,
});

// Pragmas for a local single-writer setup.
await libsql.execute("PRAGMA journal_mode = WAL;");
await libsql.execute("PRAGMA foreign_keys = ON;");
await libsql.execute("PRAGMA busy_timeout = 5000;");

export const db = drizzle(libsql, { schema });
export { schema };
export type DB = typeof db;

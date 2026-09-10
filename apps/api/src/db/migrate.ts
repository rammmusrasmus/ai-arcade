import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/libsql/migrator";
import { db, libsql } from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, "../../drizzle");

console.log(`Applying migrations from ${migrationsFolder} ...`);
await migrate(db, { migrationsFolder });
console.log("Migrations up to date.");
libsql.close();

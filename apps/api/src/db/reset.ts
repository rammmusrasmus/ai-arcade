import { rmSync } from "node:fs";
import { env } from "../env.js";

if (!env.sqlitePath) {
  console.error("db:reset only supports a file: DATABASE_URL");
  process.exit(1);
}

for (const suffix of ["", "-wal", "-shm"]) {
  try {
    rmSync(env.sqlitePath + suffix, { force: true });
  } catch {
    /* ignore */
  }
}
console.log(`Removed ${env.sqlitePath} (+ wal/shm). Run "npm run db:migrate" to recreate.`);

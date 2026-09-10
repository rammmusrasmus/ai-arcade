import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import AdmZip from "adm-zip";

export interface GameBundle {
  buffer: Buffer;
  files: string[];
  /** Absolute http(s) URLs referenced in the bundle's HTML/CSS. */
  externalRefs: string[];
  hasEntry: boolean;
}

// dev-only files that shouldn't ship inside a game bundle
const SKIP = [
  /^\./,
  /^node_modules$/i,
  /\.zip$/i,
  /\.md$/i,
  /^lobby\.(js|mjs|cjs)$/i,
  /^serve\.(js|mjs|cjs)$/i,
  /^thumbs\.db$/i,
  /^package(-lock)?\.json$/i,
];

const MAX_BYTES = 50 * 1024 * 1024;

/** Zip every non-dev file in `dir` flat (no subdirectories). Throws on problems. */
export function zipGameFolder(dir: string, entry = "index.html"): GameBundle {
  const names = readdirSync(dir).filter((name) => {
    let s;
    try {
      s = statSync(join(dir, name));
    } catch {
      return false;
    }
    return s.isFile() && !SKIP.some((re) => re.test(name));
  });

  if (names.length === 0) throw new Error("That folder has no files to bundle.");

  const zip = new AdmZip();
  const external: string[] = [];
  let total = 0;
  for (const name of names) {
    const buf = readFileSync(join(dir, name));
    total += buf.length;
    if (total > MAX_BYTES) throw new Error("The folder is larger than the 50 MB limit.");
    zip.addFile(basename(name), buf);
    if (/\.(html?|css)$/i.test(name)) {
      external.push(...(buf.toString("utf8").match(/https?:\/\/[^\s"'<>)]+/g) ?? []));
    }
  }

  return {
    buffer: zip.toBuffer(),
    files: names,
    externalRefs: [...new Set(external)],
    hasEntry: names.some((n) => n.toLowerCase() === entry.toLowerCase()),
  };
}

/** Read an existing .zip, returning its bytes + a quick external-URL scan. */
export function readGameZip(path: string): GameBundle {
  const buffer = readFileSync(path);
  if (buffer.length > MAX_BYTES) throw new Error("That zip is larger than the 50 MB limit.");
  const zip = new AdmZip(buffer);
  const files: string[] = [];
  const external: string[] = [];
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    files.push(e.entryName);
    if (/\.(html?|css)$/i.test(e.entryName)) {
      external.push(...(e.getData().toString("utf8").match(/https?:\/\/[^\s"'<>)]+/g) ?? []));
    }
  }
  return {
    buffer,
    files,
    externalRefs: [...new Set(external)],
    hasEntry: files.some((n) => /(^|\/)index\.html?$/i.test(n)),
  };
}

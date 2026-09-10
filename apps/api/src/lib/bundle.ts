import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import AdmZip from "adm-zip";
import { badRequest, payloadTooLarge, unprocessable } from "./errors.js";

export interface BundleLimits {
  maxFiles: number;
  maxUnzippedBytes: number;
}

export interface BundleInfo {
  sha256: string;
  fileCount: number;
  unzippedBytes: number;
  /** POSIX-style path of the HTML entry file inside the bundle. */
  entryPath: string;
  /** All safe, normalized POSIX entry paths (files only). */
  files: string[];
  /**
   * Absolute http(s) URLs referenced by resource tags in the bundle's HTML/CSS
   * (script src, link href, img src, CSS url()/@import, …). The desktop client
   * blocks all network egress except the multiplayer relay, so these will NOT
   * load there even though they work in the browser player. Surfaced as a
   * warning, not a hard failure.
   */
  externalRefs: string[];
}

/** Scan HTML/CSS text for absolute http(s) resource references. */
function scanExternalRefs(text: string): string[] {
  const out: string[] = [];
  const patterns = [
    // <script src="…">, <link href="…">, <img src="…">, <iframe|audio|video|source|track|embed src>, <object data>
    /<(?:script|link|img|iframe|audio|video|source|track|embed|object)\b[^>]*?\b(?:src|href|data)\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi,
    // CSS  url(https://…)  and  @import "https://…"
    /url\(\s*["']?(https?:\/\/[^"'\s)]+)/gi,
    /@import\s+(?:url\(\s*)?["']?(https?:\/\/[^"'\s);]+)/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[1]) out.push(m[1]);
    }
  }
  return out;
}

const BLOCKED_EXT = new Set([
  ".exe", ".dll", ".so", ".dylib", ".bat", ".cmd", ".com", ".msi",
  ".sh", ".ps1", ".jar", ".php", ".asp", ".aspx", ".jsp",
]);

/** Reject path traversal, absolute paths, drive letters, NUL bytes. */
function safeRelPath(raw: string): string | null {
  if (!raw || raw.includes("\0")) return null;
  const posix = raw.replace(/\\/g, "/");
  if (posix.startsWith("/") || /^[a-zA-Z]:/.test(posix)) return null;
  const parts = posix.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === "..")) return null;
  return parts.join("/");
}

function pickEntry(files: string[], preferred?: string): string {
  if (preferred) {
    const norm = safeRelPath(preferred);
    if (!norm || !files.includes(norm)) {
      throw unprocessable(`entryPath "${preferred}" was not found in the bundle`);
    }
    if (!/\.html?$/i.test(norm)) {
      throw unprocessable("entryPath must be an .html file");
    }
    return norm;
  }
  const htmls = files.filter((f) => /\.html?$/i.test(f));
  if (htmls.length === 0) {
    throw unprocessable(
      "No .html file found in the bundle. The game must have an HTML entry point (e.g. index.html).",
    );
  }
  // Prefer index.html closest to the root, then the shallowest html, then first.
  const byDepth = (f: string) => f.split("/").length;
  htmls.sort((a, b) => byDepth(a) - byDepth(b) || a.localeCompare(b));
  const rootIndex = htmls.find((f) => f.toLowerCase() === "index.html");
  const anyIndex = htmls.find((f) => f.toLowerCase().endsWith("/index.html"));
  return rootIndex ?? anyIndex ?? htmls[0]!;
}

/**
 * Validate an uploaded zip. Throws AppError on any problem.
 * Does NOT write anything to disk.
 */
export function inspectBundle(
  buffer: Buffer,
  limits: BundleLimits,
  preferredEntry?: string,
): BundleInfo {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw badRequest("The uploaded file is not a valid .zip archive");
  }

  const entries = zip.getEntries();
  const files: string[] = [];
  const externalRefs = new Set<string>();
  let unzippedBytes = 0;

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const rel = safeRelPath(entry.entryName);
    if (rel === null) {
      throw unprocessable(`Unsafe path in archive: "${entry.entryName}"`);
    }
    const dot = rel.lastIndexOf(".");
    const ext = dot === -1 ? "" : rel.slice(dot).toLowerCase();
    if (BLOCKED_EXT.has(ext)) {
      throw unprocessable(`Disallowed file type in bundle: "${rel}"`);
    }
    unzippedBytes += entry.header.size;
    if (unzippedBytes > limits.maxUnzippedBytes) {
      throw payloadTooLarge(
        `Bundle expands to more than ${Math.round(limits.maxUnzippedBytes / 1024 / 1024)} MB`,
      );
    }
    files.push(rel);
    if (files.length > limits.maxFiles) {
      throw unprocessable(`Bundle has more than ${limits.maxFiles} files`);
    }

    if (/\.(html?|css)$/i.test(rel) && externalRefs.size < 50) {
      for (const url of scanExternalRefs(entry.getData().toString("utf8"))) {
        externalRefs.add(url);
        if (externalRefs.size >= 50) break;
      }
    }
  }

  if (files.length === 0) throw unprocessable("The archive is empty");

  const entryPath = pickEntry(files, preferredEntry);
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  return {
    sha256,
    fileCount: files.length,
    unzippedBytes,
    entryPath,
    files,
    externalRefs: [...externalRefs],
  };
}

/**
 * Extract the (already-inspected) bundle to `targetDir`. Re-validates each
 * path against traversal before writing.
 */
export function extractBundle(buffer: Buffer, targetDir: string): void {
  const zip = new AdmZip(buffer);
  const root = normalize(targetDir);
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const rel = safeRelPath(entry.entryName);
    if (rel === null) continue;
    const dest = normalize(join(root, rel));
    if (dest !== root && !dest.startsWith(root + sep)) continue;
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, entry.getData());
  }
}

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import { app } from "electron";
import AdmZip from "adm-zip";
import { getApiUrl } from "./config.js";
import { store } from "./store.js";

export interface InstalledGame {
  gameId: string;
  slug: string;
  title: string;
  version: number;
  entryPath: string;
  sha256: string;
  sizeBytes: number;
  installedAt: string;
  lastPlayedAt: string | null;
}

const libRoot = () => {
  const d = join(app.getPath("userData"), "library");
  mkdirSync(d, { recursive: true });
  return d;
};
const manifestPath = () => join(libRoot(), "games.json");
export const gameDir = (gameId: string) => join(libRoot(), gameId);

function readManifest(): InstalledGame[] {
  try {
    if (!existsSync(manifestPath())) return [];
    return JSON.parse(readFileSync(manifestPath(), "utf8")) as InstalledGame[];
  } catch {
    return [];
  }
}

function writeManifest(list: InstalledGame[]) {
  writeFileSync(manifestPath(), JSON.stringify(list, null, 2), "utf8");
}

export function listLibrary(): InstalledGame[] {
  return readManifest().sort((a, b) => (b.lastPlayedAt ?? b.installedAt).localeCompare(a.lastPlayedAt ?? a.installedAt));
}

export function getInstalled(gameId: string): InstalledGame | undefined {
  return readManifest().find((g) => g.gameId === gameId);
}

function safeExtract(zipBuffer: Buffer, targetDir: string): number {
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
  const root = normalize(targetDir);
  const zip = new AdmZip(zipBuffer);
  let bytes = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const rel = entry.entryName.replace(/\\/g, "/");
    if (rel.includes("\0") || rel.startsWith("/") || /^[a-zA-Z]:/.test(rel)) continue;
    if (rel.split("/").some((p) => p === "..")) continue;
    const dest = normalize(join(root, rel));
    if (dest !== root && !dest.startsWith(root + sep)) continue;
    mkdirSync(dirname(dest), { recursive: true });
    const data = entry.getData();
    writeFileSync(dest, data);
    bytes += data.length;
  }
  return bytes;
}

/** Download the approved bundle for a game and unpack it into the library. */
export async function installGame(gameId: string): Promise<InstalledGame> {
  const token = store.getToken();
  const res = await fetch(`${getApiUrl()}/games/${encodeURIComponent(gameId)}/download`, {
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "x-client": "desktop",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Download failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const slug = res.headers.get("x-game-slug") ?? gameId;
  const version = Number(res.headers.get("x-game-version") ?? "1");
  const entryPath = res.headers.get("x-entry-path") ?? "index.html";
  const sha256 = res.headers.get("x-bundle-sha256") ?? "";
  const buffer = Buffer.from(await res.arrayBuffer());

  const sizeBytes = safeExtract(buffer, gameDir(gameId));

  // Title: try the content-disposition, else fall back to slug.
  const title =
    (res.headers.get("content-disposition") ?? "")
      .match(/filename="?([^"]+?)-v\d+\.zip"?/)?.[1]
      ?.replace(/-/g, " ") ?? slug;

  const entry: InstalledGame = {
    gameId,
    slug,
    title: titleCase(title),
    version,
    entryPath,
    sha256,
    sizeBytes,
    installedAt: new Date().toISOString(),
    lastPlayedAt: null,
  };

  const list = readManifest().filter((g) => g.gameId !== gameId);
  list.push(entry);
  writeManifest(list);
  return entry;
}

export function uninstallGame(gameId: string): void {
  rmSync(gameDir(gameId), { recursive: true, force: true });
  writeManifest(readManifest().filter((g) => g.gameId !== gameId));
}

export function markPlayed(gameId: string): void {
  const list = readManifest();
  const g = list.find((x) => x.gameId === gameId);
  if (g) {
    g.lastPlayedAt = new Date().toISOString();
    writeManifest(list);
  }
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

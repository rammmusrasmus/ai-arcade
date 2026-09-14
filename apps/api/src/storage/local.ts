import { mkdirSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Storage } from "./index.js";

/**
 * Filesystem layout under <root>:
 *   bundles/<versionId>.zip        original uploads (private)
 *   public/games/<gameId>/<versionId>/...   extracted for validation (not served)
 *   public/images/<imageId>.<ext>          uploaded images, served at /files/images
 */
export class LocalStorage implements Storage {
  private readonly root: string;
  private readonly publicUrlBase: string;

  constructor(root: string, publicApiUrl: string) {
    this.root = root;
    this.publicUrlBase = publicApiUrl.replace(/\/+$/, "");
    mkdirSync(join(root, "bundles"), { recursive: true });
    mkdirSync(join(root, "public", "games"), { recursive: true });
    mkdirSync(join(root, "public", "images"), { recursive: true });
  }

  publicRoot(): string {
    return join(this.root, "public");
  }

  bundlePath(key: string): string {
    return join(this.root, "bundles", key);
  }

  async putBundle(versionId: string, data: Buffer): Promise<string> {
    const key = `${versionId}.zip`;
    await writeFile(this.bundlePath(key), data);
    return key;
  }

  async readBundle(key: string): Promise<Buffer> {
    return readFile(this.bundlePath(key));
  }

  extractedDir(gameId: string, versionId: string): string {
    return join(this.root, "public", "games", gameId, versionId);
  }

  async removeExtracted(gameId: string, versionId: string): Promise<void> {
    await rm(this.extractedDir(gameId, versionId), { recursive: true, force: true });
  }

  async putImage(imageId: string, ext: string, data: Buffer): Promise<string> {
    const name = `${imageId}${ext}`;
    await writeFile(join(this.root, "public", "images", name), data);
    return `${this.publicUrlBase}/files/images/${name}`;
  }
}
